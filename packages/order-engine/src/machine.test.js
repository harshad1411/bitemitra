// The expected table below is transcribed from ORDERS.md §3 independently of machine.js: every
// (state, event, actor) combination is checked against it, so changing either forces a review of both.
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPES,
  DELIVERY_STATUSES,
  EVENTS,
  KITCHEN_STATUSES,
  OrderTransitionError,
  TERMINAL_STATUSES,
  deriveStatus,
  initialState,
  transition,
} from './index.js';

const now = new Date('2026-09-25T10:00:00Z');
const ANY = null;
/** event → [allowed overall statuses (null = any live), kitchen states, delivery states, actors] */
const SPEC = {
  PAYMENT_CONFIRMED: [['PAYMENT_PENDING'], ANY, ANY, ['SYSTEM']],
  PAYMENT_FAILED: [['PAYMENT_PENDING'], ANY, ANY, ['SYSTEM']],
  CUSTOMER_ABANDONED: [['CREATED', 'PAYMENT_PENDING'], ANY, ANY, ['CUSTOMER']],
  RESTAURANT_NOTIFIED: [null, ['NEW'], ANY, ['SYSTEM', 'RESTAURANT_USER'], (o) => !o.restaurantNotifiedAt],
  ACCEPT: [null, ['NEW'], ANY, ['RESTAURANT_USER', 'SYSTEM']],
  REJECT: [null, ['NEW'], ANY, ['RESTAURANT_USER', 'SYSTEM']],
  START_PREPARING: [null, ['ACCEPTED'], ANY, ['RESTAURANT_USER', 'SYSTEM']],
  MARK_READY: [null, ['ACCEPTED', 'PREPARING'], ANY, ['RESTAURANT_USER']],
  UPDATE_PREP_TIME: [null, ['ACCEPTED', 'PREPARING'], ANY, ['RESTAURANT_USER', 'ADMIN']],
  DISPATCH_START: [null, ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'], ['NOT_STARTED'], ['SYSTEM']],
  RIDER_OFFERED: [null, ANY, ['SEARCHING', 'NO_RIDER_FOUND'], ['SYSTEM', 'ADMIN']],
  RIDER_ACCEPTED: [null, ANY, ['ASSIGNED'], ['RIDER']],
  RIDER_DECLINED: [null, ANY, ['ASSIGNED'], ['RIDER', 'SYSTEM']],
  RIDER_UNASSIGNED: [null, ANY, ['ACCEPTED', 'AT_RESTAURANT'], ['RIDER', 'ADMIN']],
  RIDER_AT_RESTAURANT: [null, ANY, ['ACCEPTED'], ['RIDER']],
  PICKED_UP: [null, ANY, ['AT_RESTAURANT'], ['RIDER']],
  TRIP_STARTED: [null, ANY, ['PICKED_UP'], ['SYSTEM']],
  ARRIVED: [null, ANY, ['ON_THE_WAY'], ['RIDER']],
  DELIVERED: [null, ANY, ['ARRIVED'], ['RIDER']],
  NO_RIDER_FOUND: [null, ANY, ['SEARCHING'], ['SYSTEM']],
  DISPATCH_RETRY: [null, ANY, ['NO_RIDER_FOUND'], ['ADMIN']],
};
// Inputs that satisfy every guard, so only state and actor decide.
const OK_INPUT = {
  now,
  reason: 'test',
  prepTimeMinutes: 20,
  orderNumberVerified: true,
  otpVerified: true,
  codCollected: true,
  proofProvided: true,
};

function* states() {
  for (const status of ['CREATED', 'PAYMENT_PENDING', 'PLACED', ...TERMINAL_STATUSES])
    for (const restaurantStatus of KITCHEN_STATUSES)
      for (const deliveryStatus of DELIVERY_STATUSES)
        for (const restaurantNotifiedAt of [null, now]) {
          const o = {
            status,
            restaurantStatus,
            deliveryStatus,
            restaurantNotifiedAt,
            paymentMethod: 'COD',
            codAmountPaise: 100,
          };
          // "PLACED" stands for every live status: derive it from the tracks.
          if (status === 'PLACED') o.status = deriveStatus(o);
          if (o.status === 'RESTAURANT_REJECTED' && status === 'PLACED') continue; // not a live state
          yield o;
        }
}

describe('transition table (ORDERS.md §3)', () => {
  it('matches the spec for every state × event × actor', () => {
    const live = (o) =>
      !TERMINAL_STATUSES.includes(o.status) &&
      !['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED'].includes(o.status);
    let checked = 0;
    const mismatches = [];
    expect(Object.keys(SPEC).sort()).toEqual(Object.keys(EVENTS).sort());
    for (const o of states())
      for (const [event, [statuses, kitchen, delivery, actors, extra]] of Object.entries(SPEC))
        for (const actor of ACTOR_TYPES) {
          const stateOk =
            (statuses ? statuses.includes(o.status) : live(o)) &&
            (!kitchen || kitchen.includes(o.restaurantStatus)) &&
            (!delivery || delivery.includes(o.deliveryStatus)) &&
            (!extra || extra(o));
          const guardOk = event !== 'PICKED_UP' || o.restaurantStatus === 'READY_FOR_PICKUP';
          const expected = stateOk && actors.includes(actor) && guardOk;
          let actual;
          try {
            transition(o, /** @type {any} */ (event), { ...OK_INPUT, actor: { type: actor, id: 'x' } });
            actual = true;
          } catch (err) {
            if (!(err instanceof OrderTransitionError)) throw err;
            actual = false;
          }
          checked++;
          if (actual !== expected) mismatches.push({ event, actor, ...o, expected });
        }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
  }, 30_000); // ~160 000 cases: allow for a busy CI machine

  it('never leaves a terminal state', () => {
    for (const status of TERMINAL_STATUSES)
      for (const event of Object.keys(EVENTS))
        expect(() =>
          transition(
            { status, restaurantStatus: 'NEW', deliveryStatus: 'NOT_STARTED' },
            /** @type {any} */ (event),
            {
              ...OK_INPUT,
              actor: { type: 'SYSTEM' },
            },
          ),
        ).toThrow(OrderTransitionError);
  });

  it('reports why a transition is refused', () => {
    const o = { status: 'PLACED', restaurantStatus: 'NEW', deliveryStatus: 'NOT_STARTED' };
    const code = (fn) => {
      try {
        fn();
      } catch (e) {
        return e.code;
      }
    };
    expect(code(() => transition(o, 'MARK_READY', { now, actor: { type: 'RESTAURANT_USER' } }))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(
      code(() => transition(o, 'ACCEPT', { now, prepTimeMinutes: 10, actor: { type: 'CUSTOMER' } })),
    ).toBe('ACTOR_NOT_ALLOWED');
    expect(code(() => transition(o, 'ACCEPT', { now, actor: { type: 'RESTAURANT_USER' } }))).toBe(
      'GUARD_FAILED',
    );
    expect(
      code(() => transition(o, 'REJECT', { now, reason: '  ', actor: { type: 'RESTAURANT_USER' } })),
    ).toBe('REASON_REQUIRED');
    expect(code(() => transition(o, 'NOPE', { now, actor: { type: 'SYSTEM' } }))).toBe('INVALID_INPUT');
  });
});

describe('guards', () => {
  const atRestaurant = {
    status: 'PREPARING',
    restaurantStatus: 'PREPARING',
    deliveryStatus: 'AT_RESTAURANT',
    paymentMethod: 'COD',
    codAmountPaise: 500,
  };
  it('pickup needs the food ready and the order number checked', () => {
    expect(() =>
      transition(atRestaurant, 'PICKED_UP', { now, orderNumberVerified: true, actor: { type: 'RIDER' } }),
    ).toThrow(/not marked the order ready/);
    const ready = { ...atRestaurant, restaurantStatus: 'READY_FOR_PICKUP', status: 'RIDER_AT_RESTAURANT' };
    expect(() => transition(ready, 'PICKED_UP', { now, actor: { type: 'RIDER' } })).toThrow(/order number/);
    const r = transition(ready, 'PICKED_UP', { now, orderNumberVerified: true, actor: { type: 'RIDER' } });
    expect(r.changes).toMatchObject({
      status: 'PICKED_UP',
      restaurantStatus: 'COMPLETED',
      deliveryStatus: 'PICKED_UP',
    });
  });
  it('delivery needs cash confirmed for COD, the OTP and the photo when required', () => {
    const arrived = {
      status: 'ARRIVED',
      restaurantStatus: 'COMPLETED',
      deliveryStatus: 'ARRIVED',
      paymentMethod: 'COD',
      codAmountPaise: 500,
    };
    const rider = { type: 'RIDER' };
    expect(() => transition(arrived, 'DELIVERED', { now, actor: rider })).toThrow(/Cash collection/);
    expect(() =>
      transition(arrived, 'DELIVERED', { now, actor: rider, codCollected: true, requireOtp: true }),
    ).toThrow(/delivery code/);
    expect(() =>
      transition(arrived, 'DELIVERED', { now, actor: rider, codCollected: true, requireProof: true }),
    ).toThrow(/photo/);
    const prepaid = { ...arrived, paymentMethod: 'UPI', codAmountPaise: 0 };
    expect(transition(prepaid, 'DELIVERED', { now, actor: rider }).changes.status).toBe('DELIVERED');
  });
});

describe('deriveStatus (ORDERS.md §4)', () => {
  const d = (restaurantStatus, deliveryStatus, notified = null) =>
    deriveStatus({ status: 'PLACED', restaurantStatus, deliveryStatus, restaurantNotifiedAt: notified });
  it('follows the kitchen before the food is ready', () => {
    expect(d('NEW', 'NOT_STARTED')).toBe('PLACED');
    expect(d('NEW', 'NOT_STARTED', now)).toBe('RESTAURANT_NOTIFIED');
    expect(d('ACCEPTED', 'SEARCHING')).toBe('RESTAURANT_ACCEPTED');
    expect(d('PREPARING', 'ACCEPTED')).toBe('PREPARING');
    expect(d('REJECTED', 'CANCELLED')).toBe('RESTAURANT_REJECTED');
  });
  it('follows the rider once the food is ready', () => {
    expect(d('READY_FOR_PICKUP', 'NOT_STARTED')).toBe('READY_FOR_PICKUP');
    expect(d('READY_FOR_PICKUP', 'SEARCHING')).toBe('RIDER_SEARCHING');
    expect(d('READY_FOR_PICKUP', 'NO_RIDER_FOUND')).toBe('RIDER_SEARCHING');
    expect(d('READY_FOR_PICKUP', 'ASSIGNED')).toBe('RIDER_ASSIGNED');
    expect(d('READY_FOR_PICKUP', 'ACCEPTED')).toBe('RIDER_ACCEPTED');
    expect(d('READY_FOR_PICKUP', 'AT_RESTAURANT')).toBe('RIDER_AT_RESTAURANT');
  });
  it('after pickup the delivery track is the status', () => {
    for (const s of ['PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED']) expect(d('COMPLETED', s)).toBe(s);
  });
  it('keeps terminal and payment-phase statuses', () => {
    for (const status of [...TERMINAL_STATUSES, 'CREATED', 'PAYMENT_PENDING'])
      expect(deriveStatus({ status, restaurantStatus: 'PREPARING', deliveryStatus: 'SEARCHING' })).toBe(
        status,
      );
  });
  it('gives a spec status for every reachable pair', () => {
    for (const k of ['NEW', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'])
      for (const dl of DELIVERY_STATUSES.filter((x) => x !== 'CANCELLED'))
        expect([
          'PLACED',
          'RESTAURANT_ACCEPTED',
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
        ]).toContain(d(k, dl));
  });
});

describe('a complete lifecycle', () => {
  it('COD order: placed → accepted → preparing → rider → ready → pickup → delivered, one history row each', () => {
    const init = initialState({
      paymentMethod: 'COD',
      totalPayablePaise: 32100,
      actor: { type: 'CUSTOMER', id: 'c' },
      now,
    });
    expect(init.fields.status).toBe('PLACED');
    expect(init.history.map((h) => h.toStatus)).toEqual(['CREATED', 'PLACED']);
    let o = { ...init.fields, paymentMethod: 'COD', codAmountPaise: 32100, restaurantNotifiedAt: null };
    const steps = [
      ['RESTAURANT_NOTIFIED', 'SYSTEM', 'RESTAURANT_NOTIFIED'],
      ['ACCEPT', 'RESTAURANT_USER', 'RESTAURANT_ACCEPTED'],
      ['DISPATCH_START', 'SYSTEM', 'RESTAURANT_ACCEPTED'],
      ['START_PREPARING', 'RESTAURANT_USER', 'PREPARING'],
      ['RIDER_OFFERED', 'SYSTEM', 'PREPARING'],
      ['RIDER_DECLINED', 'RIDER', 'PREPARING'],
      ['RIDER_OFFERED', 'SYSTEM', 'PREPARING'],
      ['RIDER_ACCEPTED', 'RIDER', 'PREPARING'],
      ['RIDER_AT_RESTAURANT', 'RIDER', 'PREPARING'],
      ['MARK_READY', 'RESTAURANT_USER', 'RIDER_AT_RESTAURANT'],
      ['PICKED_UP', 'RIDER', 'PICKED_UP'],
      ['TRIP_STARTED', 'SYSTEM', 'ON_THE_WAY'],
      ['ARRIVED', 'RIDER', 'ARRIVED'],
      ['DELIVERED', 'RIDER', 'DELIVERED'],
    ];
    const history = [];
    for (const [event, actor, expected] of steps) {
      const r = transition(o, /** @type {any} */ (event), { ...OK_INPUT, actor: { type: actor, id: 'a' } });
      o = { ...o, ...r.changes };
      history.push(r.history);
      expect(o.status, event).toBe(expected);
    }
    expect(history).toHaveLength(steps.length);
    expect(history[1]).toMatchObject({
      fromStatus: 'RESTAURANT_NOTIFIED',
      toStatus: 'RESTAURANT_ACCEPTED',
      metadata: { event: 'ACCEPT', kitchen: ['NEW', 'ACCEPTED'] },
    });
    expect(o).toMatchObject({
      restaurantStatus: 'COMPLETED',
      deliveryStatus: 'DELIVERED',
      prepTimeMinutes: 20,
    });
  });

  it('online payment starts pending; ₹0 orders are placed at once', () => {
    expect(
      initialState({ paymentMethod: 'UPI', totalPayablePaise: 100, actor: { type: 'CUSTOMER' }, now }).fields
        .status,
    ).toBe('PAYMENT_PENDING');
    expect(
      initialState({ paymentMethod: 'UPI', totalPayablePaise: 0, actor: { type: 'CUSTOMER' }, now }).fields
        .status,
    ).toBe('PLACED');
    const o = { status: 'PAYMENT_PENDING', restaurantStatus: 'NEW', deliveryStatus: 'NOT_STARTED' };
    expect(transition(o, 'PAYMENT_CONFIRMED', { now, actor: { type: 'SYSTEM' } }).changes.status).toBe(
      'PLACED',
    );
    expect(transition(o, 'PAYMENT_FAILED', { now, actor: { type: 'SYSTEM' } }).changes.status).toBe(
      'PAYMENT_FAILED',
    );
  });

  it('a rejected order ends both tracks', () => {
    const o = { status: 'PLACED', restaurantStatus: 'NEW', deliveryStatus: 'NOT_STARTED' };
    const r = transition(o, 'REJECT', {
      now,
      reason: 'TOO_BUSY',
      actor: { type: 'RESTAURANT_USER', id: 'u' },
    });
    expect(r.changes).toMatchObject({
      status: 'RESTAURANT_REJECTED',
      restaurantStatus: 'REJECTED',
      deliveryStatus: 'CANCELLED',
    });
    expect(r.history.reason).toBe('TOO_BUSY');
    expect(r.emits).toBe('order.rejected');
  });
});
