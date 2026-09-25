// Ledgers, settlements and cash deposits (Phase 8: D-88 … D-92) against real PostgreSQL. Orders go through the
// real API end to end (checkout → restaurant → dispatch → delivery); the worker's jobs are called directly.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createLedgerJobs } from '../src/modules/ledgers/jobs.js';
import { createSettlements } from '../src/modules/ledgers/settlements.js';
import { createFlows } from './flows.js';

let ctx;
let pizza;
let owner;
let admin;
let finance;
let ledgerJobs;
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
  owner = await mobileLogin(ctx, 'RESTAURANT', pizza.phone);
  admin = (await adminLogin(ctx)).accessToken;
  finance = (await adminWithRole(ctx, 'FINANCE')).accessToken;
  ledgerJobs = createLedgerJobs({ prisma: ctx.prisma, clock: ctx.clock });
  f = flows();
});
afterAll(() => ctx?.stop());

const call = (method, url, token, payload, app = 'RIDER', extra = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(token.accessToken ?? token, app, extra),
    ...(payload !== undefined ? { payload } : {}),
  });
const asAdmin = (method, url, payload, token = admin) => call(method, url, token, payload, 'ADMIN');
/** Runs the worker's ledger job for the order's latest event of this type. */
async function post(eventType, orderId) {
  const events = await ctx.prisma.outboxEvent.findMany({ where: { aggregateId: orderId, eventType } });
  for (const e of events) await ledgerJobs[eventType](e);
}
const entries = async (model, orderId) =>
  (await ctx.prisma[model].findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })).map((e) => ({
    type: e.type,
    direction: e.direction,
    amountPaise: Number(e.amountPaise),
  }));
const net = (list) => list.reduce((n, e) => n + (e.direction === 'CREDIT' ? 1 : -1) * e.amountPaise, 0);

const flows = () => createFlows(ctx, { owner });
let f;
const activeRider = () => f.activeRider();
const deliveredOrder = (o) => f.deliveredOrder(o);

