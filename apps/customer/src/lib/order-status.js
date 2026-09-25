// What each order status means to a customer. The API decides the status; this only words it.
export function statusText(o) {
  switch (o.status) {
    case 'PLACED':
      return { title: 'Order placed', text: `Waiting for ${o.restaurant.name} to accept it.` };
    case 'RESTAURANT_NOTIFIED':
      return { title: 'Order placed', text: `${o.restaurant.name} has seen your order.` };
    case 'RESTAURANT_ACCEPTED':
      return {
        title: 'Order accepted',
        text: o.prepTimeMinutes
          ? `Ready in about ${o.prepTimeMinutes} minutes.`
          : 'The restaurant accepted your order.',
      };
    case 'PREPARING':
      return { title: 'Being prepared', text: `${o.restaurant.name} is preparing your food.` };
    case 'READY_FOR_PICKUP':
      return {
        title: 'Packed and ready',
        text: 'Your food is ready for pickup by a delivery partner. Live delivery tracking is not available yet.',
      };
    case 'DELIVERED':
      return { title: 'Delivered', text: 'Enjoy your meal!' };
    case 'CUSTOMER_CANCELLED':
      return { title: 'Cancelled', text: 'You cancelled this order.' };
    case 'RESTAURANT_REJECTED':
      return {
        title: 'Not accepted',
        text: `${o.restaurant.name} could not take this order. You have not been charged.`,
      };
    case 'RESTAURANT_CANCELLED':
      return {
        title: 'Cancelled by the restaurant',
        text: 'Sorry — the restaurant had to cancel. You have not been charged.',
      };
    case 'ADMIN_CANCELLED':
      return { title: 'Cancelled', text: 'Jamzo support cancelled this order.' };
    default:
      return { title: o.status, text: '' };
  }
}

export const TIMELINE_LABEL = {
  CREATED: 'Order created',
  PLACED: 'Order placed',
  RESTAURANT_NOTIFIED: 'Seen by the restaurant',
  RESTAURANT_ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  DELIVERED: 'Delivered',
  CUSTOMER_CANCELLED: 'Cancelled by you',
  RESTAURANT_REJECTED: 'Not accepted by the restaurant',
  RESTAURANT_CANCELLED: 'Cancelled by the restaurant',
  ADMIN_CANCELLED: 'Cancelled by Jamzo',
};

export const CANCEL_REASONS = [
  ['CHANGED_MIND', 'I changed my mind'],
  ['ORDERED_BY_MISTAKE', 'Ordered by mistake'],
  ['WRONG_ADDRESS', 'Wrong address'],
  ['OTHER', 'Something else'],
];
