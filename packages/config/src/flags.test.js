import { describe, expect, it } from 'vitest';
import { bucketOf, evaluateFlag } from './flags.js';

describe('feature flags', () => {
  it('disabled flags are always off', () => {
    expect(evaluateFlag({ key: 'cod', enabled: false }, { userId: 'u' })).toBe(false);
  });

  it('targets apps, cities and minimum app versions', () => {
    const flag = {
      key: 'tips',
      enabled: true,
      rules: { apps: ['CUSTOMER'], cityIds: ['unjha'], minAppVersion: '1.4.0' },
    };
    expect(evaluateFlag(flag, { appId: 'CUSTOMER', cityId: 'unjha', appVersion: '1.4.0' })).toBe(true);
    expect(evaluateFlag(flag, { appId: 'RIDER', cityId: 'unjha', appVersion: '1.4.0' })).toBe(false);
    expect(evaluateFlag(flag, { appId: 'CUSTOMER', cityId: 'mehsana', appVersion: '1.4.0' })).toBe(false);
    expect(evaluateFlag(flag, { appId: 'CUSTOMER', cityId: 'unjha', appVersion: '1.3.9' })).toBe(false);
    expect(evaluateFlag(flag, { appId: 'CUSTOMER', cityId: 'unjha' })).toBe(false);
  });

  it('percentage rollout is stable per user and roughly proportional', () => {
    const flag = { key: 'batching', enabled: true, rules: { rolloutPercent: 30 } };
    const on = Array.from({ length: 10_000 }, (_, i) => evaluateFlag(flag, { userId: `user-${i}` })).filter(
      Boolean,
    ).length;
    expect(on).toBeGreaterThan(2700);
    expect(on).toBeLessThan(3300);
    expect(evaluateFlag(flag, { userId: 'user-42' })).toBe(evaluateFlag(flag, { userId: 'user-42' }));
    expect(evaluateFlag(flag, {})).toBe(false);
    expect(bucketOf('abc')).toBe(bucketOf('abc'));
  });
});
