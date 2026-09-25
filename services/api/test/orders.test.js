// Orders (Phase 5: ORDERS.md, D-60 … D-69) against real PostgreSQL with the seeded catalog and placeholder
// rules. The clock is a Monday lunchtime in IST so Pizza Point is open.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createConsolePushProvider } from '@jamzo/notifications';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createOrderJobs } from '../src/modules/orders/jobs.js';
import { createNotificationDispatcher } from '../src/modules/notifications/dispatch.js';
import { attachRealtime } from '../src/modules/realtime/server.js';

let ctx;
let pizza;
let owner; // Pizza Point OWNER
let staff; // Pizza Point STAFF
let admin;
const HERE = { lat: 23.805, lng: 72.39 };
const MONDAY_1300 = ist('2026-09-28T13:00:00');
let phoneSeq = 0;

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  owner = await member('OWNER');
  staff = await member('STAFF');
  admin = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

async function member(role, restaurantId = pizza.id) {
  const phone = `+9197700${String(++phoneSeq).padStart(5, '0')}`;
  const user = await ctx.prisma.user.create({
    data: { phone, identities: { create: { provider: 'PHONE_OTP', subject: phone } } },
  });
  await ctx.prisma.restaurantUser.create({ data: { restaurantId, userId: user.id, role } });
  return mobileLogin(ctx, 'RESTAURANT', phone);
}

/** A signed-in customer with a saved address at HERE. */
async function newCustomer(name = 'Asha Patel') {
  const session = await mobileLogin(ctx, 'CUSTOMER', `98${String(Date.now() + ++phoneSeq).slice(-8)}`);
  await ctx.prisma.user.update({ where: { id: session.me.user.id }, data: { name } });
  const res = await call('POST', '/v1/customer/addresses', session, {
    label: 'Home',
    line1: '12 Station Road',
    ...HERE,
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...session, addressId: res.json().id };
}

const call = (method, url, session, payload, app = 'CUSTOMER', extra = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(session.accessToken ?? session, app, extra),
    ...(payload !== undefined ? { payload } : {}),
  });
const asRestaurant = (method, url, session, payload) => call(method, url, session, payload, 'RESTAURANT');
const asAdmin = (method, url, payload, token = admin) => call(method, url, token, payload, 'ADMIN');

async function margheritaLines(quantity = 2) {
  const p = await ctx.prisma.product.findFirstOrThrow({
    where: { restaurantId: pizza.id, name: 'Margherita' },
    include: { variants: true, addonGroups: { include: { addons: true } } },
  });
  const crust = p.addonGroups
    .find((g) => g.name === 'Crust')
    .addons.find((a) => a.name === 'Classic hand-tossed');
  const cheese = p.addonGroups.find((g) => g.name === 'Add cheese').addons[0];
  return [
    {
      key: 'a',
      productId: p.id,
      variantId: p.variants.find((v) => v.isDefault).id,
      addonIds: [crust.id, cheese.id],
      quantity,
    },
  ];
}

async function quote(customer, extra = {}) {
  const res = await call('POST', '/v1/customer/cart/quote', customer, {
    restaurantId: pizza.id,
    addressId: customer.addressId,
    lines: await margheritaLines(),
    ...extra,
  });
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json();
}

async function checkout(customer, extra = {}, key = randomUUID()) {
  const q = await quote(customer, { couponCode: extra.couponCode });
  return call(
    'POST',
    '/v1/orders',
    customer,
    {
      restaurantId: pizza.id,
      addressId: customer.addressId,
      lines: await margheritaLines(),
      paymentMethod: 'COD',
      expectedTotalPaise: q.bill?.totalPayablePaise ?? 0,
      restaurantInstructions: 'Less spicy please',
      ...extra,
    },
    'CUSTOMER',
    { 'idempotency-key': key },
  );
}

