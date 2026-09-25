// Support vocabulary for the admin (D-93). The API decides; this only words it.
export const TICKET_STATUS = {
  OPEN: ['Open', 'warning'],
  IN_PROGRESS: ['In progress', 'info'],
  WAITING_ON_CUSTOMER: ['Waiting for the customer', 'neutral'],
  RESOLVED: ['Resolved', 'success'],
  CLOSED: ['Closed', 'neutral'],
};
export const ISSUE = {
  MISSING_ITEM: 'Missing item',
  WRONG_ITEM: 'Wrong item',
  FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery',
  RIDER_ISSUE: 'Delivery partner',
  RESTAURANT_ISSUE: 'Restaurant',
  PAYMENT_ISSUE: 'Payment',
  REFUND_ISSUE: 'Refund',
  OTHER: 'Something else',
};
