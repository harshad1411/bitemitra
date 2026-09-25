// Ledger posting rules (SETTLEMENTS.md §2–§4, D-88). Pure: (order facts) → entries. Every entry has a
// deterministic idempotency key, so posting the same facts twice can never double-count. Amounts are
// positive integer paise; the direction gives the sign from that ledger's point of view.

/** @typedef {{ type: string, direction: 'CREDIT' | 'DEBIT', amountPaise: number, key: string, description?: string }} Entry */

const sum = (a) => a.reduce((n, x) => n + x, 0);

/** Adds an entry only when the amount is not zero; a negative amount flips the direction. */
function push(list, type, direction, amount, key, description) {
  if (!Number.isInteger(amount)) throw new Error(`posting ${type}: amount must be whole paise`);
  if (amount === 0) return;
  const flip = { CREDIT: 'DEBIT', DEBIT: 'CREDIT' };
  list.push({
    type,
    direction: amount > 0 ? direction : flip[direction],
    amountPaise: Math.abs(amount),
    key,
    ...(description ? { description } : {}),
  });
}

/** Platform entry types that are liabilities (money held for others), not revenue or cost. */
export const PLATFORM_LIABILITIES = ['TAX_COLLECTED', 'WITHHOLDING_TAX', 'TIP_PASS_THROUGH'];
/** Rider entry types that move cash held (the rest move earnings). */
export const RIDER_COD_TYPES = ['COD_COLLECTED', 'COD_SUBMITTED', 'COD_SHORTAGE'];

/** Signed amount of an entry (+ for CREDIT). */
export const signed = (e) => (e.direction === 'CREDIT' ? 1 : -1) * Number(e.amountPaise);

/**
 * A delivered order (D-88). `q` is the frozen quote (snapshot.engineOutput); `earning` the final rider earning
 * (riderEarningFinal); `gatewayFeePaise` the actual fee incl. tax (null → the snapshot estimate, labelled).
 * @param {{ orderId: string, q: any, earning: any | null, codCollectedPaise: number, gatewayFeePaise: number | null }} i
 * @returns {{ restaurant: Entry[], rider: Entry[], platform: Entry[] }}
 */
export function deliveredPostings({ orderId, q, earning, codCollectedPaise, gatewayFeePaise }) {
  const k = (type) => `order:${orderId}:${type}`;
  const r = q.restaurant;
  const p = q.platform;
  const restaurant = [];
  push(
    restaurant,
    'FOOD_SALE',
    'CREDIT',
    r.foodValuePaise + r.packagingPaise + (r.roundingAbsorbedPaise ?? 0),
    k('FOOD_SALE'),
  );
  push(
    restaurant,
    'RESTAURANT_FUNDED_DISCOUNT',
    'DEBIT',
    r.restaurantFundedDiscountPaise,
    k('RESTAURANT_FUNDED_DISCOUNT'),
  );
  const commissionTax = r.commissionTax?.amountPaise ?? 0;
  push(restaurant, 'COMMISSION', 'DEBIT', r.commissionChargedPaise - commissionTax, k('COMMISSION'));
  push(restaurant, 'COMMISSION_TAX', 'DEBIT', commissionTax, k('COMMISSION_TAX'));
  for (const w of r.withholdings ?? [])
    push(restaurant, 'WITHHOLDING', 'DEBIT', w.amountPaise, k(`WITHHOLDING:${w.kind}`), w.kind);

  const rider = [];
  const tripPaise = earning ? earning.tripPaise : 0;
  const tipRider = earning ? earning.tipPaise : 0;
  if (earning) {
    const incentives = sum((earning.incentives ?? []).map((x) => x.amountPaise));
    // The base line takes whatever the other parts do not cover (e.g. a minimum-pay top-up), so the lines
    // always add up to the trip pay.
    push(
      rider,
      'DELIVERY_EARNING',
      'CREDIT',
      tripPaise - earning.distancePaise - incentives - earning.waitingPaise,
      k('DELIVERY_EARNING'),
    );
    push(rider, 'DISTANCE_EARNING', 'CREDIT', earning.distancePaise, k('DISTANCE_EARNING'));
    push(rider, 'WAITING_CHARGE', 'CREDIT', earning.waitingPaise, k('WAITING_CHARGE'));
    push(rider, 'INCENTIVE', 'CREDIT', incentives, k('INCENTIVE'));
    push(rider, 'TIP', 'CREDIT', tipRider, k('TIP'));
  }
  push(rider, 'COD_COLLECTED', 'CREDIT', codCollectedPaise, k('COD_COLLECTED'));

  const platform = [];
  const gateway = gatewayFeePaise ?? p.gatewayEstimatePaise ?? 0;
  push(platform, 'MARKUP_REVENUE', 'CREDIT', p.markupPaise, k('MARKUP_REVENUE'));
  push(platform, 'COMMISSION_REVENUE', 'CREDIT', p.commissionRevenuePaise, k('COMMISSION_REVENUE'));
  push(platform, 'PLATFORM_FEE', 'CREDIT', p.platformFeePaise, k('PLATFORM_FEE'));
  push(platform, 'DELIVERY_FEE', 'CREDIT', p.deliveryFeePaise, k('DELIVERY_FEE'));
  push(platform, 'SMALL_ORDER_FEE', 'CREDIT', p.smallOrderFeePaise, k('SMALL_ORDER_FEE'));
  push(platform, 'SURCHARGE', 'CREDIT', p.surchargePaise, k('SURCHARGE'));
  push(
    platform,
    'PLATFORM_FUNDED_DISCOUNT',
    'DEBIT',
    p.platformFundedDiscountPaise,
    k('PLATFORM_FUNDED_DISCOUNT'),
  );
  push(platform, 'RIDER_COST', 'DEBIT', tripPaise, k('RIDER_COST'));
  push(platform, 'ROUNDING_ADJUSTMENT', 'CREDIT', p.roundingPaise, k('ROUNDING_ADJUSTMENT'));
  push(
    platform,
    'GATEWAY_FEE',
    'DEBIT',
    gateway,
    k('GATEWAY_FEE'),
    gatewayFeePaise == null && gateway ? 'estimate' : undefined,
  );
  // Taxes inside prices belong to the tax authority, not to Jamzo's revenue (as in the pricing engine).
  push(
    platform,
    'ADJUSTMENT',
    'DEBIT',
    q.taxes?.inclusiveTotalPaise ?? 0,
    k('INCLUSIVE_TAX'),
    'Tax included in prices',
  );
  push(platform, 'TAX_COLLECTED', 'CREDIT', p.taxLiabilitiesPaise, k('TAX_COLLECTED'));
  push(platform, 'WITHHOLDING_TAX', 'CREDIT', p.withholdingPaise, k('WITHHOLDING_TAX'));
  push(platform, 'TIP_PASS_THROUGH', 'CREDIT', (q.totals?.tipPaise ?? 0) - tipRider, k('TIP_PASS_THROUGH'));
  return { restaurant, rider, platform };
}