async function placed(customer = undefined, extra = {}) {
  const c = customer ?? (await newCustomer());
  const res = await checkout(c, extra);
  if (res.statusCode !== 201) throw new Error(res.body);
  return { customer: c, order: res.json().order };
}

const orderRow = (id) => ctx.prisma.order.findUniqueOrThrow({ where: { id } });

describe('checkout (D-60, D-63, D-64)', () => {
  it('places a cash-on-delivery order with a frozen snapshot, history, events and an acceptance timer', async () => {
    const c = await newCustomer();
    const q = await quote(c);
    expect(q.canCheckout).toBe(true);
    const res = await checkout(c);
    expect(res.statusCode, res.body).toBe(201);
    const { order, created } = res.json();
    expect(created).toBe(true);
    expect(order).toMatchObject({
      status: 'PLACED',
      restaurantStatus: 'NEW',
      deliveryStatus: 'NOT_STARTED',
      totalPayablePaise: 34_100,
      payment: { method: 'COD', codAmountPaise: 34_100 },
      restaurantInstructions: 'Less spicy please',
      canCancel: true,
    });
    expect(order.orderNumber).toMatch(/^UNJ-260928-\d{5}$/);
    expect(order.bill).toEqual(q.bill); // exactly the bill the customer confirmed
    expect(order.items[0]).toMatchObject({
      name: 'Margherita',
      quantity: 2,
      addons: ['Classic hand-tossed', 'Extra cheese'],
    });
    expect(order.timeline.map((t) => t.status)).toEqual(['CREATED', 'PLACED']);

    const row = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { addons: true } }, pricingSnapshot: true, address: true },
    });
    expect(row.pricingSnapshot).toMatchObject({
      restaurantBaseSubtotalPaise: 30_000, // ₹150 × 2 at restaurant prices
      customerFoodSubtotalPaise: 33_000,
      markupTotalPaise: 3_000,
      restaurantFundedDiscountPaise: 3_300,
      totalPayablePaise: 34_100,
      distanceSource: 'FALLBACK',
    });
    expect(row.pricingSnapshot.commissionAmountPaise).toBe(
      row.items.reduce((n, i) => n + i.commissionAmountPaise, 0),
    );
    expect(row.items[0]).toMatchObject({
      restaurantBasePricePaise: 12_000,
      customerDisplayPricePaise: 13_200,
      markupAmountPaise: 1_200,
    });
    expect(row.items[0].addons.map((a) => [a.groupName, a.customerDisplayPricePaise])).toEqual([
      ['Crust', 0],
      ['Add cheese', 3_300],
    ]);
    expect(row.address.line1).toBe('12 Station Road');
    const events = await ctx.prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
    const timer = events.find((e) => e.eventType === 'order.acceptance_timeout');
    expect(events.map((e) => e.eventType).sort()).toEqual(['order.acceptance_timeout', 'order.placed']);
    expect(timer.availableAt.getTime() - row.createdAt.getTime()).toBe(180_000);
  });

  it('a restaurant that accepts automatically gets the order accepted at once, with no acceptance timer', async () => {
    await ctx.prisma.restaurantSettings.update({
      where: { restaurantId: pizza.id },
      data: { autoAccept: true },
    });
    try {
      const { order } = await placed();
      expect(order).toMatchObject({ status: 'RESTAURANT_ACCEPTED', prepTimeMinutes: 20 });
      expect(order.timeline.map((t) => t.status)).toEqual(['CREATED', 'PLACED', 'RESTAURANT_ACCEPTED']);
      const timers = await ctx.prisma.outboxEvent.count({
        where: { aggregateId: order.id, eventType: 'order.acceptance_timeout' },
      });
      expect(timers).toBe(0);
      const accepted = await ctx.prisma.orderStatusHistory.findFirst({
        where: { orderId: order.id, toStatus: 'RESTAURANT_ACCEPTED' },
      });
      expect(accepted).toMatchObject({ actorType: 'SYSTEM', reason: 'AUTO_ACCEPT' });
    } finally {
      await ctx.prisma.restaurantSettings.update({
        where: { restaurantId: pizza.id },
        data: { autoAccept: false },
      });
    }
  });

  it('a double tap never creates two orders — sequential, concurrent, or after the idempotency record expired', async () => {
    const c = await newCustomer();
    const key = randomUUID();
    const first = await checkout(c, {}, key);
    const again = await checkout(c, {}, key);
    expect(again.statusCode).toBe(201);
    expect(again.json().order.id).toBe(first.json().order.id);
    await ctx.prisma.idempotencyRecord.deleteMany({});
    const late = await checkout(c, {}, key);
    expect(late.json()).toMatchObject({ created: false, order: { id: first.json().order.id } });

    const c2 = await newCustomer();
    const key2 = randomUUID();
    const both = await Promise.all([checkout(c2, {}, key2), checkout(c2, {}, key2)]);
    for (const r of both) expect([201, 409]).toContain(r.statusCode);
    const cust2 = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: c2.me.user.id } });
    expect(await ctx.prisma.order.count({ where: { customerId: cust2.id } })).toBe(1);
  });

  it('refuses without an Idempotency-Key, when prices changed, and for online payment (D-60)', async () => {
    const c = await newCustomer();
    const noKey = await call('POST', '/v1/orders', c, {
      restaurantId: pizza.id,
      addressId: c.addressId,
      lines: await margheritaLines(),
      paymentMethod: 'COD',
      expectedTotalPaise: 34_100,
    });
    expect(noKey.statusCode).toBe(400);
    const changed = await checkout(c, { expectedTotalPaise: 30_000 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toMatchObject({
      code: 'PRICE_CHANGED',
      details: { previousTotalPaise: 30_000, quote: { bill: { totalPayablePaise: 34_100 } } },
    });
    const upi = await checkout(c, { paymentMethod: 'UPI' });
    expect(upi.statusCode).toBe(422);
    expect(upi.json().error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const cust = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: c.me.user.id } });
    expect(await ctx.prisma.order.count({ where: { customerId: cust.id } })).toBe(0);
  });

  it('revalidates: sold-out item, closed restaurant, cash on delivery disabled — nothing is created', async () => {
    const c = await newCustomer();
    const cust = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: c.me.user.id } });
    const lines = await margheritaLines();
    await ctx.prisma.product.update({ where: { id: lines[0].productId }, data: { isAvailable: false } });
    let res = await checkout(c);
    await ctx.prisma.product.update({ where: { id: lines[0].productId }, data: { isAvailable: true } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'CHECKOUT_BLOCKED' });
    expect(res.json().error.details.issues[0].code).toBe('ITEM_UNAVAILABLE');

    ctx.clock.set(ist('2026-09-28T03:00:00'));
    res = await checkout(c, { expectedTotalPaise: 34_100 });
    ctx.clock.set(MONDAY_1300);
    expect(res.json().error.details.issues.map((i) => i.code)).toContain('RESTAURANT_CLOSED');

    await ctx.prisma.customer.update({ where: { id: cust.id }, data: { codDisabled: true } });
    res = await checkout(c);
    await ctx.prisma.customer.update({ where: { id: cust.id }, data: { codDisabled: false } });
    expect(res.json().error.details.issues[0]).toMatchObject({ code: 'COD_NOT_AVAILABLE' });
    expect(await ctx.prisma.order.count({ where: { customerId: cust.id } })).toBe(0);
  });
});

