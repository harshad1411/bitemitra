// Order persistence around the pure engine (ORDERS.md §1): every change is one transaction that updates the
// order with optimistic concurrency, appends a history row, records an outbox event and a realtime notice.
import { OrderTransitionError, cancel, transition } from '@jamzo/order-engine';
import { resolveScoped } from '@jamzo/config';
import { AppError, conflict } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';
import { RULE_SOURCES } from '../pricing/service.js';
import { releaseRiderOnCancel } from '../dispatch/trips.js';

export const REALTIME_CHANNEL = 'jamzo_realtime';

export const ORDER_DETAIL_INCLUDE = {
  items: { include: { addons: true }, orderBy: { createdAt: /** @type {const} */ ('asc') } },
  address: true,
  pricingSnapshot: true,
  statusHistory: { orderBy: { createdAt: /** @type {const} */ ('asc') } },
  cancellation: true,
  restaurant: { include: { city: true } },
};

/** Engine errors → API errors (409 for state, 403 for actor, 400 for input). */
export function asAppError(err) {
  if (!(err instanceof OrderTransitionError)) return err;
  if (err.code === 'ACTOR_NOT_ALLOWED')
    return new AppError('FORBIDDEN', err.message, { details: err.details });
  if (err.code === 'INVALID_STATE_TRANSITION' || err.code === 'GUARD_FAILED')
    return new AppError('INVALID_STATE_TRANSITION', err.message, { details: err.details });
  return new AppError('VALIDATION_FAILED', err.message, { details: err.details });
}

/**
 * `<CITY>-<YYMMDD>-<seq>` (D-63). The date is the city's local date.
 * @param {any} tx
 * @param {{ slug: string, timezone: string }} city
 * @param {Date} now
 */
export async function nextOrderNumber(tx, city, now) {
  const rows = await tx.$queryRaw`SELECT nextval(pg_get_serial_sequence('orders', 'orderSeq'))::int AS seq`;
  const seq = /** @type {{ seq: number }[]} */ (rows)[0].seq;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: city.timezone,
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const code = city.slug
    .replace(/[^a-z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  return {
    orderSeq: seq,
    orderNumber: `${code}-${parts.year}${parts.month}${parts.day}-${String(seq).padStart(5, '0')}`,
  };
}

/** Realtime notice, delivered only if the transaction commits (D-62). Ids and statuses only. */
export async function publishOrder(tx, order, patch, event) {
  const msg = JSON.stringify({
    kind: 'order',
    event,
    orderId: order.id,
    restaurantId: order.restaurantId,
    customerId: order.customerId,
    status: patch.status ?? order.status,
    restaurantStatus: patch.restaurantStatus ?? order.restaurantStatus,
    deliveryStatus: patch.deliveryStatus ?? order.deliveryStatus,
    needsAttention: patch.needsAttention ?? order.needsAttention ?? false,
    riderId: patch.riderId !== undefined ? patch.riderId : (order.riderId ?? null),
  });
  await tx.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${msg})`;
}

/** Any other realtime notice (rider offers, rider positions), delivered on commit like order notices. */
export async function publishNotice(tx, notice) {
  await tx.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(notice)})`;
}

/**
 * Writes an engine result: conditional update on `version`, history row, outbox event, realtime notice.
 * @param {any} tx
 * @param {any} order the row the decision was made on (its `version` is the expected one)
 * @param {{ changes: object, history: object, emits: string }} result
 * @param {{ now: Date, extra?: object, payload?: object }} opts
 */
export async function applyResult(tx, order, result, { now, extra = {}, payload = {} }) {
  const patch = { ...result.changes, ...extra };
  const res = await tx.order.updateMany({
    where: { id: order.id, version: order.version },
    data: { ...patch, version: { increment: 1 } },
  });
  if (res.count !== 1)
    throw conflict('This order was just updated by someone else. Refresh to see its current state.', {
      reason: 'ORDER_VERSION',
    });
  await tx.orderStatusHistory.create({ data: { orderId: order.id, ...result.history, createdAt: now } });
  await enqueueEvent(tx, {
    aggregateType: 'ORDER',
    aggregateId: order.id,
    eventType: result.emits,
    payload: { orderId: order.id, event: result.history.metadata.event, status: patch.status, ...payload },
  });
  await publishOrder(tx, order, patch, result.emits);
  return { ...order, ...patch, version: order.version + 1 };
}

/**
 * Loads the order (optionally locked), checks the version the client acted on, runs `decide`, writes it.
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {{ orderId: string, version?: number, where?: object,
 *           decide: (order: any, tx: any) => Promise<{ result: any, extra?: object, payload?: object, after?: (tx: any, updated: any) => Promise<void> }> }} opts
 */
export async function changeOrder(app, { orderId, version, where = {}, decide }) {
  const now = app.clock.now();
  return app.prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, ...where } });
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    if (version !== undefined && order.version !== version)
      throw conflict('This order was just updated. Refresh to see its current state.', {
        reason: 'ORDER_VERSION',
        currentVersion: order.version,
      });
    let decided;
    try {
      decided = await decide(order, tx);
    } catch (err) {
      throw asAppError(err);
    }
    const updated = await applyResult(tx, order, decided.result, {
      now,
      extra: decided.extra,
      payload: decided.payload,
    });
    await decided.after?.(tx, updated);
    return updated;
  });
}

/** Runs one engine event on an order. */
export const eventOn = (order, event, input) => transition(order, event, input);

