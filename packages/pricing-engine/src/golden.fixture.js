// The PRICING.md §6 worked example as a reusable test fixture: the pricing engine's own golden test and the
// settlement engine's posting tests price the very same order. Test code only; nothing in the apps uses it.
import { quote } from './index.js';

export const TZ = 'Asia/Kolkata';
export const ist = (local) => new Date(`${local}+05:30`);
export const AT_2330 = ist('2026-09-28T23:30:00');
export const AT_1300 = ist('2026-09-28T13:00:00');

let seq = 0;
export const rule = (scope, params, extra = {}) => ({
  id: `rule-${++seq}`,
  scope,
  scopeRefId: scope === 'GLOBAL' ? null : extra.ref,
  params,
  priority: 0,
  effectiveFrom: '2026-01-01T00:00:00Z',
  effectiveTo: null,
  ...extra,
});
export const gst = (appliesTo, rateBps, mode = 'EXCLUSIVE') =>
  rule('GLOBAL', {
    appliesTo,
    mode,
    components: [
      { code: 'CGST', rateBps: rateBps / 2 },
      { code: 'SGST', rateBps: rateBps / 2 },
    ],
  });

export const CTX = {
  countryId: 'in',
  stateId: 'gj',
  cityId: 'unjha',
  restaurantZoneId: 'z-central',
  deliveryZoneId: 'z-north',
  restaurantId: 'abc-pizza',
  branchId: 'b1',
  timeZone: TZ,
  distanceM: 3200,
  distanceSource: 'ROAD',
  paymentMethod: 'CARD',
  pastOrderCount: 0,
};

/** PRICING.md §6 configuration. */
export function goldenRules() {
  return {
    markup: [
      rule(
        'RESTAURANT',
        { type: 'PERCENTAGE', valueBps: 1000, rounding: { mode: 'NEAREST_1', direction: 'HALF_UP' } },
        { ref: 'abc-pizza' },
      ),
    ],
    commission: [
      rule(
        'RESTAURANT',
        { type: 'PERCENTAGE', rateBps: 1200, basis: 'POST_RESTAURANT_DISCOUNT' },
        { ref: 'abc-pizza' },
      ),
    ],
    tax: [
      gst('FOOD', 500),
      gst('PACKAGING', 500),
      gst('DELIVERY_FEE', 1800),
      gst('SURCHARGE', 1800),
      gst('PLATFORM_FEE', 1800),
      gst('COMMISSION', 1800),
    ],
    platformFee: [rule('GLOBAL', { enabled: true, fixedPaise: 500 })],
    delivery: [
      rule('GLOBAL', {
        strategy: 'SLABS',
        slabs: [
          { upToM: 2000, feePaise: 2000 },
          { upToM: 4000, feePaise: 3000 },
          { upToM: 6000, feePaise: 4000 },
        ],
        maxDistanceM: 6000,
      }),
    ],
    surge: [
      rule(
        'GLOBAL',
        { type: 'FIXED', value: 1000, window: { start: '23:00', end: '06:00' } },
        { kind: 'NIGHT', isEnabled: true },
      ),
    ],
    riderEarning: [
      rule('GLOBAL', {
        basePaise: 2500,
        includedM: 2000,
        perKmPaise: 600,
        billingUnitM: 100,
        incentives: [{ kind: 'NIGHT', type: 'FIXED', value: 500, window: { start: '23:00', end: '06:00' } }],
      }),
    ],
  };
}
export const SETTINGS = {
  finalRounding: { mode: 'NEAREST_1', direction: 'HALF_UP', absorbedBy: 'PLATFORM' },
  surchargeCapPaise: 5000,
  promotionStacking: 'ONE_PROMO_ONE_COUPON',
  tips: { enabled: true, riderShareBps: 10_000 },
  flags: { night_pricing: true, surge: true, free_delivery: true, tips: true },
  gatewayFees: {
    methods: { CARD: { bps: 200, fixedPaise: 0 }, UPI: { bps: 0, fixedPaise: 0 } },
    gstBps: 1800,
    defaultMethod: 'UPI',
  },
  markupDisclosure: 'NONE',
};
export const SAVE10 = {
  id: 'coupon-save10',
  code: 'SAVE10',
  discountType: 'PERCENTAGE',
  valueBps: 1000,
  maxDiscountPaise: 10_000,
  fundingSource: 'SHARED',
  restaurantShareBps: 5000,
  targeting: {},
  startsAt: '2026-01-01T00:00:00Z',
  endsAt: null,
  isActive: true,
};
export const pizzaLine = (overrides = {}) => ({
  key: 'l1',
  productId: 'paneer-tikka-pizza',
  categoryId: 'pizza',
  name: 'Paneer Tikka Pizza',
  unitBasePaise: 20_000,
  quantity: 2,
  packagingPaise: 500,
  ...overrides,
});
export const run = (over = {}) =>
  quote(
    { lines: over.lines ?? [pizzaLine()] },
    { ...CTX, ...over.ctx },
    over.rules ?? goldenRules(),
    { ...SETTINGS, ...over.settings, flags: { ...SETTINGS.flags, ...over.flags } },
    {
      coupon: over.coupon === undefined ? SAVE10 : over.coupon,
      promotions: over.promotions ?? [],
      tipPaise: over.tip,
      now: over.now ?? AT_2330,
    },
  );
