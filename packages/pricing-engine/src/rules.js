// Parameter schemas of the versioned commercial rules (PRICING.md §3, DELIVERY.md §4). Validated when a
// rule is written (API) and again when the engine reads it — a malformed stored rule never prices an order.
import { z } from 'zod';

const paise = z.number().int().min(0).max(1_000_000_000);
const bps = z.number().int().min(0).max(10_000);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const hhmmEnd = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:mm or 24:00');
/** A daily time window in the city's timezone; may cross midnight (e.g. 23:00–06:00). */
export const timeWindow = z
  .object({ start: hhmm, end: hhmmEnd })
  .refine((w) => w.start !== w.end, 'Start and end cannot be equal');

export const MARKUP_ROUNDING_MODES = ['NONE', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10', 'PSYCHOLOGICAL'];

export const markupParams = z
  .object({
    type: z.enum(['PERCENTAGE', 'FIXED']),
    valueBps: z.number().int().min(0).max(100_000).optional(), // up to +1000%
    valuePaise: paise.optional(),
    rounding: z
      .object({
        mode: z.enum(MARKUP_ROUNDING_MODES),
        direction: z.enum(['HALF_UP', 'UP', 'DOWN']).default('HALF_UP'),
        endingDigit: z.number().int().min(0).max(9).optional(), // PSYCHOLOGICAL: e.g. 9 → ₹119
      })
      .default({ mode: 'NONE', direction: 'HALF_UP' }),
    applyToAddons: z.boolean().default(true),
  })
  .refine(
    (p) => (p.type === 'PERCENTAGE' ? p.valueBps !== undefined : p.valuePaise !== undefined),
    'Set the markup value',
  )
  .refine(
    (p) => p.rounding.mode !== 'PSYCHOLOGICAL' || p.rounding.endingDigit !== undefined,
    'Psychological rounding needs an ending digit',
  );

export const COMMISSION_BASES = ['PRE_DISCOUNT', 'POST_RESTAURANT_DISCOUNT', 'POST_ALL_DISCOUNTS'];
export const commissionParams = z
  .object({
    type: z.enum(['PERCENTAGE', 'FIXED', 'HYBRID']),
    rateBps: bps.optional(),
    fixedPaise: paise.optional(),
    hybridMode: z.enum(['SUM', 'MAX']).default('SUM'),
    basis: z.enum(COMMISSION_BASES), // never assumed (OD-10)
  })
  .refine((p) => p.type === 'FIXED' || p.rateBps !== undefined, 'Set the commission rate')
  .refine((p) => p.type === 'PERCENTAGE' || p.fixedPaise !== undefined, 'Set the fixed commission');

export const TAXABLE_CHARGES = [
  'FOOD',
  'PACKAGING',
  'DELIVERY_FEE',
  'PLATFORM_FEE',
  'SMALL_ORDER_FEE',
  'SURCHARGE',
  'COMMISSION',
];
const chargeTax = z.object({
  appliesTo: z.enum(TAXABLE_CHARGES),
  mode: z.enum(['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT']),
  components: z
    .array(z.object({ code: z.string().min(1).max(20), rateBps: bps }))
    .max(4)
    .default([]),
  liableParty: z.enum(['PLATFORM', 'RESTAURANT']).default('PLATFORM'),
});
const withholding = z.object({
  appliesTo: z.literal('WITHHOLDING'),
  kind: z.enum(['GST_TCS', 'INCOME_TAX_TDS']),
  rateBps: bps,
  base: z.enum(['FOOD_VALUE', 'FOOD_VALUE_AFTER_RESTAURANT_DISCOUNT']),
  enabled: z.boolean(),
});
export const taxParams = z.union([chargeTax, withholding]);

export const platformFeeParams = z.object({
  enabled: z.boolean(),
  fixedPaise: paise.default(0),
  rateBps: bps.default(0),
  minPaise: paise.optional(),
  maxPaise: paise.optional(),
  schedule: z
    .object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), window: timeWindow })
    .optional(),
});

