import { describe, expect, it } from 'vitest';
import { BRAND, MOBILE_APPS, mobileIdentity, isKnownAppId } from './apps.js';

describe('product registry', () => {
  it('holds the owner-approved identifiers (OD-3)', () => {
    expect(BRAND.domain).toBe('jamzo.in');
    expect(MOBILE_APPS.CUSTOMER.bundleId).toBe('in.jamzo.customer');
    expect(MOBILE_APPS.RESTAURANT.bundleId).toBe('in.jamzo.restaurant');
    expect(MOBILE_APPS.RIDER.bundleId).toBe('in.jamzo.rider');
  });

  it('gives every app a unique id, scheme and name; all share the Jamzo navy (D-107)', () => {
    const apps = Object.values(MOBILE_APPS);
    for (const field of ['bundleId', 'scheme', 'slug', 'displayName']) {
      expect(new Set(apps.map((a) => a[field])).size).toBe(apps.length);
    }
    expect(new Set(apps.map((a) => a.color))).toEqual(new Set(['#1B2250']));
  });

  it('suffixes non-production variants so they can be installed side by side', () => {
    expect(mobileIdentity('RIDER', 'production').bundleId).toBe('in.jamzo.rider');
    expect(mobileIdentity('RIDER', 'development').bundleId).toBe('in.jamzo.rider.dev');
    expect(mobileIdentity('RIDER', 'preview').bundleId).toBe('in.jamzo.rider.preview');
    expect(mobileIdentity('CUSTOMER', 'development').scheme).toBe('jamzo-dev');
    expect(mobileIdentity('CUSTOMER', 'production').associatedDomain).toBe('jamzo.in');
    expect(mobileIdentity('RESTAURANT', 'production').associatedDomain).toBeNull();
  });

  it('rejects unknown apps and variants', () => {
    expect(() => mobileIdentity(/** @type {any} */ ('ADMIN'))).toThrow();
    expect(() => mobileIdentity('CUSTOMER', /** @type {any} */ ('beta'))).toThrow();
    expect(isKnownAppId('ADMIN')).toBe(true);
    expect(isKnownAppId('POS')).toBe(false);
  });
});
