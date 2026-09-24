// Deterministic feature-flag evaluation (CONFIGURATION.md §4). Server-side only is authoritative;
// clients receive the evaluated booleans.
import { compareVersions, isValidVersion } from './semver.js';

/**
 * FNV-1a 32-bit hash → stable bucket 0..99 for percentage rollouts.
 * @param {string} input
 */
export function bucketOf(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * @param {{ key: string, enabled: boolean, rules?: { cityIds?: string[], zoneIds?: string[], apps?: string[], minAppVersion?: string, rolloutPercent?: number } }} flag
 * @param {{ userId?: string | null, cityId?: string | null, zoneId?: string | null, appId?: string | null, appVersion?: string | null }} ctx
 */
export function evaluateFlag(flag, ctx = {}) {
  if (!flag.enabled) return false;
  const r = flag.rules ?? {};
  if (r.apps?.length && !r.apps.includes(ctx.appId ?? '')) return false;
  if (r.cityIds?.length && !r.cityIds.includes(ctx.cityId ?? '')) return false;
  if (r.zoneIds?.length && !r.zoneIds.includes(ctx.zoneId ?? '')) return false;
  if (r.minAppVersion) {
    if (!ctx.appVersion || !isValidVersion(ctx.appVersion)) return false;
    if (compareVersions(ctx.appVersion, r.minAppVersion) < 0) return false;
  }
  if (r.rolloutPercent != null && r.rolloutPercent < 100) {
    if (!ctx.userId) return false; // anonymous users only see fully rolled-out flags
    return bucketOf(`${flag.key}:${ctx.userId}`) < r.rolloutPercent;
  }
  return true;
}
