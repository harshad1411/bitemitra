// Online payments and refunds (Phase 7: D-82 … D-87, PAYMENTS.md §7) against real PostgreSQL with the fake
// gateway, which sends Razorpay-shaped, signed webhooks through the real webhook endpoint.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createNotificationDispatcher } from '../src/modules/notifications/dispatch.js';

let ctx;
let pizza;
let owner;
let admin;
let finance;
const HERE = { lat: 23.805, lng: 72.39 };
const MONDAY_1300 = ist('2026-09-28T13:00:00');
let seq = 0;

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  owner = await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
  admin = (await adminLogin(ctx)).accessToken;
  finance = (await adminWithRole(ctx, 'FINANCE')).accessToken;
});
afterAll(() => ctx?.stop());
// A test that simulates an outage must not leave the fake gateway broken for the next one.
afterEach(() => {
  gateway().setFailures(0);
  gateway().setRefundMode('PROCESSED');
});

const gateway = () => /** @type {any} */ (ctx.app.services.payments.provider);
const jobs = () => ctx.app.services.payments.handlers;
const job = (name, payload) => jobs()[name]({ id: randomUUID(), eventType: name, payload });
const call = (method, url, token, payload, app = 'CUSTOMER', extra = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token.accessToken ?? token, app, extra),
    ...(payload !== undefined ? { payload } : {}),
  });
const asAdmin = (method, url, payload, token = admin) => call(method, url, token, payload, 'ADMIN');
const deliver = (hook) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/fake',
    headers: { 'content-type': 'application/json', ...hook.headers },
    payload: hook.rawBody,
  });
/** Sets the refund approval limit through the real settings API (reason required: a money setting). */
const approvalLimit = async (thresholdPaise) => {
  const res =
    thresholdPaise == null
      ? await asAdmin('DELETE', '/v1/admin/settings', {
          key: 'refunds.approval',
          scope: 'GLOBAL',
          reason: 'test reset',
        })
      : await asAdmin('PUT', '/v1/admin/settings', {
          key: 'refunds.approval',
          scope: 'GLOBAL',
          value: { thresholdPaise },
          reason: 'test limit',
        });
  expect(res.statusCode, res.body).toBeLessThan(300);
};
const orderRow = (id) => ctx.prisma.order.findUniqueOrThrow({ where: { id } });
const paymentOf = (orderId) =>
  ctx.prisma.payment.findFirstOrThrow({ where: { orderId, provider: { not: 'cod' } } });
const outbox = (aggregateId, eventType) =>
  ctx.prisma.outboxEvent.findMany({ where: { aggregateId, eventType } });

/** A customer's online order at Pizza Point (not paid yet). */
async function onlineOrder({ method = 'UPI' } = {}) {
  const c = await mobileLogin(ctx, 'CUSTOMER', `97${String(Date.now() + ++seq).slice(-8)}`);
  const addr = (
    await call('POST', '/v1/customer/addresses', c, { label: 'Home', line1: '12 Station Road', ...HERE })
  ).json();
  const bread = await ctx.prisma.product.findFirstOrThrow({
    where: { restaurantId: pizza.id, name: 'Garlic Bread' },
  });
  const body = {
    restaurantId: pizza.id,
    addressId: addr.id,
    lines: [{ key: 'a', productId: bread.id, quantity: 2 }],
  };
  const q = (await call('POST', '/v1/customer/cart/quote', c, body)).json();
  const res = await call(
    'POST',
    '/v1/orders',
    c,
    { ...body, paymentMethod: method, expectedTotalPaise: q.bill.totalPayablePaise },
    'CUSTOMER',
    { 'idempotency-key': randomUUID() },
  );
  expect(res.statusCode, res.body).toBe(201);
  const order = res.json().order;
  const payment = method === 'COD' ? null : await paymentOf(order.id);
  return { customer: c, order, payment };
}