describe('posting (D-88)', () => {
  it('a delivered cash order: restaurant payable, the partner’s pay and cash, Jamzo’s side — adding up, posted once', async () => {
    const { order, rider } = await deliveredOrder();
    await post('order.delivered', order.id);
    await post('order.delivered', order.id); // a repeated job posts nothing twice
    const snap = await ctx.prisma.orderPricingSnapshot.findUniqueOrThrow({ where: { orderId: order.id } });
    const rest = await entries('restaurantLedgerEntry', order.id);
    expect(rest.map((e) => e.type)).toEqual(
      expect.arrayContaining(['FOOD_SALE', 'COMMISSION', 'COMMISSION_TAX']),
    );
    expect(net(rest)).toBe(snap.restaurantPayablePaise);
    const earning = await ctx.prisma.riderEarning.findUniqueOrThrow({ where: { orderId: order.id } });
    const riderEntries = await entries('riderLedgerEntry', order.id);
    expect(net(riderEntries.filter((e) => e.type !== 'COD_COLLECTED'))).toBe(earning.totalPaise);
    expect(riderEntries.find((e) => e.type === 'COD_COLLECTED')).toMatchObject({
      amountPaise: order.totalPayablePaise,
    });
    const ledger = await ctx.prisma.riderLedger.findUniqueOrThrow({ where: { riderId: rider.rider.id } });
    expect(Number(ledger.codHeldPaise)).toBe(order.totalPayablePaise);
    expect(Number(ledger.earningsBalancePaise)).toBe(earning.totalPaise);
    const platform = await entries('platformLedgerEntry', order.id);
    expect(platform.find((e) => e.type === 'RIDER_COST')).toMatchObject({
      amountPaise: earning.breakdown.tripPaise,
    });
    expect(platform.find((e) => e.type === 'GATEWAY_FEE')).toBeUndefined(); // cash: no gateway

    const checks = (
      await asAdmin('GET', '/v1/admin/finance/checks?from=2026-09-28&to=2026-09-29', undefined, finance)
    ).json();
    const mine = checks.orders.problems.find((p) => p.orderId === order.id);
    expect(mine).toBeUndefined(); // it adds up
    expect(checks.orders.checked).toBeGreaterThan(0);
    expect(checks.balances.drift).toEqual([]);
  });

  it('online: the actual gateway fee is Jamzo’s cost; a refund after delivery is paid by its bearer', async () => {
    const { order } = await deliveredOrder({ method: 'UPI' });
    await post('order.delivered', order.id);
    const pay = await ctx.prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, status: 'SUCCEEDED' },
    });
    const platform = await entries('platformLedgerEntry', order.id);
    expect(platform.find((e) => e.type === 'GATEWAY_FEE')).toMatchObject({
      amountPaise: pay.gatewayFeePaise,
    });

    const r = (
      await asAdmin('POST', `/v1/admin/orders/${order.id}/refunds`, {
        type: 'PARTIAL',
        amountPaise: 3_000,
        reason: 'Bread was burnt',
        bearer: 'RESTAURANT',
        idempotencyKey: 'ledger-refund-1',
      })
    ).json();
    await ctx.app.services.payments.handlers['refund.process']({ payload: { refundId: r.id } });
    await post('order.refunded', order.id);
    const rest = await ctx.prisma.restaurantLedgerEntry.findMany({ where: { refundId: r.id } });
    expect(rest.map((e) => [e.type, e.direction, Number(e.amountPaise)])).toEqual([
      ['REFUND', 'DEBIT', 3_000],
    ]);
  });

  it('a cancellation after acceptance: the restaurant is compensated and Jamzo carries the loss (OD-38)', async () => {
    const c = await mobileLogin(ctx, 'CUSTOMER', `95${String(Date.now() + ++seq).slice(-8)}`);
    const addr = (
      await call('POST', '/v1/customer/addresses', c, { label: 'Home', line1: '1 Road', ...HERE }, 'CUSTOMER')
    ).json();
    const bread = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurantId: pizza.id, name: 'Garlic Bread' },
    });
    const body = {
      restaurantId: pizza.id,
      addressId: addr.id,
      lines: [{ key: 'a', productId: bread.id, quantity: 1 }],
    };
    const q = (await call('POST', '/v1/customer/cart/quote', c, body, 'CUSTOMER')).json();
    const order = (
      await call(
        'POST',
        '/v1/orders',
        c,
        { ...body, paymentMethod: 'COD', expectedTotalPaise: q.bill.totalPayablePaise },
        'CUSTOMER',
        {
          'idempotency-key': randomUUID(),
        },
      )
    ).json().order;
    await call(
      'POST',
      `/v1/restaurant/orders/${order.id}/accept`,
      owner,
      { prepTimeMinutes: 15, version: 0 },
      'RESTAURANT',
    );
    await call(
      'POST',
      `/v1/customer/orders/${order.id}/cancel`,
      c,
      { reasonCode: 'CHANGED_MIND' },
      'CUSTOMER',
    );
    await post('order.cancelled', order.id);
    const cancellation = await ctx.prisma.orderCancellation.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(cancellation.restaurantCompensationPaise).toBeGreaterThan(0);
    const rest = await entries('restaurantLedgerEntry', order.id);
    expect(rest).toEqual([
      { type: 'CANCELLATION', direction: 'CREDIT', amountPaise: cancellation.restaurantCompensationPaise },
    ]);
    const platform = await entries('platformLedgerEntry', order.id);
    expect(platform).toEqual([
      { type: 'REFUND_LOSS', direction: 'DEBIT', amountPaise: cancellation.restaurantCompensationPaise },
    ]);
  });
});

