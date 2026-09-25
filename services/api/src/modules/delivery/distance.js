// Delivery distance (OD-14, A-19, D-48). Road distance comes from a maps provider behind this interface;
// Google is available behind the admin setting maps.provider (D-81); otherwise the configured fallback is
// used, and every result says which source it is.
import { haversineM } from '@jamzo/delivery-engine';
import { applyBps } from '@jamzo/pricing-engine';

/**
 * @typedef {{ name: string, roadDistanceM: (from: { lat: number, lng: number }, to: { lat: number, lng: number }) => Promise<number | null> }} DistanceProvider
 */

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Road distance (D-81). The Jamzo Admin setting `maps.provider` picks the source on every call: NONE never
 * pretends to know road distance; GOOGLE asks the Routes API for a two-wheeler route. The API key comes only
 * from the server environment. Answers are cached (points rounded to ~100 m) so browsing does not call Google
 * once per restaurant per screen, and a slow or failed answer returns null so the labelled fallback applies
 * (D-48). Tested against a fake endpoint only; not verified with Google until the key exists.
 *
 * @param {{ apiKey?: string | null, getProvider?: () => Promise<'NONE' | 'GOOGLE'>, fetch?: typeof fetch,
 *   timeoutMs?: number, cacheTtlMs?: number, now?: () => number, log?: { warn: Function } }} [options]
 * @returns {DistanceProvider}
 */
export function createDistanceProvider(options = {}) {
  const {
    apiKey = null,
    getProvider = async () => 'NONE',
    fetch: doFetch = globalThis.fetch,
    timeoutMs = 1500,
    cacheTtlMs = 10 * 60_000,
    now = Date.now,
    log,
  } = options;
  /** @type {Map<string, { m: number, until: number }>} */
  const cache = new Map();
  const round = (p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;

  async function google(from, to) {
    const key = `${round(from)}>${round(to)}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.m;
    const point = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const res = await doFetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': /** @type {string} */ (apiKey),
        'x-goog-fieldmask': 'routes.distanceMeters',
      },
      body: JSON.stringify({ origin: point(from), destination: point(to), travelMode: 'TWO_WHEELER' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`maps provider answered ${res.status}`);
    const body = /** @type {{ routes?: { distanceMeters?: number }[] }} */ (await res.json());
    const m = body?.routes?.[0]?.distanceMeters;
    if (!Number.isInteger(m) || m < 0) throw new Error('maps provider returned no route');
    if (cache.size >= 5000) cache.delete(cache.keys().next().value);
    cache.set(key, { m, until: now() + cacheTtlMs });
    return m;
  }

  return {
    name: apiKey ? 'google-or-none' : 'none',
    async roadDistanceM(from, to) {
      if (!apiKey || (await getProvider()) !== 'GOOGLE') return null;
      try {
        return await google(from, to);
      } catch (err) {
        log?.warn({ err: String(err?.message ?? err) }, 'road distance unavailable, using fallback');
        return null;
      }
    },
  };
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
