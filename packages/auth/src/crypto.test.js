import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCipher, restaurantRoleCan } from './index.js';

const key = randomBytes(32).toString('base64');

describe('field encryption (D-35)', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const c = createFieldCipher(key);
    const a = c.encrypt('123456789012');
    const b = c.encrypt('123456789012');
    expect(a).not.toBe(b);
    expect(a).not.toContain('123456789012');
    expect(c.decrypt(a)).toBe('123456789012');
    expect(a.split('.')[0]).toBe(c.keyId);
  });

  it('detects the wrong key and tampering', () => {
    const c = createFieldCipher(key);
    const other = createFieldCipher(randomBytes(32).toString('base64'));
    const ct = c.encrypt('50100012345678');
    expect(() => other.decrypt(ct)).toThrow(/different key/);
    const parts = ct.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 1;
    parts[3] = flipped.toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => createFieldCipher('short')).toThrow(/32 bytes/);
    expect(() => createFieldCipher(undefined)).toThrow(/32 bytes/);
  });
});

describe('restaurant role capabilities (D-42)', () => {
  it('staff toggle availability but cannot change store status', () => {
    expect(restaurantRoleCan('STAFF', 'menu.availability')).toBe(true);
    expect(restaurantRoleCan('STAFF', 'store.status')).toBe(false);
    expect(restaurantRoleCan('MANAGER', 'store.status')).toBe(true);
    expect(restaurantRoleCan('OWNER', 'unknown.capability')).toBe(false);
  });
});
