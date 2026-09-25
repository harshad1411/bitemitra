// The pricing pipeline (PRICING.md §4–§8, DECISIONS D-49). Pure: (cart, context, rules, settings, now) → quote.
// No database, network or clock access. Every quote passes the invariant checks before it is returned.
import { localTime, parseHHmm } from '@jamzo/catalog-engine';
import { resolveScoped } from '@jamzo/config';
import { allocate, applyBps, divRoundHalfUp, inclusiveTax, roundToStep } from './money.js';
import { PricingError, parseRuleParams } from './rules.js';

export const ENGINE_VERSION = '2026.09-1';
const STEP = { NEAREST_1: 100, NEAREST_5: 500, NEAREST_10: 1000 };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * @typedef {object} CartLine
 * @property {string} key client line key
 * @property {string} productId
 * @property {string | null} [variantId]
 * @property {string | null} [categoryId] platform food category
 * @property {string} name
 * @property {number} unitBasePaise restaurant price of one unit (variant price when a variant is chosen), excl. add-ons
 * @property {number} quantity
 * @property {{ addonId: string, name: string, basePricePaise: number }[]} [addons]
 * @property {number} [packagingPaise] per unit, already resolved (product → restaurant default)
 * @property {boolean | null} [taxInclusive] product-level override of the tax rule's mode
 */

/**
 * @typedef {object} QuoteContext
 * @property {string} [countryId] @property {string} [stateId] @property {string} cityId
 * @property {string | null} [restaurantZoneId] zone of the restaurant branch (markup, commission, tax, packaging)
 * @property {string | null} [deliveryZoneId] zone of the customer (delivery, surcharges, platform fee, rider)
 * @property {string} restaurantId @property {string} [branchId]
 * @property {string} timeZone
 * @property {number} distanceM @property {'ROAD' | 'FALLBACK'} distanceSource
 * @property {string | null} [paymentMethod]
 * @property {number} [pastOrderCount] completed orders of this customer (Phase 5; 0 until then — D-52)
 */

/**
 * Candidate rule rows (as stored: { id, scope, scopeRefId, restaurantId?, params, priority, effectiveFrom, effectiveTo, kind?, isEnabled? }).
 * @typedef {{ markup?: any[], commission?: any[], tax?: any[], platformFee?: any[], delivery?: any[], surge?: any[], riderEarning?: any[] }} RuleSet
 */

function inWindow(window, now, timeZone) {
  if (!window) return true;
  const m = localTime(now, timeZone).minute;
  const s = parseHHmm(window.start);
  const e = parseHHmm(window.end, { allowEndOfDay: true });
  return s < e ? m >= s && m < e : m >= s || m < e;
}

function roundDisplay(paise, rounding) {
  if (!rounding || rounding.mode === 'NONE') return paise;
  if (rounding.mode === 'PSYCHOLOGICAL') {
    // Smallest rupee amount ≥ price (or largest ≤ with DOWN) whose last digit is endingDigit.
    const d = rounding.endingDigit;
    let rupees = rounding.direction === 'DOWN' ? Math.floor(paise / 100) : Math.ceil(paise / 100);
    const step = rounding.direction === 'DOWN' ? -1 : 1;
    while (((rupees % 10) + 10) % 10 !== d) rupees += step;
    return Math.max(0, rupees) * 100;
  }
  return roundToStep(paise, STEP[rounding.mode], rounding.direction ?? 'HALF_UP');
}

/** Customer price of one unit for a markup rule (restaurant price never changes — spec §10). */
export function applyMarkup(basePaise, params) {
  if (!params) return basePaise;
  const raw =
    params.type === 'PERCENTAGE'
      ? basePaise + applyBps(basePaise, params.valueBps)
      : basePaise + params.valuePaise;
  return Math.max(basePaise, roundDisplay(raw, params.rounding)); // rounding never goes below the restaurant price
}

/**
 * Customer price of an add-on: the rule's percentage markup **and its rounding** (owner decision Q-19 → OD-39),
 * only when the rule applies to add-ons. FIXED markups apply to the main item only; free add-ons stay free.
 */
export function addonDisplay(basePaise, params) {
  if (!params || !params.applyToAddons || params.type !== 'PERCENTAGE' || basePaise === 0) return basePaise;
  return applyMarkup(basePaise, params);
}

/** Tax on an amount per a (parsed) charge-tax rule. */
function taxOn(amountPaise, rule, forceInclusive) {
  if (!rule || rule.params.mode === 'EXEMPT' || amountPaise <= 0) {
    return {
      ruleId: rule?.id ?? null,
      mode: rule ? rule.params.mode : 'NONE',
      rateBps: 0,
      amountPaise: 0,
      components: [],
      inclusive: false,
    };
  }
  const mode =
    forceInclusive === true ? 'INCLUSIVE' : forceInclusive === false ? 'EXCLUSIVE' : rule.params.mode;
  const rateBps = sum(rule.params.components.map((c) => c.rateBps));
  if (!rateBps)
    return {
      ruleId: rule.id,
      mode,
      rateBps: 0,
      amountPaise: 0,
      components: [],
      inclusive: mode === 'INCLUSIVE',
    };
  const amount = mode === 'INCLUSIVE' ? inclusiveTax(amountPaise, rateBps) : applyBps(amountPaise, rateBps);
  const parts =
    amount > 0
      ? allocate(
          amount,
          rule.params.components.map((c) => c.rateBps),
        )
      : rule.params.components.map(() => 0);
  return {
    ruleId: rule.id,
    mode,
    rateBps,
    amountPaise: amount,
    components: rule.params.components.map((c, i) => ({
      code: c.code,
      rateBps: c.rateBps,
      amountPaise: parts[i],
    })),
    inclusive: mode === 'INCLUSIVE',
    liableParty: rule.params.liableParty,
  };
}

