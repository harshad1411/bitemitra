// Dispatch strategy (DELIVERY.md §3, D-75). Pure and deterministic: given an order and the riders the API
// loaded, decide who is eligible and in which order to offer. The API owns offers, timeouts and the
// single-winner rule; this module can be replaced without touching them (§22 "do not couple to the first
// algorithm").
import { haversineM } from './geo.js';

export const STRATEGY_ID = 'nearest-available@1';

/** Why a rider was not considered — kept for the admin's dispatch view. */
export const EXCLUSIONS = Object.freeze({
  OFFLINE: 'Offline',
  NOT_ACTIVE: 'Not an active delivery partner',
  STALE_LOCATION: 'No recent location',
  OTHER_ZONE: 'Outside the order’s zones',
  AT_CAPACITY: 'Already on the maximum number of orders',
  COD_DISABLED: 'Cash on delivery switched off for this partner',
  COD_LIMIT: 'Cash in hand would exceed the limit',
  ALREADY_OFFERED: 'Already offered this order',
  TOO_FAR: 'Too far from the restaurant',
});

/**
 * @param {{ order: { id: string, zoneIds: string[], paymentMethod: string, codAmountPaise: number },
 *           restaurant: { lat: number, lng: number },
 *           riders: { id: string, onboardingStatus: string, isOnline: boolean, lat: number|null, lng: number|null,
 *                     lastLocationAt: Date|string|null, zoneId: string|null, activeOrderCount: number,
 *                     codEnabled: boolean, codLimitPaise: number, codBalancePaise: number }[],
 *           alreadyOffered: string[], now: Date,
 *           settings: { maxLocationAgeSec: number, maxActiveOrders: number, maxPickupDistanceM: number } }} input
 * @returns {{ ranked: { riderId: string, score: number, pickupDistanceM: number }[], excluded: { riderId: string, reason: keyof typeof EXCLUSIONS }[] }}
 */
export function rankCandidates({ order, restaurant, riders, alreadyOffered, now, settings }) {
  const ranked = [];
  const excluded = [];
  const out = (riderId, reason) => excluded.push({ riderId, reason });
  for (const r of riders) {
    if (r.onboardingStatus !== 'ACTIVE') {
      out(r.id, 'NOT_ACTIVE');
      continue;
    }
    if (!r.isOnline) {
      out(r.id, 'OFFLINE');
      continue;
    }
    if (alreadyOffered.includes(r.id)) {
      out(r.id, 'ALREADY_OFFERED');
      continue;
    }
    const age = r.lastLocationAt ? (now.getTime() - new Date(r.lastLocationAt).getTime()) / 1000 : Infinity;
    if (r.lat == null || r.lng == null || age > settings.maxLocationAgeSec) {
      out(r.id, 'STALE_LOCATION');
      continue;
    }
    if (!r.zoneId || !order.zoneIds.includes(r.zoneId)) {
      out(r.id, 'OTHER_ZONE');
      continue;
    }
    if (r.activeOrderCount >= settings.maxActiveOrders) {
      out(r.id, 'AT_CAPACITY');
      continue;
    }
    if (order.paymentMethod === 'COD' && order.codAmountPaise > 0) {
      if (!r.codEnabled) {
        out(r.id, 'COD_DISABLED');
        continue;
      }
      if (r.codBalancePaise + order.codAmountPaise > r.codLimitPaise) {
        out(r.id, 'COD_LIMIT');
        continue;
      }
    }
    const pickupDistanceM = Math.round(haversineM({ lat: r.lat, lng: r.lng }, restaurant));
    if (pickupDistanceM > settings.maxPickupDistanceM) {
      out(r.id, 'TOO_FAR');
      continue;
    }
    // Closest first; each active order counts like 1 km more; ties broken by id so ranking is deterministic.
    ranked.push({ riderId: r.id, pickupDistanceM, score: pickupDistanceM + r.activeOrderCount * 1000 });
  }
  ranked.sort((a, b) => a.score - b.score || (a.riderId < b.riderId ? -1 : 1));
  return { ranked, excluded };
}