describe('coupon limits (D-65)', () => {
  it('first-order coupon is used once, blocked for a second order, and released by cancellation', async () => {
    const c = await newCustomer();
    const { order } = await placed(c, { couponCode: 'WELCOME50' });
    expect(order.bill.lines.map((l) => l.code)).toContain('COUPON');
    const coupon = await ctx.prisma.coupon.findUniqueOrThrow({ where: { code: 'WELCOME50' } });
    const usedBefore = coupon.usedCount;
    expect(await ctx.prisma.couponUsage.count({ where: { orderId: order.id, reversedAt: null } })).toBe(1);

    const second = await quote(c, { couponCode: 'WELCOME50' });
    expect(second.coupon.status).toBe('NOT_APPLICABLE');
    expect(second.canCheckout).toBe(false);

    const res = await call('POST', `/v1/customer/orders/${order.id}/cancel`, c, {
      reasonCode: 'CHANGED_MIND',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await ctx.prisma.couponUsage.count({ where: { orderId: order.id, reversedAt: null } })).toBe(0);
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { code: 'WELCOME50' } })).usedCount).toBe(
      usedBefore - 1,
    );
    expect((await quote(c, { couponCode: 'WELCOME50' })).coupon.status).toBe('APPLIED'); // cancelled orders do not count
  });

  it('two customers racing for the last use of a coupon: exactly one gets it', async () => {
    await ctx.prisma.coupon.create({
      data: {
        code: 'LASTONE',
        discountType: 'FIXED',
        valuePaise: 5_000,
        usageLimit: 1,
        fundingSource: 'PLATFORM',
        startsAt: ist('2026-01-01T00:00:00'),
      },
    });
    const [a, b] = await Promise.all([newCustomer(), newCustomer()]);
    const results = await Promise.all([
      checkout(a, { couponCode: 'LASTONE' }),
      checkout(b, { couponCode: 'LASTONE' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { code: 'LASTONE' } })).usedCount).toBe(1);
  });
});

