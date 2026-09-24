// Domain vocabulary shared by every app and service (JavaScript only — DECISIONS OD-1).
// Enum values mirror packages/database/prisma/design/schema.design.prisma; a test in
// @jamzo/database fails if they drift.

/**
 * @template {string} T
 * @param {T[]} values
 * @returns {Readonly<Record<T, T>>}
 */
const enumOf = (values) => /** @type {any} */ (Object.freeze(Object.fromEntries(values.map((v) => [v, v]))));

export const APP_IDS = enumOf(['CUSTOMER', 'RESTAURANT', 'RIDER', 'ADMIN']);
export const DEVICE_PLATFORMS = enumOf(['IOS', 'ANDROID', 'WEB']);
export const USER_STATUSES = enumOf(['ACTIVE', 'SUSPENDED', 'DELETED']);
export const AUTH_PROVIDERS = enumOf(['PHONE_OTP', 'EMAIL_OTP', 'GOOGLE', 'APPLE', 'PASSWORD']);
export const OTP_CHANNELS = enumOf(['SMS', 'EMAIL']);
export const CONFIG_SCOPES = enumOf([
  'GLOBAL',
  'COUNTRY',
  'STATE',
  'CITY',
  'ZONE',
  'RESTAURANT',
  'BRANCH',
  'CATEGORY',
  'PRODUCT',
  'VARIANT',
]);
export const ACTOR_TYPES = enumOf(['CUSTOMER', 'RESTAURANT_USER', 'RIDER', 'ADMIN', 'SYSTEM']);
export const RESTAURANT_ONBOARDING_STATUSES = enumOf([
  'DRAFT',
  'DOCUMENTS_PENDING',
  'REVIEW',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
]);
export const RIDER_ONBOARDING_STATUSES = enumOf([
  'APPLIED',
  'DOCUMENT_PENDING',
  'UNDER_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]);
export const RESTAURANT_USER_ROLES = enumOf(['OWNER', 'MANAGER', 'STAFF']);
export const MEDIA_KINDS = enumOf(['IMAGE', 'DOCUMENT']);
export const DOCUMENT_STATUSES = enumOf(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']);
export const FOOD_TYPES = enumOf(['VEG', 'NON_VEG', 'EGG', 'VEGAN']);
export const PRODUCT_STATUSES = enumOf(['DRAFT', 'ACTIVE', 'ARCHIVED']);
/** Restaurant document kinds (validated in the API; the column is free text so new kinds need no migration). */
export const RESTAURANT_DOCUMENT_KINDS = enumOf([
  'FSSAI',
  'PAN',
  'GST',
  'SHOP_ACT',
  'TRADE_LICENSE',
  'CANCELLED_CHEQUE',
  'OTHER',
]);

/** Headers every first-party client sends (API.md §2). */
export const CLIENT_HEADERS = Object.freeze({
  appId: 'x-app-id',
  appVersion: 'x-app-version',
  platform: 'x-platform',
  requestId: 'x-request-id',
  idempotencyKey: 'idempotency-key',
});

/** Standard error codes (API.md §3). */
export const ERROR_CODES = enumOf([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'OTP_RESEND_TOO_SOON',
  'AUTH_METHOD_DISABLED',
  'AUTH_METHOD_UNAVAILABLE',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'UPGRADE_REQUIRED',
  'MAINTENANCE',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'INVALID_STATE_TRANSITION',
  'NOT_SERVICEABLE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
]);

/** HTTP status for each error code. */
export const ERROR_STATUS = Object.freeze({
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  OTP_INVALID: 401,
  OTP_EXPIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  AUTH_METHOD_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  NOT_SERVICEABLE: 422,
  ACCOUNT_LOCKED: 423,
  UPGRADE_REQUIRED: 426,
  RATE_LIMITED: 429,
  OTP_ATTEMPTS_EXCEEDED: 429,
  OTP_RESEND_TOO_SOON: 429,
  AUTH_METHOD_UNAVAILABLE: 501,
  MAINTENANCE: 503,
  INTERNAL: 500,
});

/**
 * @typedef {object} ApiErrorBody
 * @property {{ code: string, message: string, fieldErrors?: Record<string, string[]>, requestId: string, details?: Record<string, unknown> }} error
 */

/**
 * @template T
 * @typedef {object} Page
 * @property {T[]} items
 * @property {string | null} nextCursor
 */

/**
 * @typedef {object} AuthTokens
 * @property {string} accessToken
 * @property {number} expiresIn seconds
 * @property {string} [refreshToken] omitted for admin (sent as an httpOnly cookie instead)
 */

/**
 * @typedef {object} VersionStatus
 * @property {'OK' | 'UPDATE_RECOMMENDED' | 'UPDATE_REQUIRED'} status
 * @property {string} minSupportedVersion
 * @property {string} recommendedVersion
 * @property {boolean} forceUpdate
 * @property {string | null} storeUrl
 */
