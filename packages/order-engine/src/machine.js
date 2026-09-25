// The order state machine (ORDERS.md §2–§4). Pure: `transition(order, event, input)` returns the changed
// fields, one history row and the events to emit — or throws OrderTransitionError. Nothing here touches the
// database; the API applies the result with optimistic concurrency (orders.version).

export const ORDER_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAYMENT_CONFIRMED',
  'PLACED',
  'RESTAURANT_NOTIFIED',
  'RESTAURANT_ACCEPTED',
  'RESTAURANT_REJECTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'RIDER_SEARCHING',
  'RIDER_ASSIGNED',
  'RIDER_ACCEPTED',
  'RIDER_AT_RESTAURANT',
  'PICKED_UP',
  'ON_THE_WAY',
  'ARRIVED',
  'DELIVERED',
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'RIDER_ISSUE',
  'ADMIN_CANCELLED',
  'PAYMENT_FAILED',
];
export const KITCHEN_STATUSES = [
  'NEW',
  'ACCEPTED',
  'REJECTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED',
];
export const DELIVERY_STATUSES = [
  'NOT_STARTED',
  'SEARCHING',
  'ASSIGNED',
  'ACCEPTED',
  'AT_RESTAURANT',
  'PICKED_UP',
  'ON_THE_WAY',
  'ARRIVED',
  'DELIVERED',
  'NO_RIDER_FOUND',
  'CANCELLED',
];
export const ACTOR_TYPES = ['CUSTOMER', 'RESTAURANT_USER', 'RIDER', 'ADMIN', 'SYSTEM'];

/** No transition leaves these (ORDERS.md §3.4). */
export const TERMINAL_STATUSES = [
  'DELIVERED',
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'RESTAURANT_REJECTED',
  'RIDER_ISSUE',
  'ADMIN_CANCELLED',
  'PAYMENT_FAILED',
];
/** Before the tracks start. */
export const PAYMENT_PHASE = ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED'];

export class OrderTransitionError extends Error {
  /** @param {'INVALID_STATE_TRANSITION'|'ACTOR_NOT_ALLOWED'|'GUARD_FAILED'|'REASON_REQUIRED'|'INVALID_INPUT'} code @param {string} message @param {object} [details] */
  constructor(code, message, details) {
    super(message);
    this.name = 'OrderTransitionError';
    this.code = code;
    this.details = details;
  }
}

export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);
const PICKED_UP_OR_LATER = ['PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED'];

/**
 * Overall status from the two tracks (ORDERS.md §4). Terminal and payment-phase statuses are kept as they are.
 * @param {{ status: string, restaurantStatus: string, deliveryStatus: string, restaurantNotifiedAt?: Date|string|null }} o
 */
export function deriveStatus(o) {
  if (isTerminal(o.status) || PAYMENT_PHASE.includes(o.status)) return o.status;
  if (PICKED_UP_OR_LATER.includes(o.deliveryStatus)) return o.deliveryStatus;
  if (o.restaurantStatus === 'READY_FOR_PICKUP' || o.restaurantStatus === 'COMPLETED') {
    return (
      {
        NOT_STARTED: 'READY_FOR_PICKUP',
        SEARCHING: 'RIDER_SEARCHING',
        NO_RIDER_FOUND: 'RIDER_SEARCHING',
        ASSIGNED: 'RIDER_ASSIGNED',
        ACCEPTED: 'RIDER_ACCEPTED',
        AT_RESTAURANT: 'RIDER_AT_RESTAURANT',
      }[o.deliveryStatus] ?? 'READY_FOR_PICKUP'
    );
  }
  return (
    {
      NEW: o.restaurantNotifiedAt ? 'RESTAURANT_NOTIFIED' : 'PLACED',
      ACCEPTED: 'RESTAURANT_ACCEPTED',
      PREPARING: 'PREPARING',
      REJECTED: 'RESTAURANT_REJECTED',
    }[o.restaurantStatus] ?? o.status
  );
}

