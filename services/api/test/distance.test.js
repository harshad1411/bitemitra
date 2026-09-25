// Road distance provider (D-81) against a fake Routes endpoint. Not verified with Google: no key exists yet.
import { describe, expect, it, vi } from 'vitest';
import { createDistanceProvider, deliveryDistance } from '../src/modules/delivery/distance.js';

const A = { lat: 23.8001, lng: 72.3902 };
const B = { lat: 23.8123, lng: 72.4011 };
const KEY = 'test-key-not-a-real-google-key';
const route = (m) => new Response(JSON.stringify({ routes: [{ distanceMeters: m }] }), { status: 200 });

describe('distance provider', () => {
  it('asks Google only when the admin setting is GOOGLE and a key exists; sends the key server-side', async () => {
    const fetch = vi.fn(async () => route(2150));
    let mode = 'NONE';
    const p = createDistanceProvider({ apiKey: KEY, getProvider: async () => mode, fetch });
    expect(await p.roadDistanceM(A, B)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    mode = 'GOOGLE';
    expect(await p.roadDistanceM(A, B)).toBe(2150);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(init.headers['x-goog-fieldmask']).toBe('routes.distanceMeters');
    expect(JSON.parse(init.body)).toEqual({
      origin: { location: { latLng: { latitude: A.lat, longitude: A.lng } } },
      destination: { location: { latLng: { latitude: B.lat, longitude: B.lng } } },
      travelMode: 'TWO_WHEELER',
    });

    const noKey = createDistanceProvider({ getProvider: async () => 'GOOGLE', fetch });
    expect(await noKey.roadDistanceM(A, B)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches nearby points for a while, then asks again', async () => {
    let t = 0;
    const fetch = vi.fn(async () => route(2150));
    const p = createDistanceProvider({
      apiKey: KEY,
      getProvider: async () => 'GOOGLE',
      fetch,
      now: () => t,
      cacheTtlMs: 60_000,
    });
    await p.roadDistanceM(A, B);
    expect(await p.roadDistanceM({ lat: 23.80014, lng: 72.39024 }, B)).toBe(2150); // same ~100 m cell
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 61_000;
    await p.roadDistanceM(A, B);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('errors, bad answers and timeouts fall back to the labelled straight-line estimate', async () => {
    const setting = { maxDistanceM: 10_000, fallback: 'HAVERSINE_FACTOR', roadFactorBps: 14_000 };
    const warn = vi.fn();
    for (const fetch of [
      vi.fn(async () => new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })),
      vi.fn(async () => new Response('{"routes":[]}', { status: 200 })),
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }),
    ]) {
      const p = createDistanceProvider({
        apiKey: KEY,
        getProvider: async () => 'GOOGLE',
        fetch,
        log: { warn },
      });
      const d = /** @type {any} */ (await deliveryDistance(p, setting, A, B));
      expect(d.source).toBe('FALLBACK');
      expect(d.distanceM).toBe(Math.round((d.straightLineM * 14_000) / 10_000));
    }
    expect(warn).toHaveBeenCalledTimes(3);
    const ok = createDistanceProvider({
      apiKey: KEY,
      getProvider: async () => 'GOOGLE',
      fetch: async () => route(2150),
    });
    expect(await deliveryDistance(ok, setting, A, B)).toMatchObject({ distanceM: 2150, source: 'ROAD' });
  });
});
