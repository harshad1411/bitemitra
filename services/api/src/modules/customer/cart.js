// Cart quote (D-46, PRICING.md §4 step 1 "revalidate"): every line is re-checked against the live menu, then
// priced by the engine. Customers receive only the customer-facing part; the admin test quote gets it all.
import { PricingError } from '@jamzo/pricing-engine';
import { AppError, notFound } from '../../core/errors.js';
import { currentWindowsWhere } from '../catalog/service.js';
import { engineSettings, loadRuleSet, quote, ruleTargets } from '../pricing/service.js';
import { customerAvailability, discover, locationFrom } from './discovery.js';

const toEngineOffer = (o, extra = {}) => ({
  id: o.id,
  code: o.code ?? null,
  name: o.name ?? o.code,
  discountType: o.discountType,
  valueBps: o.valueBps ?? undefined,
  valuePaise: o.valuePaise ?? undefined,
  maxDiscountPaise: o.maxDiscountPaise,
  minOrderPaise: o.minOrderPaise,
  fundingSource: o.fundingSource,
  restaurantShareBps: o.restaurantShareBps,
  firstOrderOnly: o.firstOrderOnly ?? false,
  usageLimit: o.usageLimit ?? null,
  perUserLimit: o.perUserLimit ?? null,
  usedCount: o.usedCount ?? 0,
  targeting: o.targeting ?? {},
  startsAt: o.startsAt,
  endsAt: o.endsAt,
  isActive: o.isActive,
  priority: o.priority ?? 0,
  ...extra,
});

const COUPON_MESSAGES = {
  NOT_FOUND: 'This coupon code does not exist.',
  INACTIVE: 'This coupon is no longer active.',
  NOT_STARTED: 'This coupon is not active yet.',
  EXPIRED: 'This coupon has expired.',
  NOT_IN_CITY: 'This coupon is not valid in your city.',
  NOT_IN_ZONE: 'This coupon is not valid for your area.',
  NOT_FOR_RESTAURANT: 'This coupon is not valid at this restaurant.',
  PAYMENT_METHOD: 'This coupon needs a specific payment method.',
  FIRST_ORDER_ONLY: 'This coupon is only for your first order.',
  USAGE_LIMIT_REACHED: 'This coupon has been fully used.',
  PER_USER_LIMIT_REACHED: 'You have already used this coupon.',
  MIN_ORDER: 'Add more items to use this coupon.',
  NO_ELIGIBLE_ITEMS: 'None of your items qualify for this coupon.',
  NOTHING_LEFT_TO_DISCOUNT: 'Your items are already fully discounted.',
  DELIVERY_ALREADY_FREE: 'Delivery is already free.',
  FREE_DELIVERY_DISABLED: 'Free delivery offers are paused right now.',
  BETTER_OFFER_APPLIED: 'A better offer is already applied.',
};

/** Order statuses that do not count as "an earlier order" for first-order coupons (D-65). */
export const NOT_COUNTED_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'RESTAURANT_REJECTED',
  'ADMIN_CANCELLED',
];

/** What the signed-in customer has used so far: counted from real orders and coupon usages (D-65). */
async function customerHistory(prisma, request, coupon, db = prisma) {
  if (!request.auth) return { customerId: null, pastOrderCount: 0, userUsedCount: 0 };
  const customer = await db.customer.findUnique({ where: { userId: request.auth.userId } });
  if (!customer) return { customerId: null, pastOrderCount: 0, userUsedCount: 0 };
  const [pastOrderCount, userUsedCount] = await Promise.all([
    db.order.count({
      where: { customerId: customer.id, placedAt: { not: null }, status: { notIn: NOT_COUNTED_STATUSES } },
    }),
    coupon
      ? db.couponUsage.count({ where: { couponId: coupon.id, customerId: customer.id, reversedAt: null } })
      : 0,
  ]);
  return { customerId: customer.id, pastOrderCount, userUsedCount };
}

/**
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {import('../../core/types.js').JamzoRequest} request
 * @param {any} body parsed cartQuoteBody
 * @param {{ audience: 'CUSTOMER' | 'ADMIN' }} opts
 */
export async function quoteCart(app, request, body, { audience }) {
  return (await priceCart(app, request, body, { audience })).view;
}

