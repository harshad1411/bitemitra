// Shared zod schemas — the runtime contract between clients and the API (MASTER_SPEC §4, OD-1).
import { z } from 'zod';
import {
  APP_IDS,
  AUTH_PROVIDERS,
  CONFIG_SCOPES,
  DEVICE_PLATFORMS,
  FOOD_TYPES,
  OTP_CHANNELS,
  PRODUCT_STATUSES,
  RESTAURANT_DOCUMENT_KINDS,
  RESTAURANT_ONBOARDING_STATUSES,
  RESTAURANT_USER_ROLES,
  RIDER_ONBOARDING_STATUSES,
} from '@jamzo/shared-types';

const values = (/** @type {Record<string,string>} */ e) =>
  /** @type {[string, ...string[]]} */ (Object.keys(e));

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * PATCH body from a create schema: every field optional and **no defaults applied**. zod's `.partial()`
 * keeps field defaults, so an omitted field would be silently overwritten with its default (e.g. renaming
 * a live city would send isActive=false). Bug found in Phase 2; every update schema uses this helper.
 * @template {import('zod').ZodRawShape} T
 * @param {import('zod').ZodObject<T>} schema
 * @returns {ReturnType<import('zod').ZodObject<T>['partial']>} (type approximation: defaults are removed at runtime)
 */
export function patchOf(schema) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? v.unwrap() : v]),
  );
  return /** @type {any} */ (z.object(shape).partial());
}

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
export const adminVerifyBody = z.object({ challengeId: uuid, code: otpCode });
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
export const cityUpdateBody = patchOf(cityCreateBody.omit({ stateId: true }));
export const zoneCreateBody = z.object({
  cityId: uuid,
  slug,
  name: z.string().trim().min(2).max(80),
  geometry: areaGeometry,
  isActive: z.boolean().default(true),
});
export const zoneUpdateBody = patchOf(zoneCreateBody.omit({ cityId: true }));
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
export const roleUpdateBody = patchOf(roleCreateBody.omit({ key: true }));

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

// ── Restaurants & menus (Phase 2 — docs/RESTAURANTS.md) ─────────────────────

const text = (min, max) => z.string().trim().min(min).max(max);
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
export const hhmmOrEndOfDay = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:mm (24-hour) or 24:00');
/** Menu prices: whole paise, at most ₹1,00,000 per item. */
export const pricePaise = z.number().int('Use whole paise').min(0).max(10_000_000);
export const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code');
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN, e.g. ABCDE1234F');
export const fssaiNumber = z
  .string()
  .trim()
  .regex(/^\d{14}$/, 'FSSAI numbers have 14 digits');
export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234');
export const bankAccountNumber = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{9,18}$/, 'Account numbers have 9 to 18 digits'));
export const upiId = z
  .string()
  .trim()
  .regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a valid UPI ID, e.g. name@bank');
export const foodType = z.enum(values(FOOD_TYPES));
export const productStatus = z.enum(values(PRODUCT_STATUSES));
export const restaurantDocumentKind = z.enum(values(RESTAURANT_DOCUMENT_KINDS));
export const restaurantUserRole = z.enum(values(RESTAURANT_USER_ROLES));
export const restaurantStatus = z.enum(values(RESTAURANT_ONBOARDING_STATUSES));
const localDate = z.iso.date('Use YYYY-MM-DD');

