// Cash deposits (D-90), manual adjustments (D-92) and the Finance checks (SETTLEMENTS.md §5).
import { isUniqueViolation } from '@jamzo/database';
import { RIDER_COD_TYPES, conservation, signed } from '@jamzo/settlement-engine';
import { AppError } from '../../core/errors.js';
import { postEntries } from './post.js';

const num = (v) => Number(v ?? 0);

/** @param {{ prisma: any, clock?: { now: () => Date } }} deps */
export function createMoney({ prisma, clock = { now: () => new Date() } }) {
  // ── Cash deposits (D-90) ──────────────────────────────────────────────────
  /** @param {string} riderId @param {any} i */
  async function reportDeposit(
    riderId,
    { amountPaise, method, reference, idempotencyKey, reportedBy, receivedById = null },
  ) {
    try {
      return await prisma.riderCodDeposit.create({
        data: {
          riderId,
          amountPaise,
          method,
          reference: reference ?? null,
          reportedBy,
          receivedById,
          idempotencyKey: `${reportedBy.toLowerCase()}:${idempotencyKey}`,
          createdAt: clock.now(),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return prisma.riderCodDeposit.findUnique({
        where: { idempotencyKey: `${reportedBy.toLowerCase()}:${idempotencyKey}` },
      });
    }
  }

  /**
   * Finance confirms the money arrived: cash held goes down by the deposit (anything above the cash held is
   * owed back to the partner), and collected cash payments are marked reconciled in collection order.
   */
  async function verifyDeposit(depositId, adminUserId) {
    const now = clock.now();
    return prisma.$transaction(async (tx) => {
      const d = await tx.riderCodDeposit.findUnique({ where: { id: depositId } });
      if (!d || d.status !== 'PENDING')
        throw new AppError('INVALID_STATE_TRANSITION', 'This deposit is not waiting for a check.');
      await tx.riderLedger.upsert({
        where: { riderId: d.riderId },
        create: { riderId: d.riderId },
        update: {},
      });
      const [l] =
        await tx.$queryRaw`SELECT id, "codHeldPaise" FROM rider_ledgers WHERE "riderId" = ${d.riderId}::uuid FOR UPDATE`;
      const held = num(l.codHeldPaise);
      const submitted = Math.min(d.amountPaise, Math.max(0, held));
      const excess = d.amountPaise - submitted;
      await tx.riderCodDeposit.update({
        where: { id: d.id },
        data: {
          status: 'VERIFIED',
          verifiedById: adminUserId,
          verifiedAt: now,
          expectedPaise: held,
          variancePaise: excess,
        },
      });
      await postEntries(
        tx,
        { riderId: d.riderId },
        {
          rider: [
            ...(submitted > 0
              ? [
                  {
                    type: 'COD_SUBMITTED',
                    direction: 'DEBIT',
                    amountPaise: submitted,
                    key: `deposit:${d.id}:COD_SUBMITTED`,
                    description: `${d.method} ${d.reference ?? ''}`.trim(),
                  },
                ]
              : []),
            ...(excess > 0
              ? [
                  {
                    type: 'COD_EXCESS',
                    direction: 'CREDIT',
                    amountPaise: excess,
                    key: `deposit:${d.id}:COD_EXCESS`,
                    description: 'Deposited more than the cash held',
                  },
                ]
              : []),
          ],
        },
        { now, createdById: adminUserId },
      );
      await reconcileCod(tx, d.riderId, d.id, now);
      return tx.riderCodDeposit.findUnique({ where: { id: d.id } });
    });
  }

  /** FIFO: collected cash payments are reconciled while all cash handed over (deposits, netting) covers them. */
  async function reconcileCod(tx, riderId, ref, now) {
    const ledger = await tx.riderLedger.findUnique({ where: { riderId } });
    const submitted = await tx.riderLedgerEntry.aggregate({
      where: { ledgerId: ledger.id, type: 'COD_SUBMITTED' },
      _sum: { amountPaise: true },
    });
    let covered = num(submitted._sum.amountPaise);
    const payments = await tx.payment.findMany({
      where: { provider: 'cod', status: 'SUCCEEDED', codCollectedById: riderId },
      orderBy: { codCollectedAt: 'asc' },
    });
    for (const p of payments) {
      covered -= p.capturedPaise;
      if (covered < 0) break;
      if (!p.codReconciledAt)
        await tx.payment.update({
          where: { id: p.id },
          data: { codReconciledAt: now, codSettlementRef: ref },
        });
    }
  }

  async function rejectDeposit(depositId, adminUserId, note) {
    const res = await prisma.riderCodDeposit.updateMany({
      where: { id: depositId, status: 'PENDING' },
      data: { status: 'REJECTED', verifiedById: adminUserId, verifiedAt: clock.now(), note },
    });
    if (res.count !== 1)
      throw new AppError('INVALID_STATE_TRANSITION', 'This deposit is not waiting for a check.');
  }

  // ── Manual adjustments (D-92) ────────────────────────────────────────────
  /** @param {'RESTAURANT' | 'RIDER'} kind */
  async function adjust(kind, id, { type, direction, amountPaise, reason, idempotencyKey, adminUserId }) {
    const entry = { type, direction, amountPaise, key: `manual:${idempotencyKey}`, description: reason };
    const now = clock.now();
    return prisma.$transaction((tx) =>
      postEntries(
        tx,
        kind === 'RESTAURANT' ? { restaurantId: id } : { riderId: id },
        kind === 'RESTAURANT' ? { restaurant: [entry] } : { rider: [entry] },
        { now, createdById: adminUserId },
      ),
    );
  }

  // ── Finance checks (SETTLEMENTS.md §5) ───────────────────────────────────
  /**
   * Every delivered order in the range must add up (what the customer paid = everyone's share), and every
   * cached balance must equal the sum of its entries.
   */
  async function checks({ from, to }) {
    const orders = await prisma.order.findMany({
      where: { status: 'DELIVERED', deliveredAt: { gte: from, lt: to } },
      select: { id: true, orderNumber: true, restaurantId: true },
      orderBy: { deliveredAt: 'asc' },
      take: 2000,
    });
    const ids = orders.map((o) => o.id);
    const key = () => ({ orderId: { in: ids }, idempotencyKey: { startsWith: 'order:' } });
    const [rest, rider, platform, pays] = await Promise.all([
      prisma.restaurantLedgerEntry.findMany({ where: key() }),
      prisma.riderLedgerEntry.findMany({ where: key() }),
      prisma.platformLedgerEntry.findMany({ where: key() }),
      prisma.payment.findMany({ where: { orderId: { in: ids }, status: 'SUCCEEDED' } }),
    ]);
    const by = (list) => list.reduce((m, e) => m.set(e.orderId, [...(m.get(e.orderId) ?? []), e]), new Map());
    const [R, D, P] = [by(rest), by(rider), by(platform)];
    const toEntry = (e) => ({
      type: e.type,
      direction: e.direction,
      amountPaise: num(e.amountPaise),
      key: e.idempotencyKey,
    });
    const orderResults = orders.map((o) => {
      const paid = pays.filter((p) => p.orderId === o.id).reduce((n, p) => n + p.capturedPaise, 0);
      if (!R.get(o.id) && !P.get(o.id))
        return { orderId: o.id, orderNumber: o.orderNumber, status: 'NOT_POSTED' };
      const c = conservation({
        paidPaise: paid,
        restaurant: (R.get(o.id) ?? []).map(toEntry),
        rider: (D.get(o.id) ?? []).map(toEntry),
        platform: (P.get(o.id) ?? []).map(toEntry),
      });
      return { orderId: o.id, orderNumber: o.orderNumber, status: c.ok ? 'OK' : 'MISMATCH', ...c };
    });

    const drift = [];
    for (const l of await prisma.restaurantLedger.findMany({ include: { restaurant: true } })) {
      const entries = await prisma.restaurantLedgerEntry.findMany({ where: { ledgerId: l.id } });
      const sum = entries.reduce(
        (n, e) => n + signed({ direction: e.direction, amountPaise: num(e.amountPaise) }),
        0,
      );
      if (sum !== num(l.balancePaise))
        drift.push({
          kind: 'RESTAURANT',
          id: l.restaurantId,
          name: l.restaurant.name,
          cachedPaise: num(l.balancePaise),
          entriesPaise: sum,
        });
    }
    for (const l of await prisma.riderLedger.findMany()) {
      const entries = await prisma.riderLedgerEntry.findMany({ where: { ledgerId: l.id } });
      const part = (cod) =>
        entries
          .filter((e) => RIDER_COD_TYPES.includes(e.type) === cod)
          .reduce((n, e) => n + signed({ direction: e.direction, amountPaise: num(e.amountPaise) }), 0);
      if (part(false) !== num(l.earningsBalancePaise) || part(true) !== num(l.codHeldPaise))
        drift.push({
          kind: 'RIDER',
          id: l.riderId,
          cachedPaise: num(l.earningsBalancePaise),
          entriesPaise: part(false),
        });
    }
    return {
      orders: {
        checked: orderResults.length,
        ok: orderResults.filter((r) => r.status === 'OK').length,
        problems: orderResults.filter((r) => r.status !== 'OK'),
      },
      balances: { drift },
    };
  }

  return { reportDeposit, verifyDeposit, rejectDeposit, adjust, checks };
}
