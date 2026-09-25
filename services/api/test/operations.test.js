// Admin operations (Phase 9: D-93 … D-97): support tickets, orders filters / saved views / bulk actions,
// analytics for admins, restaurants and delivery partners, and the audit export — against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createFlows } from './flows.js';
import { createNotificationDispatcher } from '../src/modules/notifications/dispatch.js';

let ctx;
let f;
let admin;
let support;
let owner;
let pizza;
let delivered;
let placed;
const MONDAY_1300 = ist('2026-09-28T13:00:00');

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  owner = await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
  f = createFlows(ctx, { owner });
  admin = (await adminLogin(ctx)).accessToken;
  support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
  delivered = await f.deliveredOrder();
  placed = await f.placedOrder({ method: 'COD', quantity: 3 });
});
afterAll(() => ctx?.stop());

const call = (method, url, token, payload, app = 'CUSTOMER') =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token.accessToken ?? token, app),
    ...(payload !== undefined ? { payload } : {}),
  });
const asAdmin = (method, url, payload, token = admin) => call(method, url, token, payload, 'ADMIN');

describe('support (D-93)', () => {
  it('a customer asks for help on an order; support answers with an internal note too; the customer is told', async () => {
    const { order, customer } = delivered;
    let res = await call('POST', '/v1/customer/support/tickets', customer, {
      orderId: order.id,
      issueType: 'MISSING_ITEM',
      message: 'The garlic dip was missing',
    });
    expect(res.statusCode, res.body).toBe(201);
    const t = res.json();
    expect(t).toMatchObject({
      ticketNumber: expect.stringMatching(/^SUP-260928-\d{5}$/),
      status: 'OPEN',
      orderNumber: order.orderNumber,
    });
    // Asking again for the same order and issue continues the same ticket.
    res = await call('POST', '/v1/customer/support/tickets', customer, {
      orderId: order.id,
      issueType: 'MISSING_ITEM',
      message: 'Still waiting',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: t.id,
      messages: [expect.anything(), expect.objectContaining({ body: 'Still waiting' })],
    });
    // Someone else's order: not found.
    const stranger = await mobileLogin(ctx, 'CUSTOMER', '9123400009');
    expect(
      (
        await call('POST', '/v1/customer/support/tickets', stranger, {
          orderId: order.id,
          issueType: 'OTHER',
          message: 'hello',
        })
      ).statusCode,
    ).toBe(404);

    // Support queue: the ticket, with the full order at hand.
    const list = (await asAdmin('GET', '/v1/admin/support/tickets?status=OPEN', undefined, support)).json();
    expect(list.items.find((x) => x.id === t.id)).toMatchObject({
      orderNumber: order.orderNumber,
      issueType: 'MISSING_ITEM',
    });
    await asAdmin(
      'POST',
      `/v1/admin/support/tickets/${t.id}/messages`,
      { body: 'Checked with the kitchen: dip was not packed.', internal: true },
      support,
    );
    await asAdmin(
      'POST',
      `/v1/admin/support/tickets/${t.id}/messages`,
      { body: 'Sorry! We are refunding the dip.', internal: false },
      support,
    );
    const detail = (await asAdmin('GET', `/v1/admin/support/tickets/${t.id}`, undefined, support)).json();
    expect(detail).toMatchObject({
      status: 'WAITING_ON_CUSTOMER',
      orderId: order.id,
      assignedToName: 'SUPPORT',
    });
    expect(detail.firstResponseAt).not.toBeNull();
    expect(detail.messages.map((m) => [m.authorType, m.internal])).toEqual([
      ['CUSTOMER', false],
      ['CUSTOMER', false],
      ['ADMIN', true],
      ['ADMIN', false],
    ]);
    // The customer never sees the internal note.
    const mine = (await call('GET', `/v1/customer/support/tickets/${t.id}`, customer)).json();
    expect(mine.messages.map((m) => m.from)).toEqual(['YOU', 'YOU', 'JAMZO']);
    expect(JSON.stringify(mine)).not.toContain('not packed');
    // The reply sends a push notification to the customer (template support.reply).
    const [event] = await ctx.prisma.outboxEvent.findMany({
      where: { aggregateId: t.id, eventType: 'support.replied' },
    });
    const dispatcher = createNotificationDispatcher({
      prisma: ctx.prisma,
      push: { name: 'none', send: async () => [] },
    });
    await dispatcher['support.replied'](event);
    const note = await ctx.prisma.notification.findFirstOrThrow({ where: { event: 'support.replied' } });
    expect(note).toMatchObject({
      title: 'Jamzo support replied',
      body: `About ${t.ticketNumber}: open the app to read the reply.`,
    });
    expect(note.data).toMatchObject({ url: `/support/${t.id}` });
  });

  it('resolving needs a resolution; a customer writing again reopens; closed stays closed', async () => {
    const { order, customer } = delivered;
    const t = (
      await call('POST', '/v1/customer/support/tickets', customer, {
        orderId: order.id,
        issueType: 'LATE_DELIVERY',
        message: 'Took an hour',
      })
    ).json();
    expect(
      (await asAdmin('PATCH', `/v1/admin/support/tickets/${t.id}`, { status: 'RESOLVED' }, support))
        .statusCode,
    ).toBe(400);
    const res = await asAdmin(
      'PATCH',
      `/v1/admin/support/tickets/${t.id}`,
      { status: 'RESOLVED', resolution: 'Apologised; ₹20 coupon given' },
      support,
    );
    expect(res.json()).toMatchObject({ status: 'RESOLVED', resolution: 'Apologised; ₹20 coupon given' });
    await call('POST', `/v1/customer/support/tickets/${t.id}/messages`, customer, {
      body: 'Thanks, but where is the coupon?',
    });
    expect((await call('GET', `/v1/customer/support/tickets/${t.id}`, customer)).json()).toMatchObject({
      status: 'OPEN',
      resolution: null,
    });
    await asAdmin(
      'PATCH',
      `/v1/admin/support/tickets/${t.id}`,
      { status: 'CLOSED', resolution: 'Coupon sent by SMS' },
      support,
    );
    expect(
      (await call('POST', `/v1/customer/support/tickets/${t.id}/messages`, customer, { body: 'ok' }))
        .statusCode,
    ).toBe(409);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: t.id, action: 'support.update' } })).toBe(2);
    // A restaurant partner-app user cannot use customer support routes.
    expect(
      (await call('GET', '/v1/customer/support/tickets', owner, undefined, 'RESTAURANT')).statusCode,
    ).toBe(403);
  });
});

