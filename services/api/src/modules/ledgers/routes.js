// Ledgers, settlements and cash deposits (D-88 … D-92): Jamzo Admin (Finance), the restaurant's payouts
// screen and the delivery partner's wallet. Money is never moved by Jamzo: payouts are recorded, not made.
import { z } from 'zod';
import {
  codDepositBody,
  codDepositListQuery,
  financeRangeQuery,
  ledgerEntriesQuery,
  restaurantAdjustmentBody,
  riderAdjustmentBody,
  settlementListQuery,
  settlementNoteBody,
  settlementPaidBody,
  settlementRunBody,
  uuid,
} from '@jamzo/validation';
import { localStart, riderPosition, settlementPeriod } from '@jamzo/settlement-engine';
import { restaurantRoleCan } from '@jamzo/auth';
import { AppError, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { idPage, toPage } from '../../core/pagination.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { createMemberGuard } from '../restaurants/membership.js';
import { assertActive, riderOf } from '../riders/service.js';
import { createSettlements } from './settlements.js';
import { createMoney } from './money.js';

const TZ = 'Asia/Kolkata';
const idParam = z.object({ id: uuid });
const kindParam = z.object({ kind: z.enum(['restaurant', 'rider']), id: uuid });
const num = (v) => (v == null ? null : Number(v));
const day = (text, tz = TZ) => {
  const [y, m, d] = text.split('-').map(Number);
  return localStart({ y, m, d }, tz);
};

/** BigInt columns → numbers for JSON. */
const settlementView = (s) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
const entryView = (e, orders = new Map()) => ({
  id: e.id,
  type: e.type,
  direction: e.direction,
  amountPaise: num(e.amountPaise),
  balanceAfterPaise: num(e.balanceAfterPaise),
  orderId: e.orderId,
  orderNumber: e.orderId ? (orders.get(e.orderId) ?? null) : null,
  settlementId: e.settlementId,
  description: e.description,
  createdAt: e.createdAt,
});

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function ledgerRoutes(app) {
  const prisma = app.prisma;
  const { config } = app.services;
  const settlements = createSettlements({ prisma, clock: app.clock, log: app.log });
  const money = createMoney({ prisma, clock: app.clock });
  const requireMember = createMemberGuard(prisma);

  const orderNumbers = async (entries) => {
    const ids = [...new Set(entries.map((e) => e.orderId).filter(Boolean))];
    const rows = ids.length
      ? await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true } })
      : [];
    return new Map(rows.map((o) => [o.id, o.orderNumber]));
  };
  const inCities = (request, perm, path) => {
    const ids = allowedCityIds(request, perm);
    return ids ? path(ids) : {};
  };

  // ── Settlements ──────────────────────────────────────────────────────────
  app.get(
    '/v1/admin/settlements',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(settlementListQuery, request.query);
      const page = idPage(q);
      const where = { ...page.where, ...(q.status ? { status: q.status } : {}) };
      if (q.kind === 'RESTAURANT') {
        const rows = await prisma.restaurantSettlement.findMany({
          where: {
            ...where,
            ...inCities(request, 'settlements.view', (ids) => ({ restaurant: { cityId: { in: ids } } })),
            ...(q.q ? { restaurant: { name: { contains: q.q, mode: 'insensitive' } } } : {}),
          },
          orderBy: page.orderBy,
          take: page.take,
          include: { restaurant: true },
        });
        const r = toPage(rows, q.limit);
        return {
          ...r,
          items: r.items.map((/** @type {any} */ s) => ({
            ...settlementView(s),
            name: s.restaurant.name,
            restaurant: undefined,
          })),
        };
      }
      const rows = await prisma.riderSettlement.findMany({
        where: {
          ...where,
          ...inCities(request, 'settlements.view', (ids) => ({ rider: { cityId: { in: ids } } })),
          ...(q.q ? { rider: { user: { name: { contains: q.q, mode: 'insensitive' } } } } : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { rider: { include: { user: true } } },
      });
      const r = toPage(rows, q.limit);
      return {
        ...r,
        items: r.items.map((/** @type {any} */ s) => ({
          ...settlementView(s),
          name: s.rider.user.name,
          rider: undefined,
        })),
      };
    },
  );

  /** @returns {Promise<any>} */
  async function loadSettlement(request, kind, id, perm) {
    const s =
      kind === 'restaurant'
        ? await prisma.restaurantSettlement.findUnique({
            where: { id },
            include: { restaurant: true, entries: { orderBy: { createdAt: 'asc' } } },
          })
        : await prisma.riderSettlement.findUnique({
            where: { id },
            include: { rider: { include: { user: true } }, entries: { orderBy: { createdAt: 'asc' } } },
          });
    const cityId = kind === 'restaurant' ? s?.restaurant.cityId : s?.rider.cityId;
    if (!s || !canInCity(request, perm, cityId)) throw notFound('Settlement');
    return s;
  }

  app.get(
    '/v1/admin/settlements/:kind/:id',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { kind, id } = parse(kindParam, request.params);
      const s = await loadSettlement(request, kind, id, 'settlements.view');
      const orders = await orderNumbers(s.entries);
      const cityId = kind === 'restaurant' ? s.restaurant.cityId : s.rider.cityId;
      return {
        ...settlementView({ ...s, entries: undefined, restaurant: undefined, rider: undefined }),
        kind: kind.toUpperCase(),
        name: kind === 'restaurant' ? s.restaurant.name : s.rider.user.name,
        entries: s.entries.map((e) => entryView(e, orders)),
        permissions: { manage: canInCity(request, 'settlements.manage', cityId) },
      };
    },
  );

  app.get(
    '/v1/admin/settlements/:kind/:id/statement.csv',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { kind, id } = parse(kindParam, request.params);
      const s = await loadSettlement(request, kind, id, 'settlements.view');
      const orders = await orderNumbers(s.entries);
      const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
      const rupees = (p) => (Number(p) / 100).toFixed(2);
      const lines = [
        ['Date (UTC)', 'Order', 'Type', 'Credit (₹)', 'Debit (₹)', 'Note'],
        ...s.entries.map((e) => [
          e.createdAt.toISOString(),
          orders.get(e.orderId) ?? '',
          e.type,
          e.direction === 'CREDIT' ? rupees(e.amountPaise) : '',
          e.direction === 'DEBIT' ? rupees(e.amountPaise) : '',
          e.description ?? '',
        ]),
        [],
        ['Net payable (₹)', rupees(s.netPayablePaise)],
      ];
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="jamzo-settlement-${id.slice(0, 8)}.csv"`);
      return lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
    },
  );

  app.post(
    '/v1/admin/settlements/run',
    { config: { permission: 'settlements.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(settlementRunBody, request.body);
      const period = body.from ? { start: day(body.from), end: day(body.to) } : null;
      const results =
        body.kind === 'RESTAURANT'
          ? await settlements.runRestaurants({ period })
          : await settlements.runRiders({ period });
      await audit(prisma, request, {
        action: 'settlement.run',
        entityType: 'settlement',
        entityId: '00000000-0000-0000-0000-000000000000',
        newValue: {
          kind: body.kind,
          from: body.from ?? null,
          to: body.to ?? null,
          created: results.filter((r) => r.outcome === 'CREATED').length,
        },
      });
      const count = (o) => results.filter((r) => r.outcome === o).length;
      return {
        created: count('CREATED'),
        carriedForward: count('CARRIED_FORWARD'),
        exists: count('EXISTS'),
        notDue: count('NOT_DUE'),
      };
    },
  );

  const step = (path, run, bodySchema) =>
    app.post(
      `/v1/admin/settlements/:kind/:id/${path}`,
      { config: { permission: 'settlements.manage' } },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const { kind, id } = parse(kindParam, request.params);
        const body = bodySchema ? parse(bodySchema, request.body) : {};
        await loadSettlement(request, kind, id, 'settlements.manage');
        await run(kind.toUpperCase(), id, body, request.auth.userId);
        await audit(prisma, request, {
          action: `settlement.${path}`,
          entityType: 'settlement',
          entityId: id,
          newValue: body,
        });
        const s = await loadSettlement(request, kind, id, 'settlements.view');
        return settlementView({ ...s, entries: undefined, restaurant: undefined, rider: undefined });
      },
    );
  step('approve', (k, id, _b, admin) => settlements.approve(k, id, admin));
  step(
    'paid',
    (k, id, b, admin) => settlements.markPaid(k, id, { reference: b.reference, adminUserId: admin }),
    settlementPaidBody,
  );
  step('fail', (k, id, b) => settlements.release(k, id, { to: 'FAILED', note: b.note }), settlementNoteBody);
  step(
    'cancel',
    (k, id, b) => settlements.release(k, id, { to: 'CANCELLED', note: b.note }),
    settlementNoteBody,
  );

  // ── Ledgers ──────────────────────────────────────────────────────────────
  app.get(
    '/v1/admin/ledgers/:kind/:id',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { kind, id } = parse(kindParam, request.params);
      const q = parse(ledgerEntriesQuery, request.query);
      const page = idPage(q);
      if (kind === 'restaurant') {
        const r = await prisma.restaurant.findUnique({ where: { id } });
        if (!r || !canInCity(request, 'settlements.view', r.cityId)) throw notFound('Restaurant');
        const ledger = await prisma.restaurantLedger.findUnique({ where: { restaurantId: id } });
        const rows = ledger
          ? await prisma.restaurantLedgerEntry.findMany({
              where: { ...page.where, ledgerId: ledger.id, ...(q.unsettled ? { settlementId: null } : {}) },
              orderBy: page.orderBy,
              take: page.take,
            })
          : [];
        const orders = await orderNumbers(rows);
        const p = toPage(rows, q.limit);
        return {
          name: r.name,
          balancePaise: num(ledger?.balancePaise ?? 0),
          ...p,
          items: p.items.map((e) => entryView(e, orders)),
          permissions: { adjust: canInCity(request, 'ledgers.adjust', r.cityId) },
        };
      }
      const rider = await prisma.rider.findUnique({ where: { id }, include: { user: true } });
      if (!rider || !canInCity(request, 'settlements.view', rider.cityId)) throw notFound('Delivery partner');
      const ledger = await prisma.riderLedger.findUnique({ where: { riderId: id } });
      const rows = ledger
        ? await prisma.riderLedgerEntry.findMany({
            where: { ...page.where, ledgerId: ledger.id, ...(q.unsettled ? { settlementId: null } : {}) },
            orderBy: page.orderBy,
            take: page.take,
          })
        : [];
      const orders = await orderNumbers(rows);
      const p = toPage(rows, q.limit);
      const earnings = num(ledger?.earningsBalancePaise ?? 0);
      const cod = num(ledger?.codHeldPaise ?? 0);
      return {
        name: rider.user.name,
        earningsBalancePaise: earnings,
        codHeldPaise: cod,
        ...riderPosition({ earningsPaise: earnings, codHeldPaise: cod }),
        ...p,
        items: p.items.map((e) => entryView(e, orders)),
        permissions: { adjust: canInCity(request, 'ledgers.adjust', rider.cityId) },
      };
    },
  );

  app.post(
    '/v1/admin/ledgers/:kind/:id/adjustments',
    { config: { permission: 'ledgers.adjust' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { kind, id } = parse(kindParam, request.params);
      const body = parse(
        kind === 'restaurant' ? restaurantAdjustmentBody : riderAdjustmentBody,
        request.body,
      );
      const target =
        kind === 'restaurant'
          ? await prisma.restaurant.findUnique({ where: { id } })
          : await prisma.rider.findUnique({ where: { id } });
      if (!target || !canInCity(request, 'ledgers.adjust', target.cityId))
        throw notFound(kind === 'restaurant' ? 'Restaurant' : 'Delivery partner');
      const type =
        kind === 'restaurant'
          ? body.direction === 'CREDIT'
            ? 'MANUAL_CREDIT'
            : 'MANUAL_DEBIT'
          : /** @type {any} */ (body).type;
      const direction = type === 'BONUS' ? 'CREDIT' : type === 'PENALTY' ? 'DEBIT' : body.direction;
      const written = await money.adjust(kind === 'restaurant' ? 'RESTAURANT' : 'RIDER', id, {
        type,
        direction,
        amountPaise: body.amountPaise,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        adminUserId: request.auth.userId,
      });
      if (written)
        await audit(prisma, request, {
          action: 'ledger.adjust',
          entityType: kind,
          entityId: id,
          newValue: { type, direction, amountPaise: body.amountPaise, reason: body.reason },
        });
      return { posted: written > 0 };
    },
  );

  app.get(
    '/v1/admin/finance/platform',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(financeRangeQuery, request.query);
      const cities = allowedCityIds(request, 'settlements.view');
      const rows = await prisma.platformLedgerEntry.groupBy({
        by: ['type', 'direction'],
        where: {
          createdAt: { gte: day(q.from), lt: day(q.to) },
          ...(cities ? { cityId: { in: cities } } : {}),
        },
        _sum: { amountPaise: true },
        _count: true,
      });
      const LIABILITY = ['TAX_COLLECTED', 'WITHHOLDING_TAX', 'TIP_PASS_THROUGH'];
      const lines = rows.map((r) => ({
        type: r.type,
        direction: r.direction,
        amountPaise: num(r._sum.amountPaise),
        entries: r._count,
        liability: LIABILITY.includes(r.type),
      }));
      const net = lines
        .filter((l) => !l.liability)
        .reduce((x, l) => x + (l.direction === 'CREDIT' ? 1 : -1) * l.amountPaise, 0);
      return { from: q.from, to: q.to, lines, netPaise: net };
    },
  );

  app.get(
    '/v1/admin/finance/checks',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(financeRangeQuery, request.query);
      return money.checks({ from: day(q.from), to: day(q.to) });
    },
  );

  // ── Cash deposits (D-90) ─────────────────────────────────────────────────
  app.get(
    '/v1/admin/cod-deposits',
    { config: { permission: 'settlements.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(codDepositListQuery, request.query);
      const page = idPage(q);
      const rows = await prisma.riderCodDeposit.findMany({
        where: {
          ...page.where,
          ...(q.status ? { status: q.status } : {}),
          ...inCities(request, 'settlements.view', (ids) => ({ rider: { cityId: { in: ids } } })),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { rider: { include: { user: true } } },
      });
      const ledgers = await prisma.riderLedger.findMany({
        where: { riderId: { in: rows.map((d) => d.riderId) } },
      });
      const held = new Map(ledgers.map((l) => [l.riderId, num(l.codHeldPaise)]));
      const r = toPage(rows, q.limit);
      return {
        ...r,
        items: r.items.map((/** @type {any} */ d) => ({
          id: d.id,
          riderId: d.riderId,
          riderName: d.rider.user.name,
          amountPaise: d.amountPaise,
          method: d.method,
          reference: d.reference,
          status: d.status,
          reportedBy: d.reportedBy,
          expectedPaise: d.expectedPaise,
          variancePaise: d.variancePaise,
          codHeldPaise: held.get(d.riderId) ?? 0,
          note: d.note,
          verifiedAt: d.verifiedAt,
          createdAt: d.createdAt,
        })),
      };
    },
  );

  app.post(
    '/v1/admin/riders/:id/cod-deposits',
    { config: { permission: 'settlements.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(codDepositBody, request.body);
      const rider = await prisma.rider.findUnique({ where: { id } });
      if (!rider || !canInCity(request, 'settlements.manage', rider.cityId))
        throw notFound('Delivery partner');
      const d = await money.reportDeposit(id, {
        ...body,
        reportedBy: 'ADMIN',
        receivedById: request.auth.userId,
      });
      await audit(prisma, request, {
        action: 'cod_deposit.record',
        entityType: 'cod_deposit',
        entityId: d.id,
        newValue: body,
      });
      return d;
    },
  );

  const depositStep = (path, run, schema) =>
    app.post(
      `/v1/admin/cod-deposits/:id/${path}`,
      { config: { permission: 'settlements.manage' } },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const { id } = parse(idParam, request.params);
        const body = schema ? parse(schema, request.body) : {};
        const d = await prisma.riderCodDeposit.findUnique({ where: { id }, include: { rider: true } });
        if (!d || !canInCity(request, 'settlements.manage', d.rider.cityId)) throw notFound('Deposit');
        await run(id, request.auth.userId, body);
        await audit(prisma, request, {
          action: `cod_deposit.${path}`,
          entityType: 'cod_deposit',
          entityId: id,
          newValue: body,
        });
        return prisma.riderCodDeposit.findUnique({ where: { id } });
      },
    );
  depositStep('verify', (id, admin) => money.verifyDeposit(id, admin));
  depositStep('reject', (id, admin, b) => money.rejectDeposit(id, admin, b.note), settlementNoteBody);

  // ── Restaurant Partner app: payouts (owners and managers) ────────────────
  app.get(
    '/v1/restaurant/payouts',
    { config: { apps: ['RESTAURANT'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { restaurantId } = parse(z.object({ restaurantId: uuid }), request.query);
      const membership = await requireMember(request, restaurantId, 'orders.view');
      if (!restaurantRoleCan(membership.role, 'orders.finance'))
        throw forbidden('Only owners and managers can see payouts.');
      const [restaurant, ledger, list] = await Promise.all([
        prisma.restaurant.findUnique({ where: { id: restaurantId }, include: { city: true } }),
        prisma.restaurantLedger.findUnique({ where: { restaurantId } }),
        prisma.restaurantSettlement.findMany({
          where: { restaurantId, status: { not: 'CANCELLED' } },
          orderBy: { periodEnd: 'desc' },
          take: 20,
        }),
      ]);
      const unsettled = ledger
        ? await prisma.restaurantLedgerEntry.findMany({ where: { ledgerId: ledger.id, settlementId: null } })
        : [];
      const s = (
        await config.resolve('settlements.restaurants', await config.contextFor('RESTAURANT', restaurantId))
      ).value;
      const tz = restaurant.city?.timezone ?? TZ;
      // The next day a settlement will be made for this schedule (checked day by day at 06:00).
      let next = null;
      for (let i = 1; i <= 8 && s.schedule !== 'MANUAL'; i++) {
        const at = new Date(app.clock.now().getTime() + i * 86_400_000);
        if (settlementPeriod(s.schedule, at, { timeZone: tz, weeklyRunDay: s.weeklyRunDay })) {
          next = at.toISOString().slice(0, 10);
          break;
        }
      }
      const b = settlements.restaurantBreakdown(unsettled, new Date(0));
      return {
        balancePaise: num(ledger?.balancePaise ?? 0),
        schedule: s.schedule,
        nextSettlementDate: next,
        minPayoutPaise: s.minPayoutPaise,
        pending: {
          orders: new Set(unsettled.filter((e) => e.type === 'FOOD_SALE').map((e) => e.orderId)).size,
          foodSalesPaise: num(b.grossSalesPaise),
          commissionPaise: num(b.commissionPaise),
          commissionTaxPaise: num(b.taxesPaise),
          discountsPaise: num(b.discountsPaise),
          refundsPaise: num(b.refundsPaise),
          adjustmentsPaise: num(b.adjustmentsPaise),
          netPaise: num(b.netPayablePaise),
        },
        settlements: list.map((x) =>
          settlementView({
            ...x,
            restaurantId: undefined,
            statementMediaId: undefined,
            approvedById: undefined,
          }),
        ),
      };
    },
  );

  // ── Delivery Partner app: wallet and cash deposits ───────────────────────
  app.get(
    '/v1/rider/wallet',
    { config: { apps: ['RIDER'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const rider = await riderOf(prisma, request);
      assertActive(rider);
      const [ledger, payouts, deposits, cod] = await Promise.all([
        prisma.riderLedger.findUnique({ where: { riderId: rider.id } }),
        prisma.riderPayout.findMany({
          where: { riderId: rider.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.riderCodDeposit.findMany({
          where: { riderId: rider.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        config.resolve('cod', rider.cityId ? await config.contextFor('CITY', rider.cityId) : {}),
      ]);
      const earnings = num(ledger?.earningsBalancePaise ?? 0);
      const held = num(ledger?.codHeldPaise ?? 0);
      return {
        earningsBalancePaise: earnings,
        codHeldPaise: held,
        netting: cod.value.netAgainstEarnings,
        ...riderPosition({ earningsPaise: earnings, codHeldPaise: held }),
        payouts: payouts.map((p) => ({
          id: p.id,
          amountPaise: p.amountPaise,
          reference: p.reference,
          paidAt: p.paidAt,
        })),
        deposits: deposits.map((d) => ({
          id: d.id,
          amountPaise: d.amountPaise,
          method: d.method,
          reference: d.reference,
          status: d.status,
          note: d.status === 'REJECTED' ? d.note : null,
          createdAt: d.createdAt,
        })),
      };
    },
  );

  app.post(
    '/v1/rider/cod-deposits',
    { config: { apps: ['RIDER'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(codDepositBody, request.body);
      const rider = await riderOf(prisma, request);
      assertActive(rider);
      if (body.method === 'CASH_AT_HUB')
        throw new AppError('VALIDATION_FAILED', 'Cash handed over at a hub is recorded by the hub staff.', {
          fieldErrors: { method: ['Choose UPI or bank deposit'] },
        });
      const d = await money.reportDeposit(rider.id, { ...body, reportedBy: 'RIDER' });
      return {
        id: d.id,
        amountPaise: d.amountPaise,
        method: d.method,
        reference: d.reference,
        status: d.status,
      };
    },
  );
}
