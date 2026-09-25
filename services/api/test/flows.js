// Real order flows through the API for tests (checkout → restaurant → dispatch → delivery), shared by the
// Phase 8 and Phase 9 test files.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { bearer, mobileLogin, TEST_FIELD_KEY } from './helpers.js';
import { deliveryCode } from '../src/modules/dispatch/otp.js';

const HERE = { lat: 23.805, lng: 72.39 };

/**
 * @param {any} ctx the test app
 * @param {{ owner?: any }} [o] an existing restaurant-owner session (a second sign-in would hit the OTP cooldown)
 */
export function createFlows(ctx, o = {}) {
  let seq = 0;
  let pizza;
  let branch;
  let owner = o.owner;
  const setup = async () => {
    pizza ??= await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: 'pizza-point-unjha' },
      include: { branches: true },
    });
    branch = pizza.branches[0];
    owner ??= await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
    return { pizza, branch, owner };
  };
  const call = (method, url, token, payload, app = 'RIDER', extra = {}) =>
    ctx.app.inject({
      method,
      url,
      headers: bearer(token.accessToken ?? token, app, extra),
      ...(payload !== undefined ? { payload } : {}),
    });
  const orderRow = (id) => ctx.prisma.order.findUniqueOrThrow({ where: { id } });

  async function activeRider() {
    await setup();
    const phone = `+9196700${String(++seq).padStart(5, '0')}`;
    const user = await ctx.prisma.user.create({
      data: { phone, name: 'Mohan Lal', identities: { create: { provider: 'PHONE_OTP', subject: phone } } },
    });
    const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
    const rider = await ctx.prisma.rider.create({
      data: {
        userId: user.id,
        cityId: unjha.id,
        onboardingStatus: 'ACTIVE',
        vehicles: { create: { type: 'MOTORCYCLE', registrationNumber: 'GJ02AB0001' } },
      },
    });
    const session = await mobileLogin(ctx, 'RIDER', phone);
    await ctx.prisma.riderAvailability.updateMany({ data: { isOnline: false } });
    await call('POST', '/v1/rider/status', session, { online: true });
    await call('POST', '/v1/rider/locations', session, {
      points: [
        {
          lat: Number(branch.lat) + 0.002,
          lng: Number(branch.lng),
          recordedAt: ctx.clock.now().toISOString(),
        },
      ],
    });
    return { ...session, rider };
  }

  /** Checkout → accept → dispatch → the full trip → DELIVERED, through the real API. */
  async function deliveredOrder({ method = 'COD', rider } = {}) {
    await setup();
    const r = rider ?? (await activeRider());
    const c = await mobileLogin(ctx, 'CUSTOMER', `96${String(Date.now() + ++seq).slice(-8)}`);
    const addr = (
      await call(
        'POST',
        '/v1/customer/addresses',
        c,
        { label: 'Home', line1: '12 Station Road', ...HERE },
        'CUSTOMER',
      )
    ).json();
    const bread = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: pizza.id, name: 'Garlic Bread' },
    });
    const body = {
      restaurantId: pizza.id,
      addressId: addr.id,
      lines: [{ key: 'a', productId: bread.id, quantity: 2 }],
      tipPaise: 2_000,
    };
    const q = (await call('POST', '/v1/customer/cart/quote', c, body, 'CUSTOMER')).json();
    const res = await call(
      'POST',
      '/v1/orders',
      c,
      { ...body, paymentMethod: method, expectedTotalPaise: q.bill.totalPayablePaise },
      'CUSTOMER',
      { 'idempotency-key': randomUUID() },
    );
    expect(res.statusCode, res.body).toBe(201);
    let order = res.json().order;
    if (method !== 'COD') {
      const p = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      const hook = /** @type {any} */ (ctx.app.services.payments.provider).simulate(p.providerOrderId, {
        outcome: 'success',
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/webhooks/payments/fake',
        headers: { 'content-type': 'application/json', ...hook.headers },
        payload: hook.rawBody,
      });
    }
    let v = (await orderRow(order.id)).version;
    await call(
      'POST',
      `/v1/restaurant/orders/${order.id}/accept`,
      owner,
      { prepTimeMinutes: 15, version: v },
      'RESTAURANT',
    );
    await ctx.app.services.dispatch.handlers['order.accepted']({
      id: randomUUID(),
      eventType: 'order.accepted',
      payload: { orderId: order.id },
    });
    const work = (await call('GET', '/v1/rider/work', r)).json();
    expect(work.offer, 'the rider got the offer').toBeTruthy();
    await call('POST', `/v1/rider/offers/${work.offer.assignmentId}/accept`, r);
    await call('POST', `/v1/rider/trips/${order.id}/at-restaurant`, r);
    v = (await orderRow(order.id)).version;
    await call('POST', `/v1/restaurant/orders/${order.id}/ready`, owner, { version: v }, 'RESTAURANT');
    await call('POST', `/v1/rider/trips/${order.id}/picked-up`, r, {
      orderDigits: order.orderNumber.slice(-4),
    });
    await call('POST', `/v1/rider/trips/${order.id}/arrived`, r);
    const done = await call('POST', `/v1/rider/trips/${order.id}/delivered`, r, {
      otp: deliveryCode(TEST_FIELD_KEY, order.id),
      ...(method === 'COD' ? { codCollectedPaise: order.totalPayablePaise } : {}),
    });
    expect(done.statusCode, done.body).toBe(200);
    order = await orderRow(order.id);
    expect(order.status).toBe('DELIVERED');
    return { order, customer: c, rider: r };
  }

  /** A placed (not accepted) order by a new customer. */
  async function placedOrder({ method = 'COD', quantity = 1 } = {}) {
    await setup();
    const c = await mobileLogin(ctx, 'CUSTOMER', `93${String(Date.now() + ++seq).slice(-8)}`);
    const addr = (
      await call('POST', '/v1/customer/addresses', c, { label: 'Home', line1: '5 Road', ...HERE }, 'CUSTOMER')
    ).json();
    const bread = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: pizza.id, name: 'Garlic Bread' },
    });
    const body = {
      restaurantId: pizza.id,
      addressId: addr.id,
      lines: [{ key: 'a', productId: bread.id, quantity }],
    };
    const q = (await call('POST', '/v1/customer/cart/quote', c, body, 'CUSTOMER')).json();
    const res = await call(
      'POST',
      '/v1/orders',
      c,
      { ...body, paymentMethod: method, expectedTotalPaise: q.bill.totalPayablePaise },
      'CUSTOMER',
      { 'idempotency-key': randomUUID() },
    );
    expect(res.statusCode, res.body).toBe(201);
    return { order: res.json().order, customer: c };
  }

  return { setup, call, orderRow, activeRider, deliveredOrder, placedOrder };
}
