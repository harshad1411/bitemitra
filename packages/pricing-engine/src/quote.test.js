// Pricing engine tests (PRICING.md §10). Expected values are worked out by hand in paise, independently of
// the implementation. The §6 worked example is the golden test.
import { describe, expect, it } from 'vitest';
import { PricingError, applyMarkup, quote } from './index.js';

const TZ = 'Asia/Kolkata';
const ist = (local) => new Date(`${local}+05:30`);
const AT_2330 = ist('2026-09-28T23:30:00');
const AT_1300 = ist('2026-09-28T13:00:00');

let seq = 0;
const rule = (scope, params, extra = {}) => ({
  id: `rule-${++seq}`,
  scope,
  scopeRefId: scope === 'GLOBAL' ? null : extra.ref,
  params,
  priority: 0,
  effectiveFrom: '2026-01-01T00:00:00Z',
  effectiveTo: null,
  ...extra,
});
const gst = (appliesTo, rateBps, mode = 'EXCLUSIVE') =>
  rule('GLOBAL', {
    appliesTo,
    mode,
    components: [
      { code: 'CGST', rateBps: rateBps / 2 },
      { code: 'SGST', rateBps: rateBps / 2 },
    ],
  });

const CTX = {
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
function goldenRules() {
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
const SETTINGS = {
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
const SAVE10 = {
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
const pizzaLine = (overrides = {}) => ({
  key: 'l1',
  productId: 'paneer-tikka-pizza',
  categoryId: 'pizza',
  name: 'Paneer Tikka Pizza',
  unitBasePaise: 20_000,
  quantity: 2,
  packagingPaise: 500,
  ...overrides,
});
const run = (over = {}) =>
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

describe('golden example (PRICING.md §6)', () => {
  const q = run();
  it('customer bill, line by line', () => {
    expect(q.totals).toMatchObject({
      foodBasePaise: 40_000,
      foodDisplayPaise: 44_000,
      markupPaise: 4_000,
      foodDiscountPaise: 4_400,
      packagingPaise: 1_000,
      deliveryFeePaise: 3_000,
      surchargePaise: 1_000,
      platformFeePaise: 500,
      taxExclusivePaise: 1_980 + 50 + 540 + 180 + 90,
      beforeRoundingPaise: 47_940,
      roundingAdjustmentPaise: -40,
      totalPayablePaise: 47_900,
    });
    expect(q.lines[0].tax.amountPaise).toBe(1_980);
    expect(q.taxes.packaging.amountPaise).toBe(50);
    expect(q.taxes.deliveryFee.amountPaise).toBe(540);
    expect(q.taxes.surcharge.amountPaise).toBe(180);
    expect(q.taxes.platformFee.amountPaise).toBe(90);
    expect(q.customerBill.lines.map((l) => [l.code, l.amountPaise])).toEqual([
      ['ITEMS', 44_000],
      ['COUPON', -4_400],
      ['PACKAGING', 1_000],
      ['DELIVERY_FEE', 3_000],
      ['SURCHARGE_NIGHT', 1_000],
      ['PLATFORM_FEE', 500],
      ['TAXES', 2_840],
      ['ROUNDING', -40],
    ]);
  });

  it('restaurant payable 33 448', () => {
    expect(q.restaurant).toMatchObject({
      foodValuePaise: 40_000,
      restaurantFundedDiscountPaise: 2_200,
      commissionChargedPaise: 4_536 + 816,
      payablePaise: 33_448,
    });
    expect(q.restaurant.commission.groups[0]).toMatchObject({
      basis: 'POST_RESTAURANT_DISCOUNT',
      basePaise: 37_800,
      amountPaise: 4_536,
    });
    expect(q.restaurant.commissionTax.amountPaise).toBe(816);
  });

  it('rider 3 720, gateway 1 130, platform net 5 946 — every paise accounted for', () => {
    expect(q.rider.totalPaise).toBe(3_720);
    expect(q.platform.gatewayEstimatePaise).toBe(1_130);
    expect(q.platform.taxLiabilitiesPaise).toBe(3_656);
    expect(q.platform.netPaise).toBe(5_946);
    expect(33_448 + 3_720 + 3_656 + 1_130 + 5_946).toBe(q.totals.totalPayablePaise);
  });

  it('records the delivery source, the coupon funding and every rule used', () => {
    expect(q.delivery).toMatchObject({ distanceM: 3200, distanceSource: 'ROAD', standardFeePaise: 3000 });
    expect(q.discounts[0]).toMatchObject({
      code: 'SAVE10',
      amountPaise: 4_400,
      restaurantFundedPaise: 2_200,
      platformFundedPaise: 2_200,
    });
    expect(q.coupon).toEqual({ code: 'SAVE10', status: 'APPLIED' });
    expect(new Set(q.rulesUsed.map((r) => r.type))).toEqual(
      new Set(['MARKUP', 'DELIVERY', 'SURGE', 'PLATFORM_FEE', 'TAX', 'COMMISSION', 'RIDER_EARNING']),
    );
    expect(q.taxes.pendingCaReview).toBe(true);
    expect(q.issues).toEqual([]);
  });
});

describe('markup (spec §10, OD-8)', () => {
  const rules = () => ({
    ...goldenRules(),
    markup: [
      rule('GLOBAL', { type: 'PERCENTAGE', valueBps: 500 }),
      rule('CITY', { type: 'PERCENTAGE', valueBps: 700 }, { ref: 'unjha' }),
      rule('RESTAURANT', { type: 'PERCENTAGE', valueBps: 1000 }, { ref: 'abc-pizza' }),
      rule('PRODUCT', { type: 'PERCENTAGE', valueBps: 1500 }, { ref: 'farmhouse' }),
    ],
  });
  const unit = (line, ctx = {}) =>
    run({
      rules: rules(),
      coupon: null,
      lines: [pizzaLine({ unitBasePaise: 10_000, quantity: 1, ...line })],
      ctx,
    }).lines[0].unitDisplayPaise;
  it('the most specific rule wins: product 15%, restaurant 10%, city 7%, global 5%', () => {
    expect(unit({ productId: 'farmhouse' })).toBe(11_500);
    expect(unit({ productId: 'garlic-bread' })).toBe(11_000);
    expect(unit({ productId: 'x' }, { restaurantId: 'other' })).toBe(10_700);
    expect(unit({ productId: 'x' }, { restaurantId: 'other', cityId: 'future-city' })).toBe(10_500);
  });
  it('no markup rule → restaurant price', () => {
    const q = run({ rules: { ...goldenRules(), markup: [] }, coupon: null });
    expect(q.lines[0].unitDisplayPaise).toBe(20_000);
    expect(q.totals.markupPaise).toBe(0);
  });
  it('rounding modes; never below the restaurant price', () => {
    const r = (mode, direction = 'HALF_UP', endingDigit) => ({
      type: 'PERCENTAGE',
      valueBps: 700,
      rounding: { mode, direction, endingDigit },
    });
    expect(applyMarkup(10_049, r('NONE'))).toBe(10_752); // 10 049 + 703.43 → 703
    expect(applyMarkup(10_049, r('NEAREST_1'))).toBe(10_800);
    expect(applyMarkup(10_049, r('NEAREST_5'))).toBe(11_000); // ₹107.52 is nearer ₹110 than ₹105
    expect(applyMarkup(10_049, r('NEAREST_10'))).toBe(11_000);
    expect(applyMarkup(10_049, r('PSYCHOLOGICAL', 'UP', 9))).toBe(10_900);
    expect(applyMarkup(10_049, r('NEAREST_10', 'DOWN'))).toBe(10_049); // would be ₹100 < ₹100.49 → kept at base
    expect(applyMarkup(20_000, { type: 'FIXED', valuePaise: 1_500, rounding: { mode: 'NONE' } })).toBe(
      21_500,
    );
  });
  it('add-ons follow percentage markup only when applyToAddons', () => {
    const line = pizzaLine({
      quantity: 1,
      addons: [{ addonId: 'a1', name: 'Cheese', basePricePaise: 3_000 }],
    });
    const on = run({ coupon: null, lines: [line] });
    expect(on.lines[0].addons[0].displayPricePaise).toBe(3_300);
    const off = run({
      coupon: null,
      lines: [line],
      rules: {
        ...goldenRules(),
        markup: [rule('GLOBAL', { type: 'PERCENTAGE', valueBps: 1000, applyToAddons: false })],
      },
    });
    expect(off.lines[0].addons[0].displayPricePaise).toBe(3_000);
  });
  it('expired and future-dated rules are ignored', () => {
    const q = run({
      coupon: null,
      rules: {
        ...goldenRules(),
        markup: [
          rule('GLOBAL', { type: 'PERCENTAGE', valueBps: 500 }),
          rule(
            'RESTAURANT',
            { type: 'PERCENTAGE', valueBps: 9000 },
            { ref: 'abc-pizza', effectiveTo: '2026-06-01T00:00:00Z' },
          ),
          rule(
            'PRODUCT',
            { type: 'PERCENTAGE', valueBps: 9000 },
            { ref: 'paneer-tikka-pizza', effectiveFrom: '2027-01-01T00:00:00Z' },
          ),
        ],
      },
    });
    expect(q.lines[0].unitDisplayPaise).toBe(21_000);
  });
  it('restaurant-qualified category rule (6.5) beats the plain category rule (6)', () => {
    const q = run({
      coupon: null,
      rules: {
        ...goldenRules(),
        markup: [
          rule('CATEGORY', { type: 'PERCENTAGE', valueBps: 800 }, { ref: 'pizza' }),
          rule(
            'CATEGORY',
            { type: 'PERCENTAGE', valueBps: 300 },
            { ref: 'pizza', restaurantId: 'abc-pizza' },
          ),
        ],
      },
    });
    expect(q.lines[0].unitDisplayPaise).toBe(20_600);
  });
});

describe('tax', () => {
  it('inclusive tax is extracted, not added', () => {
    const q = run({ coupon: null, rules: { ...goldenRules(), tax: [gst('FOOD', 500, 'INCLUSIVE')] } });
    // 44 000 × 500 / 10 500 = 2 095.2 → 2 095, inside the price
    expect(q.lines[0].tax).toMatchObject({ mode: 'INCLUSIVE', amountPaise: 2_095 });
    expect(q.totals.taxExclusivePaise).toBe(0);
    expect(q.customerBill.notes[0]).toMatch(/Includes taxes of ₹20\.95/);
  });
  it('exempt, and a product-level inclusive override', () => {
    expect(
      run({ coupon: null, rules: { ...goldenRules(), tax: [gst('FOOD', 0, 'EXEMPT')] } }).lines[0].tax
        .amountPaise,
    ).toBe(0);
    const q = run({ coupon: null, lines: [pizzaLine({ taxInclusive: true })] });
    expect(q.lines[0].tax.mode).toBe('INCLUSIVE');
  });
  it('components always add up to the tax (odd amounts split exactly)', () => {
    const q = run({
      coupon: null,
      lines: [pizzaLine({ unitBasePaise: 10_001, quantity: 1 })],
      rules: { ...goldenRules(), markup: [] },
    });
    const t = q.lines[0].tax; // 5% of 10 001 = 500.05 → 500 → 250 + 250
    expect(t.amountPaise).toBe(500);
    expect(t.components.map((c) => c.amountPaise)).toEqual([250, 250]);
    const odd = run({
      coupon: null,
      lines: [pizzaLine({ unitBasePaise: 10_020, quantity: 1 })],
      rules: { ...goldenRules(), markup: [] },
    });
    expect(odd.lines[0].tax.amountPaise).toBe(501);
    expect(odd.lines[0].tax.components.map((c) => c.amountPaise)).toEqual([251, 250]);
  });
  it('tax is computed after the discount allocation', () => {
    const q = run();
    expect(q.lines[0].tax.amountPaise).toBe(1_980); // 5% × (44 000 − 4 400)
  });
  it('a missing food tax rule is reported, not guessed', () => {
    const q = run({ coupon: null, rules: { ...goldenRules(), tax: [] } });
    expect(q.issues.some((i) => i.code === 'TAX_RULE_MISSING' && i.charge === 'FOOD')).toBe(true);
    expect(q.totals.taxExclusivePaise).toBe(0);
  });
});

describe('platform fee', () => {
  const pf = (params, extra) =>
    run({
      coupon: null,
      now: AT_1300,
      rules: { ...goldenRules(), platformFee: [rule('GLOBAL', params, extra)] },
    }).totals.platformFeePaise;
  it('disabled, fixed, percentage, both, min and max clamps', () => {
    expect(pf({ enabled: false, fixedPaise: 500 })).toBe(0);
    expect(pf({ enabled: true, fixedPaise: 500 })).toBe(500);
    expect(pf({ enabled: true, rateBps: 100 })).toBe(440); // 1% of 44 000
    expect(pf({ enabled: true, fixedPaise: 200, rateBps: 100 })).toBe(640);
    expect(pf({ enabled: true, rateBps: 10, minPaise: 300 })).toBe(300);
    expect(pf({ enabled: true, rateBps: 500, maxPaise: 1_000 })).toBe(1_000);
  });
  it('outside its schedule, and a restaurant override that disables it', () => {
    expect(
      pf({
        enabled: true,
        fixedPaise: 500,
        schedule: { days: [1], window: { start: '18:00', end: '23:00' } },
      }),
    ).toBe(0); // Monday 13:00
    const q = run({
      coupon: null,
      rules: {
        ...goldenRules(),
        platformFee: [
          rule('GLOBAL', { enabled: true, fixedPaise: 500 }),
          rule('RESTAURANT', { enabled: false }, { ref: 'abc-pizza' }),
        ],
      },
    });
    expect(q.totals.platformFeePaise).toBe(0);
  });
});

describe('delivery fee', () => {
  const slabs = (distanceM) => run({ coupon: null, now: AT_1300, ctx: { distanceM } });
  it.each([
    [0, 2000],
    [1000, 2000],
    [2000, 2000], // 2.0 km is still in 0–2 km
    [2100, 3000], // 2.1 km moves to 2–4 km
    [6000, 4000], // maximum distance
  ])('%i m → %i paise', (m, fee) => expect(slabs(m).totals.deliveryFeePaise).toBe(fee));
  it('beyond the maximum distance → not deliverable (no price)', () => {
    const q = slabs(6001);
    expect(q.deliverable).toBe(false);
    expect(q.issues[0]).toMatchObject({ code: 'NOT_DELIVERABLE', reason: 'TOO_FAR' });
  });
  it('base + per km with billing-unit edges and min/max clamps', () => {
    const per = (distanceM, extra = {}) =>
      run({
        coupon: null,
        now: AT_1300,
        ctx: { distanceM },
        rules: {
          ...goldenRules(),
          delivery: [
            rule('GLOBAL', {
              strategy: 'BASE_PLUS_PER_KM',
              basePaise: 1500,
              includedM: 2000,
              perKmPaise: 800,
              billingUnitM: 500,
              maxDistanceM: 10_000,
              ...extra,
            }),
          ],
        },
      }).totals.deliveryFeePaise;
    expect(per(2000)).toBe(1500);
    expect(per(2001)).toBe(1900); // one 500 m unit = ₹4
    expect(per(2500)).toBe(1900);
    expect(per(2501)).toBe(2300);
    expect(per(9000, { maxPaise: 5000 })).toBe(5000);
    expect(per(100, { basePaise: 500, minPaise: 1200 })).toBe(1200);
  });
  it('free above a threshold: exactly at it, and 1 paise below', () => {
    const at = (freeAbove) =>
      run({
        coupon: null,
        now: AT_1300,
        rules: {
          ...goldenRules(),
          delivery: [
            rule('GLOBAL', { ...goldenRules().delivery[0].params, freeAboveSubtotalPaise: freeAbove }),
          ],
        },
      });
    expect(at(44_000).totals.deliveryFeePaise).toBe(0);
    expect(at(44_000).delivery.freeReason).toBe('THRESHOLD');
    expect(at(44_001).totals.deliveryFeePaise).toBe(3000);
    // The free_delivery flag switches thresholds off.
    expect(
      run({
        coupon: null,
        now: AT_1300,
        flags: { free_delivery: false },
        rules: {
          ...goldenRules(),
          delivery: [rule('GLOBAL', { ...goldenRules().delivery[0].params, freeAboveSubtotalPaise: 100 })],
        },
      }).totals.deliveryFeePaise,
    ).toBe(3000);
  });
  it('small-order fee below the threshold', () => {
    const r = {
      ...goldenRules(),
      delivery: [
        rule('GLOBAL', {
          ...goldenRules().delivery[0].params,
          smallOrder: { belowSubtotalPaise: 9_900, feePaise: 1_500 },
        }),
      ],
    };
    expect(
      run({ coupon: null, now: AT_1300, rules: r, lines: [pizzaLine({ unitBasePaise: 5_000, quantity: 1 })] })
        .totals.smallOrderFeePaise,
    ).toBe(1_500);
    expect(run({ coupon: null, now: AT_1300, rules: r }).totals.smallOrderFeePaise).toBe(0);
  });
});

describe('surcharges (Asia/Kolkata night window 23:00–06:00)', () => {
  const night = (local, over = {}) => run({ coupon: null, now: ist(local), ...over }).totals.surchargePaise;
  it.each([
    ['2026-09-28T22:59:59', 0],
    ['2026-09-28T23:00:00', 1000],
    ['2026-09-29T05:59:59', 1000],
    ['2026-09-29T06:00:00', 0],
  ])('%s → %i', (t, amount) => expect(night(t)).toBe(amount));
  it('a window that does not cross midnight', () => {
    const rules = {
      ...goldenRules(),
      surge: [
        rule(
          'GLOBAL',
          { type: 'FIXED', value: 700, window: { start: '12:00', end: '15:00' } },
          { kind: 'MANUAL', isEnabled: true },
        ),
      ],
    };
    expect(night('2026-09-28T13:00:00', { rules })).toBe(700);
    expect(night('2026-09-28T15:00:00', { rules })).toBe(0);
  });
  it('demand surge multipliers ×1.0 / ×1.2 / ×1.5 on the delivery fee', () => {
    const m = (value) =>
      night('2026-09-28T13:00:00', {
        rules: {
          ...goldenRules(),
          surge: [rule('GLOBAL', { type: 'MULTIPLIER', value }, { kind: 'DEMAND', isEnabled: true })],
        },
      });
    expect(m(10_000)).toBe(0);
    expect(m(12_000)).toBe(600);
    expect(m(15_000)).toBe(1500);
  });
  it('kill-switch, feature flag and the total cap', () => {
    const r = goldenRules();
    r.surge[0].isEnabled = false;
    expect(night('2026-09-28T23:30:00', { rules: r })).toBe(0);
    expect(night('2026-09-28T23:30:00', { flags: { night_pricing: false } })).toBe(0);
    const both = {
      ...goldenRules(),
      surge: [
        ...goldenRules().surge,
        rule('GLOBAL', { type: 'FIXED', value: 4_500 }, { kind: 'DEMAND', isEnabled: true }),
      ],
    };
    expect(night('2026-09-28T23:30:00', { rules: both })).toBe(5_000); // 1 000 + 4 500 capped at 5 000
  });
});

describe('discounts and funding', () => {
  const offer = (o) => ({
    id: `o-${++seq}`,
    targeting: {},
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
    isActive: true,
    fundingSource: 'PLATFORM',
    ...o,
  });
  it('fixed, capped percentage, and a discount larger than the subtotal', () => {
    expect(
      run({ coupon: offer({ code: 'FLAT50', discountType: 'FIXED', valuePaise: 5_000 }) }).totals
        .foodDiscountPaise,
    ).toBe(5_000);
    expect(
      run({
        coupon: offer({
          code: 'HALF',
          discountType: 'PERCENTAGE',
          valueBps: 5_000,
          maxDiscountPaise: 10_000,
        }),
      }).totals.foodDiscountPaise,
    ).toBe(10_000);
    const huge = run({ coupon: offer({ code: 'ALL', discountType: 'FIXED', valuePaise: 999_999 }) });
    expect(huge.totals.foodDiscountPaise).toBe(44_000);
    expect(huge.totals.foodAfterDiscountPaise).toBe(0);
  });
  it('minimum order edge: exactly at it applies, 1 paise short does not', () => {
    expect(
      run({ coupon: offer({ code: 'MIN', discountType: 'FIXED', valuePaise: 1_000, minOrderPaise: 44_000 }) })
        .coupon.status,
    ).toBe('APPLIED');
    const short = run({
      coupon: offer({ code: 'MIN', discountType: 'FIXED', valuePaise: 1_000, minOrderPaise: 44_001 }),
    });
    expect(short.coupon).toMatchObject({ status: 'NOT_APPLICABLE', reason: 'MIN_ORDER', shortByPaise: 1 });
    expect(short.totals.foodDiscountPaise).toBe(0);
  });
  it('first order only, usage limits, dates, targeting', () => {
    expect(
      run({
        coupon: offer({ code: 'NEW', discountType: 'FIXED', valuePaise: 100, firstOrderOnly: true }),
        ctx: { pastOrderCount: 1 },
      }).coupon.reason,
    ).toBe('FIRST_ORDER_ONLY');
    expect(
      run({
        coupon: offer({
          code: 'U',
          discountType: 'FIXED',
          valuePaise: 100,
          perUserLimit: 1,
          userUsedCount: 1,
        }),
      }).coupon.reason,
    ).toBe('PER_USER_LIMIT_REACHED');
    expect(
      run({
        coupon: offer({ code: 'X', discountType: 'FIXED', valuePaise: 100, endsAt: '2026-09-01T00:00:00Z' }),
      }).coupon.reason,
    ).toBe('EXPIRED');
    expect(
      run({
        coupon: offer({
          code: 'R',
          discountType: 'FIXED',
          valuePaise: 100,
          targeting: { restaurantIds: ['other'] },
        }),
      }).coupon.reason,
    ).toBe('NOT_FOR_RESTAURANT');
    expect(
      run({
        coupon: offer({
          code: 'P',
          discountType: 'FIXED',
          valuePaise: 100,
          targeting: { paymentMethods: ['UPI'] },
        }),
      }).coupon.reason,
    ).toBe('PAYMENT_METHOD');
  });
  it('category-targeted discount applies only to matching lines', () => {
    const lines = [
      pizzaLine({ quantity: 1 }),
      pizzaLine({ key: 'l2', productId: 'coke', categoryId: 'beverages', unitBasePaise: 5_000, quantity: 1 }),
    ];
    const q = run({
      lines,
      coupon: offer({
        code: 'PIZZA20',
        discountType: 'PERCENTAGE',
        valueBps: 2_000,
        targeting: { categoryIds: ['pizza'] },
      }),
    });
    expect(q.lines.map((l) => l.discountPaise)).toEqual([4_400, 0]); // 20% of 22 000
  });
  it('restaurant / platform / shared funding and remainders across lines', () => {
    const lines = [
      pizzaLine({ quantity: 1, unitBasePaise: 10_001 }),
      pizzaLine({ key: 'l2', productId: 'b', quantity: 1, unitBasePaise: 10_002 }),
      pizzaLine({ key: 'l3', productId: 'c', quantity: 1, unitBasePaise: 10_003 }),
    ];
    const q = run({
      lines,
      rules: { ...goldenRules(), markup: [] },
      coupon: offer({
        code: 'SH',
        discountType: 'FIXED',
        valuePaise: 1_000,
        fundingSource: 'SHARED',
        restaurantShareBps: 3_333,
      }),
    });
    // 1 000 × 10 001/30 006 = 333.29, × 10 002/30 006 = 333.33, × 10 003/30 006 = 333.37 → largest remainder gets the spare paise
    expect(q.lines.map((l) => l.discountPaise)).toEqual([333, 333, 334]);
    expect(q.lines.reduce((a, l) => a + l.discountPaise, 0)).toBe(1_000);
    expect(q.discounts[0]).toMatchObject({ restaurantFundedPaise: 333, platformFundedPaise: 667 });
    expect(q.lines.reduce((a, l) => a + l.restaurantFundedDiscountPaise, 0)).toBe(333);
    const rest = run({
      coupon: offer({ code: 'RF', discountType: 'FIXED', valuePaise: 2_000, fundingSource: 'RESTAURANT' }),
    });
    expect(rest.restaurant.restaurantFundedDiscountPaise).toBe(2_000);
    expect(rest.platform.platformFundedDiscountPaise).toBe(0);
  });
  it('free-delivery coupon, and one promotion + one coupon stacking vs best-of', () => {
    const fd = run({
      now: AT_1300,
      coupon: offer({ code: 'FREEDEL', discountType: 'FREE_DELIVERY', fundingSource: 'RESTAURANT' }),
    });
    expect(fd.totals.deliveryDiscountPaise).toBe(3_000);
    expect(fd.taxes.deliveryFee.amountPaise).toBe(0);
    expect(fd.restaurant.restaurantFundedDiscountPaise).toBe(3_000);
    const fdPromo = run({
      now: AT_1300,
      coupon: null,
      promotions: [offer({ name: 'Free delivery weekend', discountType: 'FREE_DELIVERY' })],
    });
    expect(fdPromo.totals.deliveryDiscountPaise).toBe(3_000);
    expect(fdPromo.customerBill.lines.find((l) => l.code === 'DELIVERY_DISCOUNT').label).toBe(
      'Free delivery (Free delivery weekend)',
    );
    const promo = offer({
      name: '10% off',
      discountType: 'PERCENTAGE',
      valueBps: 1_000,
      fundingSource: 'RESTAURANT',
    });
    const coupon = offer({ code: 'C20', discountType: 'FIXED', valuePaise: 2_000 });
    expect(run({ promotions: [promo], coupon }).totals.foodDiscountPaise).toBe(4_400 + 2_000);
    const best = run({ promotions: [promo], coupon, settings: { promotionStacking: 'BEST_OF' } });
    expect(best.totals.foodDiscountPaise).toBe(4_400);
    expect(best.coupon).toMatchObject({ status: 'NOT_APPLIED', reason: 'BETTER_OFFER_APPLIED' });
  });
});

describe('orders, tips and rounding', () => {
  it('large order (₹50 000) and 200 lines keep every invariant', () => {
    expect(run({ lines: [pizzaLine({ unitBasePaise: 2_500_000, quantity: 2 })] }).totals.foodBasePaise).toBe(
      5_000_000,
    );
    const many = Array.from({ length: 200 }, (_, i) =>
      pizzaLine({ key: `k${i}`, productId: `p${i}`, unitBasePaise: 1_000 + i, quantity: 1 + (i % 3) }),
    );
    const q = run({ lines: many });
    expect(q.lines).toHaveLength(200);
  });
  it('tip goes to the rider, never platform revenue; switched off when tips are disabled', () => {
    // UPI has no gateway fee here; with a card, the gateway fee on the tip is a real platform cost.
    const upi = { paymentMethod: 'UPI' };
    const withoutTip = run({ ctx: upi }).platform.netPaise;
    const q = run({ tip: 2_000, ctx: upi });
    expect(q.totals.tipPaise).toBe(2_000);
    expect(q.rider.tipPaise).toBe(2_000);
    expect(q.platform.netPaise).toBe(withoutTip); // the tip never becomes platform revenue
    const split = run({ tip: 2_000, ctx: upi, settings: { tips: { enabled: true, riderShareBps: 9_000 } } });
    expect(split.platform.tipPassThroughPaise).toBe(200);
    expect(split.platform.netPaise).toBe(withoutTip);
    expect(run({ tip: 2_000 }).platform.gatewayEstimatePaise).toBe(1_178); // card: 2% × 49 900 = 998 + 18% GST 180
    const off = run({ tip: 2_000, flags: { tips: false } });
    expect(off.totals.tipPaise).toBe(0);
    expect(off.issues.map((i) => i.code)).toContain('TIPS_DISABLED');
  });
  it('final rounding up, down, none, and absorbed by the restaurant', () => {
    const r = (finalRounding) =>
      run({ settings: { finalRounding: { absorbedBy: 'PLATFORM', ...finalRounding } } });
    expect(r({ mode: 'NEAREST_1', direction: 'UP' }).totals.totalPayablePaise).toBe(48_000);
    expect(r({ mode: 'NEAREST_1', direction: 'DOWN' }).totals.totalPayablePaise).toBe(47_900);
    expect(r({ mode: 'NEAREST_10', direction: 'HALF_UP' }).totals.totalPayablePaise).toBe(48_000);
    expect(r({ mode: 'NONE', direction: 'HALF_UP' }).totals.roundingAdjustmentPaise).toBe(0);
    const rest = run({
      settings: { finalRounding: { mode: 'NEAREST_1', direction: 'HALF_UP', absorbedBy: 'RESTAURANT' } },
    });
    expect(rest.restaurant.payablePaise).toBe(33_448 - 40);
    expect(rest.platform.netPaise).toBe(5_946 + 40);
  });
  it('markup disclosure modes change presentation, never the total', () => {
    const none = run();
    const itemised = run({ settings: { markupDisclosure: 'ITEMISED' } });
    expect(itemised.customerBill.lines.slice(0, 2)).toEqual([
      { code: 'ITEMS', label: 'Item total', amountPaise: 40_000 },
      { code: 'PRICE_ADJUSTMENT', label: 'Platform price adjustment', amountPaise: 4_000 },
    ]);
    expect(itemised.totals.totalPayablePaise).toBe(none.totals.totalPayablePaise);
    expect(run({ settings: { markupDisclosure: 'NOTE' } }).customerBill.notes[0]).toMatch(/may differ/);
  });
});

describe('commission', () => {
  const c = (params) =>
    run({ rules: { ...goldenRules(), commission: [rule('GLOBAL', params)] } }).restaurant.commission
      .groups[0];
  it('basis is configurable: before discount, after restaurant-funded, after all discounts', () => {
    expect(c({ type: 'PERCENTAGE', rateBps: 1_200, basis: 'PRE_DISCOUNT' })).toMatchObject({
      basePaise: 40_000,
      amountPaise: 4_800,
    });
    expect(c({ type: 'PERCENTAGE', rateBps: 1_200, basis: 'POST_RESTAURANT_DISCOUNT' })).toMatchObject({
      basePaise: 37_800,
      amountPaise: 4_536,
    });
    expect(c({ type: 'PERCENTAGE', rateBps: 1_200, basis: 'POST_ALL_DISCOUNTS' })).toMatchObject({
      basePaise: 35_600,
      amountPaise: 4_272,
    });
  });
  it('fixed and hybrid (sum / max)', () => {
    expect(c({ type: 'FIXED', fixedPaise: 3_000, basis: 'PRE_DISCOUNT' }).amountPaise).toBe(3_000);
    expect(
      c({ type: 'HYBRID', rateBps: 1_000, fixedPaise: 1_000, hybridMode: 'SUM', basis: 'PRE_DISCOUNT' })
        .amountPaise,
    ).toBe(5_000);
    expect(
      c({ type: 'HYBRID', rateBps: 1_000, fixedPaise: 5_000, hybridMode: 'MAX', basis: 'PRE_DISCOUNT' })
        .amountPaise,
    ).toBe(5_000);
  });
  it('a commission above the food value flags the quote for review instead of hiding it', () => {
    const q = run({
      rules: {
        ...goldenRules(),
        commission: [rule('GLOBAL', { type: 'FIXED', fixedPaise: 90_000, basis: 'PRE_DISCOUNT' })],
      },
    });
    expect(q.restaurant.needsReview).toBe(true);
  });
  it('withholdings are off unless a rule enables them (pending CA, Q-3)', () => {
    expect(run().restaurant.withholdings).toEqual([]);
    const tcs = rule('GLOBAL', {
      appliesTo: 'WITHHOLDING',
      kind: 'GST_TCS',
      rateBps: 100,
      base: 'FOOD_VALUE',
      enabled: true,
    });
    const q = run({ rules: { ...goldenRules(), tax: [...goldenRules().tax, tcs] } });
    expect(q.restaurant.withholdings[0]).toMatchObject({ kind: 'GST_TCS', amountPaise: 400 });
    expect(q.restaurant.payablePaise).toBe(33_448 - 400);
  });
});

describe('safety', () => {
  it('refuses to price with an invalid stored rule', () => {
    const bad = { ...goldenRules(), markup: [rule('GLOBAL', { type: 'PERCENTAGE' })] };
    expect(() => run({ rules: bad })).toThrow(PricingError);
  });
  it('refuses an empty cart and a location without a delivery rule', () => {
    expect(() => run({ lines: [] })).toThrow(/empty/);
    expect(() => run({ rules: { ...goldenRules(), delivery: [] } })).toThrow(/No delivery pricing rule/);
  });
});

describe('property test: random carts and rules always satisfy the invariants (PRICING.md §8)', () => {
  // Small deterministic PRNG so failures are reproducible.
  let s = 20260925;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (xs) => xs[int(0, xs.length - 1)];
  it('2 000 random quotes', () => {
    for (let n = 0; n < 2000; n += 1) {
      const lines = Array.from({ length: int(1, 6) }, (_, i) =>
        pizzaLine({
          key: `k${i}`,
          productId: pick(['p1', 'p2', 'p3']),
          categoryId: pick(['pizza', 'drinks', null]),
          unitBasePaise: int(1, 80_000),
          quantity: int(1, 5),
          packagingPaise: pick([0, 500, 1_000]),
          addons: rnd() < 0.3 ? [{ addonId: 'a', name: 'A', basePricePaise: int(0, 5_000) }] : [],
          taxInclusive: pick([undefined, true, false]),
        }),
      );
      const rules = goldenRules();
      rules.markup = [
        rule('GLOBAL', {
          type: pick(['PERCENTAGE', 'FIXED']),
          valueBps: int(0, 3_000),
          valuePaise: int(0, 5_000),
          rounding: {
            mode: pick(['NONE', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10']),
            direction: pick(['HALF_UP', 'UP', 'DOWN']),
          },
        }),
      ];
      rules.tax[0] = gst('FOOD', pick([0, 500, 1_200, 1_800]), pick(['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT']));
      rules.commission = [
        rule('GLOBAL', {
          type: pick(['PERCENTAGE', 'HYBRID']),
          rateBps: int(0, 3_000),
          fixedPaise: int(0, 2_000),
          hybridMode: pick(['SUM', 'MAX']),
          basis: pick(['PRE_DISCOUNT', 'POST_RESTAURANT_DISCOUNT', 'POST_ALL_DISCOUNTS']),
        }),
      ];
      const coupon =
        rnd() < 0.6
          ? {
              ...SAVE10,
              discountType: pick(['PERCENTAGE', 'FIXED', 'FREE_DELIVERY']),
              valueBps: int(1, 10_000),
              valuePaise: int(1, 60_000),
              fundingSource: pick(['PLATFORM', 'RESTAURANT', 'SHARED']),
              restaurantShareBps: int(0, 10_000),
            }
          : null;
      const q = run({
        lines,
        rules,
        coupon,
        tip: pick([0, 0, 1_000, 3_333]),
        ctx: { distanceM: int(0, 6_000), paymentMethod: pick(['CARD', 'UPI', 'COD']) },
        now: new Date(Date.UTC(2026, 8, 28, int(0, 23), int(0, 59))),
        settings: {
          finalRounding: {
            mode: pick(['NONE', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10']),
            direction: pick(['HALF_UP', 'UP', 'DOWN']),
            absorbedBy: pick(['PLATFORM', 'RESTAURANT']),
          },
          promotionStacking: pick(['ONE_PROMO_ONE_COUPON', 'BEST_OF', 'COUPON_ONLY']),
        },
      });
      // quote() throws on any broken invariant; the conservation identity is re-checked here explicitly.
      const p = q.platform;
      expect(
        q.restaurant.payablePaise +
          q.rider.totalPaise +
          q.totals.tipPaise +
          p.taxLiabilitiesPaise +
          p.withholdingPaise +
          p.gatewayEstimatePaise +
          p.netPaise,
      ).toBe(q.totals.totalPayablePaise);
      expect(q.totals.totalPayablePaise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('per-line commission (order items, Phase 5)', () => {
  it('one line carries the whole commission of the golden example', () => {
    const q = run();
    expect(q.lines[0].commission).toMatchObject({ amountPaise: q.restaurant.commission.amountPaise });
    expect(q.lines[0].commission.basis).toBe(q.restaurant.commission.groups[0].basis);
  });
  it('several lines split their group exactly, in proportion to their base (largest remainder)', () => {
    const lines = [
      pizzaLine({ key: 'a', quantity: 1, unitBasePaise: 10_001 }),
      pizzaLine({ key: 'b', productId: 'garlic-bread', quantity: 3, unitBasePaise: 3_333 }),
      pizzaLine({ key: 'c', productId: 'coke', quantity: 1, unitBasePaise: 999 }),
    ];
    const q = run({ lines, coupon: null });
    const parts = q.lines.map((l) => l.commission.amountPaise);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(q.restaurant.commission.amountPaise);
    const bases = q.lines.map((l) => l.commission.basePaise);
    const total = bases.reduce((a, b) => a + b, 0);
    parts.forEach((p, i) =>
      expect(Math.abs(p - (q.restaurant.commission.amountPaise * bases[i]) / total)).toBeLessThan(1),
    );
  });
});

describe('add-on rounding (Q-19 → OD-39)', () => {
  it("add-ons get the markup rule's rounding; free add-ons stay free; FIXED markups skip add-ons", async () => {
    const { addonDisplay } = await import('./quote.js');
    const pct = (rounding) => ({ type: 'PERCENTAGE', valueBps: 1000, rounding, applyToAddons: true });
    expect(addonDisplay(2_500, pct({ mode: 'NEAREST_1', direction: 'HALF_UP' }))).toBe(2_800); // ₹27.50 → ₹28
    expect(addonDisplay(2_500, pct({ mode: 'NONE', direction: 'HALF_UP' }))).toBe(2_750);
    expect(addonDisplay(0, pct({ mode: 'PSYCHOLOGICAL', direction: 'UP', endingDigit: 9 }))).toBe(0);
    expect(
      addonDisplay(2_500, { ...pct({ mode: 'NEAREST_1', direction: 'HALF_UP' }), applyToAddons: false }),
    ).toBe(2_500);
    expect(
      addonDisplay(2_500, {
        type: 'FIXED',
        valuePaise: 1_000,
        rounding: { mode: 'NONE' },
        applyToAddons: true,
      }),
    ).toBe(2_500);
  });
});

describe('final rider pay (D-78)', () => {
  it('actual distance, waiting beyond free minutes (capped), incentives by time, tip on top', async () => {
    const { riderEarningFinal } = await import('./quote.js');
    const params = {
      basePaise: 2_500,
      includedM: 2_000,
      perKmPaise: 600,
      billingUnitM: 100,
      minPaise: 2_500,
      waitingFreeMin: 10,
      waitingPerMinPaise: 100,
      waitingCapPaise: 1_000,
      incentives: [{ kind: 'NIGHT', type: 'FIXED', value: 500, window: { start: '23:00', end: '06:00' } }],
    };
    const day = new Date('2026-09-28T07:30:00Z'); // 13:00 IST
    const r = riderEarningFinal(params, {
      deliveryDistanceM: 3_450,
      pickupDistanceM: 900,
      waitingMin: 13.2,
      tipPaise: 2_000,
      now: day,
      timeZone: 'Asia/Kolkata',
    });
    // 1.45 km over the included 2 km → 15 units of 100 m × ₹0.60 = ₹9; waiting 14 − 10 = 4 min × ₹1.
    expect(r).toMatchObject({
      distancePaise: 900,
      waitingPaise: 400,
      waitingMin: 14,
      tripPaise: 3_800,
      tipPaise: 2_000,
      totalPaise: 5_800,
      pickupDistanceM: 900,
    });
    const night = new Date('2026-09-28T18:00:00Z'); // 23:30 IST
    const n = riderEarningFinal(params, {
      deliveryDistanceM: 1_000,
      pickupDistanceM: 0,
      waitingMin: 45,
      tipPaise: 0,
      now: night,
      timeZone: 'Asia/Kolkata',
    });
    expect(n).toMatchObject({
      waitingPaise: 1_000,
      incentives: [{ kind: 'NIGHT', amountPaise: 500 }],
      tripPaise: 4_000,
    });
  });
});