describe('restaurant order handling (D-67)', () => {
  it('new → seen → accepted → preparing → ready, with version checks; the customer sees each step', async () => {
    const { customer, order } = await placed();
    let res = await asRestaurant('GET', `/v1/restaurant/orders?restaurantId=${pizza.id}&view=NEW`, owner);
    expect(res.statusCode, res.body).toBe(200);
    const listed = res.json().items.find((o) => o.id === order.id);
    expect(listed).toMatchObject({
      shortNumber: order.orderNumber.slice(-4),
      customer: { firstName: 'Asha' },
      restaurantInstructions: 'Less spicy please',
      foodValuePaise: 30_000,
      payment: { method: 'COD' },
      finance: { foodValuePaise: 30_000, restaurantFundedDiscountPaise: 3_300, estimate: true },
    });
    expect(listed.items[0]).toMatchObject({ unitPricePaise: 12_000, lineTotalPaise: 30_000 }); // restaurant's own prices
    expect(new Date(listed.acceptBy).getTime() - new Date(order.placedAt).getTime()).toBe(180_000);
    // Never: customer display prices, markup, platform fees, platform revenue, phone or address.
    expect(res.body).not.toMatch(/markup|platformFee|platformRevenue|34100|33000|\+91|Station Road/i);

    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/seen`, owner, {});
    expect(res.json().status).toBe('RESTAURANT_NOTIFIED');
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/seen`, owner, {}); // safe to repeat
    expect(res.statusCode).toBe(200);
    const v = res.json().version;

    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, staff, {
      prepTimeMinutes: 90,
      version: v,
    });
    expect(res.statusCode).toBe(400); // above orders.preparation.maxPrepMinutes (60)
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, staff, {
      prepTimeMinutes: 20,
      version: v,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'RESTAURANT_ACCEPTED', prepTimeMinutes: 20, finance: null }); // STAFF: no money
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/preparing`, owner, { version: v });
    expect(res.statusCode).toBe(409); // stale version
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/preparing`, owner, {
      version: v + 1,
    });
    expect(res.json().status).toBe('PREPARING');
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/ready`, owner, { version: v + 2 });
    expect(res.json()).toMatchObject({
      status: 'READY_FOR_PICKUP',
      restaurantStatus: 'READY_FOR_PICKUP',
      deliveryStatus: 'NOT_STARTED',
    });
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/ready`, owner, { version: v + 3 });
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');

    const mine = (await call('GET', `/v1/customer/orders/${order.id}`, customer)).json();
    expect(mine.timeline.map((t) => t.status)).toEqual([
      'CREATED',
      'PLACED',
      'RESTAURANT_NOTIFIED',
      'RESTAURANT_ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
    ]);
    expect(mine.canCancel).toBe(false);
    expect(new Date(mine.estimatedReadyAt).getTime() - new Date(mine.acceptedAt).getTime()).toBe(20 * 60_000);
    const list = (await call('GET', '/v1/customer/orders', customer)).json();
    expect(list.items[0]).toMatchObject({ id: order.id, status: 'READY_FOR_PICKUP' });
    const history = await ctx.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.find((h) => h.toStatus === 'RESTAURANT_ACCEPTED')).toMatchObject({
      actorType: 'RESTAURANT_USER',
      metadata: { event: 'ACCEPT', kitchen: ['NEW', 'ACCEPTED'] },
    });
  });

  it('only members see an order; STAFF cannot cancel; a reject needs a reason and releases the coupon', async () => {
    const { order } = await placed(undefined, { couponCode: 'FREEDEL' });
    const outsider = await member(
      'OWNER',
      (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'demo-kitchen' } })).id,
    );
    expect((await asRestaurant('GET', `/v1/restaurant/orders/${order.id}`, outsider)).statusCode).toBe(404);
    expect(
      (
        await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/cancel`, staff, {
          reasonCode: 'KITCHEN_ISSUE',
          version: 0,
        })
      ).statusCode,
    ).toBe(403);
    let res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/reject`, owner, {
      reasonCode: 'OTHER',
      version: 0,
    });
    expect(res.statusCode).toBe(400);
    res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/reject`, owner, {
      reasonCode: 'TOO_BUSY',
      version: 0,
    });
    expect(res.json()).toMatchObject({
      status: 'RESTAURANT_REJECTED',
      restaurantStatus: 'REJECTED',
      deliveryStatus: 'CANCELLED',
    });
    expect(await ctx.prisma.couponUsage.count({ where: { orderId: order.id, reversedAt: null } })).toBe(0);
  });

  it('a restaurant manager can cancel after accepting; the outcome is recorded with the rule', async () => {
    const { order } = await placed();
    await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
      prepTimeMinutes: 15,
      version: 0,
    });
    const res = await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/cancel`, owner, {
      reasonCode: 'KITCHEN_ISSUE',
      version: 1,
    });
    expect(res.json()).toMatchObject({
      status: 'RESTAURANT_CANCELLED',
      cancellation: { byType: 'RESTAURANT_USER', reasonCode: 'KITCHEN_ISSUE' },
    });
    const outcome = await ctx.prisma.orderCancellation.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(outcome).toMatchObject({
      stage: 'AFTER_ACCEPT',
      refundDuePaise: 0,
      customerFeePaise: 0,
      isAdminOverride: false,
    });
    expect(outcome.ruleId).not.toBeNull();
  });
});

