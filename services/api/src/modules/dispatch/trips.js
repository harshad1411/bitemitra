// The rider's trip after accepting (D-76, D-77, D-78): at restaurant → picked up (order number checked, food
// ready) → on the way → arrived → delivered (delivery code, cash, proof photo when switched on). Each step is
// one engine transition written with the order version; delivery also records the cash collected and the
// rider's final pay in the same transaction.
import { parseRuleParams, riderEarningFinal } from '@jamzo/pricing-engine';
import { AppError, notFound } from '../../core/errors.js';
import { applyResult, asAppError, eventOn } from '../orders/service.js';
import { checkDeliveryCode } from './otp.js';

const lockOrder = (tx, id) => tx.$queryRaw`SELECT id FROM orders WHERE id = ${id}::uuid FOR UPDATE`;

/**
 * @param {{ prisma: any, clock: { now: () => Date }, otpSecret: string }} deps
 */
export function createTrips({ prisma, clock, otpSecret }) {
  /** Loads the rider's own order under a row lock and runs `fn`. */
  async function onTrip(riderId, orderId, fn) {
    return prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.riderId !== riderId) throw notFound('Trip');
      try {
        return await fn(tx, order);
      } catch (err) {
        throw asAppError(err);
      }
    });
  }
  const rider = (riderId) => ({ type: 'RIDER', id: riderId });

  const atRestaurant = (riderId, orderId) =>
    onTrip(riderId, orderId, (tx, order) => {
      const now = clock.now();
      return applyResult(tx, order, eventOn(order, 'RIDER_AT_RESTAURANT', { actor: rider(riderId), now }), {
        now,
        extra: { riderAtRestaurantAt: now },
      });
    });

  const pickedUp = (riderId, orderId, orderDigits) =>
    onTrip(riderId, orderId, async (tx, order) => {
      const now = clock.now();
      const verified = order.orderNumber.slice(-4) === orderDigits;
      if (!verified)
        throw new AppError(
          'VALIDATION_FAILED',
          'Those digits do not match this order. Check the order number on the bag.',
          {
            fieldErrors: { orderDigits: ['Does not match'] },
          },
        );
      const picked = await applyResult(
        tx,
        order,
        eventOn(order, 'PICKED_UP', { actor: rider(riderId), now, orderNumberVerified: true }),
        { now },
      );
      // The trip starts automatically (ORDERS.md §3.3): a second history row, same transaction.
      return applyResult(
        tx,
        picked,
        eventOn(picked, 'TRIP_STARTED', { actor: { type: 'SYSTEM', id: null }, now }),
        { now },
      );
    });

  const arrived = (riderId, orderId) =>
    onTrip(riderId, orderId, (tx, order) => {
      const now = clock.now();
      return applyResult(tx, order, eventOn(order, 'ARRIVED', { actor: rider(riderId), now }), {
        now,
        extra: { arrivedAtCustomerAt: now },
      });
    });

  /** Handover. `flags` are the evaluated feature flags for the order's city. */
  async function delivered(riderId, orderId, body, flags) {
    const now = clock.now();
    // A wrong delivery code is counted outside the handover transaction so the count survives the refusal.
    if (flags.delivery_otp) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.riderId !== riderId) throw notFound('Trip');
      if (!body.otp || !checkDeliveryCode(otpSecret, orderId, body.otp)) {
        const attempts = order.deliveryOtpAttempts + 1;
        await prisma.order.update({
          where: { id: orderId },
          data: {
            deliveryOtpAttempts: attempts,
            ...(attempts >= 5 ? { needsAttention: true, attentionReason: 'DELIVERY_CODE_ATTEMPTS' } : {}),
          },
        });
        throw new AppError(
          'VALIDATION_FAILED',
          body.otp
            ? 'That delivery code is not right. Ask the customer again.'
            : 'Enter the delivery code the customer sees in their app.',
          {
            fieldErrors: { otp: ['Incorrect'] },
            details: { attempts },
          },
        );
      }
    }
    return onTrip(riderId, orderId, async (tx, order) => {
      const cod = order.paymentMethod === 'COD' && order.codAmountPaise > 0;
      if (cod && body.codCollectedPaise !== order.codAmountPaise)
        throw new AppError(
          'VALIDATION_FAILED',
          `Collect exactly ₹${(order.codAmountPaise / 100).toFixed(2)} in cash.`,
          {
            fieldErrors: { codCollectedPaise: ['Must equal the amount to collect'] },
          },
        );
      if (flags.proof_of_delivery) {
        const media = body.proofMediaId
          ? await tx.media.findUnique({ where: { id: body.proofMediaId } })
          : null;
        if (!media || media.kind !== 'DOCUMENT')
          throw new AppError('VALIDATION_FAILED', 'Take a photo of the handover first.');
      }
      const done = await applyResult(
        tx,
        order,
        eventOn(order, 'DELIVERED', {
          actor: rider(riderId),
          now,
          requireOtp: false, // checked above
          otpVerified: true,
          codCollected: cod ? true : undefined,
          requireProof: false, // checked above
          proofProvided: true,
        }),
        { now, extra: { deliveryProofMediaId: body.proofMediaId ?? null } },
      );
      if (cod)
        await tx.payment.create({
          data: {
            orderId,
            method: 'COD',
            provider: 'cod',
            status: 'SUCCEEDED',
            amountPaise: order.codAmountPaise,
            capturedPaise: order.codAmountPaise,
            codCollectedById: riderId,
            codCollectedAt: now,
            createdAt: now,
          },
        });
      const a = await tx.orderAssignment.findFirst({ where: { orderId, status: 'ACCEPTED' } });
      if (a) await tx.orderAssignment.update({ where: { id: a.id }, data: { status: 'COMPLETED' } });
      await tx.riderAvailability.update({ where: { riderId }, data: { activeOrderCount: { decrement: 1 } } });
      await recordEarning(tx, done, riderId, a, now);
      return done;
    });
  }

  /** Final pay from the rule version the order was priced with (D-78). */
  async function recordEarning(tx, order, riderId, assignment, now) {
    const snap = await tx.orderPricingSnapshot.findUnique({ where: { orderId: order.id } });
    const city = await tx.city.findUnique({ where: { id: order.cityId } });
    const ruleId = snap?.riderEarningRule?.ruleId ?? null;
    const rule = ruleId ? await tx.riderEarningRule.findUnique({ where: { id: ruleId } }) : null;
    const waitingMin =
      order.riderAtRestaurantAt && order.pickedUpAt
        ? Math.max(0, (order.pickedUpAt.getTime() - order.riderAtRestaurantAt.getTime()) / 60_000)
        : 0;
    const breakdown = rule
      ? riderEarningFinal(parseRuleParams('RIDER_EARNING', rule), {
          deliveryDistanceM: snap.distanceM,
          pickupDistanceM: assignment?.pickupDistanceM ?? 0,
          waitingMin,
          tipPaise: snap.tipPaise,
          now: order.pickedUpAt ?? now,
          timeZone: city.timezone,
        })
      : {
          tripPaise: 0,
          tipPaise: snap?.tipPaise ?? 0,
          totalPaise: snap?.tipPaise ?? 0,
          note: 'No rider pay rule was in force',
        };
    await tx.riderEarning.create({
      data: {
        riderId,
        orderId: order.id,
        ruleId,
        kind: 'DELIVERY',
        totalPaise: breakdown.totalPaise,
        breakdown,
        createdAt: now,
      },
    });
  }

  return { atRestaurant, pickedUp, arrived, delivered };
}

/**
 * When an order is cancelled: withdraw open offers, free the rider, and record the cancelled-trip pay when a
 * rider had accepted (OD-39, D-78). Called inside the cancellation transaction.
 */
export async function releaseRiderOnCancel(tx, order, outcome, now) {
  await tx.orderAssignment.updateMany({
    where: { orderId: order.id, status: 'OFFERED' },
    data: { status: 'CANCELLED', respondedAt: now },
  });
  const a = await tx.orderAssignment.findFirst({ where: { orderId: order.id, status: 'ACCEPTED' } });
  if (!a) return;
  await tx.orderAssignment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
  await tx.riderAvailability.update({
    where: { riderId: a.riderId },
    data: { activeOrderCount: { decrement: 1 } },
  });
  if (outcome.riderCompensationPaise > 0)
    await tx.riderEarning.create({
      data: {
        riderId: a.riderId,
        orderId: order.id,
        kind: 'CANCELLED_TRIP',
        totalPaise: outcome.riderCompensationPaise,
        breakdown: {
          cancelledTrip: true,
          compensationPaise: outcome.riderCompensationPaise,
          stage: outcome.stage,
        },
        createdAt: now,
      },
    });
}
