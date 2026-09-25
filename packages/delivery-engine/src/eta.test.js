import { describe, expect, it } from 'vitest';
import { arrivalEstimate } from './eta.js';

const settings = { avgSpeedKmph: 18, bufferMinutes: 5, rangeMinutes: 10 }; // 18 km/h = 300 m per minute
const now = new Date('2026-09-25T12:00:00Z');

describe('arrivalEstimate', () => {
  it('before pickup: the later of reaching the restaurant and the food being ready, then the ride', () => {
    // 900 m to the restaurant = 3 min, food ready in 10 min → wait 10; 3 000 m ride = 10 min; +5 buffer
    expect(
      arrivalEstimate({
        deliveryStatus: 'ACCEPTED',
        now,
        readyAt: new Date(now.getTime() + 10 * 60_000),
        toRestaurantM: 900,
        restaurantToCustomerM: 3000,
        settings,
      }),
    ).toEqual({ minMinutes: 25, maxMinutes: 35 });
    // food already ready: travel decides (3 + 10 + 5)
    expect(
      arrivalEstimate({
        deliveryStatus: 'AT_RESTAURANT',
        now,
        readyAt: new Date(now.getTime() - 60_000),
        toRestaurantM: 900,
        restaurantToCustomerM: 3000,
        settings,
      }),
    ).toEqual({ minMinutes: 18, maxMinutes: 28 });
  });

  it('after pickup: the ride from where the partner is; arrived is "arriving now"', () => {
    expect(arrivalEstimate({ deliveryStatus: 'ON_THE_WAY', now, toCustomerM: 1500, settings })).toEqual({
      minMinutes: 10,
      maxMinutes: 20,
    });
    expect(arrivalEstimate({ deliveryStatus: 'ARRIVED', now, settings })).toEqual({
      minMinutes: 0,
      maxMinutes: 0,
      arrivingNow: true,
    });
  });

  it('no estimate without a position, or outside a delivery', () => {
    expect(arrivalEstimate({ deliveryStatus: 'PICKED_UP', now, toCustomerM: null, settings })).toBeNull();
    expect(
      arrivalEstimate({ deliveryStatus: 'ACCEPTED', now, restaurantToCustomerM: 10, settings }),
    ).toBeNull();
    expect(arrivalEstimate({ deliveryStatus: 'SEARCHING', now, toCustomerM: 5, settings })).toBeNull();
    expect(
      arrivalEstimate({
        deliveryStatus: 'ON_THE_WAY',
        now,
        toCustomerM: 0,
        settings: { ...settings, bufferMinutes: 0 },
      }),
    ).toEqual({ minMinutes: 1, maxMinutes: 11 });
  });
});
