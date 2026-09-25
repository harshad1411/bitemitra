// Posting rules against the PRICING.md §6 worked example priced by the real pricing engine: the ledgers must
// add up to what the customer paid (SETTLEMENTS.md §5), with estimates and with actual amounts.
import { describe, expect, it } from 'vitest';
import { run } from '@jamzo/pricing-engine/golden';
import { cancelledPostings, conservation, deliveredPostings, refundPostings, signed } from './postings.js';

const total = (list) => list.reduce((n, e) => n + signed(e), 0);
const estimateEarning = (q) => ({
  tripPaise: q.rider.totalPaise,
  tipPaise: q.rider.tipPaise,
  distancePaise: q.rider.distancePaise,
  incentives: q.rider.incentives,
  waitingPaise: 0,
});

describe('delivered order postings', () => {
  it('the worked example: restaurant ₹334.48, rider ₹37.20, everything adds up to ₹479.00 (§2.2, §5)', () => {
    const q = run();
    expect(q.totals.totalPayablePaise).toBe(47_900);
    const p = deliveredPostings({
      orderId: 'o1',
      q,
      earning: estimateEarning(q),
      codCollectedPaise: 0,
      gatewayFeePaise: q.platform.gatewayEstimatePaise,
    });
    expect(p.restaurant.map((e) => [e.type, e.direction, e.amountPaise])).toEqual([
      ['FOOD_SALE', 'CREDIT', 41_000],
      ['RESTAURANT_FUNDED_DISCOUNT', 'DEBIT', 2_200],
      ['COMMISSION', 'DEBIT', 4_536],
      ['COMMISSION_TAX', 'DEBIT', 816],
    ]);
    expect(total(p.restaurant)).toBe(33_448); // = the restaurant payable of the quote
    expect(total(p.rider)).toBe(3_720);
    const c = conservation({ paidPaise: 47_900, ...p });
    expect(c).toMatchObject({ ok: true, restaurantPaise: 33_448, riderPaise: 3_720, gatewayPaise: 1_130 });
    expect(c.platformNetPaise).toBe(q.platform.netPaise);
    // Keys are deterministic: the same order always yields the same keys (idempotent posting).
    expect(p.restaurant[0].key).toBe('order:o1:FOOD_SALE');
    expect(new Set([...p.restaurant, ...p.rider, ...p.platform].map((e) => e.key)).size).toBe(
      p.restaurant.length + p.rider.length + p.platform.length,
    );
  });

  it('actual rider pay and gateway fee replace the estimates; the books still balance', () => {
    const q = run();
    const earning = { ...estimateEarning(q), waitingPaise: 300, tripPaise: q.rider.totalPaise + 300 };
    const p = deliveredPostings({ orderId: 'o2', q, earning, codCollectedPaise: 0, gatewayFeePaise: 990 });
    const c = conservation({ paidPaise: 47_900, ...p });
    expect(c.ok).toBe(true);
    expect(c.riderPaise).toBe(4_020);
    expect(c.platformNetPaise).toBe(q.platform.netPaise - 300 + (1_130 - 990));
    expect(p.rider.find((e) => e.type === 'WAITING_CHARGE')).toMatchObject({ amountPaise: 300 });
  });

  it('cash on delivery: the cash the rider holds is recorded apart from their earnings; no gateway fee', () => {
    const q = run({ ctx: { paymentMethod: 'COD' } });
    const p = deliveredPostings({
      orderId: 'o3',
      q,
      earning: estimateEarning(q),
      codCollectedPaise: q.totals.totalPayablePaise,
      gatewayFeePaise: 0,
    });
    expect(p.rider.find((e) => e.type === 'COD_COLLECTED')).toMatchObject({
      direction: 'CREDIT',
      amountPaise: q.totals.totalPayablePaise,
    });
    expect(p.platform.find((e) => e.type === 'GATEWAY_FEE')).toBeUndefined();
    expect(conservation({ paidPaise: q.totals.totalPayablePaise, ...p }).ok).toBe(true);
  });

  it('a missing actual fee is posted from the estimate and labelled', () => {
    const q = run();
    const p = deliveredPostings({
      orderId: 'o4',
      q,
      earning: estimateEarning(q),
      codCollectedPaise: 0,
      gatewayFeePaise: null,
    });
    expect(p.platform.find((e) => e.type === 'GATEWAY_FEE')).toMatchObject({
      amountPaise: 1_130,
      description: 'estimate',
    });
  });

  it('a mistake is caught: an order that does not add up is reported with the difference', () => {
    const q = run();
    const p = deliveredPostings({
      orderId: 'o5',
      q,
      earning: estimateEarning(q),
      codCollectedPaise: 0,
      gatewayFeePaise: 1_130,
    });
    expect(conservation({ paidPaise: 48_000, ...p })).toMatchObject({ ok: false, differencePaise: 100 });
  });
});

describe('cancellations and refunds', () => {
  const outcome = { stage: 'AFTER_ACCEPT', customerFeePaise: 47_900, restaurantCompensationPaise: 36_600 };

  it('customer cancels after acceptance (OD-38): the restaurant gets its food value, Jamzo keeps the fee', () => {
    const p = cancelledPostings({ orderId: 'c1', outcome, riderPaidPaise: 3_720, gatewayFeePaise: 1_130 });
    expect(p.restaurant).toEqual([
      expect.objectContaining({ type: 'CANCELLATION', direction: 'CREDIT', amountPaise: 36_600 }),
    ]);
    expect(p.rider).toEqual([expect.objectContaining({ type: 'DELIVERY_EARNING', amountPaise: 3_720 })]);
    expect(total(p.platform)).toBe(47_900 - 36_600 - 3_720 - 1_130);
    // Money kept (customer fee) = restaurant + rider + gateway + Jamzo's result.
    expect(total(p.restaurant) + total(p.rider) + 1_130 + total(p.platform)).toBe(47_900);
  });

  it('nothing to post for a cancellation that costs nothing', () => {
    const none = { stage: 'BEFORE_ACCEPT', customerFeePaise: 0, restaurantCompensationPaise: 0 };
    expect(
      cancelledPostings({ orderId: 'c2', outcome: none, riderPaidPaise: 0, gatewayFeePaise: null }),
    ).toEqual({
      restaurant: [],
      rider: [],
      platform: [],
    });
  });

  it('refunds after delivery are paid by their bearer; refunds before delivery post nothing', () => {
    expect(
      refundPostings({ refundId: 'r1', amountPaise: 500, bearer: 'RESTAURANT', delivered: true }).restaurant,
    ).toEqual([{ type: 'REFUND', direction: 'DEBIT', amountPaise: 500, key: 'refund:r1:REFUND' }]);
    expect(
      refundPostings({ refundId: 'r2', amountPaise: 500, bearer: 'PLATFORM', delivered: true }).platform,
    ).toEqual([{ type: 'REFUND_LOSS', direction: 'DEBIT', amountPaise: 500, key: 'refund:r2:REFUND_LOSS' }]);
    expect(
      refundPostings({ refundId: 'r3', amountPaise: 500, bearer: 'PLATFORM', delivered: false }),
    ).toEqual({
      restaurant: [],
      rider: [],
      platform: [],
    });
  });
});