describe('customer cancellation (A-25)', () => {
  it('free before the restaurant accepts; after that the customer is sent to support', async () => {
    let { customer, order } = await placed();
    let res = await call('POST', `/v1/customer/orders/${order.id}/cancel`, customer, {
      reasonCode: 'ORDERED_BY_MISTAKE',
    });
    expect(res.json()).toMatchObject({
      status: 'CUSTOMER_CANCELLED',
      canCancel: false,
      cancellation: { refundDuePaise: 0 },
    });
    expect(
      await ctx.prisma.orderCancellation.findUniqueOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ stage: 'BEFORE_ACCEPT', cancelledByType: 'CUSTOMER' });

    ({ customer, order } = await placed());
    await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
      prepTimeMinutes: 20,
      version: 0,
    });
    res = await call('POST', `/v1/customer/orders/${order.id}/cancel`, customer, {
      reasonCode: 'TAKING_TOO_LONG',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/contact support/);
    const other = await newCustomer();
    expect((await call('GET', `/v1/customer/orders/${order.id}`, other)).statusCode).toBe(404);
  });

  it('accept and cancel at the same moment: exactly one wins', async () => {
    const { customer, order } = await placed();
    const [accept, cancel] = await Promise.all([
      asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
        prepTimeMinutes: 20,
        version: 0,
      }),
      call('POST', `/v1/customer/orders/${order.id}/cancel`, customer, { reasonCode: 'CHANGED_MIND' }),
    ]);
    const wins = [accept, cancel].filter((r) => r.statusCode === 200);
    expect(wins).toHaveLength(1);
    const row = await orderRow(order.id);
    expect(['RESTAURANT_ACCEPTED', 'CUSTOMER_CANCELLED']).toContain(row.status);
    expect(await ctx.prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(3);
  });
});