export const deliveryPricingParams = z
  .object({
    strategy: z.enum(['SLABS', 'BASE_PLUS_PER_KM', 'FLAT']),
    slabs: z
      .array(z.object({ upToM: z.number().int().min(1), feePaise: paise }))
      .max(20)
      .optional(),
    basePaise: paise.optional(),
    includedM: z.number().int().min(0).default(0),
    perKmPaise: paise.optional(),
    billingUnitM: z.number().int().min(1).max(1000).default(100),
    flatPaise: paise.optional(),
    minPaise: paise.optional(),
    maxPaise: paise.optional(),
    maxDistanceM: z.number().int().min(100).max(100_000),
    freeAboveSubtotalPaise: paise.optional(),
    smallOrder: z.object({ belowSubtotalPaise: paise, feePaise: paise }).optional(),
  })
  .refine((p) => p.strategy !== 'SLABS' || (p.slabs?.length ?? 0) > 0, 'Add at least one distance slab')
  .refine(
    (p) => !p.slabs || p.slabs.every((s, i) => i === 0 || s.upToM > p.slabs[i - 1].upToM),
    'Slabs must be in increasing distance order',
  )
  .refine(
    (p) => p.strategy !== 'BASE_PLUS_PER_KM' || (p.basePaise !== undefined && p.perKmPaise !== undefined),
    'Set the base fee and the per-km fee',
  )
  .refine((p) => p.strategy !== 'FLAT' || p.flatPaise !== undefined, 'Set the flat fee');

export const SURGE_KINDS = ['NIGHT', 'DEMAND', 'WEATHER', 'MANUAL'];
export const surgeParams = z.object({
  type: z.enum(['FIXED', 'PERCENTAGE', 'MULTIPLIER']),
  /** FIXED: paise · PERCENTAGE: bps of the delivery fee · MULTIPLIER: bps multiplier (12 000 = ×1.2) */
  value: z.number().int().min(0).max(1_000_000),
  window: timeWindow.optional(),
  applyWhenDeliveryFree: z.boolean().default(true),
});

export const riderEarningParams = z.object({
  basePaise: paise,
  includedM: z.number().int().min(0).default(0),
  perKmPaise: paise.default(0),
  billingUnitM: z.number().int().min(1).max(1000).default(100),
  minPaise: paise.default(0),
  waitingFreeMin: z.number().int().min(0).default(0),
  waitingPerMinPaise: paise.default(0),
  waitingCapPaise: paise.optional(),
  incentives: z
    .array(
      z.object({
        kind: z.enum(['NIGHT', 'PEAK', 'RAIN', 'MANUAL']),
        type: z.enum(['FIXED', 'PERCENTAGE']),
        value: z.number().int().min(0).max(1_000_000),
        window: timeWindow.optional(),
      }),
    )
    .max(10)
    .default([]),
});

/** Rule types, their tables and schemas. */
export const RULE_TYPES = Object.freeze({
  MARKUP: { schema: markupParams, table: 'markupRule', permission: 'pricing.manage', lineScopes: true },
  COMMISSION: {
    schema: commissionParams,
    table: 'commissionRule',
    permission: 'commissions.manage',
    lineScopes: true,
  },
  TAX: { schema: taxParams, table: 'taxRule', permission: 'taxes.manage', lineScopes: true },
  PLATFORM_FEE: {
    schema: platformFeeParams,
    table: 'platformFeeRule',
    permission: 'pricing.manage',
    lineScopes: false,
  },
  DELIVERY: {
    schema: deliveryPricingParams,
    table: 'deliveryPricingRule',
    permission: 'pricing.manage',
    lineScopes: false,
  },
  SURGE: { schema: surgeParams, table: 'surgeRule', permission: 'pricing.surge', lineScopes: false },
  RIDER_EARNING: {
    schema: riderEarningParams,
    table: 'riderEarningRule',
    permission: 'pricing.manage',
    lineScopes: false,
  },
});

export class PricingError extends Error {
  /** @param {string} code @param {string} message @param {object} [details] */
  constructor(code, message, details) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Parses a stored rule's params; throws PricingError('RULE_INVALID') instead of pricing with bad data.
 * @param {keyof typeof RULE_TYPES} type
 * @param {any} rule stored rule row ({ id, params, … })
 */
export function parseRuleParams(type, rule) {
  const r = RULE_TYPES[type].schema.safeParse(rule.params);
  if (!r.success)
    throw new PricingError('RULE_INVALID', `${type} rule ${rule.id} has invalid parameters`, {
      issues: r.error.issues,
    });
  return r.data;
}