/** Delivery fee for a (parsed) delivery rule and distance — also used for listing previews. */
export function deliveryFee(params, distanceM) {
  if (distanceM > params.maxDistanceM) return { serviceable: false, reason: 'TOO_FAR' };
  let fee;
  if (params.strategy === 'SLABS') {
    const slab = params.slabs.find((s) => distanceM <= s.upToM);
    if (!slab) return { serviceable: false, reason: 'TOO_FAR' };
    fee = slab.feePaise;
  } else if (params.strategy === 'BASE_PLUS_PER_KM') {
    const units = Math.ceil(Math.max(0, distanceM - params.includedM) / params.billingUnitM);
    fee = params.basePaise + divRoundHalfUp(units * params.perKmPaise * params.billingUnitM, 1000);
  } else fee = params.flatPaise;
  if (params.minPaise !== undefined) fee = Math.max(fee, params.minPaise);
  if (params.maxPaise !== undefined) fee = Math.min(fee, params.maxPaise);
  return { serviceable: true, feePaise: fee };
}

/** Rider earning estimate (DELIVERY.md §4); waiting time is unknown before delivery, so 0. */
export function riderEarningEstimate(params, { distanceM, now, timeZone }) {
  const units = Math.ceil(Math.max(0, distanceM - params.includedM) / params.billingUnitM);
  const distancePay = divRoundHalfUp(units * params.perKmPaise * params.billingUnitM, 1000);
  const base = params.basePaise + distancePay;
  const incentives = params.incentives
    .filter((inc) => inWindow(inc.window, now, timeZone))
    .map((inc) => ({
      kind: inc.kind,
      amountPaise: inc.type === 'FIXED' ? inc.value : applyBps(base, inc.value),
    }));
  const total = Math.max(params.minPaise, base + sum(incentives.map((i) => i.amountPaise)));
  return { basePaise: params.basePaise, distancePaise: distancePay, incentives, totalPaise: total };
}

/** Is a coupon/promotion usable for this cart, and on which lines? */
function evaluateOffer(offer, { lines, ctx, now, foodSubtotal, flags }) {
  const t = offer.targeting ?? {};
  const fail = (reason, extra = {}) => ({ eligible: false, reason, ...extra });
  if (!offer.isActive) return fail('INACTIVE');
  if (new Date(offer.startsAt) > now) return fail('NOT_STARTED');
  if (offer.endsAt && new Date(offer.endsAt) <= now) return fail('EXPIRED');
  if (offer.discountType === 'FREE_DELIVERY' && !flags.free_delivery) return fail('FREE_DELIVERY_DISABLED');
  if (t.cityIds?.length && !t.cityIds.includes(ctx.cityId)) return fail('NOT_IN_CITY');
  if (t.zoneIds?.length && !t.zoneIds.includes(ctx.deliveryZoneId)) return fail('NOT_IN_ZONE');
  if (t.restaurantIds?.length && !t.restaurantIds.includes(ctx.restaurantId))
    return fail('NOT_FOR_RESTAURANT');
  if (t.paymentMethods?.length && !t.paymentMethods.includes(ctx.paymentMethod))
    return fail('PAYMENT_METHOD', { paymentMethods: t.paymentMethods });
  if (offer.firstOrderOnly && (ctx.pastOrderCount ?? 0) > 0) return fail('FIRST_ORDER_ONLY');
  if (offer.usageLimit != null && (offer.usedCount ?? 0) >= offer.usageLimit)
    return fail('USAGE_LIMIT_REACHED');
  if (offer.perUserLimit != null && (offer.userUsedCount ?? 0) >= offer.perUserLimit)
    return fail('PER_USER_LIMIT_REACHED');
  if (offer.minOrderPaise != null && foodSubtotal < offer.minOrderPaise)
    return fail('MIN_ORDER', { shortByPaise: offer.minOrderPaise - foodSubtotal });
  const targeted = Boolean(t.categoryIds?.length || t.productIds?.length);
  const eligible = lines.map(
    (l) =>
      !targeted ||
      t.productIds?.includes(l.productId) ||
      (l.categoryId && t.categoryIds?.includes(l.categoryId)),
  );
  if (!eligible.some(Boolean)) return fail('NO_ELIGIBLE_ITEMS');
  return { eligible: true, lineEligible: eligible };
}

function fundingSplit(amount, offer) {
  const restaurant =
    offer.fundingSource === 'RESTAURANT'
      ? amount
      : offer.fundingSource === 'SHARED'
        ? applyBps(amount, offer.restaurantShareBps ?? 0)
        : 0;
  return { restaurantFundedPaise: restaurant, platformFundedPaise: amount - restaurant };
}

