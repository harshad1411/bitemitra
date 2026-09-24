import { describe, expect, it } from 'vitest';
import { SETTINGS, getSettingDefinition, validateSetting } from './settings-registry.js';

describe('settings registry', () => {
  it('every default validates and every key is unique', () => {
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
    for (const s of SETTINGS) expect(s.schema.safeParse(s.default).success).toBe(true);
  });

  it('owner defaults: tips 100% to rider, rounding explicit, markup disclosure pending legal', () => {
    expect(getSettingDefinition('tips').default.riderShareBps).toBe(10_000);
    expect(getSettingDefinition('pricing.finalRounding').default.mode).toBe('NEAREST_1');
    expect(getSettingDefinition('pricing.markupDisclosure').legalReview).toBe(true);
    expect(getSettingDefinition('settlements.restaurants').default.schedule).toBe('WEEKLY');
    expect(getSettingDefinition('delivery.distance').default.fallback).toBe('HAVERSINE_FACTOR');
  });

  it('money amounts are integers (no floats)', () => {
    expect(validateSetting('cod', 'CITY', { ...getSettingDefinition('cod').default, maxOrderValuePaise: 100.5 }).ok).toBe(false);
  });

  it('rejects unknown keys, disallowed scopes and invalid values', () => {
    expect(validateSetting('nope', 'GLOBAL', 1).ok).toBe(false);
    expect(validateSetting('maintenance', 'CITY', { enabled: true, message: null, apps: [] }).ok).toBe(false);
    expect(validateSetting('auth.otp', 'GLOBAL', { ttlSec: 5, maxAttempts: 5, resendCooldownSec: 30, maxPerHour: 5 }).ok).toBe(false);
    expect(validateSetting('orders.limits', 'CITY', { minOrderPaise: 9900, maxOrderPaise: 5_000_000, maxItems: 50 }).ok).toBe(true);
  });
});
