// Analytics (D-95, D-96; spec §44–§46), computed on demand from orders and ledgers — never on the ordering
// path. Admin KPIs with a breakdown; each restaurant and delivery partner sees only their own numbers.
import { analyticsQuery, appAnalyticsQuery, uuid } from '@jamzo/validation';
import { TERMINAL_STATUSES } from '@jamzo/order-engine';
import { PLATFORM_LIABILITIES, localDate, localStart } from '@jamzo/settlement-engine';
import { restaurantRoleCan } from '@jamzo/auth';
import { forbidden } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { allowedCityIds } from '../../core/auth.js';
import { createMemberGuard } from '../restaurants/membership.js';
import { assertActive, riderOf } from '../riders/service.js';
import { startOf } from '../riders/app-routes.js';

const TZ = 'Asia/Kolkata';
const CANCELLED = TERMINAL_STATUSES.filter((s) => s !== 'DELIVERED');
const minutes = (a, b) => (b.getTime() - a.getTime()) / 60_000;
const avg = (xs) => (xs.length ? Math.round(xs.reduce((n, x) => n + x, 0) / xs.length) : null);
const day = (text) => {
  const [y, m, d] = text.split('-').map(Number);
  return localStart({ y, m, d }, TZ);
};
/** Start of today / this week (Monday) / this month in India time. */
export function rangeStart(range, now) {
  if (range === 'MONTH') {
    const t = localDate(now, TZ);
    return localStart({ y: t.y, m: t.m, d: 1 }, TZ);
  }
  return startOf(range, now, TZ);
}

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function analyticsRoutes(app) {
  const prisma = app.prisma;
  const requireMember = createMemberGuard(prisma);
  const cache = new Map();

  /** KPIs for a set of orders (placed in the range) and the platform ledger entries of that range. */
  function kpis(orders, refunds, platformNet) {
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    const gmv = delivered.reduce((n, o) => n + o.totalPayablePaise, 0);
    return {
      orders: orders.length,
      completed: delivered.length,
      cancelled: orders.filter((o) => CANCELLED.includes(o.status)).length,
      gmvPaise: gmv,
      averageOrderValuePaise: delivered.length ? Math.round(gmv / delivered.length) : null,
      refundsPaise: refunds,
      netPlatformRevenuePaise: platformNet,
      averageDeliveryMinutes: avg(
        delivered.filter((o) => o.placedAt && o.deliveredAt).map((o) => minutes(o.placedAt, o.deliveredAt)),
      ),
      averagePrepMinutes: avg(
        orders.filter((o) => o.acceptedAt && o.readyAt).map((o) => minutes(o.acceptedAt, o.readyAt)),
      ),
    };
  }

  app.get(
    '/v1/admin/analytics',
    { config: { permission: 'analytics.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(analyticsQuery, request.query);
      const cities = allowedCityIds(request, 'analytics.view');
      if (q.cityId && cities && !cities.includes(q.cityId)) throw forbidden();
      const cityFilter = q.cityId ? [q.cityId] : cities;
      const key = JSON.stringify({ q, cityFilter });
      const hit = cache.get(key);
      if (hit && hit.until > Date.now()) return hit.value;

      const from = day(q.from);
      const to = day(q.to);
      const inCities = cityFilter ? { cityId: { in: cityFilter } } : {};
      const orders = await prisma.order.findMany({
        where: { ...inCities, placedAt: { gte: from, lt: to } },
        select: {
          id: true,
          status: true,
          totalPayablePaise: true,
          placedAt: true,
          acceptedAt: true,
          readyAt: true,
          deliveredAt: true,
          cityId: true,
          zoneId: true,
          restaurantId: true,
          paymentMethod: true,
        },
      });
      const ids = orders.map((o) => o.id);
      const [refunds, platform, restaurants, riders, online] = await Promise.all([
        prisma.refund.findMany({
          where: { orderId: { in: ids }, status: 'SUCCEEDED' },
          select: { orderId: true, amountPaise: true },
        }),
        prisma.platformLedgerEntry.findMany({
          where: { ...inCities, createdAt: { gte: from, lt: to }, type: { notIn: PLATFORM_LIABILITIES } },
          select: { orderId: true, direction: true, amountPaise: true },
        }),
        prisma.restaurant.count({ where: { ...inCities, onboardingStatus: 'ACTIVE' } }),
        prisma.rider.count({ where: { ...inCities, onboardingStatus: 'ACTIVE' } }),
        prisma.riderAvailability.count({
          where: { isOnline: true, rider: { ...inCities, onboardingStatus: 'ACTIVE' } },
        }),
      ]);
      const signedAmount = (e) => (e.direction === 'CREDIT' ? 1 : -1) * Number(e.amountPaise);
      const groupOf = {
        NONE: () => 'ALL',
        CITY: (o) => o.cityId,
        ZONE: (o) => o.zoneId ?? 'NONE',
        RESTAURANT: (o) => o.restaurantId,
        PAYMENT_METHOD: (o) => o.paymentMethod,
      }[q.by];
      const byOrder = new Map(orders.map((o) => [o.id, groupOf(o)]));
      const groups = new Map();
      for (const o of orders) groups.set(groupOf(o), [...(groups.get(groupOf(o)) ?? []), o]);
      const sumFor = (list, pick) => list.reduce((n, x) => n + pick(x), 0);
      const names = await labels(q.by, [...groups.keys()]);
      const breakdown = [...groups.entries()].map(([k, list]) => {
        const inGroup = (x) => byOrder.get(x.orderId) === k;
        return {
          key: k,
          label: names.get(k) ?? k,
          ...kpis(
            list,
            sumFor(refunds.filter(inGroup), (r) => r.amountPaise),
            sumFor(platform.filter(inGroup), signedAmount),
          ),
        };
      });
      breakdown.sort((a, b) => b.gmvPaise - a.gmvPaise);
      const value = {
        from: q.from,
        to: q.to,
        by: q.by,
        totals: {
          ...kpis(
            orders,
            sumFor(refunds, (r) => r.amountPaise),
            sumFor(platform, signedAmount),
          ),
          liveRestaurants: restaurants,
          activeRiders: riders,
          onlineRidersNow: online,
        },
        breakdown: q.by === 'NONE' ? [] : breakdown,
        note: 'Computed from orders placed in the period; revenue from Jamzo’s ledger (entries of the period). Amounts are placeholders until commission and tax are confirmed.',
      };
      cache.set(key, { value, until: Date.now() + 60_000 });
      return value;
    },
  );

  async function labels(by, keys) {
    const ids = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k));
    const rows =
      by === 'CITY'
        ? await prisma.city.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : by === 'ZONE'
          ? await prisma.zone.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
          : by === 'RESTAURANT'
            ? await prisma.restaurant.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              })
            : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ── Restaurant Partner app (owners and managers): its own numbers only (§45) ──
  app.get(
    '/v1/restaurant/analytics',
    { config: { apps: ['RESTAURANT'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { restaurantId, range } = parse(appAnalyticsQuery.extend({ restaurantId: uuid }), request.query);
      const membership = await requireMember(request, restaurantId, 'orders.view');
      if (!restaurantRoleCan(membership.role, 'orders.finance'))
        throw forbidden('Only owners and managers can see sales.');
      const from = rangeStart(range, app.clock.now());
      const orders = await prisma.order.findMany({
        where: { restaurantId, placedAt: { gte: from } },
        select: { id: true, status: true, placedAt: true, pricingSnapshot: true },
      });
      const delivered = orders.filter((o) => o.status === 'DELIVERED' && o.pricingSnapshot);
      const snap = (pick) => delivered.reduce((n, o) => n + pick(o.pricingSnapshot), 0);
      const sales = snap((s) => s.restaurantBaseSubtotalPaise + s.packagingPaise);
      const items = await prisma.orderItem.groupBy({
        by: ['productName'],
        where: { orderId: { in: delivered.map((o) => o.id) } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      });
      const hours = Array.from({ length: 24 }, () => 0);
      for (const o of orders)
        hours[
          Number(
            new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(
              o.placedAt,
            ),
          )
        ] += 1;
      return {
        range,
        from,
        orders: orders.length,
        delivered: delivered.length,
        cancelled: orders.filter((o) => CANCELLED.includes(o.status)).length,
        salesPaise: sales,
        averageOrderValuePaise: delivered.length ? Math.round(sales / delivered.length) : null,
        commissionPaise: snap((s) => s.commissionAmountPaise + s.commissionTaxPaise),
        discountsPaise: snap((s) => s.restaurantFundedDiscountPaise),
        netPaise: snap((s) => s.restaurantPayablePaise),
        topItems: items.map((i) => ({ name: i.productName, quantity: i._sum.quantity ?? 0 })),
        busyHours: hours
          .map((count, hour) => ({ hour, count }))
          .filter((h) => h.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3),
      };
    },
  );

  // ── Delivery Partner app: own numbers only (§46) ──
  app.get(
    '/v1/rider/analytics',
    { config: { apps: ['RIDER'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { range } = parse(appAnalyticsQuery, request.query);
      const rider = await riderOf(prisma, request);
      assertActive(rider);
      const now = app.clock.now();
      const from = rangeStart(range, now);
      const [earnings, cash, shifts, offers] = await Promise.all([
        prisma.riderEarning.findMany({ where: { riderId: rider.id, createdAt: { gte: from } } }),
        prisma.payment.aggregate({
          where: {
            provider: 'cod',
            status: 'SUCCEEDED',
            codCollectedById: rider.id,
            codCollectedAt: { gte: from },
          },
          _sum: { capturedPaise: true },
        }),
        prisma.riderShift.findMany({
          where: { riderId: rider.id, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
        }),
        prisma.orderAssignment.groupBy({
          by: ['status'],
          where: { riderId: rider.id, offeredAt: { gte: from } },
          _count: true,
        }),
      ]);
      const trips = earnings.filter((e) => e.kind === 'DELIVERY');
      const b = (e) => /** @type {any} */ (e.breakdown) ?? {};
      const onlineMin = shifts.reduce(
        (n, s) => n + Math.max(0, minutes(s.startedAt > from ? s.startedAt : from, s.endedAt ?? now)),
        0,
      );
      const count = (st) => offers.find((o) => o.status === st)?._count ?? 0;
      const answered = count('ACCEPTED') + count('COMPLETED') + count('REJECTED') + count('TIMED_OUT');
      return {
        range,
        from,
        trips: trips.length,
        distanceM: trips.reduce((n, e) => n + (b(e).deliveryDistanceM ?? 0) + (b(e).pickupDistanceM ?? 0), 0),
        earningsPaise: earnings.reduce((n, e) => n + e.totalPaise, 0),
        tipsPaise: trips.reduce((n, e) => n + (b(e).tipPaise ?? 0), 0),
        incentivesPaise: trips.reduce(
          (n, e) => n + (b(e).incentives ?? []).reduce((x, i) => x + i.amountPaise, 0),
          0,
        ),
        cashCollectedPaise: cash._sum.capturedPaise ?? 0,
        onlineMinutes: Math.round(onlineMin),
        acceptanceRate: answered
          ? Math.round(((count('ACCEPTED') + count('COMPLETED')) / answered) * 100) / 100
          : null,
      };
    },
  );
}