/**
 * Prices a cart. Throws PricingError for invalid rules or broken invariants; unserviceable carts return
 * `deliverable: false` with issues instead of a total.
 * @param {{ lines: CartLine[] }} cart
 * @param {QuoteContext} ctx
 * @param {RuleSet} rules
 * @param {{
 *   finalRounding: { mode: string, direction: 'HALF_UP' | 'UP' | 'DOWN', absorbedBy: 'PLATFORM' | 'RESTAURANT' },
 *   surchargeCapPaise: number,
 *   promotionStacking: 'ONE_PROMO_ONE_COUPON' | 'BEST_OF' | 'COUPON_ONLY',
 *   tips: { enabled: boolean, riderShareBps: number },
 *   flags: Record<string, boolean>,
 *   gatewayFees: { methods: Record<string, { bps: number, fixedPaise: number }>, gstBps: number, defaultMethod: string },
 *   markupDisclosure: 'NONE' | 'NOTE' | 'ITEMISED',
 * }} settings
 * @param {{ promotions?: any[], coupon?: any | null, tipPaise?: number, now: Date }} extra
 */
export function quote(cart, ctx, rules, settings, extra) {
  const { now } = extra;
  const tz = ctx.timeZone;
  const issues = [];
  const rulesUsed = new Map();
  const use = (type, rule) => {
    if (rule)
      rulesUsed.set(`${type}:${rule.id}`, {
        type,
        id: rule.id,
        scope: rule.scope,
        scopeRefId: rule.scopeRefId ?? null,
        params: rule.params,
      });
    return rule;
  };
  const restaurantCtx = {
    countryId: ctx.countryId,
    stateId: ctx.stateId,
    cityId: ctx.cityId,
    zoneId: ctx.restaurantZoneId ?? undefined,
    restaurantId: ctx.restaurantId,
    branchId: ctx.branchId,
  };
  const deliveryCtx = { ...restaurantCtx, zoneId: ctx.deliveryZoneId ?? undefined };
  /** Winning rule of a type for a context, parsed; `filter` narrows candidates (e.g. tax appliesTo). */
  const resolve = (type, candidates, scopeCtx, filter = () => true) => {
    const hit = resolveScoped((candidates ?? []).filter(filter), scopeCtx, now);
    if (!hit) return null;
    return use(type, { ...hit.winner, params: parseRuleParams(type, hit.winner) });
  };
  const taxRuleFor = (charge, scopeCtx) =>
    resolve('TAX', rules.tax, scopeCtx, (r) => r.params?.appliesTo === charge);

  if (!cart.lines.length) throw new PricingError('EMPTY_CART', 'The cart is empty.');

  // ── 2–3. Line prices ──
  const lines = cart.lines.map((l) => {
    const lineCtx = {
      ...restaurantCtx,
      categoryId: l.categoryId ?? undefined,
      productId: l.productId,
      variantId: l.variantId ?? undefined,
    };
    const markupRule = resolve('MARKUP', rules.markup, lineCtx);
    const p = markupRule?.params ?? null;
    const unitItemDisplay = applyMarkup(l.unitBasePaise, p);
    const addons = (l.addons ?? []).map((a) => {
      const display = addonDisplay(a.basePricePaise, p);
      return { ...a, displayPricePaise: display, markupPaise: display - a.basePricePaise };
    });
    const unitBase = l.unitBasePaise + sum(addons.map((a) => a.basePricePaise));
    const unitDisplay = unitItemDisplay + sum(addons.map((a) => a.displayPricePaise));
    return {
      ...l,
      lineCtx,
      addons,
      unitBasePaise: unitBase,
      unitItemBasePaise: l.unitBasePaise,
      unitDisplayPaise: unitDisplay,
      unitMarkupPaise: unitDisplay - unitBase,
      lineBasePaise: unitBase * l.quantity,
      lineDisplayPaise: unitDisplay * l.quantity,
      markup: markupRule
        ? { ruleId: markupRule.id, type: p.type, value: p.type === 'PERCENTAGE' ? p.valueBps : p.valuePaise }
        : null,
      packagingLinePaise: (l.packagingPaise ?? 0) * l.quantity,
    };
  });
  const foodBase = sum(lines.map((l) => l.lineBasePaise));
  const foodDisplay = sum(lines.map((l) => l.lineDisplayPaise));

  // ── 7 (distance part first: needed for delivery offers) ──
  const deliveryRule = resolve('DELIVERY', rules.delivery, deliveryCtx);
  if (!deliveryRule)
    throw new PricingError('RULE_MISSING', 'No delivery pricing rule applies to this location.');
  const dp = deliveryRule.params;
  const delivery = deliveryFee(dp, ctx.distanceM);
  if (!delivery.serviceable) {
    return {
      engineVersion: ENGINE_VERSION,
      deliverable: false,
      issues: [
        {
          code: 'NOT_DELIVERABLE',
          reason: delivery.reason,
          distanceM: ctx.distanceM,
          maxDistanceM: dp.maxDistanceM,
        },
      ],
      rulesUsed: [...rulesUsed.values()],
    };
  }

  // ── 4. Discounts (promotion first, then at most one coupon) ──
  const offerCtx = { lines, ctx, now, foodSubtotal: foodDisplay, flags: settings.flags };
  const stacking = settings.promotionStacking;
  const candidatesPromo =
    stacking === 'COUPON_ONLY'
      ? []
      : (extra.promotions ?? [])
          .map((p) => ({ offer: p, ev: evaluateOffer(p, offerCtx) }))
          .filter((x) => x.ev.eligible && x.offer.discountType !== 'FREE_DELIVERY');
  const offerAmount = (offer, ev, remaining) => {
    const base = sum(lines.map((l, i) => (ev.lineEligible[i] ? remaining[i] : 0)));
    let amount =
      offer.discountType === 'PERCENTAGE' ? applyBps(base, offer.valueBps) : Math.min(offer.valuePaise, base);
    if (offer.maxDiscountPaise != null) amount = Math.min(amount, offer.maxDiscountPaise);
    return Math.min(amount, base);
  };
  const remaining = lines.map((l) => l.lineDisplayPaise);
  const bestPromo = candidatesPromo
    .map((x) => ({ ...x, amount: offerAmount(x.offer, x.ev, remaining) }))
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        (b.offer.priority ?? 0) - (a.offer.priority ?? 0) ||
        (a.offer.id < b.offer.id ? -1 : 1),
    )[0];
  let couponResult = null;
  /** @type {any} */
  let couponEval = null;
  if (extra.coupon) {
    couponEval = evaluateOffer(extra.coupon, offerCtx);
    if (!couponEval.eligible)
      couponResult = {
        code: extra.coupon.code,
        status: 'NOT_APPLICABLE',
        reason: couponEval.reason,
        ...couponEval,
      };
  }

  const applied = [];
  const lineDiscount = lines.map(() => 0);
  const lineRestaurantFunded = lines.map(() => 0);
  const applyFoodOffer = (source, offer, ev) => {
    const weights = lines.map((l, i) => (ev.lineEligible[i] ? l.lineDisplayPaise - lineDiscount[i] : 0));
    if (!sum(weights)) return 0;
    const amount = offerAmount(
      offer,
      ev,
      lines.map((l, i) => l.lineDisplayPaise - lineDiscount[i]),
    );
    if (amount <= 0) return 0;
    const parts = allocate(amount, weights);
    const split = fundingSplit(amount, offer);
    // The restaurant-funded part follows the same per-line split (commission bases need it per line).
    const restParts =
      split.restaurantFundedPaise > 0 ? allocate(split.restaurantFundedPaise, parts) : parts.map(() => 0);
    parts.forEach((x, i) => {
      lineDiscount[i] += x;
      lineRestaurantFunded[i] += restParts[i];
    });
    applied.push({
      source,
      id: offer.id,
      code: offer.code ?? null,
      name: offer.name ?? offer.code,
      discountType: offer.discountType,
      amountPaise: amount,
      fundingSource: offer.fundingSource,
      ...split,
      allocation: parts,
    });
    return amount;
  };

  const coupon = extra.coupon && couponEval?.eligible ? extra.coupon : null;
  const couponIsFood = coupon && coupon.discountType !== 'FREE_DELIVERY';
  if (stacking === 'BEST_OF' && bestPromo && couponIsFood) {
    const couponAmount = offerAmount(coupon, couponEval, remaining);
    if (bestPromo.amount >= couponAmount) {
      applyFoodOffer('PROMOTION', bestPromo.offer, bestPromo.ev);
      couponResult = { code: coupon.code, status: 'NOT_APPLIED', reason: 'BETTER_OFFER_APPLIED' };
    } else applyFoodOffer('COUPON', coupon, couponEval);
  } else {
    if (bestPromo) applyFoodOffer('PROMOTION', bestPromo.offer, bestPromo.ev);
    if (couponIsFood) {
      const got = applyFoodOffer('COUPON', coupon, couponEval);
      if (!got)
        couponResult = { code: coupon.code, status: 'NOT_APPLICABLE', reason: 'NOTHING_LEFT_TO_DISCOUNT' };
    }
  }
  const foodDiscount = sum(lineDiscount);
  const foodAfterDiscount = foodDisplay - foodDiscount;

  // ── 5. Packaging ──
  const packaging = sum(lines.map((l) => l.packagingLinePaise));

  // ── 7. Delivery fee, free delivery ──
  const standardDeliveryFee = delivery.feePaise;
  let deliveryCharged = standardDeliveryFee;
  let freeReason = null;
  if (
    settings.flags.free_delivery &&
    dp.freeAboveSubtotalPaise != null &&
    foodAfterDiscount >= dp.freeAboveSubtotalPaise
  ) {
    deliveryCharged = 0;
    freeReason = 'THRESHOLD';
  }
  /** @type {any} */
  let deliveryDiscount = null;
  const freeDelivery = (source, offer) => {
    const split = fundingSplit(deliveryCharged, offer);
    const label = offer.code ?? offer.name;
    deliveryDiscount = {
      source,
      id: offer.id,
      code: offer.code ?? null,
      name: label,
      discountType: 'FREE_DELIVERY',
      amountPaise: deliveryCharged,
      fundingSource: offer.fundingSource,
      ...split,
    };
    applied.push(deliveryDiscount);
  };
  if (coupon && coupon.discountType === 'FREE_DELIVERY') {
    if (deliveryCharged > 0) freeDelivery('COUPON', coupon);
    else couponResult = { code: coupon.code, status: 'NOT_APPLICABLE', reason: 'DELIVERY_ALREADY_FREE' };
  }
  // A free-delivery promotion applies automatically when no coupon already made delivery free.
  if (!deliveryDiscount && deliveryCharged > 0 && stacking !== 'COUPON_ONLY') {
    const promo = (extra.promotions ?? []).find(
      (p) => p.discountType === 'FREE_DELIVERY' && evaluateOffer(p, offerCtx).eligible,
    );
    if (promo) freeDelivery('PROMOTION', promo);
  }
  const deliveryDiscountPaise = deliveryDiscount?.amountPaise ?? 0;
  const deliveryNet = deliveryCharged - deliveryDiscountPaise;

  // ── 8. Small-order fee ──
  const smallOrder =
    dp.smallOrder && foodAfterDiscount < dp.smallOrder.belowSubtotalPaise ? dp.smallOrder.feePaise : 0;

  // ── 9. Surcharges ──
  /** @type {any[]} */
  const surcharges = [];
  for (const kind of ['NIGHT', 'DEMAND', 'WEATHER', 'MANUAL']) {
    const flagOk = kind === 'NIGHT' ? settings.flags.night_pricing : settings.flags.surge;
    const rule = resolve('SURGE', rules.surge, deliveryCtx, (r) => r.kind === kind);
    if (!rule || rule.isEnabled === false || !flagOk) continue;
    const sp = rule.params;
    if (!inWindow(sp.window, now, tz)) continue;
    if (deliveryNet === 0 && !sp.applyWhenDeliveryFree) continue;
    const amount =
      sp.type === 'FIXED'
        ? sp.value
        : sp.type === 'PERCENTAGE'
          ? applyBps(standardDeliveryFee, sp.value)
          : applyBps(standardDeliveryFee, Math.max(0, sp.value - 10_000));
    if (amount > 0)
      surcharges.push({ kind, ruleId: rule.id, type: sp.type, value: sp.value, amountPaise: amount });
  }
  let surchargeTotal = sum(surcharges.map((s) => s.amountPaise));
  if (surchargeTotal > settings.surchargeCapPaise) {
    const capped = allocate(
      settings.surchargeCapPaise,
      surcharges.map((s) => s.amountPaise),
    );
    surcharges.forEach((s, i) => ((s.cappedFromPaise = s.amountPaise), (s.amountPaise = capped[i])));
    surchargeTotal = settings.surchargeCapPaise;
  }

  // ── 10. Platform fee ──
  const pfRule = resolve('PLATFORM_FEE', rules.platformFee, deliveryCtx);
  let platformFee = 0;
  if (pfRule?.params.enabled) {
    const sch = pfRule.params.schedule;
    const inSchedule =
      !sch || (sch.days.includes(localTime(now, tz).dayOfWeek) && inWindow(sch.window, now, tz));
    if (inSchedule) {
      platformFee = pfRule.params.fixedPaise + applyBps(foodDisplay, pfRule.params.rateBps);
      if (pfRule.params.minPaise !== undefined) platformFee = Math.max(platformFee, pfRule.params.minPaise);
      if (pfRule.params.maxPaise !== undefined) platformFee = Math.min(platformFee, pfRule.params.maxPaise);
    }
  }

  // ── 6 + 11. Taxes ──
  const lineTaxes = lines.map((l, i) => {
    const rule = taxRuleFor('FOOD', l.lineCtx);
    if (!rule) issues.push({ code: 'TAX_RULE_MISSING', charge: 'FOOD', productId: l.productId });
    return taxOn(l.lineDisplayPaise - lineDiscount[i], rule, l.taxInclusive ?? undefined);
  });
  const chargeTax = (charge, amount, scopeCtx) => {
    if (amount <= 0) return taxOn(0, null);
    const rule = taxRuleFor(charge, scopeCtx);
    if (!rule) issues.push({ code: 'TAX_RULE_MISSING', charge });
    return taxOn(amount, rule);
  };
  const taxes = {
    FOOD: lineTaxes,
    PACKAGING: chargeTax('PACKAGING', packaging, restaurantCtx),
    DELIVERY_FEE: chargeTax('DELIVERY_FEE', deliveryNet, deliveryCtx),
    SMALL_ORDER_FEE: chargeTax('SMALL_ORDER_FEE', smallOrder, deliveryCtx),
    SURCHARGE: chargeTax('SURCHARGE', surchargeTotal, deliveryCtx),
    PLATFORM_FEE: chargeTax('PLATFORM_FEE', platformFee, deliveryCtx),
  };
  const allCustomerTaxes = [
    ...lineTaxes,
    taxes.PACKAGING,
    taxes.DELIVERY_FEE,
    taxes.SMALL_ORDER_FEE,
    taxes.SURCHARGE,
    taxes.PLATFORM_FEE,
  ];
  const exclusiveTax = sum(allCustomerTaxes.filter((t) => !t.inclusive).map((t) => t.amountPaise));
  const inclusiveTaxTotal = sum(allCustomerTaxes.filter((t) => t.inclusive).map((t) => t.amountPaise));

  // ── 12. Tip ──
  let tip = extra.tipPaise ?? 0;
  if (tip && !(settings.tips.enabled && settings.flags.tips)) {
    issues.push({ code: 'TIPS_DISABLED' });
    tip = 0;
  }
  const tipRider = applyBps(tip, settings.tips.riderShareBps);
  const tipPassThrough = tip - tipRider;

  // ── 13–14. Rounding and total ──
  const beforeRounding =
    foodDisplay -
    foodDiscount +
    packaging +
    deliveryCharged -
    deliveryDiscountPaise +
    smallOrder +
    surchargeTotal +
    platformFee +
    exclusiveTax +
    tip;
  const fr = settings.finalRounding;
  const rounded =
    fr.mode === 'NONE' ? beforeRounding : roundToStep(beforeRounding, STEP[fr.mode], fr.direction);
  const roundingAdjustment = rounded - beforeRounding;
  const totalPayable = rounded;

  // ── Restaurant side (never shown to customers) ──
  const byRule = new Map();
  const lineCommissionBase = [];
  const lineCommissionKey = [];
  lines.forEach((l, i) => {
    const rule = resolve('COMMISSION', rules.commission, l.lineCtx);
    const key = rule?.id ?? 'none';
    const basis = rule?.params.basis ?? 'PRE_DISCOUNT';
    const base =
      basis === 'PRE_DISCOUNT'
        ? l.lineBasePaise
        : basis === 'POST_RESTAURANT_DISCOUNT'
          ? l.lineBasePaise - lineRestaurantFunded[i]
          : l.lineBasePaise - lineDiscount[i];
    const g = byRule.get(key) ?? { key, rule, basis, basePaise: 0 };
    g.basePaise += Math.max(0, base);
    byRule.set(key, g);
    lineCommissionBase[i] = Math.max(0, base);
    lineCommissionKey[i] = key;
  });
  const commissionGroups = [...byRule.values()].map((g) => {
    if (!g.rule) {
      issues.push({ code: 'COMMISSION_RULE_MISSING' });
      return { ruleId: null, basis: g.basis, basePaise: g.basePaise, amountPaise: 0 };
    }
    const p = g.rule.params;
    const rate = p.rateBps !== undefined ? applyBps(g.basePaise, p.rateBps) : 0;
    const amount =
      p.type === 'PERCENTAGE'
        ? rate
        : p.type === 'FIXED'
          ? p.fixedPaise
          : p.hybridMode === 'MAX'
            ? Math.max(rate, p.fixedPaise)
            : rate + p.fixedPaise;
    return {
      ruleId: g.rule.id,
      type: p.type,
      basis: p.basis,
      rateBps: p.rateBps ?? null,
      fixedPaise: p.fixedPaise ?? null,
      basePaise: g.basePaise,
      amountPaise: amount,
    };
  });
  // Each group's commission split across its lines by commission base (largest remainder), for order items.
  const lineCommission = lines.map(() => 0);
  [...byRule.values()].forEach((g, gi) => {
    const idx = lines.map((_, i) => i).filter((i) => lineCommissionKey[i] === g.key);
    const weights = idx.map((i) => lineCommissionBase[i]);
    const parts = allocate(
      commissionGroups[gi].amountPaise,
      weights.some((w) => w > 0) ? weights : weights.map(() => 1),
    );
    idx.forEach((i, k) => (lineCommission[i] = parts[k]));
  });
  const commission = sum(commissionGroups.map((c) => c.amountPaise));
  const commissionTaxRule = commission > 0 ? taxRuleFor('COMMISSION', restaurantCtx) : null;
  const commissionTax = taxOn(commission, commissionTaxRule);
  const commissionCharged = commission + (commissionTax.inclusive ? 0 : commissionTax.amountPaise);
  const commissionRevenue = commissionCharged - commissionTax.amountPaise;

  const restaurantFundedFood = sum(lineRestaurantFunded);
  const restaurantFundedDelivery = deliveryDiscount?.restaurantFundedPaise ?? 0;
  const withholdings = [];
  for (const kind of ['GST_TCS', 'INCOME_TAX_TDS']) {
    const rule = resolve(
      'TAX',
      rules.tax,
      restaurantCtx,
      (r) => r.params?.appliesTo === 'WITHHOLDING' && r.params?.kind === kind,
    );
    if (!rule?.params.enabled) continue;
    const base = rule.params.base === 'FOOD_VALUE' ? foodBase : foodBase - restaurantFundedFood;
    withholdings.push({
      kind,
      ruleId: rule.id,
      rateBps: rule.params.rateBps,
      basePaise: base,
      amountPaise: applyBps(Math.max(0, base), rule.params.rateBps),
    });
  }
  const withholdingTotal = sum(withholdings.map((w) => w.amountPaise));
  const roundingToRestaurant = fr.absorbedBy === 'RESTAURANT' ? roundingAdjustment : 0;
  const restaurantPayable =
    foodBase -
    restaurantFundedFood -
    restaurantFundedDelivery -
    commissionCharged -
    withholdingTotal +
    packaging +
    roundingToRestaurant;

  // ── Rider (estimate) ──
  const riderRule = resolve('RIDER_EARNING', rules.riderEarning, deliveryCtx);
  if (!riderRule) issues.push({ code: 'RIDER_EARNING_RULE_MISSING' });
  const rider = riderRule
    ? {
        ruleId: riderRule.id,
        ...riderEarningEstimate(riderRule.params, { distanceM: ctx.distanceM, now, timeZone: tz }),
      }
    : { ruleId: null, totalPaise: 0 };

  // ── Gateway (admin estimate, D-54) ──
  const method = ctx.paymentMethod ?? settings.gatewayFees.defaultMethod;
  const gw = settings.gatewayFees.methods[method] ?? { bps: 0, fixedPaise: 0 };
  const gatewayFee = method === 'COD' ? 0 : applyBps(totalPayable, gw.bps) + gw.fixedPaise;
  const gatewayEstimate = gatewayFee + applyBps(gatewayFee, settings.gatewayFees.gstBps);

  // ── Platform ──
  const taxLiabilities = exclusiveTax + inclusiveTaxTotal + commissionTax.amountPaise;
  const platformNet =
    totalPayable -
    restaurantPayable -
    rider.totalPaise -
    tip -
    taxLiabilities -
    withholdingTotal -
    gatewayEstimate;
  const markupTotal = foodDisplay - foodBase;
  const platformFundedFood = foodDiscount - restaurantFundedFood;
  const platformFundedDelivery = deliveryDiscountPaise - restaurantFundedDelivery;
  const platformByComponents =
    markupTotal +
    commissionRevenue +
    platformFee +
    deliveryCharged +
    surchargeTotal +
    smallOrder -
    rider.totalPaise -
    platformFundedFood -
    platformFundedDelivery +
    (roundingAdjustment - roundingToRestaurant) -
    gatewayEstimate -
    inclusiveTaxTotal;

  // ── Customer bill (the only part apps receive) ──
  const disclosure = settings.markupDisclosure;
  const bill = [];
  if (disclosure === 'ITEMISED') {
    bill.push({ code: 'ITEMS', label: 'Item total', amountPaise: foodBase });
    if (markupTotal)
      bill.push({ code: 'PRICE_ADJUSTMENT', label: 'Platform price adjustment', amountPaise: markupTotal });
  } else bill.push({ code: 'ITEMS', label: 'Item total', amountPaise: foodDisplay });
  for (const d of applied.filter((x) => x.discountType !== 'FREE_DELIVERY'))
    bill.push({
      code: d.source === 'COUPON' ? 'COUPON' : 'OFFER',
      label: d.source === 'COUPON' ? `Coupon ${d.code}` : `Offer: ${d.name}`,
      amountPaise: -d.amountPaise,
    });
  if (packaging) bill.push({ code: 'PACKAGING', label: 'Packaging', amountPaise: packaging });
  bill.push({
    code: 'DELIVERY_FEE',
    label: freeReason === 'THRESHOLD' ? 'Delivery fee (free above threshold)' : 'Delivery fee',
    amountPaise: deliveryCharged,
  });
  if (deliveryDiscountPaise)
    bill.push({
      code: 'DELIVERY_DISCOUNT',
      label: `Free delivery (${deliveryDiscount.name})`,
      amountPaise: -deliveryDiscountPaise,
    });
  if (smallOrder) bill.push({ code: 'SMALL_ORDER_FEE', label: 'Small order fee', amountPaise: smallOrder });
  for (const s of surcharges)
    bill.push({
      code: `SURCHARGE_${s.kind}`,
      label:
        s.kind === 'NIGHT' ? 'Night surcharge' : `${s.kind[0]}${s.kind.slice(1).toLowerCase()} surcharge`,
      amountPaise: s.amountPaise,
    });
  if (platformFee) bill.push({ code: 'PLATFORM_FEE', label: 'Platform fee', amountPaise: platformFee });
  if (exclusiveTax) bill.push({ code: 'TAXES', label: 'Taxes', amountPaise: exclusiveTax });
  if (tip) bill.push({ code: 'TIP', label: 'Tip for your delivery partner', amountPaise: tip });
  if (roundingAdjustment) bill.push({ code: 'ROUNDING', label: 'Rounding', amountPaise: roundingAdjustment });

  const result = {
    engineVersion: ENGINE_VERSION,
    deliverable: true,
    computedAt: now.toISOString(),
    lines: lines.map((l, i) => ({
      key: l.key,
      productId: l.productId,
      variantId: l.variantId ?? null,
      name: l.name,
      quantity: l.quantity,
      unitItemBasePaise: l.unitItemBasePaise,
      unitBasePaise: l.unitBasePaise,
      unitDisplayPaise: l.unitDisplayPaise,
      unitMarkupPaise: l.unitMarkupPaise,
      addons: l.addons,
      lineBasePaise: l.lineBasePaise,
      lineDisplayPaise: l.lineDisplayPaise,
      markup: l.markup,
      discountPaise: lineDiscount[i],
      restaurantFundedDiscountPaise: lineRestaurantFunded[i],
      packagingPaise: l.packagingLinePaise,
      tax: lineTaxes[i],
      commission: {
        ruleId: lineCommissionKey[i] === 'none' ? null : lineCommissionKey[i],
        basis: byRule.get(lineCommissionKey[i]).basis,
        basePaise: lineCommissionBase[i],
        rateBps: byRule.get(lineCommissionKey[i]).rule?.params.rateBps ?? null,
        amountPaise: lineCommission[i],
      },
    })),
    discounts: applied.map(({ allocation: _a, ...d }) => d),
    coupon: couponResult ?? (coupon ? { code: coupon.code, status: 'APPLIED' } : null),
    delivery: {
      ruleId: deliveryRule.id,
      strategy: dp.strategy,
      distanceM: ctx.distanceM,
      distanceSource: ctx.distanceSource,
      standardFeePaise: standardDeliveryFee,
      chargedPaise: deliveryCharged,
      freeReason,
      freeAboveSubtotalPaise: settings.flags.free_delivery ? (dp.freeAboveSubtotalPaise ?? null) : null,
    },
    surcharges,
    platformFee: pfRule ? { ruleId: pfRule.id, amountPaise: platformFee } : null,
    taxes: {
      food: sum(lineTaxes.map((t) => t.amountPaise)),
      packaging: taxes.PACKAGING,
      deliveryFee: taxes.DELIVERY_FEE,
      smallOrderFee: taxes.SMALL_ORDER_FEE,
      surcharge: taxes.SURCHARGE,
      platformFee: taxes.PLATFORM_FEE,
      exclusiveTotalPaise: exclusiveTax,
      inclusiveTotalPaise: inclusiveTaxTotal,
      byComponent: byComponent(allCustomerTaxes),
      pendingCaReview: true, // D-51, Q-3
    },
    totals: {
      foodBasePaise: foodBase,
      foodDisplayPaise: foodDisplay,
      markupPaise: markupTotal,
      foodDiscountPaise: foodDiscount,
      foodAfterDiscountPaise: foodAfterDiscount,
      packagingPaise: packaging,
      deliveryFeePaise: deliveryCharged,
      deliveryDiscountPaise,
      smallOrderFeePaise: smallOrder,
      surchargePaise: surchargeTotal,
      platformFeePaise: platformFee,
      taxExclusivePaise: exclusiveTax,
      tipPaise: tip,
      beforeRoundingPaise: beforeRounding,
      roundingAdjustmentPaise: roundingAdjustment,
      totalPayablePaise: totalPayable,
    },
    customerBill: {
      lines: bill,
      totalPayablePaise: totalPayable,
      markupDisclosure: disclosure,
      notes: [
        ...(disclosure === 'NOTE' && markupTotal
          ? ['Prices on Jamzo may differ from the restaurant’s own menu.']
          : []),
        ...(inclusiveTaxTotal ? [`Includes taxes of ₹${(inclusiveTaxTotal / 100).toFixed(2)}.`] : []),
      ],
    },
    restaurant: {
      foodValuePaise: foodBase,
      restaurantFundedDiscountPaise: restaurantFundedFood + restaurantFundedDelivery,
      commission: { amountPaise: commission, groups: commissionGroups },
      commissionTax,
      commissionChargedPaise: commissionCharged,
      withholdings,
      packagingPaise: packaging,
      roundingAbsorbedPaise: roundingToRestaurant,
      payablePaise: restaurantPayable,
      needsReview: restaurantPayable < 0,
    },
    rider: { ...rider, tipPaise: tipRider, estimate: true },
    platform: {
      markupPaise: markupTotal,
      commissionRevenuePaise: commissionRevenue,
      platformFeePaise: platformFee,
      deliveryFeePaise: deliveryCharged,
      surchargePaise: surchargeTotal,
      smallOrderFeePaise: smallOrder,
      riderCostPaise: rider.totalPaise,
      platformFundedDiscountPaise: platformFundedFood + platformFundedDelivery,
      roundingPaise: roundingAdjustment - roundingToRestaurant,
      gatewayEstimatePaise: gatewayEstimate,
      gatewayMethod: method,
      tipPassThroughPaise: tipPassThrough,
      taxLiabilitiesPaise: taxLiabilities,
      withholdingPaise: withholdingTotal,
      netPaise: platformNet,
    },
    rulesUsed: [...rulesUsed.values()],
    issues,
  };
  checkInvariants(result, { platformByComponents, commissionTax });
  return result;
}