/**
 * Revalidates and prices a cart. `view` is the response for `audience`; `context` (null when nothing could
 * be priced) carries what checkout needs to write the order (D-64).
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {import('../../core/types.js').JamzoRequest} request
 * @param {any} body parsed cartQuoteBody
 * @param {{ audience: 'CUSTOMER' | 'ADMIN', db?: any }} opts `db` lets checkout read inside its transaction
 * @returns {Promise<{ view: any, context: any }>}
 */
export async function priceCart(app, request, body, { audience, db }) {
  const prisma = db ?? app.prisma;
  const { config } = app.services;
  const now = app.clock.now();
  const loc = await locationFrom(prisma, request, body);
  const found = await discover(app, { point: loc.point, restaurantIds: [body.restaurantId], now });
  if (!found.place.serviceable)
    return {
      context: null,
      view: {
        deliverable: false,
        issues: [
          {
            code: 'NOT_SERVICEABLE',
            reason: found.place.reason,
            message: 'We don’t deliver to this location yet.',
          },
        ],
      },
    };
  const cand = found.candidates[0];
  if (!cand) {
    const r = await prisma.restaurant.findFirst({
      where: { id: body.restaurantId, onboardingStatus: 'ACTIVE' },
    });
    if (!r) throw notFound('Restaurant');
    return {
      context: null,
      view: {
        deliverable: false,
        issues: [
          { code: 'OUT_OF_DELIVERY_AREA', message: 'This restaurant doesn’t deliver to this location.' },
        ],
      },
    };
  }
  const { restaurant, branch, card } = cand;
  const city = found.city;
  const zone = found.zone;
  const issues = [];
  if (!card.open.isOpen)
    issues.push({
      code: 'RESTAURANT_CLOSED',
      reason: card.open.reason,
      nextOpenLocal: card.open.nextOpenLocal,
      message: 'The restaurant is not taking orders right now.',
    });

  // ── Revalidate every line against the live menu ──
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(body.lines.map((l) => l.productId))] }, restaurantId: restaurant.id },
    include: {
      variants: true,
      addonGroups: { include: { addons: true } },
      menuCategory: true,
      availability: { where: currentWindowsWhere(now) },
      schedules: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const ctx = {
    countryId: city.state.countryId,
    stateId: city.stateId,
    cityId: city.id,
    zoneId: branch.zoneId ?? undefined,
    restaurantId: restaurant.id,
    branchId: branch.id,
  };
  const [packagingDefault, limits, methods] = await Promise.all([
    config.resolve('restaurants.packaging', ctx),
    config.resolve('orders.limits', ctx),
    config.resolve('payments.methods', ctx),
  ]);
  const valid = [];
  for (const l of body.lines) {
    const p = byId.get(l.productId);
    const bad = (code, message, extra = {}) =>
      issues.push({ code, lineKey: l.key, productId: l.productId, message, ...extra });
    if (!p || p.status !== 'ACTIVE' || (p.menuCategory && !p.menuCategory.isActive)) {
      bad('ITEM_NOT_FOUND', 'This item is no longer on the menu.');
      continue;
    }
    const avail = customerAvailability(p, now, city.timezone);
    if (!avail.available) {
      bad('ITEM_UNAVAILABLE', `${p.name} is not available right now.`, {
        reason: avail.reason,
        until: avail.until,
      });
      continue;
    }
    let variant = null;
    if (p.variants.length) {
      variant = p.variants.find((v) => v.id === l.variantId);
      if (!variant) {
        bad('VARIANT_REQUIRED', `Choose a size for ${p.name}.`);
        continue;
      }
      if (!variant.isAvailable) {
        bad('VARIANT_UNAVAILABLE', `${p.name} (${variant.name}) is sold out.`);
        continue;
      }
    } else if (l.variantId) {
      bad('VARIANT_INVALID', `${p.name} has no sizes.`);
      continue;
    }
    const addonsById = new Map(p.addonGroups.flatMap((g) => g.addons.map((a) => [a.id, { ...a, group: g }])));
    const chosen = l.addonIds.map((id) => addonsById.get(id));
    if (new Set(l.addonIds).size !== l.addonIds.length || chosen.some((a) => !a)) {
      bad('ADDONS_INVALID', `Some choices for ${p.name} are no longer offered.`);
      continue;
    }
    const soldOut = chosen.find((a) => !a.isAvailable);
    if (soldOut) {
      bad('ADDON_UNAVAILABLE', `${soldOut.name} is sold out.`);
      continue;
    }
    const groupProblem = p.addonGroups.find((g) => {
      const n = chosen.filter((a) => a.group.id === g.id).length;
      return n < g.minSelect || n > g.maxSelect;
    });
    if (groupProblem) {
      bad(
        'ADDONS_INVALID',
        `${groupProblem.name}: choose ${groupProblem.minSelect === groupProblem.maxSelect ? groupProblem.minSelect : `${groupProblem.minSelect}–${groupProblem.maxSelect}`}.`,
        { groupId: groupProblem.id },
      );
      continue;
    }
    valid.push({
      key: l.key,
      productId: p.id,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      categoryId: p.categoryId,
      name: p.name,
      foodType: p.foodType,
      unitBasePaise: variant ? variant.basePricePaise : p.basePricePaise,
      quantity: l.quantity,
      addons: chosen.map((a) => ({
        addonId: a.id,
        name: a.name,
        groupName: a.group.name,
        basePricePaise: a.basePricePaise,
      })),
      packagingPaise: p.packagingChargePaise ?? packagingDefault.value.perItemPaise,
      taxInclusive: p.taxInclusive,
    });
  }
  const itemCount = valid.reduce((n, l) => n + l.quantity, 0);
  if (itemCount > limits.value.maxItems)
    issues.push({
      code: 'TOO_MANY_ITEMS',
      maxItems: limits.value.maxItems,
      message: `An order can have at most ${limits.value.maxItems} items.`,
    });
  const base = {
    deliverable: true,
    restaurant: { id: restaurant.id, name: restaurant.name, isOpen: card.open.isOpen },
    delivery: { distanceM: card.distanceM, distanceSource: card.distanceSource, eta: card.eta },
    canCheckout: false,
    checkoutNote: null,
  };
  if (!valid.length) return { context: null, view: { ...base, lines: [], bill: null, issues } };

  // ── Rules, offers, settings → engine ──
  const coupon = body.couponCode
    ? await prisma.coupon.findUnique({ where: { code: body.couponCode } })
    : null;
  const history = await customerHistory(app.prisma, request, coupon, prisma);
  const [rules, promotions, settings] = await Promise.all([
    loadRuleSet(
      prisma,
      ruleTargets({
        ...ctx,
        zoneIds: [branch.zoneId, zone.id],
        categoryIds: valid.map((l) => l.categoryId).filter(Boolean),
        productIds: valid.map((l) => l.productId),
        variantIds: valid.map((l) => l.variantId).filter(Boolean),
      }),
      now,
    ),
    prisma.promotion.findMany({
      where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    }),
    engineSettings(
      config,
      { ...ctx, zoneId: zone.id },
      {
        userId: request.auth?.userId ?? null,
        cityId: city.id,
        zoneId: zone.id,
        appId: request.client?.appId,
        appVersion: request.client?.appVersion,
      },
    ),
  ]);
  let q;
  try {
    q = quote(
      { lines: valid },
      {
        countryId: ctx.countryId,
        stateId: ctx.stateId,
        cityId: city.id,
        restaurantZoneId: branch.zoneId,
        deliveryZoneId: zone.id,
        restaurantId: restaurant.id,
        branchId: branch.id,
        timeZone: city.timezone,
        distanceM: card.distanceM,
        distanceSource: card.distanceSource,
        paymentMethod: body.paymentMethod ?? null,
        pastOrderCount: history.pastOrderCount, // D-65
      },
      rules,
      settings,
      {
        coupon: coupon ? toEngineOffer(coupon, { userUsedCount: history.userUsedCount }) : null,
        promotions: promotions.map((p) => toEngineOffer(p)),
        tipPaise: body.tipPaise,
        now,
      },
    );
  } catch (err) {
    if (err instanceof PricingError && err.code === 'RULE_MISSING')
      return {
        context: null,
        view: {
          ...base,
          lines: [],
          bill: null,
          issues: [
            ...issues,
            { code: 'PRICING_UNAVAILABLE', message: 'Prices for this area are not configured yet.' },
          ],
        },
      };
    request.log.error({ err, details: /** @type {any} */ (err).details }, 'pricing failed');
    throw new AppError('INTERNAL', 'We could not price this cart. Please try again.');
  }
  if (!q.deliverable)
    return {
      context: null,
      view: {
        ...base,
        deliverable: false,
        issues: [
          ...issues,
          ...q.issues.map((i) => ({ ...i, message: 'This restaurant doesn’t deliver this far.' })),
        ],
      },
    };

  const couponInfo = body.couponCode
    ? coupon
      ? {
          code: body.couponCode,
          status: q.coupon?.status ?? 'NOT_APPLICABLE',
          reason: q.coupon?.reason ?? null,
          shortByPaise: q.coupon?.shortByPaise ?? null,
          message:
            q.coupon?.status === 'APPLIED'
              ? 'Coupon applied.'
              : (COUPON_MESSAGES[q.coupon?.reason] ?? 'This coupon cannot be used.'),
        }
      : {
          code: body.couponCode,
          status: 'NOT_APPLICABLE',
          reason: 'NOT_FOUND',
          message: COUPON_MESSAGES.NOT_FOUND,
        }
    : null;
  const subtotal = q.totals.foodDisplayPaise;
  if (subtotal < limits.value.minOrderPaise)
    issues.push({
      code: 'BELOW_MIN_ORDER',
      minOrderPaise: limits.value.minOrderPaise,
      shortByPaise: limits.value.minOrderPaise - subtotal,
      message: 'Add more items to reach the minimum order.',
    });
  if (subtotal > limits.value.maxOrderPaise)
    issues.push({
      code: 'ABOVE_MAX_ORDER',
      maxOrderPaise: limits.value.maxOrderPaise,
      message: 'This order is above the maximum order value.',
    });

  const customer = {
    ...base,
    lines: q.lines.map((l, i) => ({
      key: l.key,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      variantName: valid[i].variantName,
      foodType: valid[i].foodType,
      quantity: l.quantity,
      addons: l.addons.map((a) => ({
        addonId: a.addonId,
        name: a.name,
        unitPricePaise: a.displayPricePaise,
      })),
      unitPricePaise: l.unitDisplayPaise,
      lineTotalPaise: l.lineDisplayPaise,
    })),
    bill: q.customerBill,
    coupon: couponInfo,
    offers: q.discounts
      .filter((d) => d.source === 'PROMOTION')
      .map((d) => ({ name: d.name, amountPaise: d.amountPaise })),
    delivery: {
      ...base.delivery,
      freeReason: q.delivery.freeReason,
      freeAboveSubtotalPaise: q.delivery.freeAboveSubtotalPaise,
    },
    tips: { enabled: settings.tips.enabled && settings.flags.tips, presetsPaise: settings.tipPresetsPaise },
    // Methods switched on here (D-83); cash on delivery is re-checked at checkout with its own limits.
    paymentMethods: methods.value.enabled,
    taxNote: 'Tax amounts are provisional pending confirmation of GST treatment.',
    limitsCheckedAtCheckout: true, // D-52
    issues: [
      ...issues,
      ...q.issues
        .filter((i) => i.code === 'TIPS_DISABLED')
        .map((i) => ({ ...i, message: 'Tips are switched off.' })),
    ],
  };
  // Checkout is possible when nothing blocks it (D-64); the payment method is checked at checkout (D-60).
  const blocking = customer.issues.filter((i) => i.code !== 'TIPS_DISABLED');
  const couponBlocks = body.couponCode && couponInfo?.status !== 'APPLIED';
  customer.canCheckout = blocking.length === 0 && !couponBlocks;
  customer.checkoutNote = customer.canCheckout
    ? null
    : couponBlocks
      ? 'Remove the coupon or fix it to continue.'
      : 'Fix the items above to continue.';
  const context = {
    now,
    q,
    valid,
    restaurant,
    branch,
    city,
    zone,
    card,
    loc,
    coupon,
    couponInfo,
    customerId: history.customerId,
    blocking: [
      ...blocking,
      ...(couponBlocks ? [{ code: 'COUPON_NOT_APPLICABLE', message: couponInfo.message }] : []),
    ],
    ctx: { ...ctx, zoneId: zone.id },
  };
  // restaurant, rider, platform and rules — never for customers
  return { view: audience === 'ADMIN' ? { ...customer, engine: q } : customer, context };
}