describe('settlements (D-89, D-91)', () => {
  it('restaurant: a run creates one draft; approve → paid with the reference posts the settlement; the statement adds up', async () => {
    // Two runs at the same moment (two admins, or the admin and the daily job): exactly one settlement.
    const runOnce = () =>
      asAdmin(
        'POST',
        '/v1/admin/settlements/run',
        { kind: 'RESTAURANT', from: '2026-09-28', to: '2026-09-29' },
        finance,
      );
    const [x, y] = await Promise.all([runOnce(), runOnce()]);
    expect(x.statusCode, x.body).toBe(200);
    expect(x.json().created + y.json().created).toBe(1);
    expect(await ctx.prisma.restaurantSettlement.count({ where: { restaurantId: pizza.id } })).toBe(1);
    const ledger = await ctx.prisma.restaurantLedger.findUniqueOrThrow({ where: { restaurantId: pizza.id } });
    const list = (await asAdmin('GET', '/v1/admin/settlements?kind=RESTAURANT', undefined, finance)).json();
    const s = list.items.find((x) => x.restaurantId === pizza.id);
    expect(s).toMatchObject({
      status: 'DRAFT',
      name: 'Pizza Point',
      netPayablePaise: Number(ledger.balancePaise),
    });
    const detail = (
      await asAdmin('GET', `/v1/admin/settlements/restaurant/${s.id}`, undefined, finance)
    ).json();
    expect(detail.entries.reduce((n, e) => n + (e.direction === 'CREDIT' ? 1 : -1) * e.amountPaise, 0)).toBe(
      s.netPayablePaise,
    );
    const csv = await asAdmin(
      'GET',
      `/v1/admin/settlements/restaurant/${s.id}/statement.csv`,
      undefined,
      finance,
    );
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain(`Net payable (₹),${(s.netPayablePaise / 100).toFixed(2)}`);

    // Paid before approval is refused; approve, then record the payout made outside Jamzo.
    expect(
      (
        await asAdmin(
          'POST',
          `/v1/admin/settlements/restaurant/${s.id}/paid`,
          { reference: 'NEFT-001' },
          finance,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await asAdmin('POST', `/v1/admin/settlements/restaurant/${s.id}/approve`, undefined, finance)).json(),
    ).toMatchObject({ status: 'PROCESSING' });
    const paid = await asAdmin(
      'POST',
      `/v1/admin/settlements/restaurant/${s.id}/paid`,
      { reference: 'NEFT-001' },
      finance,
    );
    expect(paid.json()).toMatchObject({ status: 'PAID', payoutReference: 'NEFT-001' });
    const after = await ctx.prisma.restaurantLedger.findUniqueOrThrow({ where: { restaurantId: pizza.id } });
    expect(Number(after.balancePaise)).toBe(0);
    expect(
      await ctx.prisma.restaurantLedgerEntry.count({ where: { idempotencyKey: `settlement:${s.id}` } }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: s.id, action: { in: ['settlement.approve', 'settlement.paid'] } },
      }),
    ).toBe(2);
  });

  it('restaurant app: owners see the balance, what is pending and past settlements — never Jamzo’s margins', async () => {
    const res = await call(
      'GET',
      `/v1/restaurant/payouts?restaurantId=${pizza.id}`,
      owner,
      undefined,
      'RESTAURANT',
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ schedule: 'WEEKLY', balancePaise: 0, pending: { netPaise: 0 } });
    expect(res.json().settlements[0]).toMatchObject({ status: 'PAID', payoutReference: 'NEFT-001' });
    expect(JSON.stringify(res.json())).not.toMatch(/markup|platformFee|MARKUP|commissionRevenue/);
  });

  it('delivery partner: cash deposit verified (FIFO reconciled), netting, payout, and the wallet', async () => {
    const r = await activeRider();
    const a = await deliveredOrder({ rider: r });
    const b = await deliveredOrder({ rider: r });
    for (const o of [a.order, b.order]) await post('order.delivered', o.id);
    let wallet = (await call('GET', '/v1/rider/wallet', r)).json();
    const cash = a.order.totalPayablePaise + b.order.totalPayablePaise;
    expect(wallet.codHeldPaise).toBe(cash);
    const earned = wallet.earningsBalancePaise;
    expect(wallet.owesPaise).toBe(cash - earned);

    // The partner reports a UPI deposit covering the first order; Finance verifies it.
    const d = (
      await call('POST', '/v1/rider/cod-deposits', r, {
        amountPaise: a.order.totalPayablePaise,
        method: 'UPI',
        reference: 'UPI-778899',
        idempotencyKey: 'dep-test-0001',
      })
    ).json();
    expect(d.status).toBe('PENDING');
    expect(
      (
        await call('POST', '/v1/rider/cod-deposits', r, {
          amountPaise: 100_00,
          method: 'CASH_AT_HUB',
          idempotencyKey: 'dep-test-0002',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await asAdmin('POST', `/v1/admin/cod-deposits/${d.id}/verify`, undefined, finance)).json(),
    ).toMatchObject({
      status: 'VERIFIED',
      expectedPaise: cash,
      variancePaise: 0,
    });
    const pays = await ctx.prisma.payment.findMany({
      where: { orderId: { in: [a.order.id, b.order.id] }, provider: 'cod' },
    });
    expect(pays.find((p) => p.orderId === a.order.id).codReconciledAt).not.toBeNull(); // first collected, first covered
    expect(pays.find((p) => p.orderId === b.order.id).codReconciledAt).toBeNull();
    wallet = (await call('GET', '/v1/rider/wallet', r)).json();
    expect(wallet.codHeldPaise).toBe(b.order.totalPayablePaise);

    // Settlement with netting: earnings minus the cash still held; nothing below the minimum payout.
    await asAdmin('PUT', '/v1/admin/settings', {
      key: 'settlements.riders',
      scope: 'GLOBAL',
      value: { schedule: 'WEEKLY', minPayoutPaise: 0 },
      reason: 'test',
    });
    const run = await asAdmin(
      'POST',
      '/v1/admin/settlements/run',
      { kind: 'RIDER', from: '2026-09-28', to: '2026-09-29' },
      finance,
    );
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().created).toBeGreaterThanOrEqual(1);
    const s = await ctx.prisma.riderSettlement.findFirstOrThrow({ where: { riderId: r.rider.id } });
    const netted = Math.min(earned, b.order.totalPayablePaise);
    expect(Number(s.codOwedPaise)).toBe(netted);
    expect(Number(s.netPayablePaise)).toBe(earned - netted);
    await asAdmin('POST', `/v1/admin/settlements/rider/${s.id}/approve`, undefined, finance);
    await asAdmin('POST', `/v1/admin/settlements/rider/${s.id}/paid`, { reference: 'UPI-PAYOUT-1' }, finance);
    wallet = (await call('GET', '/v1/rider/wallet', r)).json();
    expect(wallet.earningsBalancePaise).toBe(0);
    expect(wallet.codHeldPaise).toBe(b.order.totalPayablePaise - netted);
    if (earned > netted)
      expect(wallet.payouts[0]).toMatchObject({ amountPaise: earned - netted, reference: 'UPI-PAYOUT-1' });
    await asAdmin('DELETE', '/v1/admin/settings', {
      key: 'settlements.riders',
      scope: 'GLOBAL',
      reason: 'test reset',
    });
  });

  it('a deposit above the cash held is owed back to the partner; a rejected deposit needs a reason', async () => {
    const r = await activeRider();
    const d = (
      await asAdmin(
        'POST',
        `/v1/admin/riders/${r.rider.id}/cod-deposits`,
        { amountPaise: 5_000, method: 'CASH_AT_HUB', reference: 'HUB-1', idempotencyKey: 'dep-test-0003' },
        finance,
      )
    ).json();
    expect(d).toMatchObject({ reportedBy: 'ADMIN', status: 'PENDING' });
    expect(
      (await asAdmin('POST', `/v1/admin/cod-deposits/${d.id}/verify`, undefined, finance)).json(),
    ).toMatchObject({ variancePaise: 5_000 });
    const wallet = (await call('GET', '/v1/rider/wallet', r)).json();
    expect(wallet).toMatchObject({ earningsBalancePaise: 5_000, codHeldPaise: 0, owedPaise: 5_000 });
    const e = (
      await call('POST', '/v1/rider/cod-deposits', r, {
        amountPaise: 1_000,
        method: 'UPI',
        reference: 'X-1',
        idempotencyKey: 'dep-test-0004',
      })
    ).json();
    expect((await asAdmin('POST', `/v1/admin/cod-deposits/${e.id}/reject`, {}, finance)).statusCode).toBe(
      400,
    );
    expect(
      (
        await asAdmin(
          'POST',
          `/v1/admin/cod-deposits/${e.id}/reject`,
          { note: 'No such UPI payment' },
          finance,
        )
      ).json(),
    ).toMatchObject({ status: 'REJECTED' });
  });

  it('manual adjustments need a reason, are audited and posted once; failed payouts release the entries', async () => {
    const before = (
      await asAdmin('GET', `/v1/admin/ledgers/restaurant/${pizza.id}`, undefined, finance)
    ).json();
    const adj = {
      direction: 'CREDIT',
      amountPaise: 20_000,
      reason: 'Packaging refund agreed',
      idempotencyKey: 'adj-test-0001',
    };
    expect(
      (await asAdmin('POST', `/v1/admin/ledgers/restaurant/${pizza.id}/adjustments`, adj, finance)).json(),
    ).toEqual({ posted: true });
    expect(
      (await asAdmin('POST', `/v1/admin/ledgers/restaurant/${pizza.id}/adjustments`, adj, finance)).json(),
    ).toEqual({ posted: false });
    const support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
    expect(
      (
        await asAdmin(
          'POST',
          `/v1/admin/ledgers/restaurant/${pizza.id}/adjustments`,
          { ...adj, idempotencyKey: 'adj-test-0002' },
          support,
        )
      ).statusCode,
    ).toBe(403);
    const view = (
      await asAdmin('GET', `/v1/admin/ledgers/restaurant/${pizza.id}?unsettled=true`, undefined, finance)
    ).json();
    expect(view.balancePaise).toBe(before.balancePaise + 20_000);
    expect(view.items[0]).toMatchObject({ type: 'MANUAL_CREDIT', description: 'Packaging refund agreed' });
    const unsettled = view.items.reduce((n, e) => n + (e.direction === 'CREDIT' ? 1 : -1) * e.amountPaise, 0);

    // A settlement for everything unsettled, approved, then the bank transfer fails → entries released.
    const run = (
      await asAdmin(
        'POST',
        '/v1/admin/settlements/run',
        { kind: 'RESTAURANT', from: '2026-09-28', to: '2026-09-30' },
        finance,
      )
    ).json();
    expect(run.created).toBe(1);
    const s = await ctx.prisma.restaurantSettlement.findFirstOrThrow({
      where: { restaurantId: pizza.id, status: 'DRAFT' },
    });
    expect(Number(s.netPayablePaise)).toBe(unsettled);
    await asAdmin('POST', `/v1/admin/settlements/restaurant/${s.id}/approve`, undefined, finance);
    const failed = await asAdmin(
      'POST',
      `/v1/admin/settlements/restaurant/${s.id}/fail`,
      { note: 'Bank rejected the transfer' },
      finance,
    );
    expect(failed.json()).toMatchObject({ status: 'FAILED', note: 'Bank rejected the transfer' });
    expect(await ctx.prisma.restaurantLedgerEntry.count({ where: { settlementId: s.id } })).toBe(0);
  });

  it('the daily job: on the weekly run day it settles last week and schedules itself again', async () => {
    const jobs = createSettlements({ prisma: ctx.prisma, clock: ctx.clock });
    await jobs.ensureScheduled();
    await jobs.ensureScheduled();
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'settlements.tick', publishedAt: null } }),
    ).toBe(1);
    const ledger = (
      await asAdmin('GET', `/v1/admin/ledgers/restaurant/${pizza.id}?unsettled=true`, undefined, finance)
    ).json();
    const unsettled = ledger.items.reduce(
      (n, e) => n + (e.direction === 'CREDIT' ? 1 : -1) * e.amountPaise,
      0,
    );
    expect(unsettled).toBeGreaterThan(0);
    ctx.clock.set(ist('2026-10-05T06:00:00')); // Monday: the week of 28 Sep – 4 Oct
    await jobs.tick();
    const weekly = await ctx.prisma.restaurantSettlement.findFirst({
      where: {
        restaurantId: pizza.id,
        periodStart: ist('2026-09-28T00:00:00'),
        periodEnd: ist('2026-10-05T00:00:00'),
      },
    });
    // Everything released by the failed payout is settled again in the weekly run.
    expect(weekly).toMatchObject({ schedule: 'WEEKLY', status: 'DRAFT', netPayablePaise: BigInt(unsettled) });
    const next = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'settlements.tick' },
      orderBy: { availableAt: 'desc' },
    });
    expect(next[0].availableAt.toISOString()).toBe(ist('2026-10-06T06:00:00').toISOString());
    ctx.clock.set(MONDAY_1300);
  });
});
