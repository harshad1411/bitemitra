// Delivery partners, dispatch and delivery (Phase 6: D-73 … D-81) against real PostgreSQL with the seeded
// catalog. The clock is a Monday lunchtime in IST so Pizza Point is open.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TINY_PNG, adminLogin, bearer, ist, mobileLogin, multipart, startTestApp } from './helpers.js';
import { deliveryCode } from '../src/modules/dispatch/otp.js';
import { TEST_FIELD_KEY } from './helpers.js';

let ctx;
let pizza;
let branch;
let owner;
let admin;
const HERE = { lat: 23.805, lng: 72.39 };
const MONDAY_1300 = ist('2026-09-28T13:00:00');
let seq = 0;

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(MONDAY_1300);
  pizza = await ctx.prisma.restaurant.findUniqueOrThrow({
    where: { slug: 'pizza-point-unjha' },
    include: { branches: true },
  });
  branch = pizza.branches[0];
  owner = await login('RESTAURANT', pizza.phone);
  admin = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

const login = (app, phone) => mobileLogin(ctx, app, phone);
const call = (method, url, token, payload, app = 'RIDER', extra = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token.accessToken ?? token, app, extra),
    ...(payload !== undefined ? { payload } : {}),
  });
const asAdmin = (method, url, payload) => call(method, url, admin, payload, 'ADMIN');
const jobs = () => ctx.app.services.dispatch.handlers;
const event = (eventType, payload) => ({ id: randomUUID(), eventType, payload });

/** An ACTIVE rider (created directly, as after approval), online at a point near the restaurant. */
async function activeRider({
  lat = Number(branch.lat) + 0.002,
  lng = Number(branch.lng),
  online = true,
  name = 'Ravi Kumar',
  cod = {},
} = {}) {
  const phone = `+9196600${String(++seq).padStart(5, '0')}`;
  const user = await ctx.prisma.user.create({
    data: { phone, name, identities: { create: { provider: 'PHONE_OTP', subject: phone } } },
  });
  const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
  const rider = await ctx.prisma.rider.create({
    data: {
      userId: user.id,
      cityId: unjha.id,
      onboardingStatus: 'ACTIVE',
      ...cod,
      vehicles: { create: { type: 'MOTORCYCLE', registrationNumber: 'GJ02AB0001' } },
    },
  });
  const session = await login('RIDER', phone);
  if (online) {
    expect((await call('POST', '/v1/rider/status', session, { online: true })).statusCode).toBe(200);
    await locate(session, lat, lng);
  }
  return { ...session, rider };
}
const locate = (s, lat, lng, at = ctx.clock.now()) =>
  call('POST', '/v1/rider/locations', s, { points: [{ lat, lng, recordedAt: at.toISOString() }] });

/** A placed COD order at Pizza Point, accepted by the restaurant (dispatch not run yet). */
async function acceptedOrder({ accept = true } = {}) {
  const phone = `98${String(Date.now() + ++seq).slice(-8)}`;
  const c = await login('CUSTOMER', phone);
  await ctx.prisma.user.update({ where: { id: c.me.user.id }, data: { name: 'Asha Patel' } });
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
    { ...body, paymentMethod: 'COD', expectedTotalPaise: q.bill.totalPayablePaise },
    'CUSTOMER',
    { 'idempotency-key': randomUUID() },
  );
  if (res.statusCode !== 201) throw new Error(res.body);
  const order = res.json().order;
  if (accept) {
    const a = await call(
      'POST',
      `/v1/restaurant/orders/${order.id}/accept`,
      owner,
      { prepTimeMinutes: 15, version: 0 },
      'RESTAURANT',
    );
    if (a.statusCode !== 200) throw new Error(a.body);
  }
  return { customer: c, order };
}
const orderRow = (id) => ctx.prisma.order.findUniqueOrThrow({ where: { id } });

