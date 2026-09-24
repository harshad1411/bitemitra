import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, versionStatus } from './semver.js';

describe('semver', () => {
  it('parses and compares', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseVersion('1.2')).toBeNull();
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0);
    expect(() => compareVersions('x', '1.0.0')).toThrow();
  });

  const policy = { minSupportedVersion: '1.2.0', recommendedVersion: '1.5.0', forceUpdate: false };
  it.each([
    ['1.1.9', 'UPDATE_REQUIRED'],
    ['1.2.0', 'UPDATE_RECOMMENDED'],
    ['1.4.99', 'UPDATE_RECOMMENDED'],
    ['1.5.0', 'OK'],
    ['2.0.0', 'OK'],
    [null, 'UPDATE_REQUIRED'],
    ['garbage', 'UPDATE_REQUIRED'],
  ])('version %s → %s', (v, expected) => {
    expect(versionStatus(v, policy)).toBe(expected);
  });

  it('forceUpdate turns "recommended" into "required"', () => {
    expect(versionStatus('1.3.0', { ...policy, forceUpdate: true })).toBe('UPDATE_REQUIRED');
    expect(versionStatus('1.5.0', { ...policy, forceUpdate: true })).toBe('OK');
  });
});
