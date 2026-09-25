// Dispatch (D-75). Offers go to one rider at a time; the database decides races (one ACCEPTED assignment
// per order — constraints.sql) and the order version decides everything else. The ranking itself is the
// pure strategy in @jamzo/delivery-engine. Follow-up work (next offer, retries, timeouts) is queued in the
// outbox so a crashed process never leaves an order without dispatch.
import { STRATEGY_ID, rankCandidates } from '@jamzo/delivery-engine';
import { isUniqueViolation } from '@jamzo/database';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';
import { createConfigService } from '../configuration/service.js';
import { applyResult, asAppError, eventOn, publishNotice } from '../orders/service.js';
import { codBalances } from '../riders/service.js';

const LIVE_DISPATCH = ['SEARCHING', 'NO_RIDER_FOUND'];
const num = (v) => (v == null ? null : Number(v));

/**
 * @param {{ prisma: import('@jamzo/database').Db, clock?: { now: () => Date }, log?: any, config?: any }} deps
 */
export function createDispatch({ prisma, clock = { now: () => new Date() }, log, config: cfg }) {
  const config = cfg ?? createConfigService(prisma, clock);
  const system = { type: 'SYSTEM', id: null };

  async function settingsFor(order) {
    const ctx = await config.contextFor('BRANCH', order.branchId);
    const [offers, cod] = await Promise.all([
      config.resolve('dispatch.offers', ctx),
      config.resolve('cod', ctx),
    ]);
    return { ...offers.value, riderLimitPaise: cod.value.riderLimitPaise };
  }

  const lock = (tx, orderId) => tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;

  /** Starts the delivery track once the kitchen accepted (dispatch.startAt = ON_ACCEPT) and offers. */
  async function start(orderId) {
    const now = clock.now();
    await prisma.$transaction(async (tx) => {
      await lock(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.deliveryStatus !== 'NOT_STARTED') return;
      if (!['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(order.restaurantStatus)) return;
      await applyResult(tx, order, eventOn(order, 'DISPATCH_START', { actor: system, now }), { now });
    });
    await offerNext(orderId);
  }

  /** Offers the order to the best eligible rider, or escalates / schedules a retry. */
  async function offerNext(orderId) {
    const now = clock.now();
    return prisma.$transaction(async (tx) => {
      await lock(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || !LIVE_DISPATCH.includes(order.deliveryStatus))
        return { offered: false, reason: 'NOT_SEARCHING' };
      const pending = await tx.orderAssignment.findFirst({ where: { orderId, status: 'OFFERED' } });
      if (pending) return { offered: false, reason: 'OFFER_PENDING' };
      const s = await settingsFor(order);
      const branch = await tx.restaurantBranch.findUnique({ where: { id: order.branchId } });
      const history = await tx.orderAssignment.findMany({ where: { orderId }, select: { riderId: true } });
      const riders = await tx.rider.findMany({
        where: { cityId: order.cityId, onboardingStatus: 'ACTIVE', availability: { isOnline: true } },
        include: { availability: true },
      });
      const balances = await codBalances(
        tx,
        riders.map((r) => r.id),
      );
      const { ranked } = rankCandidates({
        order: {
          id: order.id,
          zoneIds: [...new Set([order.zoneId, branch.zoneId].filter(Boolean))],
          paymentMethod: order.paymentMethod,
          codAmountPaise: order.codAmountPaise,
        },
        restaurant: { lat: num(branch.lat), lng: num(branch.lng) },
        riders: riders.map((r) => ({
          id: r.id,
          onboardingStatus: r.onboardingStatus,
          isOnline: r.availability.isOnline,
          lat: num(r.availability.lastLat),
          lng: num(r.availability.lastLng),
          lastLocationAt: r.availability.lastLocationAt,
          zoneId: r.availability.zoneId,
          activeOrderCount: r.availability.activeOrderCount,
          codEnabled: r.codEnabled,
          codLimitPaise: r.codLimitPaise ?? s.riderLimitPaise,
          codBalancePaise: balances.get(r.id) ?? 0,
        })),
        alreadyOffered: history.map((h) => h.riderId),
        now,
        settings: s,
      });
      const best = ranked[0];
      if (best) {
        const expiresAt = new Date(now.getTime() + s.offerTimeoutSec * 1000);
        const assignment = await tx.orderAssignment.create({
          data: {
            orderId,
            riderId: best.riderId,
            status: 'OFFERED',
            strategy: STRATEGY_ID,
            score: best.score,
            pickupDistanceM: best.pickupDistanceM,
            offeredAt: now,
            expiresAt,
          },
        });
        await applyResult(tx, order, eventOn(order, 'RIDER_OFFERED', { actor: system, now }), {
          now,
          payload: { assignmentId: assignment.id, riderId: best.riderId },
        });
        await enqueueEvent(tx, {
          aggregateType: 'ORDER',
          aggregateId: orderId,
          eventType: 'dispatch.offer_timeout',
          payload: { orderId, assignmentId: assignment.id },
          availableAt: expiresAt,
        });
        await publishNotice(tx, {
          kind: 'offer',
          riderId: best.riderId,
          orderId,
          assignmentId: assignment.id,
        });
        return { offered: true, riderId: best.riderId, assignmentId: assignment.id };
      }
      // Nobody right now: escalate once when the wait or the number of offers is too long, keep retrying.
      const started = await tx.orderStatusHistory.findFirst({
        where: { orderId, metadata: { path: ['event'], equals: 'DISPATCH_START' } },
        orderBy: { createdAt: 'asc' },
      });
      const waitedSec = started ? (now.getTime() - started.createdAt.getTime()) / 1000 : 0;
      if (
        order.deliveryStatus === 'SEARCHING' &&
        (waitedSec >= s.noRiderEscalationSec || history.length >= s.maxOffers)
      ) {
        await applyResult(tx, order, eventOn(order, 'NO_RIDER_FOUND', { actor: system, now }), {
          now,
          extra: { needsAttention: true, attentionReason: 'NO_RIDER_FOUND' },
        });
      }
      await enqueueEvent(tx, {
        aggregateType: 'ORDER',
        aggregateId: orderId,
        eventType: 'dispatch.next',
        payload: { orderId, reason: 'RETRY' },
        availableAt: new Date(now.getTime() + s.retrySec * 1000),
      });
      return { offered: false, reason: 'NO_CANDIDATE' };
    });
  }

  /**
   * A rider accepts or declines an offer.
   * @param {{ riderId: string, assignmentId: string, accept: boolean, reason?: string }} input
   */
  async function respond({ riderId, assignmentId, accept, reason }) {
    const now = clock.now();
    try {
      return await prisma.$transaction(async (tx) => {
        const a = await tx.orderAssignment.findUnique({ where: { id: assignmentId } });
        if (!a || a.riderId !== riderId) throw notFound('Offer');
        await lock(tx, a.orderId);
        const fresh = await tx.orderAssignment.findUnique({ where: { id: assignmentId } });
        if (fresh.status !== 'OFFERED' || (fresh.expiresAt && fresh.expiresAt <= now))
          throw conflict('This delivery request is no longer available.', { reason: 'OFFER_GONE' });
        const order = await tx.order.findUnique({ where: { id: a.orderId } });
        if (accept) {
          await tx.orderAssignment.update({
            where: { id: assignmentId },
            data: { status: 'ACCEPTED', respondedAt: now },
          });
          const updated = await applyResult(
            tx,
            order,
            eventOn(order, 'RIDER_ACCEPTED', { actor: { type: 'RIDER', id: riderId }, now }),
            {
              now,
              extra: { riderId, needsAttention: false, attentionReason: null },
              payload: { assignmentId, riderId },
            },
          );
          await tx.riderAvailability.update({
            where: { riderId },
            data: { activeOrderCount: { increment: 1 } },
          });
          return { accepted: true, order: updated };
        }
        await tx.orderAssignment.update({
          where: { id: assignmentId },
          data: { status: 'REJECTED', respondedAt: now, rejectReason: reason ?? null },
        });
        await applyResult(
          tx,
          order,
          eventOn(order, 'RIDER_DECLINED', { actor: { type: 'RIDER', id: riderId }, now, reason }),
          { now },
        );
        await nextSoon(tx, a.orderId, now);
        return { accepted: false };
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('Another delivery partner already took this order.', { reason: 'TAKEN' });
      throw asAppError(err);
    }
  }

  const nextSoon = (tx, orderId, now) =>
    enqueueEvent(tx, {
      aggregateType: 'ORDER',
      aggregateId: orderId,
      eventType: 'dispatch.next',
      payload: { orderId, reason: 'NEXT' },
      availableAt: now,
    });

  /** Offer timer ran out: the offer is withdrawn and the next rider is tried. */
  async function expire(assignmentId) {
    const now = clock.now();
    const orderId = await prisma.$transaction(async (tx) => {
      const a = await tx.orderAssignment.findUnique({ where: { id: assignmentId } });
      if (!a) return null;
      await lock(tx, a.orderId);
      const fresh = await tx.orderAssignment.findUnique({ where: { id: assignmentId } });
      if (fresh.status !== 'OFFERED') return null;
      if (fresh.expiresAt && fresh.expiresAt > now) return null; // not yet (clock skew)
      await tx.orderAssignment.update({
        where: { id: assignmentId },
        data: { status: 'TIMED_OUT', respondedAt: now },
      });
      const order = await tx.order.findUnique({ where: { id: a.orderId } });
      if (order.deliveryStatus === 'ASSIGNED')
        await applyResult(
          tx,
          order,
          eventOn(order, 'RIDER_DECLINED', { actor: system, now, reason: 'OFFER_TIMED_OUT' }),
          { now },
        );
      return a.orderId;
    });
    if (orderId) await offerNext(orderId);
  }

  /**
   * An admin sends the order to a chosen rider (D-75): it bypasses ranking and eligibility except that the
   * rider must be ACTIVE and online; the rider still accepts in the app. Any pending offer is withdrawn.
   */
  async function assignManually({ orderId, riderId, adminUserId, now = clock.now() }) {
    return prisma
      .$transaction(async (tx) => assignInTx(tx, { orderId, riderId, adminUserId, now }))
      .catch((err) => {
        throw asAppError(err);
      });
  }

  async function assignInTx(tx, { orderId, riderId, adminUserId, now }) {
    await lock(tx, orderId);
    let order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Order');
    const rider = await tx.rider.findUnique({ where: { id: riderId }, include: { availability: true } });
    if (!rider || rider.onboardingStatus !== 'ACTIVE')
      throw new AppError('VALIDATION_FAILED', 'Choose an active delivery partner.');
    if (!rider.availability?.isOnline)
      throw new AppError('VALIDATION_FAILED', 'This delivery partner is offline.');
    const pending = await tx.orderAssignment.findFirst({ where: { orderId, status: 'OFFERED' } });
    if (pending) {
      await tx.orderAssignment.update({
        where: { id: pending.id },
        data: { status: 'CANCELLED', respondedAt: now },
      });
      // The open offer is withdrawn by the system on the admin's behalf (riders decline; admins reassign).
      if (order.deliveryStatus === 'ASSIGNED')
        order = await applyResult(
          tx,
          order,
          eventOn(order, 'RIDER_DECLINED', {
            actor: system,
            now,
            reason: 'REASSIGNED_BY_ADMIN',
            metadata: { adminUserId },
          }),
          { now },
        );
    }
    if (!LIVE_DISPATCH.includes(order.deliveryStatus))
      throw new AppError('INVALID_STATE_TRANSITION', 'This order is not waiting for a delivery partner.');
    const s = await settingsFor(order);
    const expiresAt = new Date(now.getTime() + s.offerTimeoutSec * 2 * 1000);
    let assignment;
    try {
      assignment = await tx.orderAssignment.create({
        data: {
          orderId,
          riderId,
          status: 'OFFERED',
          isManual: true,
          assignedById: adminUserId,
          strategy: 'MANUAL',
          offeredAt: now,
          expiresAt,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('This delivery partner already has an open request for this order.');
      throw err;
    }
    try {
      await applyResult(
        tx,
        order,
        eventOn(order, 'RIDER_OFFERED', { actor: { type: 'ADMIN', id: adminUserId }, now }),
        {
          now,
          payload: { assignmentId: assignment.id, riderId, manual: true },
        },
      );
    } catch (err) {
      throw asAppError(err);
    }
    await enqueueEvent(tx, {
      aggregateType: 'ORDER',
      aggregateId: orderId,
      eventType: 'dispatch.offer_timeout',
      payload: { orderId, assignmentId: assignment.id },
      availableAt: expiresAt,
    });
    await publishNotice(tx, { kind: 'offer', riderId, orderId, assignmentId: assignment.id });
    return assignment;
  }

  /** Before pickup the rider (with a reason) or an admin can release the order; dispatch starts again. */
  async function unassign({ orderId, actor, reason, riderId = null }) {
    const now = clock.now();
    await prisma.$transaction(async (tx) => {
      await lock(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw notFound('Order');
      if (riderId && order.riderId !== riderId) throw notFound('Order');
      const a = await tx.orderAssignment.findFirst({ where: { orderId, status: 'ACCEPTED' } });
      try {
        await applyResult(tx, order, eventOn(order, 'RIDER_UNASSIGNED', { actor, now, reason }), {
          now,
          extra: { riderId: null, riderAtRestaurantAt: null },
        });
      } catch (err) {
        throw asAppError(err);
      }
      if (a) {
        await tx.orderAssignment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
        await tx.riderAvailability.update({
          where: { riderId: a.riderId },
          data: { activeOrderCount: { decrement: 1 } },
        });
      }
      await nextSoon(tx, orderId, now);
    });
  }

  /** Worker handlers. */
  const handlers = {
    'order.accepted': async (e) => {
      const order = await prisma.order.findUnique({ where: { id: e.payload.orderId } });
      if (!order) return;
      const s = await settingsFor(order);
      if (s.startAt === 'PREP_TIME_MINUS_LEAD' && order.acceptedAt && order.prepTimeMinutes) {
        const at = new Date(
          order.acceptedAt.getTime() + Math.max(0, order.prepTimeMinutes - s.leadMinutes) * 60_000,
        );
        if (at > clock.now()) {
          await enqueueEvent(prisma, {
            aggregateType: 'ORDER',
            aggregateId: order.id,
            eventType: 'dispatch.start',
            payload: { orderId: order.id },
            availableAt: at,
          });
          return;
        }
      }
      await start(order.id);
    },
    'dispatch.start': (e) => start(e.payload.orderId),
    'dispatch.next': (e) => offerNext(e.payload.orderId).then(() => {}),
    'dispatch.offer_timeout': (e) => expire(e.payload.assignmentId),
  };

  log?.debug?.('dispatch ready');
  return { start, offerNext, respond, expire, assignManually, unassign, handlers };
}