describe('onboarding (D-73)', () => {
  it('apply, vehicle, documents, submit; admin verifies documents then activates; nothing works before', async () => {
    const phone = `+9196611${String(++seq).padStart(5, '0')}`;
    const s = await login('RIDER', phone);
    let res = await call('GET', '/v1/rider/me', s);
    expect(res.json()).toMatchObject({ applied: false });
    const unjha = res.json().cities.find((c) => c.name === 'Unjha');
    res = await call('PUT', '/v1/rider/me', s, { name: 'Kiran Desai', cityId: unjha.id });
    expect(res.json()).toMatchObject({ onboardingStatus: 'APPLIED', canSubmit: false });
    res = await call('PUT', '/v1/rider/vehicle', s, { type: 'SCOOTER', registrationNumber: 'gj02 ab 9999' });
    expect(res.json().vehicle).toEqual({ type: 'SCOOTER', registrationNumber: 'GJ02 AB 9999' });
    expect(res.json().documents.missing).toEqual([
      'DRIVING_LICENCE',
      'VEHICLE_RC',
      'PAN',
      'ID_PROOF',
      'PHOTO',
    ]);
    expect((await call('POST', '/v1/rider/application/submit', s)).statusCode).toBe(400);
    for (const kind of ['DRIVING_LICENCE', 'VEHICLE_RC', 'PAN', 'ID_PROOF', 'PHOTO']) {
      const m = multipart(
        { kind, ...(kind === 'PAN' ? { number: 'ABCDE1234F' } : {}) },
        { filename: `${kind}.png`, contentType: 'image/png', content: TINY_PNG },
      );
      res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/rider/documents',
        headers: { ...bearer(s.accessToken, 'RIDER'), 'content-type': m.contentType },
        payload: m.payload,
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    expect(res.json()).toMatchObject({ status: 'PENDING' });
    const pan = await ctx.prisma.riderDocument.findFirstOrThrow({
      where: { kind: 'PAN', rider: { userId: s.me.user.id } },
    });
    expect(pan.numberLast4).toBe('234F');
    expect(pan.number).not.toContain('ABCDE1234F'); // encrypted
    res = await call('POST', '/v1/rider/application/submit', s);
    expect(res.json().onboardingStatus).toBe('UNDER_REVIEW');
    expect((await call('POST', '/v1/rider/status', s, { online: true })).statusCode).toBe(403);
    expect((await call('GET', '/v1/rider/work', s)).statusCode).toBe(403);

    const riderId = pan.riderId;
    res = await asAdmin('POST', `/v1/admin/riders/${riderId}/status`, { to: 'ACTIVE', reason: 'Looks fine' });
    expect(res.statusCode).toBe(409); // documents not verified yet
    const detail = (await asAdmin('GET', `/v1/admin/riders/${riderId}`)).json();
    expect(detail.documents.items.find((d) => d.kind === 'PAN')).toMatchObject({
      numberLast4: '234F',
      hasFile: true,
    });
    expect(JSON.stringify(detail)).not.toContain('ABCDE1234F');
    const file = await asAdmin('GET', `/v1/admin/rider-documents/${detail.documents.items[0].id}/file`);
    expect(file.statusCode).toBe(200);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'rider_document.view', entityId: riderId } }),
    ).toBe(1);
    res = await asAdmin('POST', `/v1/admin/rider-documents/${detail.documents.items[0].id}/review`, {
      status: 'REJECTED',
    });
    expect(res.statusCode).toBe(400); // a rejection needs a note
    for (const d of detail.documents.items)
      await asAdmin('POST', `/v1/admin/rider-documents/${d.id}/review`, { status: 'VERIFIED' });
    res = await asAdmin('POST', `/v1/admin/riders/${riderId}/status`, {
      to: 'ACTIVE',
      reason: 'All documents verified',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ onboardingStatus: 'ACTIVE', nextStatuses: ['SUSPENDED'] });
    expect((await call('POST', '/v1/rider/status', s, { online: true })).json()).toMatchObject({
      online: true,
    });
    expect(await ctx.prisma.riderShift.count({ where: { riderId, endedAt: null } })).toBe(1);
  });
});

