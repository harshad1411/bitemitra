// Delivery code (D-76): 4 digits derived from the order id with a server secret, so nothing secret is stored
// and the customer's app and the rider's check always agree. Shown to the customer only once a rider has
// the order; five wrong entries flag the order for operations.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** @param {string} secret @param {string} orderId */
export function deliveryCode(secret, orderId) {
  const h = createHmac('sha256', secret).update(`jamzo:delivery-otp:${orderId}`).digest();
  return String(h.readUInt32BE(0) % 10_000).padStart(4, '0');
}

/** @param {string} secret @param {string} orderId @param {string} given */
export function checkDeliveryCode(secret, orderId, given) {
  const a = Buffer.from(deliveryCode(secret, orderId));
  const b = Buffer.from(String(given ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
