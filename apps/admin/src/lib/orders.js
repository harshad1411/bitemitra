// Order vocabulary for the admin (ORDERS.md). Presentation only: the API decides every transition.

export const STATUS_LABEL = {
  CREATED: 'Created',
  PAYMENT_PENDING: 'Payment pending',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  PLACED: 'Placed',
  RESTAURANT_NOTIFIED: 'Seen by restaurant',
  RESTAURANT_ACCEPTED: 'Accepted',
  RESTAURANT_REJECTED: 'Rejected by restaurant',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  RIDER_SEARCHING: 'Finding rider',
  RIDER_ASSIGNED: 'Rider assigned',
  RIDER_ACCEPTED: 'Rider on the way to restaurant',
  RIDER_AT_RESTAURANT: 'Rider at restaurant',
  PICKED_UP: 'Picked up',
  ON_THE_WAY: 'On the way',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
  CUSTOMER_CANCELLED: 'Cancelled by customer',
  RESTAURANT_CANCELLED: 'Cancelled by restaurant',
  RIDER_ISSUE: 'Rider issue',
  ADMIN_CANCELLED: 'Cancelled by Jamzo',
  PAYMENT_FAILED: 'Payment failed',
};
export const statusLabel = (s) => STATUS_LABEL[s] ?? s;
export function statusTone(s) {
  if (['DELIVERED'].includes(s)) return 'success';
  if (
    [
      'CUSTOMER_CANCELLED',
      'RESTAURANT_CANCELLED',
      'RESTAURANT_REJECTED',
      'RIDER_ISSUE',
      'ADMIN_CANCELLED',
      'PAYMENT_FAILED',
    ].includes(s)
  )
    return 'critical';
  if (['PLACED', 'RESTAURANT_NOTIFIED', 'PAYMENT_PENDING'].includes(s)) return 'warning';
  if (s === 'READY_FOR_PICKUP') return 'accent';
  return 'info';
}

/** Saved list views (spec §29 "saved filter views" — fixed ones for now; custom views are Phase 9). */
export const ORDER_VIEWS = [
  { value: 'ALL', label: 'All orders', filters: {} },
  { value: 'ATTENTION', label: 'Needs attention', filters: { needsAttention: 'true' } },
  { value: 'NEW', label: 'Waiting for restaurant', filters: { status: 'PLACED,RESTAURANT_NOTIFIED' } },
  { value: 'OPEN', label: 'In the kitchen', filters: { status: 'RESTAURANT_ACCEPTED,PREPARING' } },
  { value: 'READY', label: 'Ready for pickup', filters: { status: 'READY_FOR_PICKUP' } },
  { value: 'DONE', label: 'Delivered', filters: { status: 'DELIVERED' } },
  {
    value: 'CANCELLED',
    label: 'Cancelled or rejected',
    filters: {
      status: 'CUSTOMER_CANCELLED,RESTAURANT_CANCELLED,RESTAURANT_REJECTED,ADMIN_CANCELLED,RIDER_ISSUE',
    },
  },
];

export const ADMIN_CANCEL_REASONS = [
  ['CUSTOMER_REQUEST', 'Customer asked'],
  ['RESTAURANT_UNRESPONSIVE', 'Restaurant not responding'],
  ['RESTAURANT_REQUEST', 'Restaurant asked'],
  ['NO_RIDER', 'No delivery partner'],
  ['RIDER_ISSUE', 'Delivery partner issue'],
  ['FRAUD_SUSPECTED', 'Suspected fraud'],
  ['OTHER', 'Other'],
];
export const ACTOR_LABEL = {
  CUSTOMER: 'Customer',
  RESTAURANT_USER: 'Restaurant',
  RIDER: 'Delivery partner',
  ADMIN: 'Jamzo admin',
  SYSTEM: 'System',
};