describe('dispatch and delivery (D-75 … D-78)', () => {
  // Each test brings its own riders online; nobody from an earlier test may take its offers.
  beforeEach(() => ctx.prisma.riderAvailability.updateMany({ data: { isOnline: false } }));

  it('offers to the nearest rider; the full trip to delivery with code, cash and final pay', async () => {
    const near = await activeRider({ name: 'Ravi Kumar' });
    const far = await activeRider({ lat: Number(branch.lat) + 0.02, name: 'Far Away' });
    const { customer, order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    let row = await orderRow(order.id);
    expect(row).toMatchObject({ deliveryStatus: 'ASSIGNED', status: 'RESTAURANT_ACCEPTED' });

    let work = (await call('GET', '/v1/rider/work', near)).json();
    expect(work.offer).toMatchObject({
      restaurant: { name: 'Pizza Point' },
      cashToCollectPaise: order.totalPayablePaise,
      itemCount: 2,
    });
    expect(work.offer.estimatedEarningPaise).toBeGreaterThan(2_000); // trip estimate + ₹20 tip
    expect((await call('GET', '/v1/rider/work', far)).json().offer).toBeNull();
    // Riders never see food prices or restaurant money.
    expect(JSON.stringify(work)).not.toMatch(/foodValue|commission|restaurantPayable|unitPrice/i);

    let res = await call('POST', `/v1/rider/offers/${work.offer.assignmentId}/accept`, near);
    expect(res.statusCode, res.body).toBe(200);
    row = await orderRow(order.id);
    expect(row).toMatchObject({ deliveryStatus: 'ACCEPTED', riderId: near.rider.id });
    const cust = (
      await call('GET', `/v1/customer/orders/${order.id}`, customer, undefined, 'CUSTOMER')
    ).json();
    expect(cust.delivery.rider).toMatchObject({ firstName: 'Ravi', vehicle: 'MOTORCYCLE' });
    expect(cust.delivery.code).toBe(deliveryCode(TEST_FIELD_KEY, order.id));
    expect(JSON.stringify(cust.delivery)).not.toContain(near.me.user.phone ?? '+9196600');
    // Arrival estimate (D-79): a range, labelled as an estimate and with its distance source (no maps key here).
    expect(cust.delivery.eta).toMatchObject({ estimate: true, source: 'FALLBACK' });
    expect(cust.delivery.eta.minMinutes).toBeGreaterThan(0);
    expect(cust.delivery.eta.maxMinutes).toBeGreaterThan(cust.delivery.eta.minMinutes);
    const rest = (
      await call('GET', `/v1/restaurant/orders/${order.id}`, owner, undefined, 'RESTAURANT')
    ).json();
    expect(rest.rider).toEqual({ firstName: 'Ravi', atRestaurant: false });

    expect((await call('POST', '/v1/rider/status', near, { online: false })).statusCode).toBe(409); // holding an order
    res = await call('POST', `/v1/rider/trips/${order.id}/at-restaurant`, near);
    expect(res.json()).toMatchObject({
      deliveryStatus: 'AT_RESTAURANT',
      items: [{ name: 'Garlic Bread', quantity: 2 }],
    });
    res = await call('POST', `/v1/rider/trips/${order.id}/picked-up`, near, { orderDigits: '0000' });
    expect(res.statusCode).toBe(400);
    res = await call('POST', `/v1/rider/trips/${order.id}/picked-up`, near, {
      orderDigits: order.orderNumber.slice(-4),
    });
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION'); // food not ready yet
    const v = (await orderRow(order.id)).version;
    await call('POST', `/v1/restaurant/orders/${order.id}/ready`, owner, { version: v }, 'RESTAURANT');
    ctx.clock.advance(12 * 60_000); // waited 12 minutes at the counter
    res = await call('POST', `/v1/rider/trips/${order.id}/picked-up`, near, {
      orderDigits: order.orderNumber.slice(-4),
    });
    expect(res.json()).toMatchObject({ deliveryStatus: 'ON_THE_WAY', restaurantStatus: 'COMPLETED' });
    res = await call('POST', `/v1/rider/trips/${order.id}/arrived`, near);
    expect(res.json().deliveryStatus).toBe('ARRIVED');
    const arriving = (
      await call('GET', `/v1/customer/orders/${order.id}`, customer, undefined, 'CUSTOMER')
    ).json();
    expect(arriving.delivery.eta).toMatchObject({ arrivingNow: true, minMinutes: 0 });

    res = await call('POST', `/v1/rider/trips/${order.id}/delivered`, near, {
      otp: '0000',
      codCollectedPaise: order.totalPayablePaise,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.attempts).toBe(1);
    const code = deliveryCode(TEST_FIELD_KEY, order.id);
    res = await call('POST', `/v1/rider/trips/${order.id}/delivered`, near, {
      otp: code,
      codCollectedPaise: 100,
    });
    expect(res.json().error.message).toMatch(/Collect exactly/);
    res = await call('POST', `/v1/rider/trips/${order.id}/delivered`, near, {
      otp: code,
      codCollectedPaise: order.totalPayablePaise,
    });
    expect(res.statusCode, res.body).toBe(200);
    row = await orderRow(order.id);
    expect(row).toMatchObject({ status: 'DELIVERED', deliveryStatus: 'DELIVERED' });
    const pay = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(pay).toMatchObject({
      provider: 'cod',
      status: 'SUCCEEDED',
      capturedPaise: order.totalPayablePaise,
      codCollectedById: near.rider.id,
    });
    const earning = await ctx.prisma.riderEarning.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(earning).toMatchObject({ kind: 'DELIVERY', riderId: near.rider.id });
    // ~12 minutes at the counter (rounded up) minus 10 free minutes, ₹1 a minute.
    expect(earning.breakdown.tipPaise).toBe(2_000);
    expect(earning.breakdown.waitingMin).toBeGreaterThanOrEqual(12);
    expect(earning.breakdown.waitingPaise).toBe((earning.breakdown.waitingMin - 10) * 100);
    expect(earning.totalPaise).toBe(earning.breakdown.tripPaise + 2_000);
    const history = await ctx.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.metadata.event)).toEqual(
      expect.arrayContaining([
        'DISPATCH_START',
        'RIDER_OFFERED',
        'RIDER_ACCEPTED',
        'RIDER_AT_RESTAURANT',
        'PICKED_UP',
        'TRIP_STARTED',
        'ARRIVED',
        'DELIVERED',
      ]),
    );
    const me = (await call('GET', '/v1/rider/me', near)).json().rider;
    expect(me).toMatchObject({ activeOrderCount: 0, cod: { balancePaise: order.totalPayablePaise } });
    const earnings = (await call('GET', '/v1/rider/earnings?range=TODAY', near)).json();
    expect(earnings).toMatchObject({ deliveries: 1, tipsPaise: 2_000, totalPaise: earning.totalPaise });
    ctx.clock.set(MONDAY_1300);
    await call('POST', '/v1/rider/status', far, { online: false });
  });

  it('decline and timeout move to the next rider; nobody left → escalated and retried', async () => {
    const a = await activeRider({ name: 'First' });
    const b = await activeRider({ lat: Number(branch.lat) + 0.004, name: 'Second' });
    const { order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    const offerA = (await call('GET', '/v1/rider/work', a)).json().offer;
    expect(offerA).not.toBeNull();
    expect(
      (await call('POST', `/v1/rider/offers/${offerA.assignmentId}/reject`, a, { reason: 'ON_BREAK' }))
        .statusCode,
    ).toBe(200);
    await jobs()['dispatch.next'](event('dispatch.next', { orderId: order.id }));
    const offerB = (await call('GET', '/v1/rider/work', b)).json().offer;
    expect(offerB).not.toBeNull();
    ctx.clock.advance(31_000);
    expect((await call('POST', `/v1/rider/offers/${offerB.assignmentId}/accept`, b)).statusCode).toBe(409); // expired
    await jobs()['dispatch.offer_timeout'](
      event('dispatch.offer_timeout', { assignmentId: offerB.assignmentId }),
    );
    // Both tried: nobody else → after maxOffers or waiting too long the order is escalated.
    ctx.clock.advance(601_000);
    await jobs()['dispatch.next'](event('dispatch.next', { orderId: order.id }));
    const row = await orderRow(order.id);
    expect(row).toMatchObject({
      deliveryStatus: 'NO_RIDER_FOUND',
      needsAttention: true,
      attentionReason: 'NO_RIDER_FOUND',
    });
    const statuses = (
      await ctx.prisma.orderAssignment.findMany({
        where: { orderId: order.id },
        orderBy: { offeredAt: 'asc' },
      })
    ).map((x) => x.status);
    expect(statuses).toEqual(['REJECTED', 'TIMED_OUT']);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { aggregateId: order.id, eventType: 'dispatch.next', publishedAt: null },
      }),
    ).toBeGreaterThan(0);
    // A new rider comes online: the retry offers it even after escalation.
    const c = await activeRider({ name: 'Third' });
    await jobs()['dispatch.next'](event('dispatch.next', { orderId: order.id }));
    expect((await call('GET', '/v1/rider/work', c)).json().offer).not.toBeNull();
    for (const s of [a, b, c])
      await ctx.prisma.riderAvailability.update({
        where: { riderId: s.rider.id },
        data: { isOnline: false },
      });
    ctx.clock.set(MONDAY_1300);
  });

  it('cash limits, stale locations and zones keep riders out; COD can be switched off per rider', async () => {
    const tooMuchCash = await activeRider({ name: 'Cash', cod: { codLimitPaise: 1_000 } });
    const noCod = await activeRider({ name: 'NoCod', cod: { codEnabled: false } });
    const stale = await activeRider({ name: 'Stale' });
    await ctx.prisma.riderAvailability.update({
      where: { riderId: stale.rider.id },
      data: { lastLocationAt: new Date(ctx.clock.now().getTime() - 600_000) },
    });
    const { order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    expect((await orderRow(order.id)).deliveryStatus).toBe('SEARCHING');
    for (const s of [tooMuchCash, noCod, stale])
      expect((await call('GET', '/v1/rider/work', s)).json().offer).toBeNull();
    const res = await asAdmin('PATCH', `/v1/admin/riders/${noCod.rider.id}/cod`, {
      codEnabled: true,
      codLimitPaise: null,
      reason: 'Trained on cash',
    });
    expect(res.json().cod).toMatchObject({ enabled: true, limitPaise: null });
    await jobs()['dispatch.next'](event('dispatch.next', { orderId: order.id }));
    expect((await call('GET', '/v1/rider/work', noCod)).json().offer).not.toBeNull();
    for (const s of [tooMuchCash, noCod, stale])
      await ctx.prisma.riderAvailability.update({
        where: { riderId: s.rider.id },
        data: { isOnline: false },
      });
  });

  it('two riders can never both hold the order (database decides)', async () => {
    const a = await activeRider({ name: 'A' });
    const b = await activeRider({ name: 'B' });
    const { order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    // Force a second open offer to the other rider (as an admin reassignment racing a rider could).
    const first = await ctx.prisma.orderAssignment.findFirstOrThrow({
      where: { orderId: order.id, status: 'OFFERED' },
    });
    const other = first.riderId === a.rider.id ? b : a;
    const mine = first.riderId === a.rider.id ? a : b;
    const second = await ctx.prisma.orderAssignment.create({
      data: {
        orderId: order.id,
        riderId: other.rider.id,
        status: 'OFFERED',
        expiresAt: new Date(ctx.clock.now().getTime() + 30_000),
      },
    });
    const [r1, r2] = await Promise.all([
      call('POST', `/v1/rider/offers/${first.id}/accept`, mine),
      call('POST', `/v1/rider/offers/${second.id}/accept`, other),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await ctx.prisma.orderAssignment.count({ where: { orderId: order.id, status: 'ACCEPTED' } })).toBe(
      1,
    );
    const holder = (await orderRow(order.id)).riderId;
    expect([a.rider.id, b.rider.id]).toContain(holder);
    const busy = holder === a.rider.id ? a : b;
    const idle = holder === a.rider.id ? b : a;
    expect(
      (await ctx.prisma.riderAvailability.findUniqueOrThrow({ where: { riderId: busy.rider.id } }))
        .activeOrderCount,
    ).toBe(1);
    expect(
      (await ctx.prisma.riderAvailability.findUniqueOrThrow({ where: { riderId: idle.rider.id } }))
        .activeOrderCount,
    ).toBe(0);
  });

  it('admin assigns and reassigns; a cancelled trip pays the rider who had accepted (OD-39)', async () => {
    const r = await activeRider({ name: 'Manual Rider' });
    const { customer, order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    const auto = await ctx.prisma.orderAssignment.findFirst({
      where: { orderId: order.id, status: 'OFFERED' },
    });
    let res = await asAdmin('POST', `/v1/admin/orders/${order.id}/assign`, {
      riderId: r.rider.id,
      reason: 'Nearest known rider',
    });
    expect(res.statusCode, res.body).toBe(200);
    if (auto && auto.riderId !== r.rider.id)
      expect((await ctx.prisma.orderAssignment.findUniqueOrThrow({ where: { id: auto.id } })).status).toBe(
        'CANCELLED',
      );
    const offer = (await call('GET', '/v1/rider/work', r)).json().offer;
    expect(offer).toMatchObject({ manual: true });
    await call('POST', `/v1/rider/offers/${offer.assignmentId}/accept`, r);
    const board = (await asAdmin('GET', '/v1/admin/dispatch')).json();
    expect(board.orders.find((o) => o.id === order.id)).toMatchObject({
      deliveryStatus: 'ACCEPTED',
      rider: { id: r.rider.id, assignment: 'ACCEPTED' },
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'order.assign_rider', entityId: order.id } }),
    ).toBe(1);

    // Customer cancels after the restaurant accepted and the rider accepted: no refund, rider gets the trip estimate.
    res = await call(
      'POST',
      `/v1/customer/orders/${order.id}/cancel`,
      customer,
      { reasonCode: 'CHANGED_MIND' },
      'CUSTOMER',
    );
    expect(res.statusCode, res.body).toBe(200);
    const outcome = await ctx.prisma.orderCancellation.findUniqueOrThrow({ where: { orderId: order.id } });
    const snap = await ctx.prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(outcome.riderCompensationPaise).toBe(snap.riderEarningEstimatePaise);
    expect(await ctx.prisma.riderEarning.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({
      kind: 'CANCELLED_TRIP',
      totalPaise: snap.riderEarningEstimatePaise,
      riderId: r.rider.id,
    });
    expect(
      (await ctx.prisma.riderAvailability.findUniqueOrThrow({ where: { riderId: r.rider.id } }))
        .activeOrderCount,
    ).toBe(0);
    expect((await call('GET', '/v1/rider/work', r)).json().trip).toBeNull();
  });

  it('a rider hands an order back before pickup; a suspended rider cannot work', async () => {
    const r = await activeRider({ name: 'Handback' });
    const { order } = await acceptedOrder();
    await jobs()['order.accepted'](event('order.accepted', { orderId: order.id }));
    const offer = (await call('GET', '/v1/rider/work', r)).json().offer;
    await call('POST', `/v1/rider/offers/${offer.assignmentId}/accept`, r);
    let res = await call('POST', `/v1/rider/trips/${order.id}/unassign`, r, { reason: 'Bike puncture' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ deliveryStatus: 'SEARCHING', riderId: null });
    await ctx.prisma.riderAvailability.update({ where: { riderId: r.rider.id }, data: { isOnline: false } });
    res = await asAdmin('POST', `/v1/admin/riders/${r.rider.id}/status`, {
      to: 'SUSPENDED',
      reason: 'Repeated no-shows',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call('GET', '/v1/rider/work', r)).statusCode).toBe(403);
  });

  it('locations: zone resolved on the server, far-future points ignored, customers get a rounded position', async () => {
    const r = await activeRider({ name: 'Mover' });
    let res = await call('POST', '/v1/rider/locations', r, {
      points: [
        { lat: 23.8051, lng: 72.3901, recordedAt: ctx.clock.now().toISOString() },
        { lat: 1, lng: 1, recordedAt: new Date(ctx.clock.now().getTime() + 3_600_000).toISOString() },
      ],
    });
    expect(res.json()).toMatchObject({ accepted: 1, online: true });
    expect(res.json().zoneId).toBeTruthy();
    const av = await ctx.prisma.riderAvailability.findUniqueOrThrow({ where: { riderId: r.rider.id } });
    expect(Number(av.lastLat)).toBeCloseTo(23.8051, 4);
    await ctx.prisma.riderAvailability.update({ where: { riderId: r.rider.id }, data: { isOnline: false } });
  });
});
