// Settlements (D-89, D-91). A run takes each ledger's unsettled entries up to the period's cut-off; one
// settlement per ledger and period (database rule). Jamzo never moves money: Finance pays outside Jamzo and
// types in the payout reference, which posts the settlement / payout debit.
import { isUniqueViolation } from '@jamzo/database';
import { nextRunAt, riderNetting, settlementPeriod, signed } from '@jamzo/settlement-engine';
import { AppError } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';
import { createConfigService } from '../configuration/service.js';
import { postEntries } from './post.js';

export const TICK_ID = '00000000-0000-7000-8000-00000000500e';
const TZ_DEFAULT = 'Asia/Kolkata';
const sumBy = (entries, pred) => entries.filter(pred).reduce((n, e) => n + signed(e), 0);
const abs = (v) => Math.abs(v);

/** @param {{ prisma: any, clock?: { now: () => Date }, log?: any }} deps */
export function createSettlements({ prisma, clock = { now: () => new Date() }, log }) {
  const config = createConfigService(prisma, clock);

  /** Breakdown columns of a restaurant settlement from its entries (restaurant's view: credits − debits). */
  function restaurantBreakdown(entries, periodStart) {
    const of = (...types) => sumBy(entries, (e) => types.includes(e.type));
    const credits = entries
      .filter((e) => e.direction === 'CREDIT')
      .reduce((x, e) => x + Number(e.amountPaise), 0);
    const debits = entries
      .filter((e) => e.direction === 'DEBIT')
      .reduce((x, e) => x + Number(e.amountPaise), 0);
    return {
      openingPaise: BigInt(sumBy(entries, (e) => e.createdAt < periodStart)),
      grossSalesPaise: BigInt(of('FOOD_SALE')),
      commissionPaise: BigInt(abs(of('COMMISSION'))),
      taxesPaise: BigInt(abs(of('COMMISSION_TAX', 'TAX_ADJUSTMENT'))),
      withholdingPaise: BigInt(abs(of('WITHHOLDING'))),
      feesPaise: BigInt(abs(of('RESTAURANT_FEE'))),
      discountsPaise: BigInt(abs(of('RESTAURANT_FUNDED_DISCOUNT'))),
      refundsPaise: BigInt(abs(of('REFUND'))),
      adjustmentsPaise: BigInt(of('MANUAL_CREDIT', 'MANUAL_DEBIT', 'PENALTY', 'CANCELLATION', 'REVERSAL')),
      creditsPaise: BigInt(credits),
      debitsPaise: BigInt(debits),
      netPayablePaise: BigInt(credits - debits),
    };
  }

  /**
   * Creates the due restaurant settlements for `now` (or for a chosen period). Returns what happened per
   * restaurant: CREATED, CARRIED_FORWARD (below the minimum), EXISTS or NOT_DUE.
   * @param {{ now?: Date, period?: { start: Date, end: Date }, restaurantIds?: string[] }} [o]
   */
  async function runRestaurants({ now = clock.now(), period = null, restaurantIds = null } = {}) {
    const ledgers = await prisma.restaurantLedger.findMany({
      where: restaurantIds ? { restaurantId: { in: restaurantIds } } : {},
      include: { restaurant: { include: { city: true } } },
    });
    const results = [];
    for (const l of ledgers) {
      const ctx = await config.contextFor('RESTAURANT', l.restaurantId);
      const s = (await config.resolve('settlements.restaurants', ctx)).value;
      const p =
        period ??
        settlementPeriod(s.schedule, now, {
          timeZone: l.restaurant.city?.timezone ?? TZ_DEFAULT,
          weeklyRunDay: s.weeklyRunDay,
        });
      if (!p) {
        results.push({ restaurantId: l.restaurantId, outcome: 'NOT_DUE' });
        continue;
      }
      try {
        const outcome = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM restaurant_ledgers WHERE id = ${l.id}::uuid FOR UPDATE`;
          const entries = await tx.restaurantLedgerEntry.findMany({
            where: { ledgerId: l.id, settlementId: null, createdAt: { lt: p.end } },
            orderBy: { createdAt: 'asc' },
          });
          const b = restaurantBreakdown(entries, p.start);
          if (!entries.length || Number(b.netPayablePaise) < s.minPayoutPaise) return 'CARRIED_FORWARD';
          const settlement = await tx.restaurantSettlement.create({
            data: {
              restaurantId: l.restaurantId,
              periodStart: p.start,
              periodEnd: p.end,
              schedule: period ? 'MANUAL' : s.schedule,
              ...b,
              codInfoPaise: 0n,
            },
          });
          await tx.restaurantLedgerEntry.updateMany({
            where: { id: { in: entries.map((e) => e.id) } },
            data: { settlementId: settlement.id },
          });
          return 'CREATED';
        });
        results.push({ restaurantId: l.restaurantId, outcome });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        results.push({ restaurantId: l.restaurantId, outcome: 'EXISTS' });
      }
    }
    return results;
  }

  /** Delivery partner settlements: earnings in the period minus the cash held when netting is on (D-91). */
  async function runRiders({ now = clock.now(), period = null, riderIds = null } = {}) {
    const ledgers = await prisma.riderLedger.findMany({
      where: riderIds ? { riderId: { in: riderIds } } : {},
      include: { rider: true },
    });
    // Riders have a city id (no relation): time zones are looked up once.
    const cities = await prisma.city.findMany({
      where: { id: { in: [...new Set(ledgers.map((l) => l.rider.cityId).filter(Boolean))] } },
    });
    const zone = new Map(cities.map((c) => [c.id, c.timezone]));
    const results = [];
    for (const l of ledgers) {
      const ctx = l.rider.cityId ? await config.contextFor('CITY', l.rider.cityId) : {};
      const [s, cod] = await Promise.all([
        config.resolve('settlements.riders', ctx),
        config.resolve('cod', ctx),
      ]);
      const p =
        period ??
        (s.value.schedule === 'MANUAL'
          ? null
          : settlementPeriod(s.value.schedule, now, { timeZone: zone.get(l.rider.cityId) ?? TZ_DEFAULT }));
      if (!p) {
        results.push({ riderId: l.riderId, outcome: 'NOT_DUE' });
        continue;
      }
      try {
        const outcome = await prisma.$transaction(async (tx) => {
          const [locked] =
            await tx.$queryRaw`SELECT "codHeldPaise" FROM rider_ledgers WHERE id = ${l.id}::uuid FOR UPDATE`;
          const entries = await tx.riderLedgerEntry.findMany({
            where: {
              ledgerId: l.id,
              settlementId: null,
              createdAt: { lt: p.end },
              type: { notIn: ['COD_COLLECTED', 'COD_SUBMITTED', 'COD_SHORTAGE'] },
            },
          });
          const earnings = sumBy(entries, () => true);
          const n = riderNetting({
            earningsPaise: earnings,
            codHeldPaise: Number(locked.codHeldPaise),
            netting: cod.value.netAgainstEarnings,
          });
          if (!entries.length || n.payablePaise < s.value.minPayoutPaise) return 'CARRIED_FORWARD';
          const settlement = await tx.riderSettlement.create({
            data: {
              riderId: l.riderId,
              periodStart: p.start,
              periodEnd: p.end,
              earningsPaise: BigInt(earnings),
              codOwedPaise: BigInt(n.codNettedPaise),
              netPayablePaise: BigInt(n.payablePaise),
            },
          });
          await tx.riderLedgerEntry.updateMany({
            where: { id: { in: entries.map((e) => e.id) } },
            data: { settlementId: settlement.id },
          });
          return 'CREATED';
        });
        results.push({ riderId: l.riderId, outcome });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        results.push({ riderId: l.riderId, outcome: 'EXISTS' });
      }
    }
    return results;
  }

  const model = (tx, kind) => (kind === 'RESTAURANT' ? tx.restaurantSettlement : tx.riderSettlement);
  const entryModel = (tx, kind) => (kind === 'RESTAURANT' ? tx.restaurantLedgerEntry : tx.riderLedgerEntry);

  /** DRAFT → PROCESSING: Finance approves paying it (outside Jamzo). */
  async function approve(kind, id, adminUserId) {
    const res = await model(prisma, kind).updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'PROCESSING', approvedById: adminUserId, approvedAt: clock.now() },
    });
    if (res.count !== 1)
      throw new AppError('INVALID_STATE_TRANSITION', 'Only a draft settlement can be approved.');
  }

  /** PROCESSING → PAID with the payout reference; the settlement / payout debit is posted. */
  async function markPaid(kind, id, { reference, adminUserId }) {
    const now = clock.now();
    await prisma.$transaction(async (tx) => {
      const s = await model(tx, kind).findUnique({ where: { id } });
      if (!s || s.status !== 'PROCESSING')
        throw new AppError('INVALID_STATE_TRANSITION', 'Approve the settlement before marking it paid.');
      await model(tx, kind).update({
        where: { id },
        data: { status: 'PAID', payoutReference: reference, paidAt: now },
      });
      const amount = Number(s.netPayablePaise);
      if (kind === 'RESTAURANT') {
        await postEntries(
          tx,
          { restaurantId: s.restaurantId },
          {
            restaurant: [
              {
                type: 'SETTLEMENT',
                direction: 'DEBIT',
                amountPaise: amount,
                key: `settlement:${id}`,
                settlementId: id,
                description: `Paid: ${reference}`,
              },
            ],
          },
          { now, createdById: adminUserId },
        );
      } else {
        const netted = Number(s.codOwedPaise);
        const rider = [
          {
            type: 'PAYOUT',
            direction: 'DEBIT',
            amountPaise: amount,
            key: `settlement:${id}:PAYOUT`,
            settlementId: id,
            description: `Paid: ${reference}`,
          },
        ];
        // Cash netted against earnings closes both sides (D-91).
        if (netted > 0)
          rider.push(
            {
              type: 'ADJUSTMENT',
              direction: 'DEBIT',
              amountPaise: netted,
              key: `settlement:${id}:NETTED`,
              settlementId: id,
              description: 'Cash on delivery netted against earnings',
            },
            {
              type: 'COD_SUBMITTED',
              direction: 'DEBIT',
              amountPaise: netted,
              key: `settlement:${id}:COD_NETTED`,
              settlementId: id,
              description: 'Netted against earnings',
            },
          );
        await postEntries(
          tx,
          { riderId: s.riderId },
          { rider: rider.filter((e) => e.amountPaise > 0) },
          { now, createdById: adminUserId },
        );
        if (amount > 0)
          await tx.riderPayout.create({
            data: {
              riderId: s.riderId,
              settlementId: id,
              amountPaise: amount,
              status: 'PAID',
              reference,
              paidAt: now,
            },
          });
      }
    });
  }

  /** A draft is cancelled, or a payout failed: the entries go back to the next run. */
  async function release(kind, id, { to, note }) {
    await prisma.$transaction(async (tx) => {
      const from = to === 'FAILED' ? ['PROCESSING'] : ['DRAFT', 'PROCESSING'];
      const res = await model(tx, kind).updateMany({
        where: { id, status: { in: from } },
        data: { status: to, note },
      });
      if (res.count !== 1)
        throw new AppError('INVALID_STATE_TRANSITION', 'This settlement cannot be changed now.');
      await entryModel(tx, kind).updateMany({ where: { settlementId: id }, data: { settlementId: null } });
    });
  }

  /** The daily job (06:00 India time): due settlements for everyone, then the next run is scheduled. */
  async function tick() {
    const now = clock.now();
    const [r, d] = [await runRestaurants({ now }), await runRiders({ now })];
    log?.info?.(
      {
        restaurants: r.filter((x) => x.outcome === 'CREATED').length,
        riders: d.filter((x) => x.outcome === 'CREATED').length,
      },
      'settlement run',
    );
    await enqueueEvent(prisma, {
      aggregateType: 'SETTLEMENT',
      aggregateId: TICK_ID,
      eventType: 'settlements.tick',
      payload: {},
      availableAt: nextRunAt(now, TZ_DEFAULT),
    });
  }

  /** Called when a worker starts: makes sure one daily run is scheduled. */
  async function ensureScheduled() {
    const pending = await prisma.outboxEvent.findFirst({
      where: { eventType: 'settlements.tick', publishedAt: null, failedAt: null },
    });
    if (!pending)
      await enqueueEvent(prisma, {
        aggregateType: 'SETTLEMENT',
        aggregateId: TICK_ID,
        eventType: 'settlements.tick',
        payload: {},
        availableAt: nextRunAt(clock.now(), TZ_DEFAULT),
      });
  }

  const handlers = { 'settlements.tick': async () => void (await tick()) };
  return {
    runRestaurants,
    runRiders,
    approve,
    markPaid,
    release,
    tick,
    ensureScheduled,
    handlers,
    restaurantBreakdown,
  };
}
