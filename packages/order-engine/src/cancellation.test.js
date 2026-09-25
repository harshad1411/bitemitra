import { describe, expect, it } from 'vitest';
import { canCancel, cancel, cancellationParams, cancellationStage, OrderTransitionError } from './index.js';

const now = new Date('2026-09-25T10:00:00Z');
const none = { type: 'NONE' };
const rule = (allowed = true, extra = {}) => ({
  allowed,
  customerFee: none,
  restaurantCompensation: none,
  riderCompensation: none,
  ...extra,
});
const stage = (c, r, a) => ({ CUSTOMER: c, RESTAURANT: r, ADMIN: a });
/** A-25 placeholder: customer free before accept only; everything else 0. */
const DEFAULT = {
  BEFORE_ACCEPT: stage(rule(true), rule(false), rule(true)),
  AFTER_ACCEPT: stage(rule(false), rule(true), rule(true)),
  AFTER_PREPARING: stage(rule(false), rule(true), rule(true)),
  AFTER_PICKUP: stage(rule(false), rule(false), rule(true)),
};
const amounts = { paidPaise: 0, foodValuePaise: 30000, tripEstimatePaise: 3000 };
const base = (restaurantStatus, deliveryStatus = 'NOT_STARTED', status = 'PLACED') => ({
  status,
  restaurantStatus,
  deliveryStatus,
  financialStatus: 'NONE',
});
const run = (o, by, extra = {}) =>
  cancel(o, {
    by,
    reasonCode: 'CHANGED_MIND',
    now,
    rule: { id: 'rule-1', params: DEFAULT },
    amounts,
    ...extra,
  });

describe('cancellation stage', () => {
  it('comes from the tracks', () => {
    expect(cancellationStage(base('NEW'))).toBe('BEFORE_ACCEPT');
    expect(cancellationStage(base('ACCEPTED', 'SEARCHING'))).toBe('AFTER_ACCEPT');
    expect(cancellationStage(base('PREPARING'))).toBe('AFTER_PREPARING');
    expect(cancellationStage(base('READY_FOR_PICKUP', 'AT_RESTAURANT'))).toBe('AFTER_PREPARING');
    expect(cancellationStage(base('COMPLETED', 'ON_THE_WAY'))).toBe('AFTER_PICKUP');
  });
});

describe('who may cancel (A-25 defaults)', () => {
  it('customer: free before accept, not after', () => {
    const r = run(base('NEW'), 'CUSTOMER', { actorId: 'c1' });
    expect(r.changes).toMatchObject({
      status: 'CUSTOMER_CANCELLED',
      restaurantStatus: 'CANCELLED',
      deliveryStatus: 'CANCELLED',
    });
    expect(r.outcome).toMatchObject({
      stage: 'BEFORE_ACCEPT',
      cancelledByType: 'CUSTOMER',
      customerFeePaise: 0,
      refundDuePaise: 0,
      platformLossPaise: 0,
      ruleId: 'rule-1',
    });
    expect(() => run(base('ACCEPTED'), 'CUSTOMER')).toThrow(/contact support/);
    expect(canCancel(base('NEW'), 'CUSTOMER', DEFAULT)).toBe(true);
    expect(canCancel(base('ACCEPTED'), 'CUSTOMER', DEFAULT)).toBe(false);
  });
  it('restaurant: rejects before accept, cancels after, never after pickup', () => {
    expect(() => run(base('NEW'), 'RESTAURANT')).toThrow(/Reject the order/);
    expect(run(base('PREPARING'), 'RESTAURANT').changes.status).toBe('RESTAURANT_CANCELLED');
    expect(() => run(base('COMPLETED', 'PICKED_UP'), 'RESTAURANT')).toThrow(OrderTransitionError);
  });
  it('admin: always, even where the rule says no; rider issue only after pickup', () => {
    const noOne = cancellationParams.parse({
      ...DEFAULT,
      AFTER_ACCEPT: stage(rule(false), rule(false), rule(false)),
    });
    expect(
      cancel(base('ACCEPTED'), {
        by: 'ADMIN',
        reasonCode: 'OPS',
        now,
        rule: { id: null, params: noOne },
        amounts,
      }).changes.status,
    ).toBe('ADMIN_CANCELLED');
    expect(run(base('COMPLETED', 'ON_THE_WAY'), 'ADMIN', { riderIssue: true }).changes).toMatchObject({
      status: 'RIDER_ISSUE',
      restaurantStatus: 'COMPLETED',
    });
    expect(() => run(base('PREPARING'), 'ADMIN', { riderIssue: true })).toThrow(/after pickup/);
  });
  it('nothing cancels a finished order, and a reason is required', () => {
    expect(() => run(base('COMPLETED', 'DELIVERED', 'DELIVERED'), 'ADMIN')).toThrow(/already DELIVERED/);
    expect(() =>
      cancel(base('NEW'), {
        by: 'CUSTOMER',
        reasonCode: ' ',
        now,
        rule: { id: null, params: DEFAULT },
        amounts,
      }),
    ).toThrow(/reason/);
  });
  it('the customer can abandon a pending online payment', () => {
    expect(run(base('NEW', 'NOT_STARTED', 'PAYMENT_PENDING'), 'CUSTOMER').changes.status).toBe(
      'CUSTOMER_CANCELLED',
    );
  });
});

