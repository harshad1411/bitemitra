// Ratings and reviews (D-110, OD-45) against real PostgreSQL. Orders go through the real API end to end
// (checkout → restaurant → dispatch → delivery) before they are rated.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createFlows } from './flows.js';

let ctx;
let f;
let pizza;
let owner;
let admin;
let rider;
const MONDAY_1300 = ist('2026-09-28T13:00:00');

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  owner = await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
  admin = (await adminLogin(ctx)).accessToken;
  f = createFlows(ctx, { owner });
  rider = await f.activeRider();
});
afterAll(() => ctx?.stop());

const call = (method, url, token, payload, app = 'CUSTOMER') =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token.accessToken ?? token, app),
    ...(payload !== undefined ? { payload } : {}),
  });
const detail = (o, c) => call('GET', `/v1/customer/orders/${o.id}`, c).then((r) => r.json());
const rate = (o, c, body) => call('POST', `/v1/customer/orders/${o.id}/review`, c, body);
const menu = async () =>
  (
    await ctx.app.inject({
      method: 'GET',
      url: `/v1/customer/restaurants/${pizza.id}`,
      headers: { 'x-app-id': 'CUSTOMER', 'x-platform': 'IOS', 'x-app-version': '1.0.0' },
    })
  ).json();
const garlicBread = (m) => m.sections.flatMap((s) => s.products).find((p) => p.name === 'Garlic Bread');

describe('customers rate delivered orders (D-110)', () => {
  let first;

  it('only after delivery; the order says what can be rated', async () => {
    const placed = await f.placedOrder();
    const early = await rate(placed.order, placed.customer, {
      items: [{ orderItemId: placed.order.id, rating: 5 }],
    });
    expect(early.json().error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await detail(placed.order, placed.customer)).review.canReview).toBe(false);

    first = await f.deliveredOrder({ rider });
    const d = await detail(first.order, first.customer);
    expect(d.review).toMatchObject({ canReview: true, ratesDelivery: true, given: null });
    expect(d.items[0].id).toEqual(expect.any(String));
    const list = (await call('GET', '/v1/customer/orders', first.customer)).json();
    expect(list.items.find((o) => o.id === first.order.id).canReview).toBe(true);
  });

  it('checks the items, saves once, and shows what was given', async () => {
    const d = await detail(first.order, first.customer);
    const bad = await rate(first.order, first.customer, {
      items: [{ orderItemId: first.order.id, rating: 5 }],
    });
    expect(bad.statusCode).toBe(400);
    const tooMany = await rate(first.order, first.customer, {
      items: [{ orderItemId: d.items[0].id, rating: 6 }],
    });
    expect(tooMany.statusCode).toBe(400);

    const ok = await rate(first.order, first.customer, {
      items: [{ orderItemId: d.items[0].id, rating: 4 }],
      deliveryRating: 5,
      comment: '  Hot and crisp  ',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ foodRating: 4, deliveryRating: 5, comment: 'Hot and crisp' });
    const again = await rate(first.order, first.customer, {
      items: [{ orderItemId: d.items[0].id, rating: 1 }],
    });
    expect(again.json().error.code).toBe('CONFLICT');

    const after = await detail(first.order, first.customer);
    expect(after.review).toMatchObject({ canReview: false, given: { foodRating: 4, deliveryRating: 5 } });
  });

  it('customers see only averages, and only from 5 ratings', async () => {
    let m = await menu();
    expect(m.restaurant.rating).toEqual({ average: null, count: null });
    expect(garlicBread(m).rating).toEqual({ average: null, count: null });
    for (const stars of [5, 5, 4, 3]) {
      const o = await f.deliveredOrder({ rider });
      const d = await detail(o.order, o.customer);
      const res = await rate(o.order, o.customer, {
        items: [{ orderItemId: d.items[0].id, rating: stars }],
        deliveryRating: stars,
      });
      expect(res.statusCode).toBe(201);
    }
    m = await menu();
    // (4 + 5 + 5 + 4 + 3) / 5 = 4.2
    expect(m.restaurant.rating).toEqual({ average: 4.2, count: 5 });
    expect(garlicBread(m).rating).toEqual({ average: 4.2, count: 5 });
    expect(JSON.stringify(m)).not.toContain('Hot and crisp'); // never comments
    const row = await ctx.prisma.rider.findUniqueOrThrow({ where: { id: rider.rider.id } });
    expect([Number(row.ratingAvg), row.ratingCount]).toEqual([4.4, 5]);
  });

  it('the restaurant sees its reviews with comments, never who wrote them', async () => {
    const res = await call(
      'GET',
      `/v1/restaurant/reviews?restaurantId=${pizza.id}`,
      owner,
      undefined,
      'RESTAURANT',
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.rating).toEqual({ average: 4.2, count: 5 });
    expect(body.spread).toEqual({ 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 });
    const mine = body.items.find((r) => r.comment === 'Hot and crisp');
    expect(mine).toMatchObject({ foodRating: 4, items: [{ name: 'Garlic Bread', rating: 4 }] });
    expect(mine.orderNumber).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/customer|phone|deliveryRating|\+91/i);
  });

  it('the delivery partner sees their own average only', async () => {
    const res = await call('GET', '/v1/rider/ratings', rider, undefined, 'RIDER');
    expect(res.json()).toEqual({
      rating: { average: 4.4, count: 5 },
      spread: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 3 },
    });
  });
});

