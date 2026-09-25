// Payment and refund vocabulary for the admin (D-85 … D-87). The API decides; this only words it.
export const PAYMENT_STATUS = {
  INITIATED: ['Not started', 'neutral'],
  PENDING: ['Waiting for payment', 'warning'],
  SUCCEEDED: ['Paid', 'success'],
  FAILED: ['Failed', 'critical'],
  EXPIRED: ['Expired', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};
export const REFUND_STATUS = {
  PENDING_APPROVAL: ['Needs approval', 'warning'],
  REQUESTED: ['Queued', 'info'],
  PROCESSING: ['With the gateway', 'info'],
  SUCCEEDED: ['Refunded', 'success'],
  FAILED: ['Failed', 'critical'],
  REJECTED: ['Rejected', 'neutral'],
};
export const REFUND_TYPE = {
  FULL: 'Everything left',
  PARTIAL: 'An amount',
  ITEM: 'Chosen items',
  DELIVERY: 'Delivery fee',
  PLATFORM_FEE: 'Platform fee',
  MANUAL: 'Manual amount',
};
export const METHOD = { COD: 'Cash', UPI: 'UPI', CARD: 'Card', NETBANKING: 'Netbanking', WALLET: 'Wallet' };
export const BEARER = { PLATFORM: 'Jamzo', RESTAURANT: 'Restaurant' };