/**
 * Transition table. Each event: which actors may send it, where it applies and what it changes.
 * `from` checks the current order; `apply` returns the changed fields (tracks, timestamps, prep time).
 * @type {Record<string, { actors: string[], from: (o: any) => boolean, apply: (o: any, i: any) => object, emits: string, needsReason?: boolean, guard?: (o: any, i: any) => string|null }>}
 */
export const EVENTS = {
  // ── payment phase (§3.1) ──
  PAYMENT_CONFIRMED: {
    actors: ['SYSTEM'],
    from: (o) => o.status === 'PAYMENT_PENDING',
    apply: (o, i) => ({ status: 'PLACED', placedAt: i.now }),
    emits: 'order.placed',
  },
  PAYMENT_FAILED: {
    actors: ['SYSTEM'],
    from: (o) => o.status === 'PAYMENT_PENDING',
    apply: (o, i) => ({ status: 'PAYMENT_FAILED', cancelledAt: i.now }),
    emits: 'order.payment_failed',
  },
  CUSTOMER_ABANDONED: {
    actors: ['CUSTOMER'],
    from: (o) => o.status === 'CREATED' || o.status === 'PAYMENT_PENDING',
    apply: (o, i) => ({ status: 'CUSTOMER_CANCELLED', cancelledAt: i.now }),
    emits: 'order.cancelled',
  },

  // ── kitchen track (§3.2) ──
  RESTAURANT_NOTIFIED: {
    actors: ['SYSTEM', 'RESTAURANT_USER'],
    from: (o) => live(o) && o.restaurantStatus === 'NEW' && !o.restaurantNotifiedAt,
    apply: (o, i) => ({ restaurantNotifiedAt: i.now }),
    emits: 'order.restaurant_notified',
  },
  ACCEPT: {
    actors: ['RESTAURANT_USER', 'SYSTEM'],
    from: (o) => live(o) && o.restaurantStatus === 'NEW',
    guard: (o, i) =>
      Number.isInteger(i.prepTimeMinutes) && i.prepTimeMinutes > 0 ? null : 'A preparation time is required.',
    apply: (o, i) => ({
      restaurantStatus: 'ACCEPTED',
      acceptedAt: i.now,
      prepTimeMinutes: i.prepTimeMinutes,
      restaurantNotifiedAt: o.restaurantNotifiedAt ?? i.now,
    }),
    emits: 'order.accepted',
  },
  REJECT: {
    actors: ['RESTAURANT_USER', 'SYSTEM'],
    from: (o) => live(o) && o.restaurantStatus === 'NEW',
    needsReason: true,
    apply: (o, i) => ({
      restaurantStatus: 'REJECTED',
      deliveryStatus: 'CANCELLED',
      status: 'RESTAURANT_REJECTED',
      cancelledAt: i.now,
    }),
    emits: 'order.rejected',
  },
  START_PREPARING: {
    actors: ['RESTAURANT_USER', 'SYSTEM'],
    from: (o) => live(o) && o.restaurantStatus === 'ACCEPTED',
    apply: () => ({ restaurantStatus: 'PREPARING' }),
    emits: 'order.preparing',
  },
  MARK_READY: {
    actors: ['RESTAURANT_USER'],
    from: (o) => live(o) && (o.restaurantStatus === 'ACCEPTED' || o.restaurantStatus === 'PREPARING'),
    apply: (o, i) => ({ restaurantStatus: 'READY_FOR_PICKUP', readyAt: i.now }),
    emits: 'order.ready',
  },
  UPDATE_PREP_TIME: {
    actors: ['RESTAURANT_USER', 'ADMIN'],
    from: (o) => live(o) && (o.restaurantStatus === 'ACCEPTED' || o.restaurantStatus === 'PREPARING'),
    guard: (o, i) =>
      Number.isInteger(i.prepTimeMinutes) && i.prepTimeMinutes > 0 ? null : 'A preparation time is required.',
    apply: (o, i) => ({ prepTimeMinutes: i.prepTimeMinutes }),
    emits: 'order.prep_time_changed',
  },

  // ── delivery track (§3.3) ──
  DISPATCH_START: {
    actors: ['SYSTEM'],
    from: (o) =>
      live(o) &&
      o.deliveryStatus === 'NOT_STARTED' &&
      ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(o.restaurantStatus),
    apply: () => ({ deliveryStatus: 'SEARCHING' }),
    emits: 'order.dispatch_started',
  },
  RIDER_OFFERED: {
    actors: ['SYSTEM', 'ADMIN'],
    from: (o) => live(o) && (o.deliveryStatus === 'SEARCHING' || o.deliveryStatus === 'NO_RIDER_FOUND'),
    apply: () => ({ deliveryStatus: 'ASSIGNED' }),
    emits: 'order.rider_assigned',
  },
  RIDER_ACCEPTED: {
    actors: ['RIDER'],
    from: (o) => live(o) && o.deliveryStatus === 'ASSIGNED',
    apply: () => ({ deliveryStatus: 'ACCEPTED' }),
    emits: 'order.rider_accepted',
  },
  RIDER_DECLINED: {
    actors: ['RIDER', 'SYSTEM'],
    from: (o) => live(o) && o.deliveryStatus === 'ASSIGNED',
    apply: () => ({ deliveryStatus: 'SEARCHING' }),
    emits: 'order.rider_declined',
  },
  RIDER_UNASSIGNED: {
    actors: ['RIDER', 'ADMIN'],
    from: (o) => live(o) && (o.deliveryStatus === 'ACCEPTED' || o.deliveryStatus === 'AT_RESTAURANT'),
    needsReason: true,
    apply: () => ({ deliveryStatus: 'SEARCHING' }),
    emits: 'order.rider_unassigned',
  },
  RIDER_AT_RESTAURANT: {
    actors: ['RIDER'],
    from: (o) => live(o) && o.deliveryStatus === 'ACCEPTED',
    apply: () => ({ deliveryStatus: 'AT_RESTAURANT' }),
    emits: 'order.rider_at_restaurant',
  },
  PICKED_UP: {
    actors: ['RIDER'],
    from: (o) => live(o) && o.deliveryStatus === 'AT_RESTAURANT',
    guard: (o, i) =>
      o.restaurantStatus !== 'READY_FOR_PICKUP'
        ? 'The restaurant has not marked the order ready.'
        : i.orderNumberVerified
          ? null
          : 'The order number must be verified at pickup.',
    apply: (o, i) => ({ deliveryStatus: 'PICKED_UP', restaurantStatus: 'COMPLETED', pickedUpAt: i.now }),
    emits: 'order.picked_up',
  },
  TRIP_STARTED: {
    actors: ['SYSTEM'],
    from: (o) => live(o) && o.deliveryStatus === 'PICKED_UP',
    apply: () => ({ deliveryStatus: 'ON_THE_WAY' }),
    emits: 'order.on_the_way',
  },
  ARRIVED: {
    actors: ['RIDER'],
    from: (o) => live(o) && o.deliveryStatus === 'ON_THE_WAY',
    apply: () => ({ deliveryStatus: 'ARRIVED' }),
    emits: 'order.arriving',
  },
  DELIVERED: {
    actors: ['RIDER'],
    from: (o) => live(o) && o.deliveryStatus === 'ARRIVED',
    guard: (o, i) => {
      if (i.requireOtp && !i.otpVerified) return 'The delivery code must be verified.';
      if (o.paymentMethod === 'COD' && o.codAmountPaise > 0 && !i.codCollected)
        return 'Cash collection must be confirmed.';
      if (i.requireProof && !i.proofProvided) return 'A proof-of-delivery photo is required.';
      return null;
    },
    apply: (o, i) => ({ deliveryStatus: 'DELIVERED', status: 'DELIVERED', deliveredAt: i.now }),
    emits: 'order.delivered',
  },
  NO_RIDER_FOUND: {
    actors: ['SYSTEM'],
    from: (o) => live(o) && o.deliveryStatus === 'SEARCHING',
    apply: () => ({ deliveryStatus: 'NO_RIDER_FOUND' }),
    emits: 'order.no_rider_found',
  },
  DISPATCH_RETRY: {
    actors: ['ADMIN'],
    from: (o) => live(o) && o.deliveryStatus === 'NO_RIDER_FOUND',
    apply: () => ({ deliveryStatus: 'SEARCHING' }),
    emits: 'order.dispatch_started',
  },
};