describe('money outcome', () => {
  const paid = {
    ...DEFAULT,
    AFTER_PREPARING: stage(
      rule(true, {
        customerFee: { type: 'PERCENT_OF_FOOD', valueBps: 5000 },
        restaurantCompensation: { type: 'FOOD_VALUE' },
        riderCompensation: { type: 'TRIP_ESTIMATE' },
      }),
      rule(true),
      rule(true, { restaurantCompensation: { type: 'FIXED', valuePaise: 10000 } }),
    ),
  };
  const prepaid = { paidPaise: 40000, foodValuePaise: 30000, tripEstimatePaise: 3000 };
  it('fee is kept from what was paid; the rest is refunded; the platform absorbs the gap', () => {
    const r = cancel(base('PREPARING'), {
      by: 'CUSTOMER',
      reasonCode: 'LATE',
      now,
      rule: { id: 'r', params: paid },
      amounts: prepaid,
    });
    expect(r.outcome).toMatchObject({
      customerFeePaise: 15000,
      refundDuePaise: 25000,
      restaurantCompensationPaise: 30000,
      riderCompensationPaise: 3000,
      platformLossPaise: 18000,
    });
    expect(r.changes.financialStatus).toBe('REFUND_PENDING');
  });
  it('cash on delivery: nothing was paid, so no fee can be kept and nothing is refunded', () => {
    const r = cancel(base('PREPARING'), {
      by: 'CUSTOMER',
      reasonCode: 'LATE',
      now,
      rule: { id: 'r', params: paid },
      amounts,
    });
    expect(r.outcome).toMatchObject({ customerFeePaise: 0, refundDuePaise: 0, platformLossPaise: 33000 });
    expect(r.changes.financialStatus).toBe('NONE');
  });
  it('admin override replaces the computed amounts and is flagged; only admins may override', () => {
    const override = { customerFeePaise: 0, restaurantCompensationPaise: 5000, riderCompensationPaise: 0 };
    const r = cancel(base('PREPARING'), {
      by: 'ADMIN',
      reasonCode: 'GOODWILL',
      now,
      rule: { id: 'r', params: paid },
      amounts: prepaid,
      override,
    });
    expect(r.outcome).toMatchObject({
      isAdminOverride: true,
      refundDuePaise: 40000,
      restaurantCompensationPaise: 5000,
      platformLossPaise: 5000,
    });
    expect(r.outcome.ruleSnapshot.computed.restaurantCompensationPaise).toBe(10000);
    expect(() =>
      cancel(base('PREPARING'), {
        by: 'CUSTOMER',
        reasonCode: 'x',
        now,
        rule: { id: 'r', params: paid },
        amounts,
        override,
      }),
    ).toThrow(/Only an admin/);
  });
  it('rejects malformed rules', () => {
    expect(() =>
      cancel(base('NEW'), {
        by: 'CUSTOMER',
        reasonCode: 'x',
        now,
        rule: { id: 'r', params: { BEFORE_ACCEPT: {} } },
        amounts,
      }),
    ).toThrow();
  });
});
