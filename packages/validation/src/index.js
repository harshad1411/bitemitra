// Shared zod schemas — the runtime contract between clients and the API (MASTER_SPEC §4, OD-1).
import { z } from 'zod';
import {
  APP_IDS,
  AUTH_PROVIDERS,
  CONFIG_SCOPES,
  DEVICE_PLATFORMS,
  OTP_CHANNELS,
  RESTAURANT_ONBOARDING_STATUSES,
  RIDER_ONBOARDING_STATUSES,
} from '@jamzo/shared-types';

const values = (/** @type {Record<string,string>} */ e) =>
  /** @type {[string, ...string[]]} */ (Object.keys(e));

// ── Primitives ──────────────────────────────────────────────────────────────

export const uuid = z.uuid();
export const slug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');
export const appId = z.enum(values(APP_IDS));
export const devicePlatform = z.enum(values(DEVICE_PLATFORMS));
export const configScope = z.enum(values(CONFIG_SCOPES));
export const authProvider = z.enum(values(AUTH_PROVIDERS));
export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA timezone');

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX). India only for now (assumption A-1);
 * other countries are added when a second country launches.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeIndianMobile(input) {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const phone = z.string().transform((v, ctx) => {
  const normalized = normalizeIndianMobile(v);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
    return z.NEVER;
  }
  return normalized;
});

export const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128)
  .refine(
    (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p),
    'Use upper- and lower-case letters and a number',
  );

// ── Pagination ──────────────────────────────────────────────────────────────

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});

// ── GeoJSON ─────────────────────────────────────────────────────────────────

const position = z.tuple([longitude, latitude]);
const ring = z
  .array(position)
  .min(4, 'A ring needs at least 4 positions (first = last)')
  .refine(
    (r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1],
    'Ring must be closed (first position = last)',
  );

export const polygonGeometry = z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) });
export const multiPolygonGeometry = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ring).min(1)).min(1),
});
export const areaGeometry = z.discriminatedUnion('type', [polygonGeometry, multiPolygonGeometry]);

// ── Auth ────────────────────────────────────────────────────────────────────

export const otpRequestBody = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('SMS'), destination: phone }),
  z.object({ channel: z.literal('EMAIL'), destination: email }),
]);
export const otpChannel = z.enum(values(OTP_CHANNELS));
export const otpVerifyBody = z.object({ challengeId: uuid, code: otpCode });
export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200).optional() });
export const adminLoginBody = z.object({ email, password: z.string().min(1).max(128) });
export const deviceRegisterBody = z.object({
  platform: z.enum(['IOS', 'ANDROID']),
  pushToken: z.string().min(10).max(300),
  pushProvider: z.enum(['expo', 'fcm', 'apns']).default('expo'),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
});

// ── Geography ───────────────────────────────────────────────────────────────

export const countryCreateBody = z.object({
  code: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2, e.g. IN'),
  name: z.string().trim().min(2).max(80),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  timezone: timezone.default('Asia/Kolkata'),
});
export const stateCreateBody = z.object({
  countryId: uuid,
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(2).max(80),
});
export const cityCreateBody = z.object({
  stateId: uuid,
  slug,
  name: z.string().trim().min(2).max(80),
  timezone: timezone.default('Asia/Kolkata'),
  centerLat: latitude,
  centerLng: longitude,
  isActive: z.boolean().default(false),
});
export const cityUpdateBody = cityCreateBody.omit({ stateId: true }).partial();
export const zoneCreateBody = z.object({
  cityId: uuid,
  slug,
  name: z.string().trim().min(2).max(80),
  geometry: areaGeometry,
  isActive: z.boolean().default(true),
});
export const zoneUpdateBody = zoneCreateBody.omit({ cityId: true }).partial();
export const serviceAreaCreateBody = z.discriminatedUnion('kind', [
  z.object({
    zoneId: uuid,
    name: z.string().trim().min(2).max(80),
    kind: z.literal('POLYGON'),
    geometry: areaGeometry,
  }),
  z.object({
    zoneId: uuid,
    name: z.string().trim().min(2).max(80),
    kind: z.literal('RADIUS'),
    centerLat: latitude,
    centerLng: longitude,
    radiusM: z.number().int().min(100).max(50_000),
  }),
]);
export const serviceAreaUpdateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
});
export const serviceabilityQuery = z.object({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
});

// ── RBAC ────────────────────────────────────────────────────────────────────

export const roleGrant = z.object({ roleId: uuid, cityId: uuid.nullable().optional() });
export const adminUserCreateBody = z.object({
  email,
  name: z.string().trim().min(2).max(80),
  password,
  grants: z.array(roleGrant).min(1).max(20),
});
export const adminUserUpdateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  grants: z.array(roleGrant).max(20).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export const permissionKey = z.string().regex(/^[a-z_]+\.[a-z_]+$/);
export const roleCreateBody = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/, 'UPPER_SNAKE_CASE, e.g. SUPPORT_LEAD'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(permissionKey).max(200),
});
export const roleUpdateBody = roleCreateBody.omit({ key: true }).partial();

// ── Configuration ───────────────────────────────────────────────────────────

export const settingWriteBody = z.object({
  key: z.string().min(1).max(100),
  scope: configScope,
  scopeRefId: uuid.nullable().optional(),
  value: z.unknown(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export const settingResetBody = z.object({
  key: z.string().min(1).max(100),
  scope: configScope,
  scopeRefId: uuid,
  reason: z.string().trim().min(3).max(500).optional(),
});
export const featureFlagUpdateBody = z.object({
  enabled: z.boolean(),
  description: z.string().trim().max(300).optional(),
  rules: z
    .object({
      apps: z.array(appId).optional(),
      cityIds: z.array(uuid).optional(),
      zoneIds: z.array(uuid).optional(),
      minAppVersion: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .optional(),
      rolloutPercent: z.number().int().min(0).max(100).optional(),
    })
    .default({}),
  reason: z.string().trim().min(3).max(500).optional(),
});
const semverString = z.string().regex(/^\d+\.\d+\.\d+$/, 'Use MAJOR.MINOR.PATCH');
export const appVersionPolicyBody = z.object({
  minSupportedVersion: semverString,
  recommendedVersion: semverString,
  forceUpdate: z.boolean(),
  storeUrl: z.url().nullable().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

// ── Media & audit ───────────────────────────────────────────────────────────

export const mediaUpdateBody = z.object({
  altText: z.string().trim().max(300).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export const auditQuery = pageQuery.extend({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  actorId: uuid.optional(),
  action: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const onboardingStatus = {
  restaurant: z.enum(values(RESTAURANT_ONBOARDING_STATUSES)),
  rider: z.enum(values(RIDER_ONBOARDING_STATUSES)),
};

/**
 * Converts a ZodError into `{ field: [messages] }` for the standard error body (API.md §3).
 * @param {import('zod').ZodError} error
 */
export function toFieldErrors(error) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