/** Placed and not finished: the tracks are running. */
function live(o) {
  return !isTerminal(o.status) && !PAYMENT_PHASE.includes(o.status);
}

/**
 * Applies one event.
 * @param {object} order current order (status, restaurantStatus, deliveryStatus, restaurantNotifiedAt, paymentMethod, codAmountPaise, …)
 * @param {keyof typeof EVENTS} event
 * @param {{ actor: { type: string, id?: string|null }, now: Date, reason?: string, metadata?: object, [k: string]: any }} input
 * @returns {{ changes: object, history: { fromStatus: string, toStatus: string, actorType: string, actorId: string|null, reason: string|null, metadata: object }, emits: string }}
 */
export function transition(order, event, input) {
  const def = EVENTS[event];
  if (!def) throw new OrderTransitionError('INVALID_INPUT', `Unknown order event ${event}`);
  if (!ACTOR_TYPES.includes(input?.actor?.type))
    throw new OrderTransitionError('INVALID_INPUT', 'Unknown actor');
  if (!def.from(order))
    throw new OrderTransitionError(
      'INVALID_STATE_TRANSITION',
      `${event} is not possible while the order is ${describe(order)}.`,
      {
        event,
        status: order.status,
        restaurantStatus: order.restaurantStatus,
        deliveryStatus: order.deliveryStatus,
      },
    );
  if (!def.actors.includes(input.actor.type))
    throw new OrderTransitionError('ACTOR_NOT_ALLOWED', `${input.actor.type} cannot perform ${event}.`, {
      event,
    });
  if (def.needsReason && !input.reason?.trim())
    throw new OrderTransitionError('REASON_REQUIRED', 'A reason is required.', { event });
  const failed = def.guard?.(order, input);
  if (failed) throw new OrderTransitionError('GUARD_FAILED', failed, { event });
  const changes = def.apply(order, input);
  return finish(order, changes, event, def.emits, input);
}

