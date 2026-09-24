import { describe, expect, it } from 'vitest';
import {
  PERMISSION_KEYS,
  SYSTEM_ROLES,
  generateOtp,
  generateRefreshToken,
  hasPermissions,
  hashOtp,
  hashPassword,
  safeEqualHex,
  sha256,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from './index.js';

const secret = 's'.repeat(32);

describe('auth primitives', () => {
  it('hashes and verifies passwords with argon2id', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('OTPs are 6 digits and hashes are challenge-bound', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    const a = hashOtp('123456', 'c1', 'pepper');
    expect(safeEqualHex(a, hashOtp('123456', 'c1', 'pepper'))).toBe(true);
    expect(safeEqualHex(a, hashOtp('123456', 'c2', 'pepper'))).toBe(false);
    expect(safeEqualHex(a, hashOtp('123457', 'c1', 'pepper'))).toBe(false);
  });

  it('refresh tokens are random and only hashes are compared', () => {
    const t = generateRefreshToken();
    expect(t).not.toBe(generateRefreshToken());
    expect(sha256(t)).toHaveLength(64);
  });

  it('access tokens are bound to their app and expire', async () => {
    const token = await signAccessToken({ sub: 'u1', app: 'CUSTOMER', sid: 's1' }, secret, 60);
    const ok = await verifyAccessToken(token, secret, 'CUSTOMER');
    expect(ok).toEqual({ ok: true, claims: { sub: 'u1', app: 'CUSTOMER', sid: 's1', pv: 0 } });
    expect(await verifyAccessToken(token, secret, 'ADMIN')).toEqual({ ok: false, reason: 'INVALID' });
    expect(await verifyAccessToken(token, 'x'.repeat(32), 'CUSTOMER')).toEqual({ ok: false, reason: 'INVALID' });
    const expired = await signAccessToken({ sub: 'u1', app: 'RIDER', sid: 's1' }, secret, -10);
    expect(await verifyAccessToken(expired, secret, 'RIDER')).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('system roles use known permissions; only Super Admin has rbac.super', () => {
    expect(SYSTEM_ROLES.map((r) => r.key)).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'CITY_MANAGER', 'FINANCE', 'SUPPORT', 'PARTNER_MANAGER', 'RIDER_MANAGER', 'MARKETING', 'CONTENT_MANAGER',
    ]);
    for (const r of SYSTEM_ROLES) {
      for (const p of r.permissions) expect(PERMISSION_KEYS).toContain(p);
      expect(r.permissions.includes('rbac.super')).toBe(r.key === 'SUPER_ADMIN');
    }
    expect(hasPermissions(['geo.view', 'geo.manage'], ['geo.view'])).toBe(true);
    expect(hasPermissions(['geo.view'], ['geo.view', 'geo.manage'])).toBe(false);
  });
});