/** Pays an online order through the fake gateway's signed webhook. */
async function paid(o = undefined) {
  const x = o ?? (await onlineOrder());
  const hook = gateway().simulate(x.payment.providerOrderId, { outcome: 'success' });
  expect((await deliver(hook)).statusCode).toBe(200);
  return x;
}

describe('online payment', () => {
  it('checkout waits for payment; the page pays; the signed webhook places the order; duplicates change nothing', async () => {
    const { customer, order, payment } = await onlineOrder();
    expect(order.status).toBe('PAYMENT_PENDING');
    expect(payment).toMatchObject({
      status: 'PENDING',
      provider: 'fake',
      method: 'UPI',
      amountPaise: order.totalPayablePaise,
    });
    expect(payment.providerOrderId).toMatch(/^order_fake_/);
    expect(order.onlinePayment).toMatchObject({ status: 'PENDING', canPay: true });
    // The restaurant does not see an unpaid order.
    expect(
      (await call('GET', `/v1/restaurant/orders/${order.id}`, owner, undefined, 'RESTAURANT')).statusCode,
    ).toBe(404);
    expect(await outbox(payment.id, 'payment.expire')).toHaveLength(1);

    // The payment page: signed link only, strict content security policy, no gateway secrets.
    const page = await ctx.app.inject({
      method: 'GET',
      url: `${order.onlinePayment.pay.path}?t=${order.onlinePayment.pay.token}&returnTo=jamzo://payment`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    expect(page.body).toContain(order.orderNumber);
    expect(page.body).toContain('Pay ₹'); // amount shown
    expect(page.body).toContain('"returnTo":"jamzo://payment"');
    const evil = await ctx.app.inject({
      method: 'GET',
      url: `${order.onlinePayment.pay.path}?t=${order.onlinePayment.pay.token}&returnTo=https://evil.example/steal`,
    });
    expect(evil.body).toContain('"returnTo":null'); // no open redirect
    expect(
      (await ctx.app.inject({ method: 'GET', url: `${order.onlinePayment.pay.path}?t=1.bad` })).statusCode,
    ).toBe(403);

    // The page's test button → a signed webhook → the order is placed.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/pay/${payment.id}/fake`,
      payload: { t: order.onlinePayment.pay.token, outcome: 'success' },
    });
    expect(res.json()).toEqual({ ok: true });
    let row = await orderRow(order.id);
    expect(row.status).toBe('PLACED');
    expect(row.placedAt).not.toBeNull();
    const p = await paymentOf(order.id);
    expect(p).toMatchObject({ status: 'SUCCEEDED', capturedPaise: order.totalPayablePaise });
    expect(p.gatewayFeePaise).toBeGreaterThan(0); // the gateway's actual fee is recorded
    expect(await outbox(order.id, 'order.placed')).toHaveLength(1);
    expect(await outbox(order.id, 'order.acceptance_timeout')).toHaveLength(1);
    expect(await ctx.prisma.paymentAttempt.count({ where: { paymentId: p.id, status: 'SUCCEEDED' } })).toBe(
      1,
    );

    // Someone replays the stored event with a made-up signature: refused (duplicates: next test).
    const event = await ctx.prisma.paymentEvent.findFirstOrThrow({ where: { paymentId: p.id } });
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/fake',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-event-id': event.providerEventId,
        'x-razorpay-signature': 'x',
      },
      payload: JSON.stringify(event.payload),
    });
    expect(again.statusCode).toBe(400); // wrong signature → refused
    // The app's verify afterwards is harmless.
    const v = (await call('POST', `/v1/customer/orders/${order.id}/payment/verify`, customer)).json();
    expect(v).toMatchObject({
      outcome: 'ALREADY',
      orderStatus: 'PLACED',
      payment: { status: 'SUCCEEDED', canPay: false },
    });
    row = await orderRow(order.id);
    expect(
      await ctx.prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'PLACED' } }),
    ).toBe(1);
    expect(await outbox(order.id, 'order.placed')).toHaveLength(1);
  });

  it('a duplicate webhook delivery is stored once and processed once', async () => {
    const o = await onlineOrder();
    const hook = gateway().simulate(o.payment.providerOrderId, { outcome: 'success' });
    const [a, b] = await Promise.all([deliver(hook), deliver(hook)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().duplicate, b.json().duplicate].filter(Boolean)).toHaveLength(1);
    expect(await ctx.prisma.paymentEvent.count({ where: { paymentId: o.payment.id } })).toBe(1);
    expect((await orderRow(o.order.id)).status).toBe('PLACED');
  });

  it('refuses webhooks with a bad signature or for another gateway, and stores nothing', async () => {
    const o = await onlineOrder();
    const hook = gateway().simulate(o.payment.providerOrderId, { outcome: 'success' });
    const forged = await deliver({
      ...hook,
      headers: { ...hook.headers, 'x-razorpay-signature': '0'.repeat(64) },
    });
    expect(forged.statusCode).toBe(400);
    const tampered = await deliver({ ...hook, rawBody: hook.rawBody.replace(/"amount":\d+/, '"amount":1') });
    expect(tampered.statusCode).toBe(400);
    const other = await ctx.app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/razorpay',
      headers: { 'content-type': 'application/json', ...hook.headers },
      payload: hook.rawBody,
    });
    expect(other.statusCode).toBe(404);
    expect(await ctx.prisma.paymentEvent.count({ where: { paymentId: o.payment.id } })).toBe(0);
    expect((await orderRow(o.order.id)).status).toBe('PAYMENT_PENDING');
  });

  it('a declined try keeps the order open to pay again; a missed webhook is repaired by the app verify', async () => {
    const { customer, order, payment } = await onlineOrder({ method: 'CARD' });
    await deliver(gateway().simulate(payment.providerOrderId, { outcome: 'fail' }));
    let view = (await call('GET', `/v1/customer/orders/${order.id}`, customer)).json();
    expect(view.status).toBe('PAYMENT_PENDING');
    expect(view.onlinePayment).toMatchObject({
      status: 'PENDING',
      canPay: true,
      lastError: 'Payment declined by the bank (test)',
    });
    // Paid, but the webhook never arrives: the app's verify asks the gateway.
    gateway().simulate(payment.providerOrderId, { outcome: 'success', method: 'card' });
    const v = (await call('POST', `/v1/customer/orders/${order.id}/payment/verify`, customer)).json();
    expect(v).toMatchObject({ outcome: 'CONFIRMED', orderStatus: 'PLACED' });
    view = (await call('GET', `/v1/customer/orders/${order.id}`, customer)).json();
    expect(view.onlinePayment).toMatchObject({ status: 'SUCCEEDED', lastError: null });
    expect(await ctx.prisma.paymentAttempt.count({ where: { paymentId: payment.id } })).toBe(2);
    // Customers cannot touch someone else's payment.
    const stranger = await mobileLogin(ctx, 'CUSTOMER', '9123400001');
    expect((await call('POST', `/v1/customer/orders/${order.id}/payment/verify`, stranger)).statusCode).toBe(
      404,
    );
  });

  it('the reconcile job repairs a missed webhook; an authorised-only payment is captured', async () => {
    const o = await onlineOrder();
    gateway().simulate(o.payment.providerOrderId, { outcome: 'authorize' });
    await job('payment.reconcile', { paymentId: o.payment.id });
    expect((await orderRow(o.order.id)).status).toBe('PLACED');
    expect((await paymentOf(o.order.id)).status).toBe('SUCCEEDED');
  });

  it('a wrong amount never confirms: the order waits and is flagged for operations', async () => {
    const o = await onlineOrder();
    await deliver(gateway().simulate(o.payment.providerOrderId, { outcome: 'success', amountPaise: 100 }));
    const row = await orderRow(o.order.id);
    expect(row).toMatchObject({
      status: 'PAYMENT_PENDING',
      needsAttention: true,
      attentionReason: 'PAYMENT_AMOUNT_MISMATCH',
    });
    expect((await paymentOf(o.order.id)).status).toBe('PENDING');
  });

  it('not paid in time: the order fails and its coupon is released; money that arrives later is refunded automatically', async () => {
    const o = await onlineOrder();
    expect(await job('payment.expire', { paymentId: o.payment.id })).toBeUndefined();
    expect((await orderRow(o.order.id)).status).toBe('PAYMENT_FAILED');
    expect(await paymentOf(o.order.id)).toMatchObject({ status: 'EXPIRED' });
    // The customer pays anyway (the gateway page was still open).
    await deliver(gateway().simulate(o.payment.providerOrderId, { outcome: 'success' }));
    const row = await orderRow(o.order.id);
    expect(row.status).toBe('PAYMENT_FAILED'); // not revived
    expect(row).toMatchObject({
      needsAttention: true,
      attentionReason: 'LATE_PAYMENT_REFUNDED',
      financialStatus: 'REFUND_PENDING',
    });
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { idempotencyKey: `late:${o.payment.id}` },
    });
    expect(refund).toMatchObject({
      type: 'FULL',
      status: 'REQUESTED',
      amountPaise: o.order.totalPayablePaise,
      actorType: 'SYSTEM',
    });
    await job('refund.process', { refundId: refund.id });
    expect(await ctx.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(await paymentOf(o.order.id)).toMatchObject({
      status: 'SUCCEEDED',
      refundedPaise: o.order.totalPayablePaise,
    });
    expect((await orderRow(o.order.id)).financialStatus).toBe('REFUNDED');
    expect(await outbox(o.order.id, 'order.refunded')).toHaveLength(1);
  });

  it('webhook and app verify at the same moment: the order is placed exactly once', async () => {
    const o = await onlineOrder();
    const hook = gateway().simulate(o.payment.providerOrderId, { outcome: 'success' });
    const [w, v] = await Promise.all([
      deliver(hook),
      call('POST', `/v1/customer/orders/${o.order.id}/payment/verify`, o.customer),
    ]);
    expect(w.statusCode).toBe(200);
    expect(v.statusCode).toBe(200);
    expect(
      await ctx.prisma.orderStatusHistory.count({ where: { orderId: o.order.id, toStatus: 'PLACED' } }),
    ).toBe(1);
    expect(await outbox(o.order.id, 'order.placed')).toHaveLength(1);
  });

  it('the gateway is down at checkout: the order waits and the app opens the payment later', async () => {
    gateway().setFailures(1);
    const o = await onlineOrder();
    expect(o.payment).toMatchObject({ status: 'INITIATED', providerOrderId: null });
    expect(o.order.onlinePayment).toMatchObject({ canPay: false, ready: false });
    const res = await call('POST', `/v1/customer/orders/${o.order.id}/payment`, o.customer);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'PENDING', canPay: true });
    expect(res.json().pay.path).toBe(`/v1/pay/${o.payment.id}`);
  });
});

