// Delivery partners (D-73, D-74, D-77): who may work, which documents they still need, and how much cash
// they are holding.
import { AppError, forbidden } from '../../core/errors.js';

export const MOTORISED = ['MOTORCYCLE', 'SCOOTER', 'EV_SCOOTER', 'CAR'];

/** Documents the rider still needs approved, given the vehicle and the setting riders.requiredDocuments. */
export function missingDocuments(rider, required) {
  const vehicle = rider.vehicles?.find((v) => v.isActive) ?? null;
  const list = vehicle && !MOTORISED.includes(vehicle.type) ? required.bicycle : required.motorised;
  const byKind = new Map();
  for (const d of rider.documents ?? []) {
    const prev = byKind.get(d.kind);
    if (!prev || d.createdAt > prev.createdAt) byKind.set(d.kind, d);
  }
  return {
    vehicle,
    required: list,
    uploaded: list.filter((k) => byKind.has(k) && byKind.get(k).status !== 'REJECTED'),
    verified: list.filter((k) => byKind.get(k)?.status === 'VERIFIED'),
    missing: list.filter((k) => !byKind.has(k) || byKind.get(k).status === 'REJECTED'),
    latest: byKind,
  };
}

/**
 * Cash the rider holds (D-77): cash collected on delivery minus cash deposited and verified. Deposits are
 * Phase 8, so for now this is everything collected.
 * @param {any} db
 * @param {string[]} riderIds
 * @returns {Promise<Map<string, number>>}
 */
export async function codBalances(db, riderIds) {
  if (!riderIds.length) return new Map();
  // Cash collected at delivery (known at once) minus cash handed over — verified deposits and netting (D-90).
  const [rows, handed] = await Promise.all([
    db.payment.groupBy({
      by: ['codCollectedById'],
      where: { provider: 'cod', status: 'SUCCEEDED', codCollectedById: { in: riderIds } },
      _sum: { capturedPaise: true },
    }),
    db.riderLedgerEntry.findMany({
      where: { type: 'COD_SUBMITTED', ledger: { riderId: { in: riderIds } } },
      select: { amountPaise: true, ledger: { select: { riderId: true } } },
    }),
  ]);
  const out = new Map(rows.map((r) => [r.codCollectedById, r._sum.capturedPaise ?? 0]));
  for (const h of handed) out.set(h.ledger.riderId, (out.get(h.ledger.riderId) ?? 0) - Number(h.amountPaise));
  return out;
}

/** The rider record of the signed-in rider-app user; 404 when they have not applied yet. */
export async function riderOf(prisma, request, include = {}) {
  const rider = await prisma.rider.findUnique({ where: { userId: request.auth.userId }, include });
  if (!rider) throw new AppError('NOT_FOUND', 'Complete your delivery partner application first.');
  return rider;
}

/** Only ACTIVE riders may work (OD-13: signing in is not approval). */
export function assertActive(rider) {
  if (rider.onboardingStatus !== 'ACTIVE')
    throw forbidden(
      rider.onboardingStatus === 'SUSPENDED'
        ? 'Your account is paused. Please contact Jamzo partner support.'
        : 'Your application is not approved yet.',
    );
}

export const firstName = (name) => (name ?? '').trim().split(/\s+/)[0] || 'Your delivery partner';
