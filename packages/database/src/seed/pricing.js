// Development pricing rules, offers and home layout (DECISIONS A-23, D-51, D-56). EVERY amount here is a
// PLACEHOLDER for development; tax values are pending CA review (Q-3); markup legality is pending (Q-4).
// Idempotent: a rule is only added when no open version exists for its target.

const EPOCH = new Date('2026-01-01T00:00:00Z');
const NOTE = 'Development placeholder (seed, A-23)';
const gst = (appliesTo, rateBps) => ({
  appliesTo,
  mode: 'EXCLUSIVE',
  components: [
    { code: 'CGST', rateBps: rateBps / 2 },
    { code: 'SGST', rateBps: rateBps / 2 },
  ],
  liableParty: 'PLATFORM',
});

/**
 * @param {any} prisma
 * @param {string} table
 * @param {{ scope?: string, scopeRefId?: string | null, params: object, kind?: string, match?: (r: any) => boolean }} opts
 */
async function ensureRule(
  prisma,
  table,
  { scope = 'GLOBAL', scopeRefId = null, params, kind, match = () => true },
) {
  const open = await prisma[table].findMany({
    where: { scope, scopeRefId, effectiveTo: null, ...(kind ? { kind } : {}) },
  });
  if (open.some((r) => match(r))) return false;
  await prisma[table].create({
    data: {
      scope,
      scopeRefId,
      params,
      effectiveFrom: EPOCH,
      changeNote: NOTE,
      ...(kind ? { kind, isEnabled: true } : {}),
    },
  });
  return true;
}