describe('orders page (D-94)', () => {
  it('filters: delivery status, amount, partner name, full phone only with the right permission', async () => {
    const ids = (r) => r.json().items.map((o) => o.id);
    let res = await asAdmin('GET', '/v1/admin/orders?deliveryStatus=DELIVERED');
    expect(ids(res)).toContain(delivered.order.id);
    expect(ids(res)).not.toContain(placed.order.id);
    res = await asAdmin(
      'GET',
      `/v1/admin/orders?minTotalPaise=${placed.order.totalPayablePaise}&maxTotalPaise=${placed.order.totalPayablePaise}`,
    );
    expect(ids(res)).toEqual([placed.order.id]);
    res = await asAdmin('GET', '/v1/admin/orders?q=Mohan');
    expect(ids(res)).toContain(delivered.order.id); // the delivery partner's name
    const row = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: placed.order.id },
      include: { customer: { include: { user: true } } },
    });
    const phone = row.customer.user.phone;
    res = await asAdmin('GET', `/v1/admin/orders?q=${encodeURIComponent(phone.slice(3))}`);
    expect(ids(res)).toEqual([placed.order.id]);
    // Only roles with customers.pii may find customers by phone.
    const ops = (await adminWithRole(ctx, 'OPERATIONS')).accessToken;
    res = await asAdmin('GET', `/v1/admin/orders?q=${encodeURIComponent(phone.slice(3))}`, undefined, ops);
    expect(ids(res)).toEqual([]);
  });

  it('saved views: private or shared; only the owner deletes', async () => {
    const mine = (
      await asAdmin('POST', '/v1/admin/saved-views', {
        resource: 'orders',
        name: 'Needs attention',
        query: { needsAttention: 'true' },
      })
    ).json();
    const shared = (
      await asAdmin('POST', '/v1/admin/saved-views', {
        resource: 'orders',
        name: 'Cash orders',
        query: { paymentMethod: 'COD' },
        isShared: true,
      })
    ).json();
    expect(mine).toMatchObject({ mine: true, isShared: false });
    const theirs = (await asAdmin('GET', '/v1/admin/saved-views?resource=orders', undefined, support)).json();
    expect(theirs.items.map((v) => v.name)).toEqual(['Cash orders']);
    expect(
      (await asAdmin('DELETE', `/v1/admin/saved-views/${shared.id}`, undefined, support)).statusCode,
    ).toBe(403);
    expect((await asAdmin('DELETE', `/v1/admin/saved-views/${shared.id}`)).statusCode).toBe(204);
  });

  it('bulk: export CSV (phones masked without permission, audited) and mark flagged orders handled', async () => {
    let res = await asAdmin('GET', '/v1/admin/orders/export.csv?deliveryStatus=DELIVERED');
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body).toContain(delivered.order.orderNumber);
    expect(res.body).toMatch(/\+91\d{10}/); // super admin sees phones
    const ops = (await adminWithRole(ctx, 'OPERATIONS')).accessToken;
    res = await asAdmin('GET', '/v1/admin/orders/export.csv?deliveryStatus=DELIVERED', undefined, ops);
    expect(res.body).not.toMatch(/\+91\d{10}/);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'order.export' } })).toBe(2);

    await ctx.prisma.order.update({
      where: { id: placed.order.id },
      data: { needsAttention: true, attentionReason: 'RESTAURANT_NOT_RESPONDING' },
    });
    res = await asAdmin('POST', '/v1/admin/orders/bulk/attention', {
      orderIds: [placed.order.id, delivered.order.id],
      note: 'Called the restaurant',
    });
    expect(res.json()).toEqual({ handled: 1, skipped: 1 });
    expect(await ctx.prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).toMatchObject({
      needsAttention: false,
    });
    expect(
      await ctx.prisma.orderNote.count({
        where: { orderId: placed.order.id, body: 'Handled: Called the restaurant' },
      }),
    ).toBe(1);
  });
});

