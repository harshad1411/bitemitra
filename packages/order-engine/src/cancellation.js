// Cancellations (ORDERS.md §5, spec §35). Stage from the tracks; who may cancel; what it costs. The money
// values come from a versioned cancellation rule (D-66) whose defaults are placeholders (A-25, Q-20).
import { z } from 'zod';
import { OrderTransitionError, PAYMENT_PHASE, isTerminal } from './machine.js';

export const CANCELLATION_STAGES = ['BEFORE_ACCEPT', 'AFTER_ACCEPT', 'AFTER_PREPARING', 'AFTER_PICKUP'];
export const CANCELLING_ACTORS = ['CUSTOMER', 'RESTAURANT', 'ADMIN'];

/** Hard limits that no rule can widen (ORDERS.md §5): who may ever cancel at each stage. */
export const STAGE_ACTORS = {
  BEFORE_ACCEPT: ['CUSTOMER', 'ADMIN'], // the restaurant rejects instead of cancelling
  AFTER_ACCEPT: ['CUSTOMER', 'RESTAURANT', 'ADMIN'],
  AFTER_PREPARING: ['CUSTOMER', 'RESTAURANT', 'ADMIN'],
  AFTER_PICKUP: ['ADMIN'],
};

const amount = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({ type: z.literal('FIXED'), valuePaise: z.number().int().min(0).max(10_000_000) }),
  z.object({ type: z.literal('PERCENT_OF_FOOD'), valueBps: z.number().int().min(0).max(10_000) }),
]);
const restaurantAmount = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({ type: z.literal('FOOD_VALUE') }),
  z.object({ type: z.literal('FIXED'), valuePaise: z.number().int().min(0).max(10_000_000) }),
  z.object({ type: z.literal('PERCENT_OF_FOOD'), valueBps: z.number().int().min(0).max(10_000) }),
]);
const riderAmount = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({ type: z.literal('TRIP_ESTIMATE') }),
  z.object({ type: z.literal('FIXED'), valuePaise: z.number().int().min(0).max(10_000_000) }),
]);
/** The customer fee may also be "everything paid" (no refund — OD-38). */
const feeAmount = z.discriminatedUnion('type', [
  ...amount.options,
  z.object({ type: z.literal('FULL_AMOUNT') }),
]);
const outcomeRule = z.object({
  allowed: z.boolean(),
  customerFee: feeAmount.default({ type: 'NONE' }),
  restaurantCompensation: restaurantAmount.default({ type: 'NONE' }),
  riderCompensation: riderAmount.default({ type: 'NONE' }),
});
const stageRules = z.object({ CUSTOMER: outcomeRule, RESTAURANT: outcomeRule, ADMIN: outcomeRule });

/** Rule parameters: stage × actor → outcome (D-66). */
export const cancellationParams = z.object({
  BEFORE_ACCEPT: stageRules,
  AFTER_ACCEPT: stageRules,
  AFTER_PREPARING: stageRules,
  AFTER_PICKUP: stageRules,
});