/** @param {import('@jamzo/database').Db} prisma @param {{ log: (m: string) => void }} opts */
export async function seedPricing(prisma, { log }) {
  let added = 0;
  for (const [charge, rate] of [
    ['FOOD', 500],
    ['PACKAGING', 500],
    ['DELIVERY_FEE', 1800],
    ['PLATFORM_FEE', 1800],
    ['SMALL_ORDER_FEE', 1800],
    ['SURCHARGE', 1800],
    ['COMMISSION', 1800],
  ]) {
    added += Number(
      await ensureRule(prisma, 'taxRule', {
        params: gst(charge, rate),
        match: (r) => r.params?.appliesTo === charge,
      }),
    );
  }
  added += Number(
    await ensureRule(prisma, 'commissionRule', {
      params: { type: 'PERCENTAGE', rateBps: 1500, basis: 'POST_RESTAURANT_DISCOUNT', hybridMode: 'SUM' },
    }),
  );
  added += Number(
    await ensureRule(prisma, 'platformFeeRule', { params: { enabled: true, fixedPaise: 500, rateBps: 0 } }),
  );
  added += Number(
    await ensureRule(prisma, 'deliveryPricingRule', {
      params: {
        strategy: 'SLABS',
        slabs: [
          { upToM: 2000, feePaise: 2000 },
          { upToM: 4000, feePaise: 3000 },
          { upToM: 7000, feePaise: 4000 },
        ],
        includedM: 0,
        billingUnitM: 100,
        maxDistanceM: 7000,
        freeAboveSubtotalPaise: 49_900,
        smallOrder: { belowSubtotalPaise: 9_900, feePaise: 1_500 },
      },
    }),
  );
  // Night surcharge exists but only applies while the feature flag `night_pricing` is on (off by default).
  added += Number(
    await ensureRule(prisma, 'surgeRule', {
      kind: 'NIGHT',
      params: {
        type: 'FIXED',
        value: 1000,
        window: { start: '23:00', end: '06:00' },
        applyWhenDeliveryFree: true,
      },
    }),
  );
  added += Number(
    await ensureRule(prisma, 'riderEarningRule', {
      params: {
        basePaise: 2500,
        includedM: 2000,
        perKmPaise: 600,
        billingUnitM: 100,
        minPaise: 2500,
        waitingFreeMin: 10,
        waitingPerMinPaise: 100,
        incentives: [{ kind: 'NIGHT', type: 'FIXED', value: 500, window: { start: '23:00', end: '06:00' } }],
      },
    }),
  );

  // Cancellation rule (owner decision OD-38, D-70). Rider compensation is decided with dispatch (Phase 6).
  const none = { type: 'NONE' };
  const outcome = (allowed, extra = {}) => ({
    allowed,
    customerFee: none,
    restaurantCompensation: none,
    riderCompensation: none,
    ...extra,
  });
  // After acceptance the customer may cancel but gets no refund; Jamzo pays the restaurant its food value.
  // A delivery partner who had accepted the trip gets the trip estimate, paid by Jamzo (OD-39); the engine
  // pays it only when a rider had actually accepted (D-78).
  const riderPaid = { riderCompensation: { type: 'TRIP_ESTIMATE' } };
  const customerLate = outcome(true, {
    customerFee: { type: 'FULL_AMOUNT' },
    restaurantCompensation: { type: 'FOOD_VALUE' },
    ...riderPaid,
  });

  added += Number(
    await ensureRule(prisma, 'cancellationRule', {
      params: {
        BEFORE_ACCEPT: { CUSTOMER: outcome(true), RESTAURANT: outcome(false), ADMIN: outcome(true) },
        AFTER_ACCEPT: {
          CUSTOMER: customerLate,
          RESTAURANT: outcome(true, riderPaid),
          ADMIN: outcome(true, riderPaid),
        },
        AFTER_PREPARING: {
          CUSTOMER: customerLate,
          RESTAURANT: outcome(true, riderPaid),
          ADMIN: outcome(true, riderPaid),
        },
        AFTER_PICKUP: { CUSTOMER: outcome(false), RESTAURANT: outcome(false), ADMIN: outcome(true) },
      },
    }),
  );

  // The owner's markup example (OD-8): restaurant +10%, one item +15% — no global markup.
  const pizza = await prisma.restaurant.findUnique({ where: { slug: 'pizza-point-unjha' } });
  if (pizza) {
    added += Number(
      await ensureRule(prisma, 'markupRule', {
        scope: 'RESTAURANT',
        scopeRefId: pizza.id,
        params: {
          type: 'PERCENTAGE',
          valueBps: 1000,
          rounding: { mode: 'NEAREST_1', direction: 'HALF_UP' },
          applyToAddons: true,
        },
      }),
    );
    const farmhouse = await prisma.product.findFirst({
      where: { restaurantId: pizza.id, name: 'Farmhouse' },
    });
    if (farmhouse)
      added += Number(
        await ensureRule(prisma, 'markupRule', {
          scope: 'PRODUCT',
          scopeRefId: farmhouse.id,
          params: {
            type: 'PERCENTAGE',
            valueBps: 1500,
            rounding: { mode: 'NEAREST_1', direction: 'HALF_UP' },
            applyToAddons: true,
          },
        }),
      );
    if (!(await prisma.promotion.count({ where: { name: 'Pizza Point: 10% off' } })))
      await prisma.promotion.create({
        data: {
          name: 'Pizza Point: 10% off',
          discountType: 'PERCENTAGE',
          valueBps: 1000,
          maxDiscountPaise: 7_500,
          minOrderPaise: 19_900,
          fundingSource: 'RESTAURANT',
          targeting: { restaurantIds: [pizza.id] },
          startsAt: EPOCH,
        },
      });
  }

  for (const c of [
    {
      code: 'WELCOME50',
      description: '50% off your first order, up to ₹100 (demo)',
      discountType: 'PERCENTAGE',
      valueBps: 5000,
      maxDiscountPaise: 10_000,
      minOrderPaise: 19_900,
      fundingSource: 'PLATFORM',
      firstOrderOnly: true,
      perUserLimit: 1,
    },
    {
      code: 'FREEDEL',
      description: 'Free delivery above ₹149 (demo)',
      discountType: 'FREE_DELIVERY',
      minOrderPaise: 14_900,
      fundingSource: 'PLATFORM',
    },
  ]) {
    await prisma.coupon.upsert({ where: { code: c.code }, create: { ...c, startsAt: EPOCH }, update: {} });
  }

  if (!(await prisma.homeSection.count())) {
    const sections = [
      { type: 'CATEGORIES', title: 'What are you craving?' },
      { type: 'OFFERS', title: 'Offers near you' },
      { type: 'RECOMMENDED', title: 'Recommended for you', config: { limit: 10 } },
      { type: 'CUISINE_COLLECTION', title: 'Gujarati thalis', config: { cuisine: 'Thali' } },
      { type: 'UNDER_PRICE', title: 'Under ₹99', config: { maxPricePaise: 9_900, limit: 12 } },
      { type: 'NEW_RESTAURANTS', title: 'New on Jamzo', config: { limit: 8 } },
    ];
    for (const [position, s] of sections.entries())
      await prisma.homeSection.create({ data: { ...s, position } });
  }
  // Legal pages exist as unpublished drafts only: the texts need counsel (Q-12).
  for (const [slug, title] of [
    ['terms', 'Terms of use'],
    ['privacy', 'Privacy policy'],
    ['refunds', 'Cancellation and refund policy'],
  ]) {
    await prisma.cmsPage.upsert({
      where: { slug },
      create: {
        slug,
        title,
        body: `# ${title}\n\n**Draft placeholder — the final text must be written with legal counsel (DECISIONS Q-12).**`,
        isPublished: false,
      },
      update: {},
    });
  }
  log(
    `demo pricing: ${added} placeholder rules added, 2 coupons, 1 promotion, home layout, draft legal pages`,
  );
}
