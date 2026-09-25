// Admin pricing rules, offers, CMS and customers (D-50 … D-57) against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminLogin,
  adminWithRole,
  bearer,
  headers,
  ist,
  mobileLogin,
  multipart,
  startTestApp,
  TINY_PNG,
} from './helpers.js';

let ctx;
let token;
let unjha;
let pizza;
const HERE = { lat: 23.805, lng: 72.39 };

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(ist('2026-09-28T13:00:00'));
  token = (await adminLogin(ctx)).accessToken;
  unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
});
afterAll(() => ctx?.stop());

const call = (method, url, payload, t = token) =>
  ctx.app.inject({ method, url, headers: bearer(t), ...(payload !== undefined ? { payload } : {}) });
const markup = (valueBps) => ({
  type: 'PERCENTAGE',
  valueBps,
  rounding: { mode: 'NEAREST_1', direction: 'HALF_UP' },
});
const menuPrice = async (name) => {
  const menu = (
    await ctx.app.inject({
      method: 'GET',
      url: `/v1/customer/restaurants/${pizza.id}`,
      headers: headers('CUSTOMER'),
    })
  ).json();
  return menu.sections.flatMap((s) => s.products).find((p) => p.name === name).pricePaise;
};

describe('versioned rules (D-50)', () => {
  it('a new version closes the previous one, links to it and takes effect immediately', async () => {
    expect(await menuPrice('Garlic Bread')).toBe(9_900); // restaurant rule +10%
    let res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'MARKUP',
      scope: 'RESTAURANT',
      scopeRefId: pizza.id,
      params: markup(2000),
      changeNote: 'Test increase to 20%',
    });
    expect(res.statusCode, res.body).toBe(201);
    const v2 = res.json();
    expect(v2.supersedesId).toBeTruthy();
    const v1 = await ctx.prisma.markupRule.findUniqueOrThrow({ where: { id: v2.supersedesId } });
    expect(v1.effectiveTo.getTime()).toBe(new Date(v2.effectiveFrom).getTime());
    expect(await menuPrice('Garlic Bread')).toBe(10_800); // ₹90 + 20%
    expect(await menuPrice('Farmhouse')).toBe(18_400); // product rule still wins

    const history = (await call('GET', `/v1/admin/pricing/rules/MARKUP/${v2.id}/history`)).json();
    expect(history.items.map((r) => r.params.valueBps)).toEqual([2000, 1000]);
    const current = (
      await call('GET', `/v1/admin/pricing/rules?type=MARKUP&scope=RESTAURANT&scopeRefId=${pizza.id}`)
    ).json();
    expect(current.items).toHaveLength(1);
    expect(current.items[0]).toMatchObject({ targetName: 'Pizza Point', status: 'ACTIVE' });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'pricing_rule.version', entityId: v2.id } }),
    ).toBe(1);

    // Ending the product rule makes Farmhouse inherit the restaurant rule again.
    const farmhouseRule = await ctx.prisma.markupRule.findFirstOrThrow({
      where: { scope: 'PRODUCT', effectiveTo: null },
    });
    res = await call('POST', `/v1/admin/pricing/rules/MARKUP/${farmhouseRule.id}/end`, {
      changeNote: 'Back to restaurant markup',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await menuPrice('Farmhouse')).toBe(19_200); // ₹160 + 20%
  });

  it('validates parameters, scopes, back-dating and future scheduling', async () => {
    let res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'MARKUP',
      scope: 'GLOBAL',
      params: { type: 'PERCENTAGE' },
      changeNote: 'Broken rule',
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fieldErrors).some((k) => k.startsWith('params'))).toBe(true);
    const variant = await ctx.prisma.productVariant.findFirstOrThrow();
    res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'COMMISSION',
      scope: 'VARIANT',
      scopeRefId: variant.id,
      params: { type: 'PERCENTAGE', rateBps: 100, basis: 'PRE_DISCOUNT' },
      changeNote: 'Per variant',
    });
    expect(res.statusCode).toBe(400);
    res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'DELIVERY',
      scope: 'GLOBAL',
      scopeRefId: unjha.id,
      params: {},
      changeNote: 'x x x',
    });
    expect(res.statusCode).toBe(400);
    res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'PLATFORM_FEE',
      scope: 'CITY',
      scopeRefId: unjha.id,
      params: { enabled: true, fixedPaise: 900 },
      effectiveFrom: new Date(ctx.clock.now().getTime() - 86_400_000).toISOString(),
      changeNote: 'Back-dated',
    });
    expect(res.statusCode).toBe(400);
    const future = new Date(ctx.clock.now().getTime() + 86_400_000).toISOString();
    res = await call('POST', '/v1/admin/pricing/rules', {
      type: 'PLATFORM_FEE',
      scope: 'CITY',
      scopeRefId: unjha.id,
      params: { enabled: true, fixedPaise: 900 },
      effectiveFrom: future,
      changeNote: 'Tomorrow',
    });
    expect(res.statusCode, res.body).toBe(201);
    const list = (await call('GET', `/v1/admin/pricing/rules?type=PLATFORM_FEE&scope=CITY`)).json();
    expect(list.items[0].status).toBe('SCHEDULED');
  });

  it('two admins saving the same rule at once: exactly one version wins', async () => {
    const zone = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'unjha-central' } });
    // Both admins opened the form when no zone rule existed (basedOnId: null).
    const body = (v) => ({
      type: 'MARKUP',
      scope: 'ZONE',
      scopeRefId: zone.id,
      params: markup(v),
      changeNote: 'Concurrent edit',
      basedOnId: null,
    });
    const results = await Promise.all([
      call('POST', '/v1/admin/pricing/rules', body(300)),
      call('POST', '/v1/admin/pricing/rules', body(400)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      await ctx.prisma.markupRule.count({ where: { scope: 'ZONE', scopeRefId: zone.id, effectiveTo: null } }),
    ).toBe(1);
    // A later edit based on the current version succeeds; one based on a stale version is refused.
    const current = await ctx.prisma.markupRule.findFirstOrThrow({
      where: { scope: 'ZONE', scopeRefId: zone.id, effectiveTo: null },
    });
    expect(
      (await call('POST', '/v1/admin/pricing/rules', { ...body(500), basedOnId: current.id })).statusCode,
    ).toBe(201);
    expect(
      (await call('POST', '/v1/admin/pricing/rules', { ...body(600), basedOnId: current.id })).statusCode,
    ).toBe(409);
  });

  it('each rule type needs its own permission; City Managers only in their city', async () => {
    const ops = await adminWithRole(ctx, 'OPERATIONS'); // pricing.view + pricing.surge, no pricing.manage
    const res = await call(
      'POST',
      '/v1/admin/pricing/rules',
      { type: 'MARKUP', scope: 'CITY', scopeRefId: unjha.id, params: markup(500), changeNote: 'Not allowed' },
      ops.accessToken,
    );
    expect(res.statusCode).toBe(403);
    const finance = await adminWithRole(ctx, 'FINANCE'); // commissions.manage, taxes.manage, pricing.manage
    const ok = await call(
      'POST',
      '/v1/admin/pricing/rules',
      {
        type: 'COMMISSION',
        scope: 'RESTAURANT',
        scopeRefId: pizza.id,
        params: { type: 'PERCENTAGE', rateBps: 1200, basis: 'POST_RESTAURANT_DISCOUNT' },
        changeNote: 'Negotiated 12%',
      },
      finance.accessToken,
    );
    expect(ok.statusCode, ok.body).toBe(201);
    const support = await adminWithRole(ctx, 'SUPPORT'); // no pricing.view at all
    expect(
      (await call('GET', '/v1/admin/pricing/rules?type=MARKUP', undefined, support.accessToken)).statusCode,
    ).toBe(403);
  });

  it('surge kill-switch: flagged night surcharge applies at 23:30 and stops instantly when switched off', async () => {
    const flag = await ctx.prisma.featureFlag.update({
      where: { key: 'night_pricing' },
      data: { enabled: true },
    });
    ctx.app.services.config.invalidate();
    ctx.clock.set(ist('2026-09-28T23:15:00'));
    const p = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: pizza.id, name: 'Garlic Bread' },
    });
    const cart = {
      restaurantId: pizza.id,
      ...HERE,
      lines: [{ key: 'a', productId: p.id, addonIds: [], quantity: 2 }],
    };
    const quote = async () =>
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/customer/cart/quote',
          headers: headers('CUSTOMER'),
          payload: cart,
        })
      ).json();
    expect((await quote()).bill.lines.find((l) => l.code === 'SURCHARGE_NIGHT')?.amountPaise).toBe(1_000);
    const night = await ctx.prisma.surgeRule.findFirstOrThrow({ where: { kind: 'NIGHT' } });
    const ops = await adminWithRole(ctx, 'OPERATIONS');
    const res = await call(
      'PATCH',
      `/v1/admin/pricing/surge/${night.id}/switch`,
      { isEnabled: false, changeNote: 'Rain stopped' },
      ops.accessToken,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect((await quote()).bill.lines.find((l) => l.code === 'SURCHARGE_NIGHT')).toBeUndefined();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'surge.disable' } })).toBe(1);
    await ctx.prisma.featureFlag.update({ where: { key: 'night_pricing' }, data: { enabled: flag.enabled } });
    ctx.app.services.config.invalidate();
    // Move on to the next day (never rewind: versions created earlier in this file must stay in force).
    ctx.clock.set(ist('2026-09-29T13:00:00'));
  });

  it('effective rules and a draft preview for a restaurant menu (§9)', async () => {
    const eff = (await call('GET', `/v1/admin/pricing/effective?restaurantId=${pizza.id}`)).json();
    expect(eff.markup).toMatchObject({ scope: 'RESTAURANT', inheritedFrom: 'RESTAURANT' });
    expect(eff.delivery.scope).toBe('GLOBAL');
    expect(eff.tax.FOOD.pendingCaReview).toBe(true);
    const res = await call('POST', '/v1/admin/pricing/preview', {
      restaurantId: pizza.id,
      draft: { type: 'MARKUP', scope: 'RESTAURANT', scopeRefId: pizza.id, params: markup(500) },
    });
    expect(res.statusCode, res.body).toBe(200);
    const bread = res.json().items.find((i) => i.name === 'Garlic Bread');
    expect(bread).toMatchObject({
      restaurantPricePaise: 9_000,
      current: { customerPricePaise: 10_800 },
      draft: { customerPricePaise: 9_500 },
    });
    expect(bread.current.commissionPaise).toBe(1_080); // the 12% restaurant commission from the Finance test
  });
});

