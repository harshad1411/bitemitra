// Writes ledger entries (D-88). Each ledger row is locked while posting, entries whose idempotency key
// already exists are skipped (a repeated job posts nothing twice), and the cached balances move with every
// entry. Entries are append-only in the database; corrections are new entries.
import { RIDER_COD_TYPES, signed } from '@jamzo/settlement-engine';

const n = (v) => Number(v ?? 0);

/** Lock (creating if needed) the restaurant's ledger row. */
async function restaurantLedger(tx, restaurantId) {
  await tx.restaurantLedger.upsert({ where: { restaurantId }, create: { restaurantId }, update: {} });
  const [row] =
    await tx.$queryRaw`SELECT id, "balancePaise" FROM restaurant_ledgers WHERE "restaurantId" = ${restaurantId}::uuid FOR UPDATE`;
  return row;
}
async function riderLedger(tx, riderId) {
  await tx.riderLedger.upsert({ where: { riderId }, create: { riderId }, update: {} });
  const [row] =
    await tx.$queryRaw`SELECT id, "earningsBalancePaise", "codHeldPaise" FROM rider_ledgers WHERE "riderId" = ${riderId}::uuid FOR UPDATE`;
  return row;
}
const fresh = async (model, entries) => {
  if (!entries.length) return [];
  const seen = await model.findMany({
    where: { idempotencyKey: { in: entries.map((e) => e.key) } },
    select: { idempotencyKey: true },
  });
  const done = new Set(seen.map((s) => s.idempotencyKey));
  return entries.filter((e) => !done.has(e.key));
};

/**
 * @param {any} tx
 * @param {{ restaurantId?: string | null, riderId?: string | null, cityId?: string | null, orderId?: string | null,
 *   refundId?: string | null, settlementId?: string | null }} refs
 * @param {{ restaurant?: any[], rider?: any[], platform?: any[] }} postings
 * @param {{ now: Date, createdById?: string | null }} o
 * @returns {Promise<number>} how many entries were written
 */
export async function postEntries(tx, refs, postings, { now, createdById = null }) {
  let written = 0;
  const restaurant = await fresh(tx.restaurantLedgerEntry, postings.restaurant ?? []);
  if (restaurant.length) {
    const l = await restaurantLedger(tx, refs.restaurantId);
    let balance = n(l.balancePaise);
    for (const e of restaurant) {
      balance += signed(e);
      await tx.restaurantLedgerEntry.create({
        data: {
          ledgerId: l.id,
          type: e.type,
          direction: e.direction,
          amountPaise: BigInt(e.amountPaise),
          balanceAfterPaise: BigInt(balance),
          orderId: refs.orderId ?? null,
          refundId: refs.refundId ?? null,
          settlementId: e.settlementId ?? null,
          description: e.description ?? null,
          idempotencyKey: e.key,
          createdById,
          createdAt: now,
        },
      });
    }
    await tx.restaurantLedger.update({
      where: { id: l.id },
      data: { balancePaise: BigInt(balance), version: { increment: 1 } },
    });
    written += restaurant.length;
  }
  const rider = await fresh(tx.riderLedgerEntry, postings.rider ?? []);
  if (rider.length) {
    const l = await riderLedger(tx, refs.riderId);
    let earnings = n(l.earningsBalancePaise);
    let cod = n(l.codHeldPaise);
    for (const e of rider) {
      if (RIDER_COD_TYPES.includes(e.type)) cod += signed(e);
      else earnings += signed(e);
      await tx.riderLedgerEntry.create({
        data: {
          ledgerId: l.id,
          type: e.type,
          direction: e.direction,
          amountPaise: BigInt(e.amountPaise),
          orderId: refs.orderId ?? null,
          settlementId: e.settlementId ?? null,
          description: e.description ?? null,
          idempotencyKey: e.key,
          createdById,
          createdAt: now,
        },
      });
    }
    await tx.riderLedger.update({
      where: { id: l.id },
      data: { earningsBalancePaise: BigInt(earnings), codHeldPaise: BigInt(cod), version: { increment: 1 } },
    });
    written += rider.length;
  }
  const platform = await fresh(tx.platformLedgerEntry, postings.platform ?? []);
  for (const e of platform)
    await tx.platformLedgerEntry.create({
      data: {
        type: e.type,
        direction: e.direction,
        amountPaise: BigInt(e.amountPaise),
        orderId: refs.orderId ?? null,
        cityId: refs.cityId ?? null,
        description: e.description ?? null,
        idempotencyKey: e.key,
        createdAt: now,
      },
    });
  return written + platform.length;
}