describe('Jamzo Admin moderates reviews (D-110)', () => {
  it('lists reviews with low ratings marked; hiding needs a reason and takes the review out of every average', async () => {
    const low = await f.deliveredOrder({ rider });
    const d = await detail(low.order, low.customer);
    await rate(low.order, low.customer, {
      items: [{ orderItemId: d.items[0].id, rating: 1 }],
      deliveryRating: 2,
      comment: 'Cold and late',
    });
    const asAdmin = (method, url, payload, token = admin) => call(method, url, token, payload, 'ADMIN');
    const list = (await asAdmin('GET', '/v1/admin/reviews?low=true')).json();
    expect(list.items).toHaveLength(1);
    const r = list.items[0];
    expect(r).toMatchObject({
      low: true,
      comment: 'Cold and late',
      foodRating: 1,
      deliveryRating: 2,
      restaurant: { name: 'Pizza Point' },
      rider: { id: rider.rider.id },
    });
    expect(r.customer.phone).toMatch(/•/); // masked
    expect((await asAdmin('GET', '/v1/admin/reviews')).json().items).toHaveLength(6);
    expect(
      Number((await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: pizza.id } })).ratingAvg),
    ).toBe(3.67);

    expect((await asAdmin('PATCH', `/v1/admin/reviews/${r.id}`, { hidden: true })).statusCode).toBe(400);
    const hidden = await asAdmin('PATCH', `/v1/admin/reviews/${r.id}`, {
      hidden: true,
      reason: 'Abusive words',
    });
    expect(hidden.json()).toMatchObject({ isHidden: true, hiddenReason: 'Abusive words' });
    const m = await menu();
    expect(m.restaurant.rating).toEqual({ average: 4.2, count: 5 });
    const riderRow = await ctx.prisma.rider.findUniqueOrThrow({ where: { id: rider.rider.id } });
    expect([Number(riderRow.ratingAvg), riderRow.ratingCount]).toEqual([4.4, 5]);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'review.hidden', entityId: r.id } })).toBe(1);

    const shown = await asAdmin('PATCH', `/v1/admin/reviews/${r.id}`, { hidden: false });
    expect(shown.json().isHidden).toBe(false);
    expect((await menu()).restaurant.rating.count).toBe(6);
  });

  it('needs the reviews permissions', async () => {
    const finance = (await adminWithRole(ctx, 'FINANCE')).accessToken;
    const res = await call('GET', '/v1/admin/reviews', finance, undefined, 'ADMIN');
    expect(res.statusCode).toBe(403);
    const support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
    expect((await call('GET', '/v1/admin/reviews', support, undefined, 'ADMIN')).statusCode).toBe(200);
  });
});

describe('the rating window', () => {
  it('closes after 7 days', async () => {
    const o = await f.deliveredOrder({ rider });
    const d = await detail(o.order, o.customer);
    ctx.clock.advance(8 * 86_400_000);
    expect((await detail(o.order, o.customer)).review.canReview).toBe(false);
    const late = await rate(o.order, o.customer, { items: [{ orderItemId: d.items[0].id, rating: 5 }] });
    expect(late.json().error.message).toMatch(/within 7 days/);
  });
});
