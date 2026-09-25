// Customer discovery and cart quotes (Phases 3 + 4: D-46 … D-48, D-56) against real PostgreSQL with the
// seeded demo catalog and placeholder pricing rules (A-23). The clock is fixed to a Monday afternoon in IST.
import { haversineM } from '@jamzo/delivery-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, headers, ist, mobileLogin, startTestApp } from './helpers.js';

let ctx;
let customer; // signed-in customer session
let admin;
let pizza;
const HERE = { lat: 23.805, lng: 72.39 }; // Unjha Central
const MONDAY_1300 = ist('2026-09-28T13:00:00');

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  customer = await mobileLogin(ctx, 'CUSTOMER', '9812300001');
  admin = (await adminLogin(ctx)).accessToken;
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({
    where: { slug: 'pizza-point-unjha' },
    include: { branches: true },
  });
});
afterAll(() => ctx?.stop());

const guest = (url) => ctx.app.inject({ method: 'GET', url, headers: headers('CUSTOMER') });
const as = (method, url, payload, token = customer.accessToken) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token, 'CUSTOMER'),
    ...(payload !== undefined ? { payload } : {}),
  });
const quoteReq = (payload, token) =>
  token
    ? as('POST', '/v1/customer/cart/quote', payload, token)
    : ctx.app.inject({
        method: 'POST',
        url: '/v1/customer/cart/quote',
        headers: headers('CUSTOMER'),
        payload,
      });
const at = (p = HERE) => `lat=${p.lat}&lng=${p.lng}`;

describe('listing (D-47)', () => {
  it('guests see only live restaurants that deliver here, with ETA, fee and the distance source', async () => {
    const res = await guest(`/v1/customer/restaurants?${at()}&limit=50`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      serviceable: true,
      city: { name: 'Unjha' },
      zone: { name: 'Unjha Central' },
    });
    const slugs = body.items.map((r) => r.slug);
    expect(slugs).toContain('pizza-point-unjha');
    expect(slugs).not.toContain('cafe-egg-station'); // APPROVED, not live
    expect(slugs).not.toContain('royal-bakery-unjha'); // in review
    expect(slugs).not.toContain('pending-restaurant');
    expect(slugs).not.toContain('chill-out-ice-cream'); // listed only in Unjha North
    const p = body.items.find((r) => r.slug === 'pizza-point-unjha');
    expect(p).toMatchObject({
      distanceSource: 'FALLBACK',
      delivery: { feePaise: 2000, freeAboveSubtotalPaise: 49_900 },
      open: { isOpen: true },
    });
    expect(p.eta.maxMinutes - p.eta.minMinutes).toBe(10);
    expect(p.offers.map((o) => o.text)).toEqual(['10% off up to ₹75 above ₹199']);
    // Straight line × 1.3 (fallback until a maps provider exists — D-48).
    const straight = haversineM(
      { lat: Number(pizza.branches[0].lat), lng: Number(pizza.branches[0].lng) },
      HERE,
    );
    expect(p.distanceM).toBe(Math.round((straight * 13_000) / 10_000));
    // Open restaurants first.
    const firstClosed = body.items.findIndex((r) => !r.open.isOpen);
    if (firstClosed >= 0) expect(body.items.slice(firstClosed).every((r) => !r.open.isOpen)).toBe(true);
  });

  it('says why a location is not served', async () => {
    expect((await guest(`/v1/customer/restaurants?lat=21.17&lng=72.83`)).json()).toMatchObject({
      serviceable: false,
      reason: 'NO_CITY',
      items: [],
    });
    expect((await guest(`/v1/customer/restaurants?lat=23.834&lng=72.381`)).json()).toMatchObject({
      serviceable: false,
      reason: 'OUTSIDE_SERVICE_AREA',
    });
    expect((await guest(`/v1/customer/restaurants`)).statusCode).toBe(400);
  });

  it('filters and sorts', async () => {
    const veg = (await guest(`/v1/customer/restaurants?${at()}&veg=true&limit=50`)).json().items;
    expect(veg.every((r) => r.isPureVeg)).toBe(true);
    const thali = (await guest(`/v1/customer/restaurants?${at()}&cuisine=Thali`)).json().items;
    expect(thali.map((r) => r.slug)).toEqual(['umiya-thali-house']);
    const byDistance = (
      await guest(`/v1/customer/restaurants?${at()}&sort=DISTANCE&openNow=true&limit=50`)
    ).json().items;
    expect(byDistance.map((r) => r.distanceM)).toEqual(
      [...byDistance.map((r) => r.distanceM)].sort((a, b) => a - b),
    );
  });

  it('search finds restaurants and dishes with customer prices', async () => {
    const res = (await guest(`/v1/customer/search?${at()}&q=margherita`)).json();
    const dish = res.dishes.find((d) => d.name === 'Margherita');
    expect(dish).toMatchObject({
      pricePaise: 13_200,
      hasVariants: true,
      restaurant: { name: 'Pizza Point' },
    }); // ₹120 + 10%
    expect(
      (await guest(`/v1/customer/search?${at()}&q=chinese`)).json().restaurants.map((r) => r.slug),
    ).toContain('dragon-wok-unjha');
    // Annapurna Dosa Corner is listed only in Unjha South: its dishes never appear for a Central address.
    expect(
      (await guest(`/v1/customer/search?${at()}&q=dosa`))
        .json()
        .dishes.every((d) => d.restaurant.name !== 'Annapurna Dosa Corner'),
    ).toBe(true);
  });

  it('guest browsing can be switched off', async () => {
    await ctx.prisma.setting.create({
      data: { key: 'customer.guestBrowsing', scope: 'GLOBAL', value: false },
    });
    ctx.app.services.config.invalidate();
    expect((await guest(`/v1/customer/restaurants?${at()}`)).statusCode).toBe(401);
    expect((await as('GET', `/v1/customer/restaurants?${at()}`)).statusCode).toBe(200);
    await ctx.prisma.setting.deleteMany({ where: { key: 'customer.guestBrowsing' } });
    ctx.app.services.config.invalidate();
  });
});

