// OTP, refresh-token and access-token primitives (SECURITY.md §1).
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors } from 'jose';

/** 6-digit OTP from a CSPRNG. */
export const generateOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * HMAC-SHA256(code, pepper), bound to the challenge id so a hash cannot be replayed on another challenge.
 * @param {string} code
 * @param {string} challengeId
 * @param {string} pepper
 */
export const hashOtp = (code, challengeId, pepper) =>
  createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');

/**
 * Constant-time comparison of hex digests.
 * @param {string} a
 * @param {string} b
 */
export function safeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Opaque 256-bit refresh token (base64url). Only its SHA-256 is stored. */
export const generateRefreshToken = () => randomBytes(32).toString('base64url');

/** @param {string} token */
export const sha256 = (token) => createHash('sha256').update(token).digest('hex');

const ISSUER = 'jamzo-api';

/**
 * @param {{ sub: string, app: string, sid: string, pv?: number }} claims  pv = permission version
 * @param {string} secret
 * @param {number} ttlSec
 */
export async function signAccessToken(claims, secret, ttlSec) {
  return new SignJWT({ app: claims.app, sid: claims.sid, pv: claims.pv ?? 0 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(claims.app)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(new TextEncoder().encode(secret));
}

/**
 * @param {string} token
 * @param {string} secret
 * @param {string} expectedApp  tokens are only valid for the app they were issued to
 * @returns {Promise<{ ok: true, claims: { sub: string, app: string, sid: string, pv: number } } | { ok: false, reason: 'EXPIRED' | 'INVALID' }>}
 */
export async function verifyAccessToken(token, secret, expectedApp) {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
      audience: expectedApp,
      algorithms: ['HS256'],
    });
    return {
      ok: true,
      claims: {
        sub: String(payload.sub),
        app: String(payload.app),
        sid: String(payload.sid),
        pv: Number(payload.pv ?? 0),
      },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof errors.JWTExpired ? 'EXPIRED' : 'INVALID' };
  }
}
