// Pricing inside the API (PRICING.md, D-49): loads the versioned rules and settings that apply to a context
// and runs the pure engine. The engine never touches the database; this module never computes money itself.
import { addonDisplay, applyMarkup, parseRuleParams, quote, RULE_TYPES } from '@jamzo/pricing-engine';
import { resolveScoped } from '@jamzo/config';

/** Rule type → { key in the engine RuleSet, Prisma delegate }. */
export const RULE_SOURCES = Object.freeze({
  MARKUP: { key: 'markup', table: 'markupRule' },
  COMMISSION: { key: 'commission', table: 'commissionRule' },
  TAX: { key: 'tax', table: 'taxRule' },
  PLATFORM_FEE: { key: 'platformFee', table: 'platformFeeRule' },
  DELIVERY: { key: 'delivery', table: 'deliveryPricingRule' },
  SURGE: { key: 'surge', table: 'surgeRule' },
  RIDER_EARNING: { key: 'riderEarning', table: 'riderEarningRule' },
});

/**
 * (scope, target) pairs that can apply to any line of a cart at a location.
 * @param {{ countryId?: string, stateId?: string, cityId?: string, zoneIds?: (string | null | undefined)[], restaurantId?: string, branchId?: string, categoryIds?: string[], productIds?: string[], variantIds?: string[] }} ids
 */
export function ruleTargets(ids) {
  const pairs = [{ scope: 'GLOBAL', scopeRefId: null }];
  const add = (scope, v) => v && pairs.push({ scope, scopeRefId: v });
  add('COUNTRY', ids.countryId);
  add('STATE', ids.stateId);
  add('CITY', ids.cityId);
  for (const z of new Set(ids.zoneIds ?? [])) add('ZONE', z);
  add('RESTAURANT', ids.restaurantId);
  add('BRANCH', ids.branchId);
  for (const c of new Set(ids.categoryIds ?? [])) add('CATEGORY', c);
  for (const p of new Set(ids.productIds ?? [])) add('PRODUCT', p);
  for (const v of new Set(ids.variantIds ?? [])) add('VARIANT', v);
  return pairs;
}

/**
 * Rules in force at `now` for the given targets, one query per rule table (never per line — OD-27).
 * @param {import('@jamzo/database').Db} prisma
 * @param {ReturnType<typeof ruleTargets>} targets
 * @param {Date} now
 * @param {(keyof typeof RULE_SOURCES)[]} [types]
 */
export async function loadRuleSet(
  prisma,
  targets,
  now,
  types = /** @type {any} */ (Object.keys(RULE_SOURCES)),
) {
  const where = {
    OR: targets.map((t) => ({ scope: t.scope, scopeRefId: t.scopeRefId })),
    effectiveFrom: { lte: now },
    AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
  };
  const entries = await Promise.all(
    types.map(async (type) => [
      RULE_SOURCES[type].key,
      await prisma[RULE_SOURCES[type].table].findMany({ where }),
    ]),
  );
  return Object.fromEntries(entries);
}

/** Engine settings for a context: settings registry values + server-evaluated feature flags. */
export async function engineSettings(config, ctx, who) {
  const [rounding, surcharges, tips, disclosure, gateway, flags] = await Promise.all([
    config.resolve('pricing.finalRounding', ctx),
    config.resolve('pricing.surcharges', ctx),
    config.resolve('tips', ctx),
    config.resolve('pricing.markupDisclosure', ctx),
    config.resolve('payments.gatewayFees'),
    config.flagMap(who),
  ]);
  return {
    finalRounding: rounding.value,
    surchargeCapPaise: surcharges.value.maxTotalPaise,
    promotionStacking: surcharges.value.promotionStacking,
    tips: { enabled: tips.value.enabled, riderShareBps: tips.value.riderShareBps },
    tipPresetsPaise: tips.value.presetsPaise,
    flags,
    gatewayFees: gateway.value,
    markupDisclosure: disclosure.value,
  };
}

/**
 * Customer display prices for a menu (spec §10): the same markup function the cart quote uses, so a menu
 * price and a cart line can never disagree.
 * @param {any[]} markupRules candidates from loadRuleSet
 * @param {object} baseCtx { countryId, stateId, cityId, zoneId, restaurantId, branchId }
 * @param {Date} now
 */
export function createMenuPricer(markupRules, baseCtx, now) {
  const cache = new Map();
  const ruleFor = (productId, categoryId, variantId) => {
    const key = `${productId}:${variantId ?? ''}`;
    if (!cache.has(key)) {
      const hit = resolveScoped(
        markupRules,
        { ...baseCtx, productId, categoryId: categoryId ?? undefined, variantId: variantId ?? undefined },
        now,
      );
      cache.set(key, hit ? parseRuleParams('MARKUP', hit.winner) : null);
    }
    return cache.get(key);
  };
  return {
    item: (basePaise, { productId, categoryId, variantId }) =>
      applyMarkup(basePaise, ruleFor(productId, categoryId, variantId)),
    addon: (basePaise, { productId, categoryId }) =>
      addonDisplay(basePaise, ruleFor(productId, categoryId, null)),
  };
}

export { quote, RULE_TYPES };