describe('home (D-56)', () => {
  it('builds the CMS sections for this location', async () => {
    const res = (await guest(`/v1/customer/home?${at()}`)).json();
    expect(res.serviceable).toBe(true);
    const types = res.sections.map((s) => s.type);
    expect(types).toEqual([
      'CATEGORIES',
      'OFFERS',
      'RECOMMENDED',
      'CUISINE_COLLECTION',
      'UNDER_PRICE',
      'NEW_RESTAURANTS',
    ]);
    expect(res.sections.find((s) => s.type === 'OFFERS').restaurants.map((r) => r.slug)).toEqual([
      'pizza-point-unjha',
    ]);
    expect(res.sections.find((s) => s.type === 'CUISINE_COLLECTION').restaurants.map((r) => r.slug)).toEqual([
      'umiya-thali-house',
    ]);
    expect(
      res.sections.find((s) => s.type === 'UNDER_PRICE').dishes.every((d) => d.pricePaise <= 9_900),
    ).toBe(true);
    expect(res.sections.find((s) => s.type === 'CATEGORIES').categories.length).toBeGreaterThan(3);
  });
});

describe('restaurant menu with customer prices (spec §10)', () => {
  it('applies the product rule over the restaurant rule; restaurant prices never change', async () => {
    const res = await guest(`/v1/customer/restaurants/${pizza.id}?${at()}`);
    expect(res.statusCode, res.body).toBe(200);
    const menu = res.json();
    const items = menu.sections.flatMap((s) => s.products);
    const farmhouse = items.find((p) => p.name === 'Farmhouse');
    const margherita = items.find((p) => p.name === 'Margherita');
    expect(farmhouse.variants.map((v) => v.pricePaise)).toEqual([18_400, 33_400, 47_200]); // 160/290/410 + 15%, nearest ₹1
    expect(margherita.variants.map((v) => v.pricePaise)).toEqual([13_200, 24_200, 35_200]); // + 10%
    expect(margherita.addonGroups.find((g) => g.name === 'Add cheese').addons[0].pricePaise).toBe(3_300);
    expect(menu.delivery).toMatchObject({ checked: true, deliverable: true, feePaise: 2000 });
    expect(menu.restaurant.open.isOpen).toBe(true);
    const stored = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: pizza.id, name: 'Margherita' },
    });
    expect(stored.basePricePaise).toBe(12_000);
  });

  it('restaurants that are not live are not shown; out-of-area is reported, not hidden', async () => {
    const cafe = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'cafe-egg-station' } });
    expect((await guest(`/v1/customer/restaurants/${cafe.id}`)).statusCode).toBe(404);
    const chill = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'chill-out-ice-cream' } });
    const res = (await guest(`/v1/customer/restaurants/${chill.id}?${at()}`)).json();
    expect(res.delivery).toEqual({ checked: true, deliverable: false, reason: 'OUT_OF_DELIVERY_AREA' });
  });
});