/** Delivery states in which a rider has accepted the trip and is working on it. */
export const RIDER_ENGAGED = ['ACCEPTED', 'AT_RESTAURANT', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'];

/** Stage from the tracks at the moment of cancellation. */
export function cancellationStage(o) {
  if (['PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED'].includes(o.deliveryStatus)) return 'AFTER_PICKUP';
  if (o.restaurantStatus === 'NEW') return 'BEFORE_ACCEPT';
  if (o.restaurantStatus === 'ACCEPTED') return 'AFTER_ACCEPT';
  return 'AFTER_PREPARING';
}

const ACTOR_TYPE = { CUSTOMER: 'CUSTOMER', RESTAURANT: 'RESTAURANT_USER', ADMIN: 'ADMIN' };
const RESULT_STATUS = {
  CUSTOMER: 'CUSTOMER_CANCELLED',
  RESTAURANT: 'RESTAURANT_CANCELLED',
  ADMIN: 'ADMIN_CANCELLED',
};

const pct = (base, bps) => Math.floor((base * bps) / 10_000);
function money(spec, { foodValuePaise, tripEstimatePaise, paidPaise }) {
  switch (spec.type) {
    case 'FULL_AMOUNT':
      return paidPaise;
    case 'FIXED':
      return spec.valuePaise;
    case 'PERCENT_OF_FOOD':
      return pct(foodValuePaise, spec.valueBps);
    case 'FOOD_VALUE':
      return foodValuePaise;
    case 'TRIP_ESTIMATE':
      return tripEstimatePaise;
    default:
      return 0;
  }
}

/**
 * Cancels an order: checks who may cancel, computes the money outcome and the transition.
 * @param {object} order
 * @param {{ by: 'CUSTOMER'|'RESTAURANT'|'ADMIN', actorId?: string|null, reasonCode: string, reasonText?: string,
 *           riderIssue?: boolean, now: Date, rule: { id: string|null, params: any },
 *           amounts: { paidPaise: number, foodValuePaise: number, tripEstimatePaise: number },
 *           override?: { customerFeePaise: number, restaurantCompensationPaise: number, riderCompensationPaise: number } }} i
 * `paidPaise` is what the customer has actually paid so far (0 for cash on delivery before delivery).
 */
export function cancel(order, i) {
  if (!CANCELLING_ACTORS.includes(i.by))
    throw new OrderTransitionError('INVALID_INPUT', 'Unknown cancelling actor');
  if (!i.reasonCode?.trim()) throw new OrderTransitionError('REASON_REQUIRED', 'A reason is required.');
  if (isTerminal(order.status))
    throw new OrderTransitionError('INVALID_STATE_TRANSITION', `The order is already ${order.status}.`);
  if (i.override && i.by !== 'ADMIN')
    throw new OrderTransitionError('ACTOR_NOT_ALLOWED', 'Only an admin can override.');

  const inPaymentPhase = PAYMENT_PHASE.includes(order.status);
  const stage = inPaymentPhase ? 'BEFORE_ACCEPT' : cancellationStage(order);
  if (!STAGE_ACTORS[stage].includes(i.by))
    throw new OrderTransitionError('ACTOR_NOT_ALLOWED', cannotMessage(i.by, stage), { stage });
  if (i.riderIssue && (i.by !== 'ADMIN' || stage !== 'AFTER_PICKUP'))
    throw new OrderTransitionError('INVALID_INPUT', 'A rider issue applies only after pickup.');

  const params = cancellationParams.parse(i.rule.params);
  const rule = params[stage][i.by];
  // An admin can always cancel (support must be able to stop an order); the rule still sets the money.
  if (!rule.allowed && i.by !== 'ADMIN')
    throw new OrderTransitionError('ACTOR_NOT_ALLOWED', cannotMessage(i.by, stage), { stage, byRule: true });

  // A rider is compensated only if one had accepted the trip (OD-39): offered or unassigned trips cost nothing.
  const riderEngaged = RIDER_ENGAGED.includes(order.deliveryStatus);
  const computed = {
    customerFeePaise: money(rule.customerFee, i.amounts),
    restaurantCompensationPaise: money(rule.restaurantCompensation, i.amounts),
    riderCompensationPaise: riderEngaged ? money(rule.riderCompensation, i.amounts) : 0,
  };
  const chosen = i.override ?? computed;
  // A fee can only be kept out of money actually paid; with cash on delivery nothing has been paid.
  const customerFeePaise = Math.min(chosen.customerFeePaise, i.amounts.paidPaise);
  const refundDuePaise = i.amounts.paidPaise - customerFeePaise;
  const platformLossPaise = Math.max(
    0,
    chosen.restaurantCompensationPaise + chosen.riderCompensationPaise - customerFeePaise,
  );

  const status = i.riderIssue ? 'RIDER_ISSUE' : RESULT_STATUS[i.by];
  const changes = {
    status,
    cancelledAt: i.now,
    restaurantStatus: ['COMPLETED', 'REJECTED'].includes(order.restaurantStatus)
      ? order.restaurantStatus
      : 'CANCELLED',
    deliveryStatus: order.deliveryStatus === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED',
    financialStatus: refundDuePaise > 0 ? 'REFUND_PENDING' : order.financialStatus,
  };
  return {
    stage,
    changes,
    outcome: {
      stage,
      cancelledByType: ACTOR_TYPE[i.by],
      cancelledById: i.actorId ?? null,
      reasonCode: i.reasonCode.trim(),
      reasonText: i.reasonText?.trim() || null,
      ruleId: i.rule.id,
      ruleSnapshot: { stage, actor: i.by, rule, computed },
      customerFeePaise,
      refundDuePaise,
      restaurantCompensationPaise: chosen.restaurantCompensationPaise,
      riderCompensationPaise: chosen.riderCompensationPaise,
      platformLossPaise,
      isAdminOverride: Boolean(i.override),
    },
    history: {
      fromStatus: order.status,
      toStatus: status,
      actorType: ACTOR_TYPE[i.by],
      actorId: i.actorId ?? null,
      reason: [i.reasonCode.trim(), i.reasonText?.trim()].filter(Boolean).join(': '),
      metadata: { event: 'CANCEL', stage, ...(i.override ? { override: true } : {}) },
    },
    emits: 'order.cancelled',
  };
}

/** Whether `by` could cancel right now (for showing or hiding a Cancel button). */
export function canCancel(order, by, ruleParams) {
  if (isTerminal(order.status)) return false;
  const stage = PAYMENT_PHASE.includes(order.status) ? 'BEFORE_ACCEPT' : cancellationStage(order);
  if (!STAGE_ACTORS[stage].includes(by)) return false;
  if (by === 'ADMIN') return true;
  return Boolean(cancellationParams.parse(ruleParams)[stage][by].allowed);
}

function cannotMessage(by, stage) {
  if (by === 'RESTAURANT' && stage === 'BEFORE_ACCEPT') return 'Reject the order instead of cancelling it.';
  if (by === 'CUSTOMER' && stage !== 'BEFORE_ACCEPT')
    return 'The restaurant has already accepted this order. Please contact support to cancel it.';
  return 'This order can no longer be cancelled here.';
}
