import { describe, expect, it } from 'vitest';
import { rankCandidates } from './index.js';

const now = new Date('2026-09-28T07:30:00Z');
const restaurant = { lat: 23.8, lng: 72.39 };
const settings = { maxLocationAgeSec: 120, maxActiveOrders: 1, maxPickupDistanceM: 7000 };
const rider = (id, extra = {}) => ({
  id,
  onboardingStatus: 'ACTIVE',
  isOnline: true,
  lat: 23.801,
  lng: 72.39,
  lastLocationAt: new Date(now.getTime() - 20_000),
  zoneId: 'z1',
  activeOrderCount: 0,
  codEnabled: true,
  codLimitPaise: 500_000,
  codBalancePaise: 0,
  ...extra,
});
const order = (extra = {}) => ({
  id: 'o',
  zoneIds: ['z1'],
  paymentMethod: 'COD',
  codAmountPaise: 30_000,
  ...extra,
});
const run = (riders, extra = {}) =>
  rankCandidates({ order: order(), restaurant, riders, alreadyOffered: [], now, settings, ...extra });

describe('dispatch ranking (D-75)', () => {
  it('nearest eligible rider first; deterministic ties', () => {
    const r = run([rider('b', { lat: 23.81 }), rider('a', { lat: 23.802 }), rider('c', { lat: 23.802 })]);
    expect(r.ranked.map((x) => x.riderId)).toEqual(['a', 'c', 'b']);
    expect(r.ranked[0].pickupDistanceM).toBeGreaterThan(0);
  });
  it('excludes with a reason: offline, not active, stale, other zone, capacity, COD, already offered, too far', () => {
    const r = rankCandidates({
      order: order(),
      restaurant,
      now,
      settings,
      alreadyOffered: ['h'],
      riders: [
        rider('a', { isOnline: false }),
        rider('b', { onboardingStatus: 'UNDER_REVIEW' }),
        rider('c', { lastLocationAt: new Date(now.getTime() - 600_000) }),
        rider('d', { zoneId: 'z9' }),
        rider('e', { activeOrderCount: 1 }),
        rider('f', { codEnabled: false }),
        rider('g', { codBalancePaise: 480_000 }),
        rider('h'),
        rider('i', { lat: 24.0 }),
        rider('ok'),
      ],
    });
    expect(Object.fromEntries(r.excluded.map((x) => [x.riderId, x.reason]))).toEqual({
      a: 'OFFLINE',
      b: 'NOT_ACTIVE',
      c: 'STALE_LOCATION',
      d: 'OTHER_ZONE',
      e: 'AT_CAPACITY',
      f: 'COD_DISABLED',
      g: 'COD_LIMIT',
      h: 'ALREADY_OFFERED',
      i: 'TOO_FAR',
    });
    expect(r.ranked.map((x) => x.riderId)).toEqual(['ok']);
  });
  it('prepaid orders ignore COD limits; a rider with an order ranks after an idle one when batching allows two', () => {
    const r = rankCandidates({
      order: order({ paymentMethod: 'UPI', codAmountPaise: 0 }),
      restaurant,
      now,
      alreadyOffered: [],
      settings: { ...settings, maxActiveOrders: 2 },
      riders: [
        rider('busy', { activeOrderCount: 1, lat: 23.8001 }),
        rider('idle', { lat: 23.803, codEnabled: false }),
      ],
    });
    expect(r.ranked.map((x) => x.riderId)).toEqual(['idle', 'busy']);
  });
});