describe('analytics (D-95, D-96)', () => {
  it('admin KPIs for a period, with a breakdown by payment method and restaurant', async () => {
    let res = await asAdmin('GET', '/v1/admin/analytics?from=2026-09-28&to=2026-09-29&by=PAYMENT_METHOD');
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json();
    expect(a.totals).toMatchObject({
      orders: 2,
      completed: 1,
      gmvPaise: delivered.order.totalPayablePaise,
      averageOrderValuePaise: delivered.order.totalPayablePaise,
    });
    expect(a.totals.averageDeliveryMinutes).toBeGreaterThanOrEqual(0);
    expect(a.totals.onlineRidersNow).toBeGreaterThanOrEqual(0);
    expect(a.breakdown).toEqual([expect.objectContaining({ key: 'COD', orders: 2 })]);
    res = await asAdmin('GET', '/v1/admin/analytics?from=2026-09-28&to=2026-09-29&by=RESTAURANT');
    expect(res.json().breakdown[0]).toMatchObject({ label: 'Pizza Point' });
    // Nothing in another week.
    expect(
      (await asAdmin('GET', '/v1/admin/analytics?from=2026-10-05&to=2026-10-06')).json().totals.orders,
    ).toBe(0);
    expect(
      (await asAdmin('GET', '/v1/admin/analytics?from=2026-09-28&to=2026-09-29', undefined, support))
        .statusCode,
    ).toBe(403);
  });

  it('restaurant app: own sales, top items and busy hours (owners only); partner app: own trips and money', async () => {
    const res = await call(
      'GET',
      `/v1/restaurant/analytics?restaurantId=${pizza.id}&range=WEEK`,
      owner,
      undefined,
      'RESTAURANT',
    );
    expect(res.statusCode, res.body).toBe(200);
    const snap = await ctx.prisma.orderPricingSnapshot.findUniqueOrThrow({
      where: { orderId: delivered.order.id },
    });
    expect(res.json()).toMatchObject({
      delivered: 1,
      salesPaise: snap.restaurantBaseSubtotalPaise + snap.packagingPaise,
      netPaise: snap.restaurantPayablePaise,
      topItems: [{ name: 'Garlic Bread', quantity: 2 }],
      busyHours: [{ hour: 13, count: 2 }],
    });
    expect(JSON.stringify(res.json())).not.toMatch(/markup|platformFee/i);

    const r = (
      await call('GET', '/v1/rider/analytics?range=TODAY', delivered.rider, undefined, 'RIDER')
    ).json();
    const earning = await ctx.prisma.riderEarning.findUniqueOrThrow({
      where: { orderId: delivered.order.id },
    });
    expect(r).toMatchObject({
      trips: 1,
      earningsPaise: earning.totalPaise,
      tipsPaise: 2_000,
      cashCollectedPaise: delivered.order.totalPayablePaise,
      acceptanceRate: 1,
    });
    expect(r.distanceM).toBeGreaterThan(0);
    expect(r.onlineMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe('audit log (D-97)', () => {
  it('exports the filtered log as CSV and records the export', async () => {
    const res = await asAdmin('GET', '/v1/admin/audit-logs/export.csv?action=support.');
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('When (UTC),Actor,Action,Entity,Entity id,Old value,New value,IP');
    expect(lines.length).toBe(3); // two support updates
    expect(await ctx.prisma.auditLog.count({ where: { action: 'audit.export' } })).toBe(1);
  });
});