/**
 * A cancelled order (D-88): what the restaurant and rider are owed, and what the customer's kept fee and
 * the gateway fee mean for Jamzo. Money refunded before delivery was never recognised, so it is not posted.
 * @param {{ orderId: string, outcome: any, riderPaidPaise: number, gatewayFeePaise: number | null }} i
 */
export function cancelledPostings({ orderId, outcome, riderPaidPaise, gatewayFeePaise }) {
  const k = (type) => `cancel:${orderId}:${type}`;
  const restaurant = [];
  push(
    restaurant,
    'CANCELLATION',
    'CREDIT',
    outcome.restaurantCompensationPaise,
    k('CANCELLATION'),
    `Compensation (${outcome.stage})`,
  );
  const rider = [];
  push(rider, 'DELIVERY_EARNING', 'CREDIT', riderPaidPaise, k('DELIVERY_EARNING'), 'Cancelled trip');
  const platform = [];
  push(platform, 'ADJUSTMENT', 'CREDIT', outcome.customerFeePaise, k('FEE_KEPT'), 'Cancellation fee kept');
  push(
    platform,
    'REFUND_LOSS',
    'DEBIT',
    outcome.restaurantCompensationPaise,
    k('RESTAURANT_COMPENSATION'),
    'Restaurant compensation',
  );
  push(platform, 'RIDER_COST', 'DEBIT', riderPaidPaise, k('RIDER_COST'), 'Cancelled trip');
  push(platform, 'GATEWAY_FEE', 'DEBIT', gatewayFeePaise ?? 0, k('GATEWAY_FEE'));
  return { restaurant, rider, platform };
}

/**
 * A refund that completed after delivery: the bearer pays for it (D-86, D-88).
 * @param {{ refundId: string, amountPaise: number, bearer: 'RESTAURANT' | 'PLATFORM', delivered: boolean }} i
 */
export function refundPostings({ refundId, amountPaise, bearer, delivered }) {
  const restaurant = [];
  const platform = [];
  if (delivered) {
    if (bearer === 'RESTAURANT')
      push(restaurant, 'REFUND', 'DEBIT', amountPaise, `refund:${refundId}:REFUND`);
    else push(platform, 'REFUND_LOSS', 'DEBIT', amountPaise, `refund:${refundId}:REFUND_LOSS`);
  }
  return { restaurant, rider: [], platform };
}

/**
 * The conservation rule for a delivered order (SETTLEMENTS.md §5): what the customer paid equals what the
 * restaurant, the rider, tax and other liabilities, the gateway and Jamzo get.
 * @param {{ paidPaise: number, restaurant: Entry[], rider: Entry[], platform: Entry[] }} i
 */
export function conservation({ paidPaise, restaurant, rider, platform }) {
  const total = (list) => sum(list.map(signed));
  const gatewayPaise = -total(platform.filter((e) => e.type === 'GATEWAY_FEE'));
  const parts = {
    restaurantPaise: total(restaurant),
    riderPaise: total(rider.filter((e) => !RIDER_COD_TYPES.includes(e.type))),
    liabilitiesPaise: total(platform.filter((e) => PLATFORM_LIABILITIES.includes(e.type))),
    gatewayPaise,
    // Jamzo's net after every cost, the gateway fee included.
    platformNetPaise: total(platform.filter((e) => !PLATFORM_LIABILITIES.includes(e.type))),
  };
  const accountedPaise =
    parts.restaurantPaise +
    parts.riderPaise +
    parts.liabilitiesPaise +
    parts.gatewayPaise +
    parts.platformNetPaise;
  return {
    ok: accountedPaise === paidPaise,
    paidPaise,
    accountedPaise,
    differencePaise: paidPaise - accountedPaise,
    ...parts,
  };
}