describe('refunds', () => {
  it('cancellations: before acceptance full refund; restaurant cancels → full refund it bears; customer after acceptance → none (OD-38)', async () => {
    // Customer cancels a paid order before the restaurant accepts.
    const a = await paid();
    let res = await call('POST', `/v1/customer/orders/${a.order.id}/cancel`, a.customer, {
      reasonCode: 'CHANGED_MIND',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().refunds).toEqual([
      expect.objectContaining({ amountPaise: a.order.totalPayablePaise, status: 'REQUESTED' }),
    ]);
    let refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { idempotencyKey: `cancel:${a.order.id}` },
    });
    expect(refund).toMatchObject({ type: 'FULL', bearer: 'PLATFORM' });
    await job('refund.process', { refundId: refund.id });
    expect((await orderRow(a.order.id)).financialStatus).toBe('REFUNDED');

    // The restaurant accepts, then cancels.
    const b = await paid();
    await call(
      'POST',
      `/v1/restaurant/orders/${b.order.id}/accept`,
      owner,
      { prepTimeMinutes: 15, version: (await orderRow(b.order.id)).version },
      'RESTAURANT',
    );
    res = await call(
      'POST',
      `/v1/restaurant/orders/${b.order.id}/cancel`,
      owner,
      { reasonCode: 'KITCHEN_ISSUE', version: (await orderRow(b.order.id)).version },
      'RESTAURANT',
    );
    expect(res.statusCode, res.body).toBe(200);
    refund = await ctx.prisma.refund.findUniqueOrThrow({ where: { idempotencyKey: `cancel:${b.order.id}` } });
    expect(refund).toMatchObject({ amountPaise: b.order.totalPayablePaise, bearer: 'RESTAURANT' });

    // The customer cancels after acceptance: no refund of an online payment.
    const c = await paid();
    await call(
      'POST',
      `/v1/restaurant/orders/${c.order.id}/accept`,
      owner,
      { prepTimeMinutes: 15, version: (await orderRow(c.order.id)).version },
      'RESTAURANT',
    );
    const view = (await call('GET', `/v1/customer/orders/${c.order.id}`, c.customer)).json();
    expect(view.cancelTerms).toMatchObject({
      refundDuePaise: 0,
      keptPaise: c.order.totalPayablePaise,
      noRefundAfterAccept: true,
    });
    res = await call('POST', `/v1/customer/orders/${c.order.id}/cancel`, c.customer, {
      reasonCode: 'CHANGED_MIND',
    });
    expect(res.json().refunds).toEqual([]);
    expect(await ctx.prisma.refund.count({ where: { orderId: c.order.id } })).toBe(0);
    expect((await orderRow(c.order.id)).financialStatus).toBe('NONE');
  });

  it('a paid order the restaurant rejects is refunded in full; the customer is told by push', async () => {
    const o = await paid();
    const res = await call(
      'POST',
      `/v1/restaurant/orders/${o.order.id}/reject`,
      owner,
      { reasonCode: 'ITEM_UNAVAILABLE', version: (await orderRow(o.order.id)).version },
      'RESTAURANT',
    );
    expect(res.statusCode, res.body).toBe(200);
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { idempotencyKey: `reject:${o.order.id}` },
    });
    expect(refund).toMatchObject({
      type: 'FULL',
      amountPaise: o.order.totalPayablePaise,
      status: 'REQUESTED',
    });
    await job('refund.process', { refundId: refund.id });
    expect((await orderRow(o.order.id)).financialStatus).toBe('REFUNDED');
    // The worker knows the new events (unknown events would be parked) and tells the customer.
    const dispatcher = createNotificationDispatcher({
      prisma: ctx.prisma,
      push: { name: 'none', send: async () => [] },
    });
    expect(Object.keys(dispatcher)).toEqual(
      expect.arrayContaining(['order.refunded', 'order.payment_failed']),
    );
    const [event] = await outbox(o.order.id, 'order.refunded');
    await dispatcher['order.refunded'](event);
    const note = await ctx.prisma.notification.findFirstOrThrow({
      where: { event: 'order.refunded', data: { path: ['orderId'], equals: o.order.id } },
    });
    expect(note.title).toBe('Refund processed');
    expect(note.body).toContain(
      `₹${(o.order.totalPayablePaise / 100).toFixed(2)} for order ${o.order.orderNumber}`,
    );
  });

  it('cancelling while the payment is still open closes it; a later capture is refunded', async () => {
    const o = await onlineOrder();
    const res = await call('POST', `/v1/customer/orders/${o.order.id}/cancel`, o.customer, {
      reasonCode: 'CHANGED_MIND',
    });
    expect(res.json().status).toBe('CUSTOMER_CANCELLED');
    expect(await paymentOf(o.order.id)).toMatchObject({ status: 'CANCELLED' });
    await deliver(gateway().simulate(o.payment.providerOrderId, { outcome: 'success' }));
    expect(await ctx.prisma.refund.count({ where: { idempotencyKey: `late:${o.payment.id}` } })).toBe(1);
  });

  it('admin refunds: types, a second approver above the limit, no refunding more than was paid, safe double submit', async () => {
    const o = await paid();
    const total = o.order.totalPayablePaise;
    // Delivery fee refund (small: no approval needed).
    let res = await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
      type: 'PARTIAL',
      amountPaise: 1_000,
      reason: 'Arrived late',
      idempotencyKey: 'test-refund-partial-1',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'REQUESTED', amountPaise: 1_000 });
    const again = await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
      type: 'PARTIAL',
      amountPaise: 1_000,
      reason: 'Arrived late',
      idempotencyKey: 'test-refund-partial-1',
    });
    expect(again.json().id).toBe(res.json().id); // double click → one refund
    await job('refund.process', { refundId: res.json().id });
    expect((await orderRow(o.order.id)).financialStatus).toBe('PARTIALLY_REFUNDED');

    // More than is left is refused.
    res = await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
      type: 'MANUAL',
      amountPaise: total,
      reason: 'Too much',
      idempotencyKey: 'test-refund-too-much',
    });
    expect(res.json().error.code).toBe('REFUND_TOO_LARGE');

    // Above the approval limit: waits for a different admin.
    await approvalLimit(1_000);
    res = await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
      type: 'FULL',
      reason: 'Wrong order delivered',
      bearer: 'RESTAURANT',
      idempotencyKey: 'test-refund-full',
    });
    expect(res.json()).toMatchObject({
      status: 'PENDING_APPROVAL',
      amountPaise: total - 1_000,
      bearer: 'RESTAURANT',
    });
    const id = res.json().id;
    expect((await asAdmin('POST', `/v1/admin/refunds/${id}/approve`)).statusCode).toBe(403); // not the maker
    const list = (
      await asAdmin('GET', '/v1/admin/refunds?status=PENDING_APPROVAL', undefined, finance)
    ).json();
    expect(list.items.find((r) => r.id === id)).toMatchObject({ canApprove: true });
    res = await asAdmin('POST', `/v1/admin/refunds/${id}/approve`, undefined, finance);
    expect(res.json()).toMatchObject({ status: 'REQUESTED' });
    await job('refund.process', { refundId: id });
    expect((await orderRow(o.order.id)).financialStatus).toBe('REFUNDED');
    expect(await paymentOf(o.order.id)).toMatchObject({ refundedPaise: total });
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: id, action: { in: ['refund.create', 'refund.approve'] } },
      }),
    ).toBe(2);
    await approvalLimit(null);
  });

  it('a rejected refund needs a reason and frees the amount again', async () => {
    const o = await paid();
    await approvalLimit(0);
    const r = (
      await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
        type: 'FULL',
        reason: 'Asked by customer',
        idempotencyKey: 'test-refund-rej',
      })
    ).json();
    expect((await asAdmin('POST', `/v1/admin/refunds/${r.id}/reject`, {}, finance)).statusCode).toBe(400);
    const res = await asAdmin(
      'POST',
      `/v1/admin/refunds/${r.id}/reject`,
      { reason: 'Food was delivered fine' },
      finance,
    );
    expect(res.json()).toMatchObject({ status: 'REJECTED', rejectionReason: 'Food was delivered fine' });
    expect((await orderRow(o.order.id)).financialStatus).toBe('NONE');
    await approvalLimit(null);
  });

  it('gateway trouble: retried with back-off, then failed and flagged; the admin retries; a slow refund completes by webhook', async () => {
    const o = await paid();
    const r = (
      await asAdmin('POST', `/v1/admin/orders/${o.order.id}/refunds`, {
        type: 'PARTIAL',
        amountPaise: 500,
        reason: 'Missing dip',
        idempotencyKey: 'test-refund-retry',
      })
    ).json();
    gateway().setFailures(3);
    for (let i = 0; i < 3; i++) await job('refund.process', { refundId: r.id });
    let row = await ctx.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(await orderRow(o.order.id)).toMatchObject({
      needsAttention: true,
      attentionReason: 'REFUND_FAILED',
      financialStatus: 'REFUND_PENDING',
    });
    expect(await outbox(r.id, 'refund.process')).toHaveLength(3); // first + two scheduled retries

    // Slow gateway: accepted now, processed later (webhook).
    gateway().setRefundMode('PENDING');
    expect(
      (await asAdmin('POST', `/v1/admin/refunds/${r.id}/retry`, undefined, finance)).json(),
    ).toMatchObject({ status: 'REQUESTED' });
    await job('refund.process', { refundId: r.id });
    row = await ctx.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PROCESSING');
    expect(await outbox(r.id, 'refund.check')).toHaveLength(1);
    await deliver(gateway().settleRefund(row.providerRefundId, 'PROCESSED'));
    expect(await ctx.prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect((await orderRow(o.order.id)).financialStatus).toBe('PARTIALLY_REFUNDED');
    gateway().setRefundMode('PROCESSED');
  });

  it('cash on delivery: refunded outside the gateway and completed with the payout reference', async () => {
    // A real cash-on-delivery checkout; the delivery's cash collection is recorded as the rider app does.
    const { order: cod } = await onlineOrder({ method: 'COD' });
    await ctx.prisma.order.update({ where: { id: cod.id }, data: { status: 'DELIVERED' } });
    await ctx.prisma.payment.create({
      data: {
        orderId: cod.id,
        method: 'COD',
        provider: 'cod',
        status: 'SUCCEEDED',
        amountPaise: cod.totalPayablePaise,
        capturedPaise: cod.totalPayablePaise,
        codCollectedById: (await ctx.prisma.user.findFirstOrThrow()).id,
        codCollectedAt: ctx.clock.now(),
      },
    });
    const r = (
      await asAdmin('POST', `/v1/admin/orders/${cod.id}/refunds`, {
        type: 'PARTIAL',
        amountPaise: 5_000,
        reason: 'Cold food',
        idempotencyKey: 'test-refund-cod',
      })
    ).json();
    expect(r).toMatchObject({ status: 'REQUESTED', paymentId: null });
    expect(await outbox(r.id, 'refund.process')).toHaveLength(0); // no gateway
    const res = await asAdmin('POST', `/v1/admin/refunds/${r.id}/paid`, { reference: 'UPI 612345678901' });
    expect(res.json()).toMatchObject({ status: 'SUCCEEDED', manualReference: 'UPI 612345678901' });
    expect((await orderRow(cod.id)).financialStatus).toBe('PARTIALLY_REFUNDED');
  });
});