describe('acceptance timeout (D-68)', () => {
  const jobs = () => createOrderJobs({ prisma: ctx.prisma, clock: ctx.clock });
  const run = async (orderId, stage = 'TIMEOUT') =>
    jobs()['order.acceptance_timeout']({
      id: randomUUID(),
      eventType: 'order.acceptance_timeout',
      payload: { orderId, stage },
    });

  it('escalates to operations, then auto-rejects after the grace period; a late job is harmless', async () => {
    const { order } = await placed();
    await run(order.id);
    let row = await orderRow(order.id);
    expect(row).toMatchObject({
      status: 'PLACED',
      needsAttention: true,
      attentionReason: 'RESTAURANT_NOT_RESPONDING',
    });
    const grace = await ctx.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: order.id,
        eventType: 'order.acceptance_timeout',
        payload: { path: ['stage'], equals: 'ESCALATED' },
      },
    });
    expect(grace.availableAt.getTime() - ctx.clock.now().getTime()).toBeGreaterThan(110_000);
    const list = (await asAdmin('GET', '/v1/admin/orders?needsAttention=true')).json();
    expect(list.items.map((o) => o.id)).toContain(order.id);
    await run(order.id, 'ESCALATED');
    row = await orderRow(order.id);
    expect(row).toMatchObject({ status: 'RESTAURANT_REJECTED', needsAttention: false });
    await run(order.id, 'ESCALATED'); // repeated job: no change
    expect((await orderRow(order.id)).version).toBe(row.version);
  });

  it('does nothing once the restaurant has accepted; AUTO_ACCEPT uses the branch preparation time', async () => {
    const { order } = await placed();
    await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
      prepTimeMinutes: 25,
      version: 0,
    });
    await run(order.id);
    expect(await orderRow(order.id)).toMatchObject({
      status: 'RESTAURANT_ACCEPTED',
      needsAttention: false,
      prepTimeMinutes: 25,
    });

    await ctx.prisma.setting.create({
      data: {
        key: 'orders.restaurantAcceptance',
        scope: 'RESTAURANT',
        scopeRefId: pizza.id,
        value: { timeoutSec: 180, fallback: 'AUTO_ACCEPT', escalationGraceSec: 120 },
      },
    });
    const { order: second } = await placed();
    await run(second.id);
    const row = await orderRow(second.id);
    await ctx.prisma.setting.deleteMany({
      where: { key: 'orders.restaurantAcceptance', scope: 'RESTAURANT' },
    });
    expect(row).toMatchObject({ status: 'RESTAURANT_ACCEPTED', prepTimeMinutes: 20 });
  });
});