function byComponent(taxList) {
  const out = {};
  for (const t of taxList)
    for (const c of t.components ?? []) out[c.code] = (out[c.code] ?? 0) + c.amountPaise;
  return out;
}

/** PRICING.md §8 — a quote that fails any check is an error, never shown. */
export function checkInvariants(q, { platformByComponents, commissionTax }) {
  const fail = (what, details) => {
    throw new PricingError('INVARIANT_FAILED', `Pricing invariant failed: ${what}`, details);
  };
  for (const l of q.lines) {
    if (l.lineDisplayPaise - l.lineBasePaise !== l.unitMarkupPaise * l.quantity)
      fail('markup identity', { key: l.key });
    if (l.unitMarkupPaise < 0 || l.lineDisplayPaise < 0 || l.discountPaise > l.lineDisplayPaise)
      fail('negative line', { key: l.key });
  }
  if (sum(q.lines.map((l) => l.commission.amountPaise)) !== q.restaurant.commission.amountPaise)
    fail('commission allocation');
  const foodDiscounts = q.discounts.filter((d) => d.discountType !== 'FREE_DELIVERY');
  if (sum(q.lines.map((l) => l.discountPaise)) !== sum(foodDiscounts.map((d) => d.amountPaise)))
    fail('discount allocation');
  for (const d of q.discounts)
    if (d.restaurantFundedPaise + d.platformFundedPaise !== d.amountPaise)
      fail('discount funding', { id: d.id });
  const taxes = [
    ...q.lines.map((l) => l.tax),
    q.taxes.packaging,
    q.taxes.deliveryFee,
    q.taxes.smallOrderFee,
    q.taxes.surcharge,
    q.taxes.platformFee,
    commissionTax,
  ];
  for (const t of taxes)
    if (t.components.length && sum(t.components.map((c) => c.amountPaise)) !== t.amountPaise)
      fail('tax components');
  if (sum(q.customerBill.lines.map((b) => b.amountPaise)) !== q.totals.totalPayablePaise)
    fail('bill lines sum');
  if (q.totals.totalPayablePaise < 0) fail('negative total');
  if (q.platform.netPaise !== platformByComponents)
    fail('conservation', { remainder: q.platform.netPaise, components: platformByComponents });
}