describe('admin payments', () => {
  it('lists payments and shows attempts, gateway events and refunds; "Check with gateway" repairs a missed webhook', async () => {
    const o = await onlineOrder();
    gateway().simulate(o.payment.providerOrderId, { outcome: 'success' }); // webhook lost
    const list = (await asAdmin('GET', `/v1/admin/payments?q=${o.order.orderNumber}`)).json();
    expect(list.items).toEqual([
      expect.objectContaining({ id: o.payment.id, status: 'PENDING', provider: 'fake' }),
    ]);
    const res = await asAdmin('POST', `/v1/admin/payments/${o.payment.id}/reconcile`);
    expect(res.json()).toMatchObject({ outcome: 'CONFIRMED', payment: { status: 'SUCCEEDED' } });
    const detail = (await asAdmin('GET', `/v1/admin/payments/${o.payment.id}`)).json();
    expect(detail.attempts).toHaveLength(1);
    expect(detail.permissions.reconcile).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/payload/); // raw gateway payloads are not sent to the browser
    const order = (await asAdmin('GET', `/v1/admin/orders/${o.order.id}`)).json();
    expect(order).toMatchObject({
      refundablePaise: o.order.totalPayablePaise,
      permissions: { refund: true },
    });
    expect(order.payments[0]).toMatchObject({ status: 'SUCCEEDED' });
    // Support can see payments but not reconcile or approve refunds.
    const support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
    expect(
      (await asAdmin('POST', `/v1/admin/payments/${o.payment.id}/reconcile`, undefined, support)).statusCode,
    ).toBe(403);
  });
});
