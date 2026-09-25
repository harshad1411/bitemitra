// Refund records (D-86) — no gateway calls here, so order cancellation can create refunds inside its own
// transaction. The worker job `refund.process` talks to the gateway (payments/service.js).
import { AppError } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';

/**
 * Refunds that count against what can be refunded. A FAILED refund still owes the customer that money: it
 * is retried (admin "Retry"), never replaced by a second refund.
 */
const OPEN = ['PENDING_APPROVAL', 'REQUESTED', 'PROCESSING', 'FAILED', 'SUCCEEDED'];

/** Online payments whose money Jamzo holds: captured minus refunded (cash on delivery is not included). */
export async function paidOnline(db, orderId) {
  const rows = await db.payment.findMany({
    where: { orderId, status: 'SUCCEEDED', provider: { not: 'cod' } },
  });
  return rows.reduce((n, p) => n + p.capturedPaise - p.refundedPaise, 0);
}

/**
 * How much can still be refunded for an order, and from which payment. Online: captured − refunds that are
 * open or done. Cash on delivery: the collected cash − refunds (paid back outside the gateway).
 */
export async function refundable(db, orderId) {
  const [payments, refunds] = await Promise.all([
    db.payment.findMany({ where: { orderId, status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } }),
    db.refund.findMany({ where: { orderId, status: { in: OPEN } } }),
  ]);
  const online = payments.find((p) => p.provider !== 'cod') ?? null;
  const cod = payments.find((p) => p.provider === 'cod') ?? null;
  const paid = (online?.capturedPaise ?? 0) + (cod?.capturedPaise ?? 0);
  const committed = refunds.reduce((n, r) => n + r.amountPaise, 0);
  return { payment: online, cod, paidPaise: paid, refundablePaise: Math.max(0, paid - committed) };
}

/**
 * Creates a refund (idempotent by key). Online refunds are queued for the gateway unless they wait for a
 * second approver; cash-on-delivery refunds wait for the payout reference.
 * @param {any} tx
 * @param {{ orderId: string, type: string, amountPaise: number, reason: string, idempotencyKey: string,
 *   actor: { type: string, id?: string | null }, bearer?: 'RESTAURANT' | 'PLATFORM', breakdown?: any,
 *   needsApproval?: boolean, now: Date }} i
 */
export async function requestRefund(tx, i) {
  const existing = await tx.refund.findUnique({ where: { idempotencyKey: i.idempotencyKey } });
  if (existing) return existing;
  if (!Number.isInteger(i.amountPaise) || i.amountPaise <= 0)
    throw new AppError('VALIDATION_FAILED', 'The refund amount must be more than zero.');
  // Serialise refunds of one order so two at once cannot both pass the "how much is left" check.
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${i.orderId}::uuid FOR UPDATE`;
  const left = await refundable(tx, i.orderId);
  if (i.amountPaise > left.refundablePaise)
    throw new AppError(
      'REFUND_TOO_LARGE',
      `Only ₹${(left.refundablePaise / 100).toFixed(2)} can still be refunded for this order.`,
      { details: { refundablePaise: left.refundablePaise } },
    );
  const refund = await tx.refund.create({
    data: {
      orderId: i.orderId,
      paymentId: left.payment?.id ?? null,
      type: /** @type {any} */ (i.type),
      status: i.needsApproval ? 'PENDING_APPROVAL' : 'REQUESTED',
      amountPaise: i.amountPaise,
      reason: i.reason,
      breakdown: i.breakdown ?? undefined,
      idempotencyKey: i.idempotencyKey,
      actorType: /** @type {any} */ (i.actor.type),
      actorId: i.actor.id ?? null,
      bearer: i.bearer ?? 'PLATFORM',
      createdAt: i.now,
    },
  });
  await tx.order.update({ where: { id: i.orderId }, data: { financialStatus: 'REFUND_PENDING' } });
  if (refund.status === 'REQUESTED' && refund.paymentId) await queueRefund(tx, refund.id);
  return refund;
}

/** Hands a refund to the worker (`refund.process`), optionally after a delay (retries). */
export function queueRefund(tx, refundId, delayMs = 0, now = new Date()) {
  return enqueueEvent(tx, {
    aggregateType: 'REFUND',
    aggregateId: refundId,
    eventType: 'refund.process',
    payload: { refundId },
    ...(delayMs ? { availableAt: new Date(now.getTime() + delayMs) } : {}),
  });
}

/**
 * Marks a refund done (gateway processed it, or the cash payout reference was recorded) and updates the
 * payment and the order's financial status. Safe to call twice.
 */
export async function completeRefund(tx, refundId, { now, manualReference = null }) {
  const done = await tx.refund.updateMany({
    where: { id: refundId, status: { in: ['REQUESTED', 'PROCESSING'] } },
    data: {
      status: 'SUCCEEDED',
      processedAt: now,
      failureReason: null,
      ...(manualReference ? { manualReference } : {}),
    },
  });
  if (done.count !== 1) return false;
  const refund = await tx.refund.findUnique({ where: { id: refundId } });
  if (refund.paymentId)
    await tx.payment.update({
      where: { id: refund.paymentId },
      data: { refundedPaise: { increment: refund.amountPaise } },
    });
  await settleFinancialStatus(tx, refund.orderId);
  await enqueueEvent(tx, {
    aggregateType: 'ORDER',
    aggregateId: refund.orderId,
    eventType: 'order.refunded',
    payload: { orderId: refund.orderId, refundId, amountPaise: refund.amountPaise },
  });
  return true;
}

/** The order's financial status from its refunds: pending while any is open or failed, else partly or fully refunded. */
export async function settleFinancialStatus(tx, orderId) {
  const [refunds, left] = await Promise.all([
    tx.refund.findMany({ where: { orderId } }),
    refundable(tx, orderId),
  ]);
  const open = refunds.some((r) =>
    ['PENDING_APPROVAL', 'REQUESTED', 'PROCESSING', 'FAILED'].includes(r.status),
  );
  const refunded = refunds.filter((r) => r.status === 'SUCCEEDED').reduce((n, r) => n + r.amountPaise, 0);
  const status = open
    ? 'REFUND_PENDING'
    : refunded === 0
      ? 'NONE'
      : refunded >= left.paidPaise
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';
  await tx.order.update({ where: { id: orderId }, data: { financialStatus: status } });
}

/**
 * A rejected order (by the restaurant, or automatically for no response) gives back everything paid online
 * (D-86). Nobody else has been paid yet, so Jamzo simply returns the money it holds. Safe to call twice.
 */
export async function refundRejected(tx, orderId, now) {
  const paid = await paidOnline(tx, orderId);
  if (paid <= 0) return null;
  return requestRefund(tx, {
    orderId,
    type: 'FULL',
    amountPaise: paid,
    reason: 'The restaurant could not take the order',
    idempotencyKey: `reject:${orderId}`,
    actor: { type: 'SYSTEM', id: null },
    bearer: 'PLATFORM',
    breakdown: { source: 'REJECTION' },
    now,
  });
}
