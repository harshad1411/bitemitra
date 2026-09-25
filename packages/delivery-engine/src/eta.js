// Customer arrival estimate while a delivery partner has the order (D-79). Pure: distances are measured by
// the caller (road distance when the maps provider is on, otherwise the labelled fallback). An estimate
// with a range, never a promise.

const BEFORE_PICKUP = ['ACCEPTED', 'AT_RESTAURANT'];
const AFTER_PICKUP = ['PICKED_UP', 'ON_THE_WAY'];

/**
 * `readyAt` is the estimated or actual time the food is ready; `toRestaurantM` is partner → restaurant
 * (before pickup; 0 when at the restaurant); `toCustomerM` is partner → customer (after pickup).
 * @param {{
 *   deliveryStatus: string,
 *   now: Date,
 *   readyAt?: Date | null,
 *   toRestaurantM?: number | null,
 *   restaurantToCustomerM?: number | null,
 *   toCustomerM?: number | null,
 *   settings: { avgSpeedKmph: number, bufferMinutes: number, rangeMinutes: number },
 * }} input
 * @returns {{ minMinutes: number, maxMinutes: number, arrivingNow?: true } | null} null when it cannot be estimated
 */
export function arrivalEstimate(input) {
  const { deliveryStatus, now, readyAt, settings } = input;
  if (deliveryStatus === 'ARRIVED') return { minMinutes: 0, maxMinutes: 0, arrivingNow: true };
  const travelMin = (m) => (m / 1000 / settings.avgSpeedKmph) * 60;
  let minutes;
  if (BEFORE_PICKUP.includes(deliveryStatus)) {
    if (input.toRestaurantM == null || input.restaurantToCustomerM == null) return null;
    const waitForFood = readyAt ? Math.max(0, (readyAt.getTime() - now.getTime()) / 60_000) : 0;
    minutes = Math.max(travelMin(input.toRestaurantM), waitForFood) + travelMin(input.restaurantToCustomerM);
  } else if (AFTER_PICKUP.includes(deliveryStatus)) {
    if (input.toCustomerM == null) return null;
    minutes = travelMin(input.toCustomerM);
  } else return null;
  const min = Math.max(1, Math.ceil(minutes + settings.bufferMinutes));
  return { minMinutes: min, maxMinutes: min + settings.rangeMinutes };
}