/**
 * The cancellation rule in force for an order (most specific scope wins, D-50/D-66).
 * @param {any} db
 * @param {any} order with restaurant.city
 * @param {Date} now
 * @returns {Promise<any>} the winning rule row
 */
export async function cancellationRuleFor(db, order, now) {
  const city = order.restaurant.city;
  const state = await db.state.findUnique({ where: { id: city.stateId } });
  const ctx = {
    countryId: state.countryId,
    stateId: state.id,
    cityId: city.id,
    zoneId: order.zoneId ?? undefined,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
  };
  const targets = [
    { scope: 'GLOBAL', scopeRefId: null },
    { scope: 'COUNTRY', scopeRefId: state.countryId },
    { scope: 'STATE', scopeRefId: state.id },
    { scope: 'CITY', scopeRefId: city.id },
    ...(order.zoneId ? [{ scope: 'ZONE', scopeRefId: order.zoneId }] : []),
    { scope: 'RESTAURANT', scopeRefId: order.restaurantId },
    { scope: 'BRANCH', scopeRefId: order.branchId },
  ];
  const rows = await db[RULE_SOURCES.CANCELLATION.table].findMany({
    where: {
      OR: targets,
      effectiveFrom: { lte: now },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
    },
  });
  const hit = resolveScoped(rows, ctx, now);
  if (!hit)
    throw new AppError('INTERNAL', 'No cancellation rule is configured. Please contact support.', {
      details: { reason: 'CANCELLATION_RULE_MISSING' },
    });
  return hit.winner;
}

/**
 * Cancels an order inside `tx`: engine outcome, `order_cancellations` row, coupon usage released.
 * Refunds (Phase 7) and ledger postings (Phase 8) are not made here (D-66).
 * @param {any} tx
 * @param {any} order
 * @param {{ by: 'CUSTOMER'|'RESTAURANT'|'ADMIN', actorId: string|null, reasonCode: string, reasonText?: string,
 *           riderIssue?: boolean, override?: any, now: Date, codLimit?: number }} input
 * `codLimit` (cod.maxRefusedOrders) switches cash on delivery off for a customer whose cancellations after
 * acceptance reach it (D-70); pass it for customer cancellations.
 * @returns {Promise<{ result: any, after: (tx: any, updated?: any) => Promise<void> }>}
 */
export async function cancelDecision(
  tx,
  order,
  { by, actorId, reasonCode, reasonText, riderIssue, override, now, codLimit },
) {
  const full = await tx.order.findUnique({
    where: { id: order.id },
    include: { restaurant: { include: { city: true } }, pricingSnapshot: true },
  });
  const rule = await cancellationRuleFor(tx, full, now);
  const snap = full.pricingSnapshot;
  const result = cancel(order, {
    by,
    actorId,
    reasonCode,
    reasonText,
    riderIssue,
    override,
    now,
    rule: { id: rule.id, params: rule.params },
    amounts: cancellationAmounts(order, snap),
  });
  return {
    result,
    after: async (tx2) => {
      await tx2.orderCancellation.create({ data: { orderId: order.id, ...result.outcome, createdAt: now } });
      await releaseCouponUsage(tx2, order.id, now);
      await releaseRiderOnCancel(tx2, order, result.outcome, now);
      if (by === 'CUSTOMER' && order.paymentMethod === 'COD' && result.stage !== 'BEFORE_ACCEPT' && codLimit)
        await applyCodStrike(tx2, order.customerId, codLimit, now);
    },
  };
}

/** What has been paid and what the restaurant's food is worth, for the cancellation engine. */
export const cancellationAmounts = (order, snap) => ({
  paidPaise: 0, // Phase 5 takes cash on delivery only: nothing has been paid before delivery (D-60)
  foodValuePaise: snap ? snap.restaurantBaseSubtotalPaise - snap.restaurantFundedDiscountPaise : 0,
  tripEstimatePaise: snap?.riderEarningEstimatePaise ?? 0,
});

/** Stages whose customer cancellations count towards losing cash on delivery (D-70). */
export const COD_STRIKE_STAGES = ['AFTER_ACCEPT', 'AFTER_PREPARING'];

/** Cash-on-delivery cancellations after acceptance by this customer. */
export const codStrikes = (db, customerId) =>
  db.orderCancellation.count({
    where: {
      cancelledByType: 'CUSTOMER',
      stage: { in: COD_STRIKE_STAGES },
      order: { customerId, paymentMethod: 'COD' },
    },
  });

async function applyCodStrike(tx, customerId, limit, now) {
  const strikes = await codStrikes(tx, customerId);
  if (strikes < limit) return;
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (customer.codDisabled) return;
  await tx.customer.update({ where: { id: customerId }, data: { codDisabled: true } });
  await tx.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'customer.cod_disabled',
      entityType: 'customer',
      entityId: customerId,
      oldValue: { codDisabled: false },
      newValue: {
        codDisabled: true,
        reason: `${strikes} cash-on-delivery cancellations after acceptance (limit ${limit})`,
      },
      createdAt: now,
    },
  });
}

/** An order that ended before pickup gives its coupon use back (D-65). Safe to call twice. */
export async function releaseCouponUsage(tx, orderId, now) {
  const usage = await tx.couponUsage.findUnique({ where: { orderId } });
  if (!usage || usage.reversedAt) return;
  await tx.couponUsage.update({ where: { id: usage.id }, data: { reversedAt: now } });
  await tx.coupon.update({ where: { id: usage.couponId }, data: { usedCount: { decrement: 1 } } });
}