async function pizzaItems() {
  const p = await ctx.prisma.product.findFirstOrThrow({
    where: { restaurantId: pizza.id, name: 'Margherita' },
    include: { variants: true, addonGroups: { include: { addons: true } } },
  });
  const group = (name) => p.addonGroups.find((g) => g.name === name);
  return {
    product: p,
    regular: p.variants.find((v) => v.isDefault),
    classic: group('Crust').addons.find((a) => a.name === 'Classic hand-tossed'),
    cheese: group('Add cheese').addons[0],
  };
}

describe('cart quote (D-46, PRICING.md)', () => {
  it('prices a cart exactly: markup, restaurant-funded promotion, tax, delivery, platform fee, rounding', async () => {
    const m = await pizzaItems();
    const res = await quoteReq({
      restaurantId: pizza.id,
      ...HERE,
      lines: [
        {
          key: 'a',
          productId: m.product.id,
          variantId: m.regular.id,
          addonIds: [m.classic.id, m.cheese.id],
          quantity: 2,
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const q = res.json();
    // Unit: ₹120 + 10% = ₹132; cheese ₹30 + 10% = ₹33 → ₹165 × 2 = ₹330. Promotion 10% (restaurant-funded) = ₹33.
    // Food tax 5% × ₹297 = ₹14.85; delivery ₹20 + 18% ₹3.60; platform fee ₹5 + 18% ₹0.90.
    // 33 000 − 3 300 + 2 000 + 500 + 1 485 + 360 + 90 = 34 135 → nearest ₹1 = 34 100 (rounding −35).
    expect(q.bill.lines.map((l) => [l.code, l.amountPaise])).toEqual([
      ['ITEMS', 33_000],
      ['OFFER', -3_300],
      ['DELIVERY_FEE', 2_000],
      ['PLATFORM_FEE', 500],
      ['TAXES', 1_935],
      ['ROUNDING', -35],
    ]);
    expect(q.bill.totalPayablePaise).toBe(34_100);
    expect(q.lines[0]).toMatchObject({
      unitPricePaise: 16_500,
      lineTotalPaise: 33_000,
      variantName: 'Regular 7"',
    });
    expect(q.offers).toEqual([{ name: 'Pizza Point: 10% off', amountPaise: 3_300 }]);
    expect(q.canCheckout).toBe(true); // nothing blocks it (Phase 5: checkout exists)
    expect(q.delivery.distanceSource).toBe('FALLBACK');
    // Nothing internal reaches customers.
    expect(res.body).not.toMatch(/commission|"payablePaise"|riderCost|"netPaise"|gateway|"engine"/i);
  });

  it('coupon on top of the promotion; unknown and ineligible coupons explain themselves', async () => {
    const m = await pizzaItems();
    const lines = [
      {
        key: 'a',
        productId: m.product.id,
        variantId: m.regular.id,
        addonIds: [m.classic.id, m.cheese.id],
        quantity: 2,
      },
    ];
    let q = (
      await quoteReq(
        { restaurantId: pizza.id, ...HERE, lines, couponCode: 'welcome50' },
        customer.accessToken,
      )
    ).json();
    expect(q.coupon).toMatchObject({ code: 'WELCOME50', status: 'APPLIED' });
    // Promotion ₹33 first, then 50% of the remaining ₹297 = ₹148.50 → capped at ₹100.
    expect(
      q.bill.lines.filter((l) => ['OFFER', 'COUPON'].includes(l.code)).map((l) => l.amountPaise),
    ).toEqual([-3_300, -10_000]);
    q = (await quoteReq({ restaurantId: pizza.id, ...HERE, lines, couponCode: 'NOPE99' })).json();
    expect(q.coupon).toMatchObject({
      status: 'NOT_APPLICABLE',
      reason: 'NOT_FOUND',
      message: 'This coupon code does not exist.',
    });
    const small = [
      { key: 'b', productId: m.product.id, variantId: m.regular.id, addonIds: [m.classic.id], quantity: 1 },
    ];
    q = (await quoteReq({ restaurantId: pizza.id, ...HERE, lines: small, couponCode: 'WELCOME50' })).json();
    expect(q.coupon).toMatchObject({
      status: 'NOT_APPLICABLE',
      reason: 'MIN_ORDER',
      shortByPaise: 19_900 - 13_200,
    });
    expect(q.limitsCheckedAtCheckout).toBe(true);
  });

  it('reports line problems instead of silently dropping or mispricing items', async () => {
    const m = await pizzaItems();
    const other = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurant: { slug: 'demo-kitchen' } },
    });
    const undhiyu = await ctx.prisma.product.findFirstOrThrow({ where: { name: { startsWith: 'Undhiyu' } } });
    const res = await quoteReq({
      restaurantId: pizza.id,
      ...HERE,
      lines: [
        {
          key: 'ok',
          productId: m.product.id,
          variantId: m.regular.id,
          addonIds: [m.classic.id],
          quantity: 1,
        },
        { key: 'no-size', productId: m.product.id, addonIds: [m.classic.id], quantity: 1 },
        { key: 'no-crust', productId: m.product.id, variantId: m.regular.id, addonIds: [], quantity: 1 },
        { key: 'elsewhere', productId: other.id, addonIds: [], quantity: 1 },
      ],
    });
    const q = res.json();
    expect(q.lines.map((l) => l.key)).toEqual(['ok']);
    expect(Object.fromEntries(q.issues.filter((i) => i.lineKey).map((i) => [i.lineKey, i.code]))).toEqual({
      'no-size': 'VARIANT_REQUIRED',
      'no-crust': 'ADDONS_INVALID',
      elsewhere: 'ITEM_NOT_FOUND',
    });
    const kitchen = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'demo-kitchen' } });
    const sold = (
      await quoteReq({
        restaurantId: kitchen.id,
        ...HERE,
        lines: [{ key: 'u', productId: undhiyu.id, addonIds: [], quantity: 1 }],
      })
    ).json();
    expect(sold.issues[0]).toMatchObject({ code: 'ITEM_UNAVAILABLE', reason: 'SOLD_OUT' });
    expect(sold.bill).toBeNull();
  });

  it('closed restaurant and out-of-area carts are flagged', async () => {
    const m = await pizzaItems();
    ctx.clock.set(ist('2026-09-29T02:00:00')); // Tuesday 02:00, Pizza Point closed
    const closed = (
      await quoteReq({
        restaurantId: pizza.id,
        ...HERE,
        lines: [
          {
            key: 'a',
            productId: m.product.id,
            variantId: m.regular.id,
            addonIds: [m.classic.id],
            quantity: 1,
          },
        ],
      })
    ).json();
    expect(closed.issues.map((i) => i.code)).toContain('RESTAURANT_CLOSED');
    ctx.clock.set(MONDAY_1300);
    const chill = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'chill-out-ice-cream' } });
    const p = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: chill.id, name: 'Mango Sorbet' },
    });
    const far = (
      await quoteReq({
        restaurantId: chill.id,
        ...HERE,
        lines: [{ key: 'a', productId: p.id, addonIds: [], quantity: 1 }],
      })
    ).json();
    expect(far).toMatchObject({ deliverable: false, issues: [{ code: 'OUT_OF_DELIVERY_AREA' }] });
  });

  it('the admin test quote shows the restaurant, rider and platform side that customers never see', async () => {
    const m = await pizzaItems();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/pricing/quote',
      headers: bearer(admin),
      payload: {
        restaurantId: pizza.id,
        ...HERE,
        lines: [
          {
            key: 'a',
            productId: m.product.id,
            variantId: m.regular.id,
            addonIds: [m.classic.id, m.cheese.id],
            quantity: 2,
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const e = res.json().engine;
    // Food value ₹300 − restaurant-funded ₹33 = ₹267 × 15% = ₹40.05 → 4 005; GST 18% on it = 720.9 → 721.
    expect(e.restaurant.commission.groups[0]).toMatchObject({ basePaise: 26_700, amountPaise: 4_005 });
    expect(e.restaurant.commissionTax.amountPaise).toBe(721);
    expect(e.restaurant.payablePaise).toBe(30_000 - 3_300 - 4_005 - 721);
    const p = e.platform;
    expect(
      e.restaurant.payablePaise +
        e.rider.totalPaise +
        p.taxLiabilitiesPaise +
        p.withholdingPaise +
        p.gatewayEstimatePaise +
        p.netPaise,
    ).toBe(34_100);
  });
});

describe('addresses, favourites, consents, pages', () => {
  it('saves addresses with their zone, keeps one default, soft-deletes', async () => {
    let res = await as('POST', '/v1/customer/addresses', {
      label: 'Home',
      line1: '12 Station Road',
      ...HERE,
      contactPhone: '9812300001',
    });
    expect(res.statusCode, res.body).toBe(201);
    const home = res.json();
    expect(home).toMatchObject({
      isDefault: true,
      serviceable: true,
      cityName: 'Unjha',
      contactPhone: '+919812300001',
    });
    res = await as('POST', '/v1/customer/addresses', {
      label: 'Surat',
      line1: 'Ring Road, Surat',
      lat: 21.17,
      lng: 72.83,
      makeDefault: true,
    });
    expect(res.json()).toMatchObject({
      isDefault: true,
      serviceable: false,
      serviceability: { reason: 'NO_CITY' },
    });
    const list = (await as('GET', '/v1/customer/addresses')).json().items;
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    // A saved address works as the location for listing and quotes.
    expect((await as('GET', `/v1/customer/restaurants?addressId=${home.id}`)).json().serviceable).toBe(true);
    expect((await guest(`/v1/customer/restaurants?addressId=${home.id}`)).statusCode).toBe(401);
    const other = await mobileLogin(ctx, 'CUSTOMER', '9812300002');
    expect(
      (await as('GET', `/v1/customer/restaurants?addressId=${home.id}`, undefined, other.accessToken))
        .statusCode,
    ).toBe(404);
    expect(
      (await as('PATCH', `/v1/customer/addresses/${home.id}`, { label: 'Home 2' })).json(),
    ).toMatchObject({ label: 'Home 2', serviceable: true });
    expect((await as('DELETE', `/v1/customer/addresses/${home.id}`)).statusCode).toBe(204);
    expect(
      (await ctx.prisma.customerAddress.findUniqueOrThrow({ where: { id: home.id } })).deletedAt,
    ).not.toBeNull();
  });

  it('favourites and consents', async () => {
    expect((await as('PUT', `/v1/customer/favorites/${pizza.id}`)).json()).toEqual({
      restaurantId: pizza.id,
      isFavorite: true,
    });
    expect((await as('GET', '/v1/customer/favorites')).json().items.map((f) => f.name)).toEqual([
      'Pizza Point',
    ]);
    expect((await as('GET', `/v1/customer/restaurants/${pizza.id}`)).json().restaurant.isFavorite).toBe(true);
    await as('DELETE', `/v1/customer/favorites/${pizza.id}`);
    expect((await as('GET', '/v1/customer/favorites')).json().items).toEqual([]);
    const c = await as('POST', '/v1/customer/consents', { kind: 'TERMS', version: '2026-09', granted: true });
    expect(c.statusCode).toBe(201);
  });

  it('legal pages are drafts until published', async () => {
    const page = await ctx.app.inject({
      method: 'GET',
      url: '/v1/cms/pages/terms',
      headers: headers('CUSTOMER'),
    });
    expect(page.statusCode).toBe(404);
    const row = await ctx.prisma.cmsPage.findUniqueOrThrow({ where: { slug: 'terms' } });
    const pub = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/admin/cms/pages/${row.id}`,
      headers: bearer(admin),
      payload: { slug: 'terms', title: row.title, body: row.body, isPublished: true },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/cms/pages/terms', headers: headers('RIDER') })).json()
        .title,
    ).toBe('Terms of use');
  });
});