export const restaurantCreateBody = z.object({
  cityId: uuid,
  name: text(2, 80),
  slug,
  legalName: optionalText(120),
  description: optionalText(500),
  cuisines: z.array(text(2, 40)).max(10).default([]),
  isPureVeg: z.boolean().default(false),
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
});
export const restaurantUpdateBody = patchOf(restaurantCreateBody.omit({ cityId: true })).extend({
  gstin: gstin.nullable().optional(),
  pan: pan.nullable().optional(),
  fssaiNumber: fssaiNumber.nullable().optional(),
  fssaiExpiresOn: localDate.nullable().optional(),
  logoMediaId: uuid.nullable().optional(),
  coverMediaId: uuid.nullable().optional(),
  isPromoted: z.boolean().optional(),
  sortWeight: z.number().int().min(-1000).max(1000).optional(),
});
export const restaurantListQuery = pageQuery.extend({
  cityId: uuid.optional(),
  status: restaurantStatus.optional(),
});
export const restaurantTransitionBody = z.object({
  to: restaurantStatus,
  reason: z.string().trim().min(3).max(500).optional(),
});
export const restaurantZonesBody = z.object({ zoneIds: z.array(uuid).max(50) });
export const restaurantSettingsBody = z
  .object({ autoAccept: z.boolean().optional(), selfEditMenu: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const restaurantMemberCreateBody = z.object({
  phone,
  name: optionalText(80),
  role: restaurantUserRole,
});
export const restaurantMemberUpdateBody = z.object({
  role: restaurantUserRole.optional(),
  isActive: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const branchCreateBody = z.object({
  name: text(2, 80),
  addressLine: text(5, 200),
  area: optionalText(80),
  pincode: pincode.nullable().optional(),
  lat: latitude,
  lng: longitude,
  prepTimeMinutes: z.number().int().min(1).max(240).default(20),
});
/** pauseMinutes: 0 resumes now; otherwise the branch is paused for that many minutes. */
export const branchUpdateBody = patchOf(branchCreateBody).extend({
  isOpen: z.boolean().optional(),
  pauseMinutes: z.number().int().min(0).max(720).optional(),
  busyMode: z.boolean().optional(),
});
export const businessHoursBody = z.object({
  hours: z
    .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmmOrEndOfDay }))
    .max(28),
});
export const deliveryAreaBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('RADIUS'), radiusM: z.number().int().min(100).max(50_000) }),
  z.object({ kind: z.literal('POLYGON'), geometry: areaGeometry }),
]);
export const partnerBranchStatusBody = z
  .object({
    isOpen: z.boolean().optional(),
    pauseMinutes: z.number().int().min(0).max(720).optional(),
    busyMode: z.boolean().optional(),
    prepTimeMinutes: z.number().int().min(1).max(240).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

/** Multipart text fields of a document upload (the file itself is optional). */
export const restaurantDocumentFields = z.object({
  kind: restaurantDocumentKind,
  number: optionalText(60),
  expiresOn: localDate.nullable().optional(),
});
export const restaurantDocumentReviewBody = z
  .object({ status: z.enum(['VERIFIED', 'REJECTED']), note: optionalText(500) })
  .refine((b) => b.status !== 'REJECTED' || Boolean(b.note), {
    message: 'Say why the document is rejected',
    path: ['note'],
  });
export const bankAccountCreateBody = z
  .object({
    accountHolderName: text(2, 100),
    accountNumber: bankAccountNumber,
    confirmAccountNumber: bankAccountNumber,
    ifsc,
    bankName: optionalText(100),
    upiId: upiId.nullable().optional(),
  })
  .refine((b) => b.accountNumber === b.confirmAccountNumber, {
    message: 'Account numbers do not match',
    path: ['confirmAccountNumber'],
  });

export const categoryCreateBody = z.object({
  slug,
  name: text(2, 60),
  iconMediaId: uuid.nullable().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export const categoryUpdateBody = patchOf(categoryCreateBody);
export const menuCategoryCreateBody = z.object({ name: text(1, 60), isActive: z.boolean().default(true) });
export const menuCategoryUpdateBody = patchOf(menuCategoryCreateBody);
export const idOrderBody = z.object({ ids: z.array(uuid).min(1).max(500) });

export const productVariantInput = z.object({
  id: uuid.optional(),
  name: text(1, 40),
  basePricePaise: pricePaise,
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
});
export const productAddonInput = z.object({
  id: uuid.optional(),
  name: text(1, 60),
  basePricePaise: pricePaise.default(0),
  foodType: foodType.default('VEG'),
  isAvailable: z.boolean().default(true),
});
export const productAddonGroupInput = z.object({
  id: uuid.optional(),
  name: text(1, 60),
  minSelect: z.number().int().min(0).max(50).default(0),
  maxSelect: z.number().int().min(1).max(50).default(1),
  addons: z.array(productAddonInput).max(50),
});
export const productScheduleInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startsAt: hhmm,
  endsAt: hhmmOrEndOfDay,
});
const productFields = {
  menuCategoryId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  name: text(2, 100),
  description: optionalText(1000),
  foodType: foodType.default('VEG'),
  basePricePaise: pricePaise.nullable().optional(),
  packagingChargePaise: pricePaise.nullable().optional(),
  taxInclusive: z.boolean().nullable().optional(),
  prepTimeMinutes: z.number().int().min(1).max(240).nullable().optional(),
  isBestseller: z.boolean().default(false),
  isRecommended: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  status: productStatus.default('ACTIVE'),
  isAvailable: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).max(100_000).nullable().optional(),
  sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
  variants: z.array(productVariantInput).max(20).default([]),
  addonGroups: z.array(productAddonGroupInput).max(20).default([]),
  imageMediaIds: z.array(uuid).max(10).default([]),
  schedules: z.array(productScheduleInput).max(21).default([]),
};
export const productCreateBody = z.object({ restaurantId: uuid, ...productFields });
export const productUpdateBody = z.object({ version: z.number().int().min(0), ...productFields });
export const productListQuery = pageQuery.extend({
  restaurantId: uuid.optional(),
  cityId: uuid.optional(),
  menuCategoryId: uuid.optional(),
  categoryId: uuid.optional(),
  status: productStatus.optional(),
  foodType: foodType.optional(),
  available: z.enum(['true', 'false']).optional(),
});
/**
 * Sold-out / back-in-stock for a product, or for one of its variants or add-ons. `until` only applies to
 * the product: "END_OF_DAY" (city timezone) or an ISO date-time; omitted = until switched back on.
 */
export const availabilityBody = z
  .object({
    isAvailable: z.boolean(),
    variantId: uuid.optional(),
    addonId: uuid.optional(),
    until: z.union([z.literal('END_OF_DAY'), z.iso.datetime({ offset: true })]).optional(),
    reason: optionalText(200),
  })
  .refine((b) => !(b.variantId && b.addonId), 'Choose a variant or an add-on, not both')
  .refine((b) => !b.until || (!b.isAvailable && !b.variantId && !b.addonId), {
    message: '"until" only applies when marking a whole product sold out',
    path: ['until'],
  });
export const productBulkBody = z
  .object({
    ids: z.array(uuid).min(1).max(200),
    action: z.enum(['SOLD_OUT', 'AVAILABLE', 'ACTIVATE', 'DRAFT', 'ARCHIVE', 'MOVE_SECTION']),
    menuCategoryId: uuid.nullable().optional(),
  })
  .refine((b) => b.action !== 'MOVE_SECTION' || b.menuCategoryId !== undefined, {
    message: 'Choose the section to move to',
    path: ['menuCategoryId'],
  });

// ── Customer discovery (Phase 3) ────────────────────────────────────────────

export const locationQuery = z.object({
  lat: z.coerce.number().pipe(latitude).optional(),
  lng: z.coerce.number().pipe(longitude).optional(),
  addressId: uuid.optional(),
});
export const customerRestaurantsQuery = locationQuery.extend({
  q: z.string().trim().max(80).optional(),
  cuisine: z.string().trim().max(40).optional(),
  veg: z.enum(['true', 'false']).optional(),
  freeDelivery: z.enum(['true', 'false']).optional(),
  openNow: z.enum(['true', 'false']).optional(),
  sort: z.enum(['RELEVANCE', 'DISTANCE', 'DELIVERY_TIME', 'RATING', 'DELIVERY_FEE']).default('RELEVANCE'),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const customerSearchQuery = locationQuery.extend({ q: z.string().trim().min(2).max(80) });
export const addressBody = z.object({
  label: text(1, 30),
  line1: text(3, 200),
  line2: optionalText(200),
  landmark: optionalText(120),
  area: optionalText(80),
  pincode: pincode.nullable().optional(),
  lat: latitude,
  lng: longitude,
  contactName: optionalText(80),
  contactPhone: phone.nullable().optional(),
  makeDefault: z.boolean().default(false),
});
export const addressUpdateBody = patchOf(addressBody);
export const consentBody = z.object({
  kind: z.enum(['TERMS', 'PRIVACY', 'MARKETING_SMS', 'MARKETING_EMAIL', 'MARKETING_PUSH']),
  version: z.string().trim().min(1).max(20),
  granted: z.boolean(),
});
export const cartQuoteBody = z
  .object({
    restaurantId: uuid,
    lines: z
      .array(
        z.object({
          key: z.string().min(1).max(64),
          productId: uuid,
          variantId: uuid.nullable().optional(),
          addonIds: z.array(uuid).max(50).default([]),
          quantity: z.number().int().min(1).max(50),
        }),
      )
      .min(1)
      .max(100),
    addressId: uuid.optional(),
    lat: latitude.optional(),
    lng: longitude.optional(),
    couponCode: z.string().trim().toUpperCase().max(20).optional(),
    tipPaise: pricePaise.max(100_000).default(0),
    paymentMethod: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']).optional(),
  })
  .refine((b) => b.addressId || (b.lat !== undefined && b.lng !== undefined), 'Send an addressId or lat/lng');

// ── CMS (Phase 3) ───────────────────────────────────────────────────────────

export const HOME_SECTION_TYPES = [
  'BANNER_CAROUSEL',
  'CATEGORIES',
  'TOP_RESTAURANTS',
  'POPULAR_NEAR_YOU',
  'RECOMMENDED',
  'OFFERS',
  'NEW_RESTAURANTS',
  'FREE_DELIVERY',
  'UNDER_PRICE',
  'TOP_RATED',
  'CUISINE_COLLECTION',
  'RESTAURANT_COLLECTION',
  'PRODUCT_COLLECTION',
  'IMAGE_PROMO',
  'TEXT',
];
const isoDateTime = z.iso.datetime({ offset: true });
export const homeSectionBody = z
  .object({
    type: z.enum(HOME_SECTION_TYPES),
    title: optionalText(80),
    subtitle: optionalText(160),
    mediaId: uuid.nullable().optional(),
    background: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #F6F1FA')
      .nullable()
      .optional(),
    ctaLabel: optionalText(30),
    deepLink: z.string().trim().max(200).nullable().optional(),
    config: z
      .object({
        limit: z.number().int().min(1).max(30).optional(),
        cuisine: z.string().trim().max(40).optional(),
        maxPricePaise: pricePaise.optional(),
        restaurantIds: z.array(uuid).max(30).optional(),
        productIds: z.array(uuid).max(30).optional(),
      })
      .default({}),
    cityIds: z.array(uuid).max(50).default([]),
    zoneIds: z.array(uuid).max(100).default([]),
    audience: z.object({ newCustomers: z.boolean().optional() }).default({}),
    startsAt: isoDateTime.nullable().optional(),
    endsAt: isoDateTime.nullable().optional(),
    isEnabled: z.boolean().default(true),
  })
  .refine((b) => b.type !== 'CUISINE_COLLECTION' || b.config.cuisine, {
    message: 'Choose a cuisine',
    path: ['config', 'cuisine'],
  })
  .refine((b) => b.type !== 'UNDER_PRICE' || b.config.maxPricePaise, {
    message: 'Set the price limit',
    path: ['config', 'maxPricePaise'],
  })
  .refine((b) => b.type !== 'RESTAURANT_COLLECTION' || b.config.restaurantIds?.length, {
    message: 'Choose restaurants',
    path: ['config', 'restaurantIds'],
  })
  .refine((b) => b.type !== 'PRODUCT_COLLECTION' || b.config.productIds?.length, {
    message: 'Choose dishes',
    path: ['config', 'productIds'],
  })
  .refine((b) => b.type !== 'IMAGE_PROMO' || b.mediaId, { message: 'Choose an image', path: ['mediaId'] })
  .refine((b) => !b.startsAt || !b.endsAt || b.endsAt > b.startsAt, {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export const bannerBody = z
  .object({
    homeSectionId: uuid.nullable().optional(),
    mediaId: uuid,
    title: optionalText(80),
    deepLink: z.string().trim().max(200).nullable().optional(),
    cityIds: z.array(uuid).max(50).default([]),
    zoneIds: z.array(uuid).max(100).default([]),
    startsAt: isoDateTime.nullable().optional(),
    endsAt: isoDateTime.nullable().optional(),
    isEnabled: z.boolean().default(true),
  })
  .refine((b) => !b.startsAt || !b.endsAt || b.endsAt > b.startsAt, {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export const cmsPageBody = z.object({
  slug,
  title: text(2, 120),
  body: z.string().max(100_000),
  isPublished: z.boolean().default(false),
});

// ── Pricing rules, coupons, promotions (Phase 4) ────────────────────────────

export const PRICING_RULE_TYPES = [
  'MARKUP',
  'COMMISSION',
  'TAX',
  'PLATFORM_FEE',
  'DELIVERY',
  'SURGE',
  'RIDER_EARNING',
  'CANCELLATION',
];
export const pricingRuleType = z.enum(PRICING_RULE_TYPES);
export const pricingRuleCreateBody = z.object({
  type: pricingRuleType,
  scope: configScope,
  scopeRefId: uuid.nullable().optional(),
  restaurantId: uuid.nullable().optional(), // CATEGORY rules limited to one restaurant
  kind: z.enum(['NIGHT', 'DEMAND', 'WEATHER', 'MANUAL']).optional(), // SURGE only
  isEnabled: z.boolean().optional(), // SURGE only
  priority: z.number().int().min(-100).max(100).default(0),
  params: z.record(z.string(), z.unknown()),
  effectiveFrom: isoDateTime.optional(),
  changeNote: z.string().trim().min(3).max(500),
  /** The version this edit was based on (null = "there was none"). Omitted = no stale-edit check. */
  basedOnId: uuid.nullable().optional(),
});
export const pricingRuleEndBody = z.object({
  changeNote: z.string().trim().min(3).max(500),
  at: isoDateTime.optional(),
});
export const pricingRuleListQuery = z.object({
  type: pricingRuleType,
  scope: configScope.optional(),
  scopeRefId: uuid.optional(),
  include: z.enum(['CURRENT', 'ALL']).default('CURRENT'),
});
export const surgeSwitchBody = z.object({
  isEnabled: z.boolean(),
  changeNote: z.string().trim().min(3).max(500),
});
const offerTargeting = z
  .object({
    cityIds: z.array(uuid).max(50).optional(),
    zoneIds: z.array(uuid).max(100).optional(),
    restaurantIds: z.array(uuid).max(200).optional(),
    categoryIds: z.array(uuid).max(50).optional(),
    productIds: z.array(uuid).max(200).optional(),
    paymentMethods: z
      .array(z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']))
      .max(5)
      .optional(),
  })
  .default({});
const offerFields = {
  discountType: z.enum(['FIXED', 'PERCENTAGE', 'FREE_DELIVERY']),
  valueBps: z.number().int().min(1).max(10_000).nullable().optional(),
  valuePaise: pricePaise.nullable().optional(),
  maxDiscountPaise: pricePaise.nullable().optional(),
  minOrderPaise: pricePaise.nullable().optional(),
  fundingSource: z.enum(['PLATFORM', 'RESTAURANT', 'SHARED']),
  restaurantShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
  targeting: offerTargeting,
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().optional(),
  isActive: z.boolean().default(true),
};
const offerRules = (schema) =>
  schema
    .refine((b) => b.discountType !== 'PERCENTAGE' || b.valueBps, {
      message: 'Set the percentage',
      path: ['valueBps'],
    })
    .refine((b) => b.discountType !== 'FIXED' || b.valuePaise, {
      message: 'Set the amount',
      path: ['valuePaise'],
    })
    .refine((b) => b.fundingSource !== 'SHARED' || b.restaurantShareBps != null, {
      message: 'Set the restaurant’s share',
      path: ['restaurantShareBps'],
    })
    .refine((b) => !b.endsAt || b.endsAt > b.startsAt, {
      message: 'End must be after start',
      path: ['endsAt'],
    });
export const couponBody = offerRules(
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, '3–20 letters or digits'),
    description: optionalText(200),
    firstOrderOnly: z.boolean().default(false),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perUserLimit: z.number().int().min(1).nullable().optional(),
    ...offerFields,
  }),
);
export const promotionBody = offerRules(
  z.object({ name: text(2, 80), priority: z.number().int().min(-100).max(100).default(0), ...offerFields }),
);
export const pricingPreviewBody = z.object({
  restaurantId: uuid,
  draft: z
    .object({
      type: z.enum(['MARKUP', 'COMMISSION']),
      scope: configScope,
      scopeRefId: uuid.nullable().optional(),
      restaurantId: uuid.nullable().optional(),
      params: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

// ── Orders (Phase 5) ────────────────────────────────────────────────────────

export const PAYMENT_METHODS = ['COD', 'UPI', 'CARD', 'NETBANKING', 'WALLET'];
/** POST /v1/orders (D-64). The delivery address must be a saved address. */
export const checkoutBody = z.object({
  restaurantId: uuid,
  addressId: uuid,
  lines: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        productId: uuid,
        variantId: uuid.nullable().optional(),
        addonIds: z.array(uuid).max(50).default([]),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(100),
  couponCode: z.string().trim().toUpperCase().max(20).optional(),
  tipPaise: pricePaise.max(100_000).default(0),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** The total the customer saw and confirmed; a different server total → 409 PRICE_CHANGED. */
  expectedTotalPaise: pricePaise,
  deliveryInstructions: optionalText(300),
  restaurantInstructions: optionalText(300),
  contactless: z.boolean().default(false),
});

export const CUSTOMER_CANCEL_REASONS = [
  'CHANGED_MIND',
  'ORDERED_BY_MISTAKE',
  'TAKING_TOO_LONG',
  'WRONG_ADDRESS',
  'OTHER',
];
export const customerCancelBody = z.object({
  reasonCode: z.enum(CUSTOMER_CANCEL_REASONS),
  reasonText: optionalText(300),
});

/** A-26 */
export const RESTAURANT_REJECT_REASONS = [
  'ITEM_UNAVAILABLE',
  'TOO_BUSY',
  'CLOSING_SOON',
  'CANNOT_PREPARE',
  'OTHER',
];
export const RESTAURANT_CANCEL_REASONS = ['ITEM_UNAVAILABLE', 'KITCHEN_ISSUE', 'CLOSING_SOON', 'OTHER'];
const prepMinutes = z.number().int().min(5).max(240);
export const acceptOrderBody = z.object({ prepTimeMinutes: prepMinutes, version: z.number().int().min(0) });
export const rejectOrderBody = z
  .object({
    reasonCode: z.enum(RESTAURANT_REJECT_REASONS),
    reasonText: optionalText(300),
    version: z.number().int().min(0),
  })
  .refine((b) => b.reasonCode !== 'OTHER' || b.reasonText, { message: 'Tell us why', path: ['reasonText'] });
export const orderStepBody = z.object({ version: z.number().int().min(0) });
export const prepTimeBody = z.object({ prepTimeMinutes: prepMinutes, version: z.number().int().min(0) });
export const restaurantCancelBody = z
  .object({
    reasonCode: z.enum(RESTAURANT_CANCEL_REASONS),
    reasonText: optionalText(300),
    version: z.number().int().min(0),
  })
  .refine((b) => b.reasonCode !== 'OTHER' || b.reasonText, { message: 'Tell us why', path: ['reasonText'] });
export const restaurantOrdersQuery = z.object({
  restaurantId: uuid,
  view: z.enum(['NEW', 'ACTIVE', 'PAST']).default('ACTIVE'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ADMIN_CANCEL_REASONS = [
  'CUSTOMER_REQUEST',
  'RESTAURANT_UNRESPONSIVE',
  'RESTAURANT_REQUEST',
  'NO_RIDER',
  'RIDER_ISSUE',
  'FRAUD_SUSPECTED',
  'OTHER',
];
export const adminCancelBody = z.object({
  reasonCode: z.enum(ADMIN_CANCEL_REASONS),
  reasonText: z.string().trim().min(3).max(500),
  riderIssue: z.boolean().default(false),
  /** Replace the computed money outcome (audit-logged, D-66). */
  override: z
    .object({
      customerFeePaise: pricePaise,
      restaurantCompensationPaise: pricePaise,
      riderCompensationPaise: pricePaise,
    })
    .optional(),
  version: z.number().int().min(0),
});
export const adminOrderListQuery = pageQuery.extend({
  q: z.string().trim().max(60).optional(),
  status: z.string().trim().max(400).optional(), // comma-separated OrderStatus values
  restaurantId: uuid.optional(),
  cityId: uuid.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  needsAttention: z.enum(['true', 'false']).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  // Phase 9 (D-94)
  zoneId: uuid.optional(),
  riderId: uuid.optional(),
  deliveryStatus: z.string().trim().max(200).optional(), // comma-separated DeliveryStatus values
  financialStatus: z.enum(['NONE', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED']).optional(),
  minTotalPaise: z.coerce.number().int().min(0).optional(),
  maxTotalPaise: z.coerce.number().int().min(0).optional(),
});
export const orderNoteBody = z.object({ body: z.string().trim().min(1).max(1000) });
export const attentionBody = z.object({ resolved: z.literal(true), note: z.string().trim().min(3).max(500) });

export const customerCodBody = z.object({
  codDisabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
// ── Riders and dispatch (Phase 6) ───────────────────────────────────────────

export const VEHICLE_TYPES = ['BICYCLE', 'MOTORCYCLE', 'SCOOTER', 'EV_SCOOTER', 'CAR'];
export const RIDER_DOCUMENT_KINDS = [
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'PAN',
  'ID_PROOF',
  'PHOTO',
  'INSURANCE',
];
export const riderProfileBody = z.object({
  name: z.string().trim().min(2).max(80),
  cityId: uuid,
  addressLine: optionalText(200),
});
export const riderVehicleBody = z.object({
  type: z.enum(VEHICLE_TYPES),
  registrationNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{1,4}$/, 'Use a number like GJ02AB1234')
    .nullable()
    .optional(),
});
export const riderDocumentFields = z.object({
  kind: z.enum(RIDER_DOCUMENT_KINDS),
  number: z.string().trim().min(4).max(30).nullable().optional(),
});
export const riderStatusBody = z.object({ online: z.boolean() });
export const riderLocationsBody = z.object({
  points: z
    .array(
      z.object({
        lat: latitude,
        lng: longitude,
        accuracyM: z.number().int().min(0).max(10_000).optional(),
        speedMps: z.number().min(0).max(100).optional(),
        headingDeg: z.number().int().min(0).max(359).optional(),
        recordedAt: isoDateTime,
      }),
    )
    .min(1)
    .max(50),
});
export const OFFER_REJECT_REASONS = ['TOO_FAR', 'VEHICLE_ISSUE', 'ON_BREAK', 'OTHER'];
export const offerRejectBody = z.object({ reason: z.enum(OFFER_REJECT_REASONS) });
export const pickupBody = z.object({
  orderDigits: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter the last 4 digits of the order number'),
});
export const deliverBody = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .optional(),
  codCollectedPaise: pricePaise.optional(),
  proofMediaId: uuid.optional(),
});
export const RIDER_ISSUES = ['ACCIDENT', 'FOOD_DAMAGED', 'CUSTOMER_UNREACHABLE', 'RESTAURANT_DELAY', 'OTHER'];
export const riderIssueBody = z.object({ kind: z.enum(RIDER_ISSUES), note: optionalText(300) });
export const riderUnassignBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const riderEarningsQuery = z.object({ range: z.enum(['TODAY', 'WEEK']).default('TODAY') });

export const riderListQuery = pageQuery.extend({
  status: z
    .enum(['APPLIED', 'DOCUMENT_PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED'])
    .optional(),
  online: z.enum(['true', 'false']).optional(),
  cityId: uuid.optional(),
});
export const riderTransitionBody = z.object({
  to: z.enum(['DOCUMENT_PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED']),
  reason: z.string().trim().min(3).max(500),
});
export const riderDocumentReviewBody = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  note: optionalText(300),
});
export const riderCodBody = z.object({
  codEnabled: z.boolean(),
  codLimitPaise: pricePaise.nullable(),
  reason: z.string().trim().min(3).max(500),
});
export const assignRiderBody = z.object({ riderId: uuid, reason: z.string().trim().min(3).max(300) });
export const unassignRiderBody = z.object({ reason: z.string().trim().min(3).max(300) });

export const notificationTemplateBody = z.object({
  title: optionalText(100),
  body: z.string().trim().min(1).max(500),
  isActive: z.boolean(),
});

export const onboardingStatus = {
  restaurant: z.enum(values(RESTAURANT_ONBOARDING_STATUSES)),
  rider: z.enum(values(RIDER_ONBOARDING_STATUSES)),
};

// ── Phase 7: payments and refunds (D-83..D-87) ───────────────────────────────

export const PAYMENT_STATUSES = ['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];
export const REFUND_STATUSES = [
  'PENDING_APPROVAL',
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
];
export const REFUND_TYPES = ['FULL', 'PARTIAL', 'ITEM', 'DELIVERY', 'PLATFORM_FEE', 'MANUAL'];

export const paymentListQuery = pageQuery.extend({
  status: z.enum(PAYMENT_STATUSES).optional(),
  provider: z.string().trim().max(20).optional(),
});
export const refundListQuery = pageQuery.extend({ status: z.enum(REFUND_STATUSES).optional() });

/** An admin refund (D-86). `amountPaise` for PARTIAL and MANUAL; `itemIds` for ITEM. */
export const adminRefundBody = z
  .object({
    type: z.enum(REFUND_TYPES),
    amountPaise: pricePaise.min(1).optional(),
    itemIds: z.array(uuid).min(1).max(100).optional(),
    reason: z.string().trim().min(3).max(300),
    bearer: z.enum(['RESTAURANT', 'PLATFORM']).default('PLATFORM'),
    idempotencyKey: z.string().trim().min(8).max(100),
  })
  .superRefine((b, ctx) => {
    if ((b.type === 'PARTIAL' || b.type === 'MANUAL') && !b.amountPaise)
      ctx.addIssue({ code: 'custom', path: ['amountPaise'], message: 'Enter the amount to refund' });
    if (b.type === 'ITEM' && !b.itemIds?.length)
      ctx.addIssue({ code: 'custom', path: ['itemIds'], message: 'Choose the items to refund' });
  });
export const refundRejectBody = z.object({ reason: z.string().trim().min(3).max(300) });
/** A cash-on-delivery refund paid back outside the gateway: the UPI / bank transfer reference. */
export const refundPaidBody = z.object({ reference: z.string().trim().min(4).max(100) });

// ── Phase 8: ledgers and settlements (D-88 … D-92) ───────────────────────────

export const SETTLEMENT_KINDS = ['RESTAURANT', 'RIDER'];
export const SETTLEMENT_STATUSES = ['DRAFT', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'];
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const settlementListQuery = pageQuery.extend({
  kind: z.enum(SETTLEMENT_KINDS).default('RESTAURANT'),
  status: z.enum(SETTLEMENT_STATUSES).optional(),
});
/** Run settlements now: for today's due periods, or for a chosen period (India dates, end exclusive). */
export const settlementRunBody = z
  .object({ kind: z.enum(SETTLEMENT_KINDS), from: dateOnly.optional(), to: dateOnly.optional() })
  .refine((b) => Boolean(b.from) === Boolean(b.to), { message: 'Give both dates or neither', path: ['to'] })
  .refine((b) => !b.from || b.from < b.to, { message: 'The end must be after the start', path: ['to'] });
export const settlementPaidBody = z.object({ reference: z.string().trim().min(4).max(100) });
export const settlementNoteBody = z.object({ note: z.string().trim().min(3).max(300) });
export const ledgerEntriesQuery = pageQuery.extend({ unsettled: z.coerce.boolean().optional() });
export const restaurantAdjustmentBody = z.object({
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountPaise: pricePaise.min(1),
  reason: z.string().trim().min(3).max(300),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const riderAdjustmentBody = z.object({
  type: z.enum(['BONUS', 'ADJUSTMENT', 'PENALTY']),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountPaise: pricePaise.min(1),
  reason: z.string().trim().min(3).max(300),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const COD_DEPOSIT_METHODS = ['UPI', 'BANK_DEPOSIT', 'CASH_AT_HUB'];
export const codDepositBody = z.object({
  amountPaise: pricePaise.min(100),
  method: z.enum(COD_DEPOSIT_METHODS),
  reference: z.string().trim().min(3).max(100).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export const codDepositListQuery = pageQuery.extend({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
});
export const financeRangeQuery = z
  .object({ from: dateOnly, to: dateOnly })
  .refine((b) => b.from < b.to, { message: 'The end must be after the start', path: ['to'] });

// ── Phase 9: support, saved views, bulk actions, analytics (D-93 … D-97) ────

export const SUPPORT_ISSUE_TYPES = [
  'MISSING_ITEM',
  'WRONG_ITEM',
  'FOOD_QUALITY',
  'LATE_DELIVERY',
  'RIDER_ISSUE',
  'RESTAURANT_ISSUE',
  'PAYMENT_ISSUE',
  'REFUND_ISSUE',
  'OTHER',
];
export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'];
export const createTicketBody = z.object({
  orderId: uuid.nullable().optional(),
  issueType: z.enum(SUPPORT_ISSUE_TYPES),
  message: z.string().trim().min(3).max(2000),
});
export const ticketMessageBody = z.object({
  body: z.string().trim().min(1).max(2000),
  internal: z.boolean().default(false),
});
export const ticketUpdateBody = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    assignedToId: uuid.nullable().optional(),
    resolution: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((b) => !['RESOLVED', 'CLOSED'].includes(b.status ?? '') || b.resolution, {
    message: 'Say how it was resolved',
    path: ['resolution'],
  });
export const ticketListQuery = pageQuery.extend({
  status: z.string().trim().max(120).optional(), // comma-separated
  mine: z.enum(['true', 'false']).optional(),
  issueType: z.enum(SUPPORT_ISSUE_TYPES).optional(),
});
export const savedViewBody = z.object({
  resource: z.enum(['orders']),
  name: z.string().trim().min(2).max(60),
  query: z.record(z.string(), z.string().max(400)),
  isShared: z.boolean().default(false),
});
export const bulkAttentionBody = z.object({
  orderIds: z.array(uuid).min(1).max(200),
  note: z.string().trim().min(3).max(500),
});
export const analyticsQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    by: z.enum(['NONE', 'CITY', 'ZONE', 'RESTAURANT', 'PAYMENT_METHOD']).default('NONE'),
    cityId: uuid.optional(),
  })
  .refine((b) => b.from < b.to, { message: 'The end must be after the start', path: ['to'] });
export const appAnalyticsQuery = z.object({ range: z.enum(['TODAY', 'WEEK', 'MONTH']).default('WEEK') });

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