describe('coupons and promotions', () => {
  it('normalises codes, rejects duplicates and code changes, reports status', async () => {
    const body = {
      code: 'diwali100',
      discountType: 'FIXED',
      valuePaise: 10_000,
      minOrderPaise: 49_900,
      fundingSource: 'SHARED',
      restaurantShareBps: 5000,
      startsAt: '2026-10-20T00:00:00+05:30',
      endsAt: '2026-10-25T00:00:00+05:30',
    };
    let res = await call('POST', '/v1/admin/coupons', body);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().code).toBe('DIWALI100');
    expect((await call('POST', '/v1/admin/coupons', body)).statusCode).toBe(409);
    expect(
      (await call('PATCH', `/v1/admin/coupons/${res.json().id}`, { ...body, code: 'OTHER1' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/v1/admin/coupons', { ...body, code: 'SHARED2', restaurantShareBps: undefined }))
        .statusCode,
    ).toBe(400);
    const list = (await call('GET', '/v1/admin/coupons?status=SCHEDULED')).json();
    expect(list.items.map((c) => c.code)).toEqual(['DIWALI100']);
    const promo = await call('POST', '/v1/admin/promotions', {
      name: 'Weekend thali',
      discountType: 'PERCENTAGE',
      valueBps: 1500,
      fundingSource: 'RESTAURANT',
      targeting: { restaurantIds: [pizza.id] },
      startsAt: '2026-01-01T00:00:00Z',
    });
    expect(promo.statusCode, promo.body).toBe(201);
  });
});

describe('CMS administration', () => {
  it('sections, banners with images, ordering', async () => {
    const upload = multipart(
      { title: 'Diwali banner' },
      { filename: 'b.png', contentType: 'image/png', content: TINY_PNG },
    );
    const media = (
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/admin/media',
        headers: { ...bearer(token), 'content-type': upload.contentType },
        payload: upload.payload,
      })
    ).json();
    let res = await call('POST', '/v1/admin/cms/home-sections', {
      type: 'BANNER_CAROUSEL',
      title: 'Festive offers',
      cityIds: [unjha.id],
    });
    expect(res.statusCode, res.body).toBe(201);
    const section = res.json();
    expect(
      (
        await call('POST', '/v1/admin/cms/banners', {
          homeSectionId: section.id,
          mediaId: '0199a3c4-1111-7000-8000-000000000001',
        })
      ).statusCode,
    ).toBe(400);
    res = await call('POST', '/v1/admin/cms/banners', {
      homeSectionId: section.id,
      mediaId: media.id,
      title: 'Diwali',
      deepLink: 'jamzo://offers',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(
      (await call('POST', '/v1/admin/cms/home-sections', { type: 'CUISINE_COLLECTION', title: 'No cuisine' }))
        .statusCode,
    ).toBe(400);
    const all = (await call('GET', '/v1/admin/cms/home-sections')).json().items;
    const ids = [section.id, ...all.filter((s) => s.id !== section.id).map((s) => s.id)];
    expect((await call('PUT', '/v1/admin/cms/home-sections/order', { ids })).statusCode).toBe(200);
    const home = (
      await ctx.app.inject({
        method: 'GET',
        url: `/v1/customer/home?lat=${HERE.lat}&lng=${HERE.lng}`,
        headers: headers('CUSTOMER'),
      })
    ).json();
    expect(home.sections[0]).toMatchObject({
      type: 'BANNER_CAROUSEL',
      banners: [{ title: 'Diwali', deepLink: 'jamzo://offers' }],
    });
    const cms = await adminWithRole(ctx, 'CONTENT_MANAGER');
    expect((await call('GET', '/v1/admin/cms/home-sections', undefined, cms.accessToken)).statusCode).toBe(
      200,
    );
    expect(
      (await call('GET', '/v1/admin/pricing/rules?type=MARKUP', undefined, cms.accessToken)).statusCode,
    ).toBe(403);
  });
});

describe('customers in the admin (D-57)', () => {
  it('masks contact details; revealing needs customers.pii, a reason, and is audited', async () => {
    const session = await mobileLogin(ctx, 'CUSTOMER', '9812344444');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/customer/addresses',
      headers: bearer(session.accessToken, 'CUSTOMER'),
      payload: { label: 'Home', line1: '44 Market Road', ...HERE },
    });
    const list = (await call('GET', '/v1/admin/customers?q=9812344444')).json();
    expect(list.items).toHaveLength(1);
    const c = list.items[0];
    expect(c.phoneMasked).not.toContain('2344444');
    const detail = (await call('GET', `/v1/admin/customers/${c.id}`)).json();
    expect(detail).toMatchObject({ phone: null, revealed: false });
    expect(detail.addresses[0].line1).toBe('44 •••');
    const marketing = await adminWithRole(ctx, 'MARKETING'); // customers.view, no customers.pii
    expect(
      (
        await call(
          'POST',
          `/v1/admin/customers/${c.id}/reveal`,
          { reason: 'Delivery issue' },
          marketing.accessToken,
        )
      ).statusCode,
    ).toBe(403);
    const support = await adminWithRole(ctx, 'SUPPORT');
    const shown = await call(
      'POST',
      `/v1/admin/customers/${c.id}/reveal`,
      { reason: 'Customer called about an address' },
      support.accessToken,
    );
    expect(shown.json()).toMatchObject({
      phone: '+919812344444',
      revealed: true,
      addresses: [{ line1: '44 Market Road' }],
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'customer.reveal_pii', entityId: c.id } }),
    ).toBe(1);
  });
});