function finish(order, changes, event, emits, input) {
  const next = { ...order, ...changes };
  const status = changes.status ?? deriveStatus(next);
  const all = { ...changes, status };
  return {
    changes: all,
    history: {
      fromStatus: order.status,
      toStatus: status,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      reason: input.reason?.trim() || null,
      metadata: {
        event,
        ...(changes.restaurantStatus && changes.restaurantStatus !== order.restaurantStatus
          ? { kitchen: [order.restaurantStatus, changes.restaurantStatus] }
          : {}),
        ...(changes.deliveryStatus && changes.deliveryStatus !== order.deliveryStatus
          ? { delivery: [order.deliveryStatus, changes.deliveryStatus] }
          : {}),
        ...(input.metadata ?? {}),
      },
    },
    emits,
  };
}

const describe = (o) => `${o.status} (kitchen ${o.restaurantStatus}, delivery ${o.deliveryStatus})`;

/**
 * The first states of a new order (ORDERS.md §3.1, §6): CREATED → PLACED for COD or ₹0, CREATED →
 * PAYMENT_PENDING for online payment. Returns the initial fields and the two history rows.
 * @param {{ paymentMethod: string, totalPayablePaise: number, actor: { type: string, id?: string|null }, now: Date }} i
 */
export function initialState({ paymentMethod, totalPayablePaise, actor, now }) {
  const payNow = paymentMethod !== 'COD' && totalPayablePaise > 0;
  const status = payNow ? 'PAYMENT_PENDING' : 'PLACED';
  const row = (fromStatus, toStatus) => ({
    fromStatus,
    toStatus,
    actorType: actor.type,
    actorId: actor.id ?? null,
    reason: null,
    metadata: { event: fromStatus ? (payNow ? 'CHECKOUT_ONLINE' : 'CHECKOUT_PLACED') : 'CREATED' },
  });
  return {
    fields: {
      status,
      restaurantStatus: 'NEW',
      deliveryStatus: 'NOT_STARTED',
      financialStatus: 'NONE',
      placedAt: payNow ? null : now,
    },
    history: [row(null, 'CREATED'), row('CREATED', status)],
    emits: payNow ? 'order.created' : 'order.placed',
  };
}
