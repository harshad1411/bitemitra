// Delivery partner performance in Jamzo Admin (D-113) against real PostgreSQL. Orders go through the real API
// (checkout → restaurant → dispatch → delivery); the expected figures are read back from the stored records.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createFlows } from './flows.js';
import { indiaDay } from '../src/modules/riders/performance.js';

let ctx;
let f;
let admin;
let rider;
let delivered;
const MONDAY_1300 = ist('2026-09-28T13:00:00');

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  const pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  const owner = await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
  admin = (await adminLogin(ctx)).accessToken;
  f = createFlows(ctx, { owner });
  rider = await f.activeRider();
  delivered = [await f.deliveredOrder({ rider }), await f.deliveredOrder({ rider, method: 'UPI' })];

  // One offer the partner turns down.
  const placed = await f.placedOrder();
  const v = (await f.orderRow(placed.order.id)).version;
  await f.call(
    'POST',
    `/v1/restaurant/orders/${placed.order.id}/accept`,
    owner,
    { prepTimeMinutes: 15, version: v },
    'RESTAURANT',
  );
  await ctx.app.services.dispatch.handlers['order.accepted']({
    id: randomUUID(),
    eventType: 'order.accepted',
    payload: { orderId: placed.order.id },
  });
  const work = (await f.call('GET', '/v1/rider/work', rider)).json();
  const rejected = await f.call('POST', `/v1/rider/offers/${work.offer.assignmentId}/reject`, rider, {
    reason: 'TOO_FAR',
  });
  expect(rejected.statusCode, rejected.body).toBe(200);
});
afterAll(() => ctx?.stop());

const today = () => indiaDay(ctx.clock.now());
const tomorrow = () => indiaDay(new Date(ctx.clock.now().getTime() + 86_400_000));
const get = (url, token = admin) =>
  ctx.app.inject({ method: 'GET', url, headers: bearer(token.accessToken ?? token, 'ADMIN') });

describe('delivery partner performance (D-113)', () => {
  it('per partner: deliveries, pay, tips, cash, delivery charges and Jamzo’s margin, from the real records', async () => {
    const res = await get(`/v1/admin/riders/performance?from=${today()}&to=${tomorrow()}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    const row = body.items.find((i) => i.rider.id === rider.rider.id);

    const ids = delivered.map((d) => d.order.id);
    const [earnings, snaps, orders] = await Promise.all([
      ctx.prisma.riderEarning.findMany({ where: { orderId: { in: ids } } }),
      ctx.prisma.orderPricingSnapshot.findMany({ where: { orderId: { in: ids } } }),
      ctx.prisma.order.findMany({ where: { id: { in: ids } } }),
    ]);
    const pay = earnings.reduce((n, e) => n + e.totalPaise, 0);
    const charges = snaps.reduce((n, s) => n + s.deliveryFeePaise + s.nightSurchargePaise + s.surgePaise, 0);
    const cod = orders.find((o) => o.paymentMethod === 'COD');

    expect(row).toMatchObject({
      deliveries: 2,
      offersRejected: 1,
      payPaise: pay,
      tipsPaise: 4_000, // ₹20 tip on each order, all of it to the partner
      cashCollectedPaise: cod.codAmountPaise,
      deliveryChargesPaise: charges,
      marginPaise: charges - pay,
    });
    expect(pay).toBeGreaterThan(0);
    expect(row.rider).toMatchObject({ name: expect.any(String), phoneMasked: expect.stringContaining('•') });
    expect(row.averageTripMinutes).toEqual(expect.any(Number));
    expect(row.onlineMinutes).toBeGreaterThanOrEqual(0);
    // The totals line adds every partner up.
    expect(body.totals.deliveries).toBe(body.items.reduce((n, i) => n + i.deliveries, 0));
    expect(body.totals.marginPaise).toBe(body.items.reduce((n, i) => n + i.marginPaise, 0));
  });

  it('day by day for one partner: today has the deliveries, other days are zero', async () => {
    const from = indiaDay(new Date(ctx.clock.now().getTime() - 2 * 86_400_000));
    const res = await get(`/v1/admin/riders/${rider.rider.id}/performance?from=${from}&to=${tomorrow()}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.days.map((d) => d.day)).toEqual([
      today(),
      indiaDay(new Date(ctx.clock.now().getTime() - 86_400_000)),
      from,
    ]);
    expect(body.days[0].deliveries).toBe(2);
    expect(body.days[1].deliveries + body.days[2].deliveries).toBe(0);
    expect(body.totals.deliveries).toBe(2);
  });

  it('checks the range and the permission', async () => {
    expect((await get(`/v1/admin/riders/performance?from=${tomorrow()}&to=${today()}`)).statusCode).toBe(400);
    expect(
      (await get('/v1/admin/riders/performance?from=2026-01-01&to=2026-06-01')).json().error.fieldErrors.to,
    ).toEqual(['Choose at most 92 days']);
    const partnerManager = (await adminWithRole(ctx, 'PARTNER_MANAGER')).accessToken;
    expect(
      (await get(`/v1/admin/riders/performance?from=${today()}&to=${tomorrow()}`, partnerManager)).statusCode,
    ).toBe(403);
  });
});
