// Ledger and settlement vocabulary for the admin (D-88 … D-92). The API decides; this only words it.
export const SETTLEMENT_STATUS = {
  DRAFT: ['Draft — check it', 'warning'],
  PENDING: ['Pending', 'info'],
  PROCESSING: ['Approved — pay it', 'info'],
  PAID: ['Paid', 'success'],
  FAILED: ['Payout failed', 'critical'],
  CANCELLED: ['Cancelled', 'neutral'],
};
export const ENTRY_TYPE = {
  FOOD_SALE: 'Food sales',
  COMMISSION: 'Commission',
  COMMISSION_TAX: 'Tax on commission',
  RESTAURANT_FUNDED_DISCOUNT: 'Discount funded by the restaurant',
  TAX_ADJUSTMENT: 'Tax adjustment',
  REFUND: 'Refund',
  CANCELLATION: 'Cancellation compensation',
  PENALTY: 'Penalty',
  WITHHOLDING: 'Tax withheld (TCS/TDS)',
  RESTAURANT_FEE: 'Fee',
  MANUAL_CREDIT: 'Adjustment (credit)',
  MANUAL_DEBIT: 'Adjustment (debit)',
  REVERSAL: 'Correction',
  SETTLEMENT: 'Paid out',
  DELIVERY_EARNING: 'Trip pay',
  DISTANCE_EARNING: 'Distance pay',
  WAITING_CHARGE: 'Waiting pay',
  INCENTIVE: 'Incentive',
  BONUS: 'Bonus',
  TIP: 'Tip',
  ADJUSTMENT: 'Adjustment',
  COD_COLLECTED: 'Cash collected',
  COD_SUBMITTED: 'Cash handed over',
  COD_SHORTAGE: 'Cash short',
  COD_EXCESS: 'Cash over (owed back)',
  PAYOUT: 'Paid out',
};
export const PLATFORM_TYPE = {
  MARKUP_REVENUE: 'Markup',
  COMMISSION_REVENUE: 'Commission',
  PLATFORM_FEE: 'Platform fee',
  DELIVERY_FEE: 'Delivery fees',
  SMALL_ORDER_FEE: 'Small-order fees',
  SURCHARGE: 'Surcharges',
  PLATFORM_FUNDED_DISCOUNT: 'Discounts paid by Jamzo',
  RIDER_COST: 'Delivery partner pay',
  GATEWAY_FEE: 'Payment gateway fees',
  REFUND_LOSS: 'Refunds and compensation paid by Jamzo',
  TAX_COLLECTED: 'Tax collected (owed to the government)',
  WITHHOLDING_TAX: 'Tax withheld (owed to the government)',
  TIP_PASS_THROUGH: 'Tips held for partners',
  ROUNDING_ADJUSTMENT: 'Rounding',
  ADJUSTMENT: 'Other adjustments',
  REVERSAL: 'Corrections',
};
export const DEPOSIT_METHOD = { UPI: 'UPI', BANK_DEPOSIT: 'Bank deposit', CASH_AT_HUB: 'Cash at hub' };
export const DEPOSIT_STATUS = {
  PENDING: ['To check', 'warning'],
  VERIFIED: ['Verified', 'success'],
  REJECTED: ['Rejected', 'critical'],
};
/** Signed amount of an entry for display (+ credit, − debit). */
export const signedPaise = (e) => (e.direction === 'CREDIT' ? 1 : -1) * e.amountPaise;
export const dateOnly = (d) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