describe('admin orders', () => {
  it('lists with filters and search, shows the full order, cancels with an audited override', async () => {
    const { order } = await placed(await newCustomer('Ravi Shah'));
    let res = await asAdmin('GET', `/v1/admin/orders?q=${order.orderNumber}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({
      id: order.id,
      restaurant: { name: 'Pizza Point' },
      customerName: 'Ravi Shah',
      city: 'Unjha',
    });
    res = await asAdmin(
      'GET',
      `/v1/admin/orders?status=CUSTOMER_CANCELLED,RESTAURANT_REJECTED&restaurantId=${pizza.id}`,
    );
    expect(
      res.json().items.every((o) => ['CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED'].includes(o.status)),
    ).toBe(true);

    res = await asAdmin('GET', `/v1/admin/orders/${order.id}`);
    const detail = res.json();
    expect(detail).toMatchObject({
      pricingSnapshot: { totalPayablePaise: 34_100 },
      permissions: { cancel: true },
      cancelPreview: { possible: true },
    });
    expect(detail.customer.phone).toMatch(/^\+91\d{10}$/); // super admin holds customers.pii
    expect(detail.pricingSnapshot.engineOutput).toBeUndefined();

    const ops = (await adminWithRole(ctx, 'OPERATIONS')).accessToken;
    const masked = (await asAdmin('GET', `/v1/admin/orders/${order.id}`, undefined, ops)).json();
    expect(masked.customer.masked).toBe(true);
    expect(masked.address.masked).toBe(true);

    await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
      prepTimeMinutes: 20,
      version: 0,
    });
    res = await asAdmin('POST', `/v1/admin/orders/${order.id}/cancel`, {
      reasonCode: 'CUSTOMER_REQUEST',
      reasonText: 'Customer called support',
      version: 1,
      override: { customerFeePaise: 0, restaurantCompensationPaise: 5_000, riderCompensationPaise: 0 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ADMIN_CANCELLED',
      cancellation: { isAdminOverride: true, restaurantCompensationPaise: 5_000, platformLossPaise: 5_000 },
    });
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'order.cancel_override', entityId: order.id },
    });
    expect(log).not.toBeNull();
    res = await asAdmin('POST', `/v1/admin/orders/${order.id}/notes`, { body: 'Called restaurant' });
    expect(res.statusCode).toBe(201);
  });

  it('city-scoped admins only see their cities; support cannot use an admin-only route from a mobile app', async () => {
    const mehsana = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'mehsana' } });
    const scoped = (await adminWithRole(ctx, 'CITY_MANAGER', { cityId: mehsana.id })).accessToken;
    const res = await asAdmin('GET', '/v1/admin/orders', undefined, scoped);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
    const { order } = await placed();
    expect((await asAdmin('GET', `/v1/admin/orders/${order.id}`, undefined, scoped)).statusCode).toBe(404);
  });
});

describe('notifications (D-69)', () => {
  it('creates rows from templates, pushes to registered devices, never twice for one event', async () => {
    const { customer, order } = await placed();
    await ctx.prisma.device.create({
      data: {
        userId: customer.me.user.id,
        appId: 'CUSTOMER',
        platform: 'IOS',
        pushToken: 'ExponentPushToken[test-1]',
      },
    });
    await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
      prepTimeMinutes: 20,
      version: 0,
    });
    const push = createConsolePushProvider();
    const handlers = createNotificationDispatcher({ prisma: ctx.prisma, push, clock: ctx.clock });
    const events = await ctx.prisma.outboxEvent.findMany({
      where: { aggregateId: order.id, eventType: { in: ['order.placed', 'order.accepted'] } },
    });
    for (const e of events) await handlers[e.eventType](e);
    for (const e of events) await handlers[e.eventType](e); // retried: no duplicates
    const rows = await ctx.prisma.notification.findMany({ where: { userId: customer.me.user.id } });
    expect(rows.map((r) => [r.event, r.status]).sort()).toEqual([
      ['order.accepted', 'SENT'],
      ['order.placed', 'SENT'],
    ]);
    expect(push.sent.map((m) => m.title).sort()).toEqual(['Order accepted', 'Order placed']);
    expect(push.sent.find((m) => m.title === 'Order accepted').body).toBe(
      'Pizza Point accepted your order. Ready in about 20 minutes.',
    );
    // Restaurant members without a registered device: recorded, not pushed.
    const restaurantRows = await ctx.prisma.notification.findMany({
      where: { appId: 'RESTAURANT', data: { path: ['orderId'], equals: order.id } },
    });
    expect(restaurantRows.length).toBeGreaterThan(0);
    expect(restaurantRows.every((r) => r.status === 'SKIPPED')).toBe(true);
    const mine = (await call('GET', '/v1/me/notifications', customer)).json();
    expect(mine.items.map((n) => n.title)).toContain('Order accepted');
  });

  it('templates are editable by notifications.manage only, and audited', async () => {
    const list = (await asAdmin('GET', '/v1/admin/notification-templates')).json();
    const t = list.items.find((x) => x.event === 'order.ready' && x.appId === 'CUSTOMER');
    let res = await asAdmin('PATCH', `/v1/admin/notification-templates/${t.id}`, {
      title: 'Ready!',
      body: 'Order {{orderNumber}} is ready.',
      isActive: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
    res = await asAdmin(
      'PATCH',
      `/v1/admin/notification-templates/${t.id}`,
      { title: 'x', body: 'y', isActive: true },
      support,
    );
    expect(res.statusCode).toBe(403);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'notification_template.update', entityId: t.id } }),
    ).toBe(1);
  });
});

describe('realtime (D-62)', () => {
  it('an order change reaches the restaurant and the customer over Socket.IO, only after commit; outsiders are refused', async () => {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const rt = await attachRealtime(ctx.app, {
      databaseUrl: ctx.env.DATABASE_URL,
      secret: ctx.env.JWT_ACCESS_SECRET,
    });
    const url = `http://127.0.0.1:${ctx.app.server.address().port}`;
    const open = (auth) =>
      new Promise((resolve, reject) => {
        const s = connect(url, {
          path: '/v1/realtime',
          auth,
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => resolve(s));
        s.on('connect_error', (e) => reject(e));
      });
    const sockets = [];
    try {
      await expect(open({ appId: 'CUSTOMER', token: 'nope' })).rejects.toThrow('UNAUTHENTICATED');
      const { customer, order } = await placed();
      const cs = await open({ appId: 'CUSTOMER', token: customer.accessToken });
      const rs = await open({ appId: 'RESTAURANT', token: owner.accessToken });
      const outsider = await member(
        'OWNER',
        (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'demo-kitchen' } })).id,
      );
      const os = await open({ appId: 'RESTAURANT', token: outsider.accessToken });
      sockets.push(cs, rs, os);
      expect(await rs.emitWithAck('subscribe', { restaurantId: pizza.id })).toEqual({ ok: true });
      expect(await os.emitWithAck('subscribe', { restaurantId: pizza.id })).toEqual({ ok: false });
      const got = { customer: [], restaurant: [], outsider: [] };
      cs.on('order.updated', (m) => got.customer.push(m));
      rs.on('order.updated', (m) => got.restaurant.push(m));
      os.on('order.updated', (m) => got.outsider.push(m));
      // A refused change (stale version) must not notify anyone.
      await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
        prepTimeMinutes: 20,
        version: 7,
      });
      await asRestaurant('POST', `/v1/restaurant/orders/${order.id}/accept`, owner, {
        prepTimeMinutes: 20,
        version: 0,
      });
      await expect.poll(() => got.customer.length, { timeout: 5000 }).toBe(1);
      await expect.poll(() => got.restaurant.length, { timeout: 5000 }).toBe(1);
      expect(got.customer[0]).toEqual({
        orderId: order.id,
        event: 'order.accepted',
        status: 'RESTAURANT_ACCEPTED',
        restaurantStatus: 'ACCEPTED',
        deliveryStatus: 'NOT_STARTED',
      });
      expect(got.outsider).toEqual([]);
    } finally {
      for (const s of sockets) s.close();
      await rt.close();
    }
  });
});
