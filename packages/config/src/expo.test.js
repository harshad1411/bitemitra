import { describe, expect, it } from 'vitest';
import { buildExpoConfig } from './expo.js';

describe('buildExpoConfig', () => {
  it('derives identity from the registry per variant', () => {
    const prod = buildExpoConfig({
      appId: 'CUSTOMER',
      version: '1.5.0',
      env: { variant: 'production', apiUrl: 'https://api.jamzo.in' },
    });
    expect(prod).toMatchObject({
      name: 'Jamzo',
      scheme: 'jamzo',
      version: '1.5.0',
      ios: { bundleIdentifier: 'in.jamzo.customer', associatedDomains: ['applinks:jamzo.in'] },
      android: { package: 'in.jamzo.customer' },
    });
    expect(prod.android.intentFilters[0].data[0].host).toBe('jamzo.in');
    expect(prod.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
    const dev = buildExpoConfig({ appId: 'CUSTOMER', version: '1.5.0', env: {} });
    expect(dev).toMatchObject({
      name: 'Jamzo (Dev)',
      scheme: 'jamzo-dev',
      ios: { bundleIdentifier: 'in.jamzo.customer.dev' },
      extra: { apiUrl: 'http://localhost:4000', variant: 'development' },
    });
    expect(dev.ios.associatedDomains).toBeUndefined();
    expect(dev.updates).toBeUndefined();
  });

  it('keeps apps independent: own ids, versions and extras', () => {
    const rider = buildExpoConfig({
      appId: 'RIDER',
      version: '1.3.0',
      env: { variant: 'production' },
      android: { permissions: ['ACCESS_BACKGROUND_LOCATION'] },
    });
    const restaurant = buildExpoConfig({
      appId: 'RESTAURANT',
      version: '1.2.0',
      env: { variant: 'production' },
    });
    expect(rider.android.package).toBe('in.jamzo.rider');
    expect(restaurant.android.package).toBe('in.jamzo.restaurant');
    expect(rider.version).not.toBe(restaurant.version);
    expect(rider.android.permissions).toContain('ACCESS_BACKGROUND_LOCATION');
    expect(restaurant.android.permissions).toBeUndefined();
    expect(rider.ios.associatedDomains).toBeUndefined();
  });
});
