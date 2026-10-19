// In-app account deletion (D-117) against real PostgreSQL: request, 30 days to keep the account, then the
// worker erases the personal data while orders and payments stay without the identity.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, headers, ist, mobileLogin, startTestApp } from './helpers.js';
import { createFlows } from './flows.js';
import { createAccountDeletionJobs } from '../src/modules/auth/deletion.js';

let ctx;
let f;
let delivered;
let phone;
const DAY = 86_400_000;

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(ist('2026-09-28T13:00:00'));
  const pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  f = createFlows(ctx, { owner: await mobileLogin(ctx, 'RESTAURANT', pizza.phone) });
  delivered = await f.deliveredOrder();
  phone = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: delivered.customer.me.user.id } })).phone;
});
afterAll(() => ctx?.stop());

const as = (token, method, url, payload, app = 'CUSTOMER') => f.call(method, url, token, payload, app);
const userId = () => delivered.customer.me.user.id;

describe('delete my account (D-117)', () => {
  it('not while an order is on its way', async () => {
    const { customer } = await f.placedOrder();
    const res = await as(customer, 'POST', '/v1/me/deletion', {});
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error.message).toMatch(/order on its way/);
  });

  it('only from the customer app', async () => {
    const rider = await f.activeRider();
    expect((await as(rider, 'POST', '/v1/me/deletion', {}, 'RIDER')).statusCode).toBe(403);
  });

  it('asking signs out everywhere, stops orders, and leaves 30 days to keep the account', async () => {
    const c = delivered.customer;
    // Things that must be erased later: a saved address, a favourite, a device, a review comment.
    const item = await ctx.prisma.orderItem.findFirstOrThrow({ where: { orderId: delivered.order.id } });
    const review = await as(c, 'POST', `/v1/customer/orders/${delivered.order.id}/review`, {
      items: [{ orderItemId: item.id, rating: 5 }],
      deliveryRating: 4,
      comment: 'Ask for Ramesh at gate 2',
    });
    expect(review.statusCode, review.body).toBe(201);
    await as(c, 'PUT', `/v1/customer/favorites/${delivered.order.restaurantId}`, {});
    await as(c, 'POST', '/v1/me/devices', { platform: 'ANDROID', pushToken: 'ExponentPushToken[del]' });

    const res = await as(c, 'POST', '/v1/me/deletion', {});
    expect(res.statusCode, res.body).toBe(200);
    const due = new Date(res.json().scheduledFor);
    expect(Math.abs(due.getTime() - (ctx.clock.now().getTime() + 30 * DAY))).toBeLessThan(5_000);
    expect(await ctx.prisma.session.count({ where: { userId: userId(), revokedAt: null } })).toBe(0);
    expect(await ctx.prisma.device.count({ where: { userId: userId(), disabledAt: null } })).toBe(0);
    const refresh = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: headers('CUSTOMER'),
      payload: { refreshToken: c.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // Signed in again within the 30 days: the app shows the date, and ordering waits for "Keep my account".
    ctx.clock.advance(60_000); // past the resend wait for this number
    const again = await mobileLogin(ctx, 'CUSTOMER', phone);
    expect(again.me.user.deletionScheduledFor).toBe(due.toISOString());
    const order = await as(again, 'POST', '/v1/orders', {}, 'CUSTOMER');
    expect(order.statusCode).toBe(400); // body checked first; a real order is refused below
    const real = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: bearer(again.accessToken, 'CUSTOMER', { 'idempotency-key': 'k-del-1' }),
      payload: {
        restaurantId: delivered.order.restaurantId,
        addressId: (
          await ctx.prisma.customerAddress.findFirstOrThrow({ where: { customer: { userId: userId() } } })
        ).id,
        lines: [{ key: 'a', productId: item.productId, quantity: 1 }],
        paymentMethod: 'COD',
        expectedTotalPaise: 100,
      },
    });
    expect(real.statusCode, real.body).toBe(409);
    expect(real.json().error.message).toMatch(/Keep my account/);

    const kept = await as(again, 'DELETE', '/v1/me/deletion');
    expect(kept.json().user.deletionScheduledFor).toBeNull();
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: userId(), action: { startsWith: 'account.deletion' } },
      }),
    ).toBe(2);
    // The job queued for day 30 does nothing for a kept account.
    const jobs = createAccountDeletionJobs({
      prisma: ctx.prisma,
      clock: { now: () => new Date(due.getTime() + DAY) },
    });
    const ev = await ctx.prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'account.delete' } });
    expect(ev.availableAt.getTime()).toBe(due.getTime());
    await jobs['account.delete'](ev);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId() } })).phone).toBe(phone);
  });

  it('after 30 days the personal data is erased; orders and payments stay, without the identity', async () => {
    ctx.clock.advance(60_000);
    const c = await mobileLogin(ctx, 'CUSTOMER', phone);
    expect((await as(c, 'POST', '/v1/me/deletion', {})).statusCode).toBe(200);
    const ev = (
      await ctx.prisma.outboxEvent.findMany({
        where: { eventType: 'account.delete' },
        orderBy: { createdAt: 'desc' },
      })
    )[0];
    const early = createAccountDeletionJobs({
      prisma: ctx.prisma,
      clock: { now: () => new Date(ev.availableAt.getTime() - 1000) },
    });
    await early['account.delete'](ev);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId() } })).status).toBe('ACTIVE');

    const due = createAccountDeletionJobs({ prisma: ctx.prisma, clock: { now: () => ev.availableAt } });
    await due['account.delete'](ev);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId() } });
    expect(u).toMatchObject({
      phone: null,
      email: null,
      name: null,
      status: 'DELETED',
      deletionScheduledFor: null,
    });
    expect(u.deletedAt).not.toBeNull();
    expect(await ctx.prisma.authIdentity.count({ where: { userId: userId() } })).toBe(0);
    expect(await ctx.prisma.session.count({ where: { userId: userId() } })).toBe(0);
    expect(await ctx.prisma.device.count({ where: { userId: userId() } })).toBe(0);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: userId() } });
    expect(await ctx.prisma.favoriteRestaurant.count({ where: { customerId: customer.id } })).toBe(0);
    for (const a of await ctx.prisma.customerAddress.findMany({ where: { customerId: customer.id } }))
      expect(a).toMatchObject({
        line1: 'Deleted',
        landmark: null,
        contactPhone: null,
        deletedAt: expect.any(Date),
      });
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: delivered.order.id },
      include: { address: true, items: true },
    });
    expect(order.totalPayablePaise).toBe(delivered.order.totalPayablePaise); // the money record stays
    expect(order.items).toHaveLength(1);
    expect(order.address).toMatchObject({
      line1: 'Removed (account deleted)',
      contactName: null,
      contactPhone: null,
    });
    const review = await ctx.prisma.review.findFirstOrThrow({ where: { orderId: delivered.order.id } });
    expect(review).toMatchObject({ comment: null, deliveryRating: 4 });
    expect(await ctx.prisma.auditLog.count({ where: { entityId: userId(), action: 'account.erase' } })).toBe(
      1,
    );

    // The number is free again: signing in starts a brand-new account with nothing from before.
    ctx.clock.advance(60_000);
    const fresh = await mobileLogin(ctx, 'CUSTOMER', phone);
    expect(fresh.me.user.id).not.toBe(userId());
    const orders = await as(fresh, 'GET', '/v1/customer/orders');
    expect(orders.json().items).toEqual([]);
  });
});
