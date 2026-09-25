// Delivery distance (OD-14, A-19, D-48). Road distance comes from a maps provider behind this interface;
// none is chosen yet (Q-14), so the configured fallback is used and every result says which source it is.
import { haversineM } from '@jamzo/delivery-engine';
import { applyBps } from '@jamzo/pricing-engine';

/**
 * @typedef {{ name: string, roadDistanceM: (from: { lat: number, lng: number }, to: { lat: number, lng: number }) => Promise<number | null> }} DistanceProvider
 */

/** @returns {DistanceProvider} */
export function createDistanceProvider() {
  // Only "none" exists until the maps provider decision (Q-14). It never pretends to know road distance.
  return { name: 'none', roadDistanceM: async () => null };
}

/**
 * @param {DistanceProvider} provider
 * @param {{ maxDistanceM: number, fallback: 'HAVERSINE_FACTOR' | 'REJECT', roadFactorBps: number }} setting delivery.distance
 * @returns {Promise<{ distanceM: number, source: 'ROAD' | 'FALLBACK', straightLineM: number } | { unavailable: true }>}
 */
export async function deliveryDistance(provider, setting, from, to) {
  const straight = haversineM(from, to);
  const road = await provider.roadDistanceM(from, to).catch(() => null);
  if (road != null) return { distanceM: road, source: 'ROAD', straightLineM: straight };
  if (setting.fallback === 'REJECT') return { unavailable: true };
  return {
    distanceM: applyBps(straight, setting.roadFactorBps),
    source: 'FALLBACK',
    straightLineM: straight,
  };
}
