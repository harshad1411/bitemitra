import { describe, expect, it } from 'vitest';
import * as v from './index.js';
import {
  adminUserCreateBody,
  appVersionPolicyBody,
  cityCreateBody,
  normalizeIndianMobile,
  otpRequestBody,
  pageQuery,
  serviceAreaCreateBody,
  toFieldErrors,
  zoneCreateBody,
} from './index.js';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [72.38, 23.79],
      [72.41, 23.79],
      [72.41, 23.82],
      [72.38, 23.82],
      [72.38, 23.79],
    ],
  ],
};

describe('validation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0091-9876543210', '+919876543210'],
    ['5876543210', null],
    ['98765', null],
    ['abc', null],
  ])('normalises %s → %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it('OTP request normalises the destination per channel', () => {
    expect(otpRequestBody.parse({ channel: 'SMS', destination: '98765 43210' }).destination).toBe(
      '+919876543210',
    );
    expect(otpRequestBody.parse({ channel: 'EMAIL', destination: ' Owner@Jamzo.example ' }).destination).toBe(
      'owner@jamzo.example',
    );
    expect(otpRequestBody.safeParse({ channel: 'SMS', destination: 'x@y.z' }).success).toBe(false);
  });

  it('pagination defaults and caps', () => {
    expect(pageQuery.parse({})).toEqual({ limit: 25 });
    expect(pageQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(pageQuery.parse({ limit: '10' }).limit).toBe(10);
  });

  it('GeoJSON polygons must be closed and within range', () => {
    const base = { cityId: '0192d6a0-0000-7000-8000-000000000001', slug: 'unjha-central', name: 'Central' };
    expect(zoneCreateBody.safeParse({ ...base, geometry: square }).success).toBe(true);
    const open = { ...square, coordinates: [square.coordinates[0].slice(0, 4)] };
    expect(zoneCreateBody.safeParse({ ...base, geometry: open }).success).toBe(false);
    const outOfRange = {
      type: 'Polygon',
      coordinates: [
        [
          [200, 23],
          [201, 23],
          [201, 24],
          [200, 23],
        ],
      ],
    };
    expect(zoneCreateBody.safeParse({ ...base, geometry: outOfRange }).success).toBe(false);
  });

  it('service areas are either polygon or radius', () => {
    const zoneId = '0192d6a0-0000-7000-8000-000000000002';
    expect(
      serviceAreaCreateBody.safeParse({
        zoneId,
        name: 'Radius',
        kind: 'RADIUS',
        centerLat: 23.8,
        centerLng: 72.39,
        radiusM: 3000,
      }).success,
    ).toBe(true);
    expect(
      serviceAreaCreateBody.safeParse({
        zoneId,
        name: 'Radius',
        kind: 'RADIUS',
        centerLat: 23.8,
        centerLng: 72.39,
      }).success,
    ).toBe(false);
  });

  it('city slugs and timezones are validated', () => {
    const city = {
      stateId: '0192d6a0-0000-7000-8000-000000000003',
      slug: 'unjha',
      name: 'Unjha',
      centerLat: 23.8,
      centerLng: 72.39,
    };
    expect(cityCreateBody.parse(city).timezone).toBe('Asia/Kolkata');
    expect(cityCreateBody.safeParse({ ...city, slug: 'Unjha City' }).success).toBe(false);
    expect(cityCreateBody.safeParse({ ...city, timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('admin passwords must be strong', () => {
    const body = {
      email: 'a@b.co',
      name: 'Ops',
      grants: [{ roleId: '0192d6a0-0000-7000-8000-000000000004' }],
    };
    expect(adminUserCreateBody.safeParse({ ...body, password: 'short' }).success).toBe(false);
    expect(adminUserCreateBody.safeParse({ ...body, password: 'alllowercase123' }).success).toBe(false);
    expect(adminUserCreateBody.safeParse({ ...body, password: 'Correct-Horse-9' }).success).toBe(true);
  });

  it('version policies use strict semver', () => {
    expect(
      appVersionPolicyBody.safeParse({
        minSupportedVersion: '1.0',
        recommendedVersion: '1.0.0',
        forceUpdate: false,
      }).success,
    ).toBe(false);
  });

  it('formats field errors', () => {
    const r = otpRequestBody.safeParse({ channel: 'SMS', destination: '123' });
    expect(r.success).toBe(false);
    expect(toFieldErrors(r.error)).toEqual({ destination: ['Enter a valid 10-digit Indian mobile number'] });
  });
});

describe('PATCH schemas never inject defaults (bug found in Phase 2)', () => {
  // Full-document writes (product with its version, feature flag state) are PUT-like and excluded.
  const FULL_DOCUMENT = new Set(['productUpdateBody', 'featureFlagUpdateBody']);
  const patches = Object.entries(v).filter(([k]) => /UpdateBody$/.test(k) && !FULL_DOCUMENT.has(k));

  it.each(patches)('%s: an empty body stays empty', (_name, schema) => {
    expect(schema.parse({})).toEqual({});
  });

  it('a partial restaurant update keeps only what was sent', () => {
    expect(v.restaurantUpdateBody.parse({ phone: '98765 43210' })).toEqual({ phone: '+919876543210' });
    expect(v.cityUpdateBody.parse({ name: 'Unjha' })).toEqual({ name: 'Unjha' });
  });
});

describe('Indian business identifiers (Phase 2)', () => {
  it.each([
    ['gstin', '24ABCDE1234F1Z5', true],
    ['gstin', '24abcde1234f1z5', true],
    ['gstin', '24ABCDE1234F1X5', false],
    ['pan', 'ABCDE1234F', true],
    ['pan', 'ABCD1234F', false],
    ['fssaiNumber', '10026022000123', true],
    ['fssaiNumber', '1002602200012', false],
    ['ifsc', 'hdfc0001234', true],
    ['ifsc', 'HDFC1001234', false],
    ['bankAccountNumber', '5010 0012 3456 78', true],
    ['bankAccountNumber', '12345678', false],
    ['upiId', 'unjha.foods@okhdfc', true],
    ['upiId', 'no-at-sign', false],
    ['pincode', '384170', true],
    ['pincode', '084170', false],
  ])('%s %s → %s', (name, value, ok) => {
    expect(v[name].safeParse(value).success).toBe(ok);
  });

  it('bank account confirmation must match', () => {
    const base = { accountHolderName: 'Test Foods', accountNumber: '123456789012', ifsc: 'SBIN0001234' };
    expect(
      v.bankAccountCreateBody.safeParse({ ...base, confirmAccountNumber: '1234 5678 9012' }).success,
    ).toBe(true);
    expect(v.bankAccountCreateBody.safeParse({ ...base, confirmAccountNumber: '123456789013' }).success).toBe(
      false,
    );
  });

  it('availability "until" only applies to marking a whole product sold out', () => {
    expect(v.availabilityBody.safeParse({ isAvailable: false, until: 'END_OF_DAY' }).success).toBe(true);
    expect(v.availabilityBody.safeParse({ isAvailable: true, until: 'END_OF_DAY' }).success).toBe(false);
    expect(
      v.availabilityBody.safeParse({
        isAvailable: false,
        variantId: '0199a3c4-1111-7000-8000-000000000001',
        until: 'END_OF_DAY',
      }).success,
    ).toBe(false);
  });
});
