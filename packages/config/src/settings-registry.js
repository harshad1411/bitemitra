// Operational settings registry (CONFIGURATION.md §2, OD-7). Every setting key is declared once here.
// Money defaults are PLACEHOLDERS (assumption A-16). `phase` = the phase whose code first READS the
// setting; earlier the value is stored and editable but has no effect, and the admin says so.
import { z } from 'zod';

const MOBILE_APP_IDS = ['CUSTOMER', 'RESTAURANT', 'RIDER'];
const AUTH_METHODS = ['PHONE_OTP', 'EMAIL_OTP', 'GOOGLE', 'APPLE', 'PASSWORD'];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
const paise = z.number().int().min(0);
const bps = z.number().int().min(0).max(10_000);

const GEO_SCOPES = ['GLOBAL', 'COUNTRY', 'STATE', 'CITY', 'ZONE'];
const DOCUMENT_KINDS = ['FSSAI', 'PAN', 'GST', 'SHOP_ACT', 'TRADE_LICENSE', 'CANCELLED_CHEQUE', 'OTHER'];
const GEO_AND_RESTAURANT = [...GEO_SCOPES, 'RESTAURANT', 'BRANCH'];

/**
 * @typedef {object} SettingDefinition
 * @property {string} key
 * @property {string} section admin grouping (spec §64)
 * @property {string} label
 * @property {string} description
 * @property {import('zod').ZodType} schema
 * @property {unknown} default
 * @property {string[]} scopes where overrides are allowed
 * @property {number} phase phase whose code first reads the value
 * @property {boolean} [critical] requires a reason; shown in configuration history (spec §63)
 * @property {boolean} [placeholder] default is a placeholder that the owner must set before launch
 * @property {boolean} [legalReview] value needs legal/CA confirmation before production (OD-9)
 */

/** @type {SettingDefinition[]} */
const DEFINITIONS = [
  // ── General ──────────────────────────────────────────────────────────────
  {
    key: 'support.contact',
    section: 'General',
    label: 'Support contact',
    description: 'Phone, email and WhatsApp shown in the apps.',
    schema: z.object({
      phone: z.string().max(20).nullable(),
      email: z.email().nullable(),
      whatsapp: z.string().max(20).nullable(),
    }),
    default: { phone: null, email: null, whatsapp: null },
    scopes: GEO_SCOPES,
    phase: 1,
  },
  {
    key: 'maintenance',
    section: 'General',
    label: 'Maintenance mode',
    description: 'Blocks the selected apps with a message. Admin is never blocked.',
    schema: z.object({
      enabled: z.boolean(),
      message: z.string().max(280).nullable(),
      apps: z.array(z.enum(MOBILE_APP_IDS)),
    }),
    default: { enabled: false, message: null, apps: [...MOBILE_APP_IDS] },
    scopes: ['GLOBAL'],
    phase: 1,
    critical: true,
  },
  {
    key: 'operations.serviceHours',
    section: 'General',
    label: 'Service hours',
    description: 'Hours during which orders are accepted (city timezone). Equal start/end = 24 hours.',
    schema: z.object({ start: hhmm, end: hhmm }),
    default: { start: '00:00', end: '00:00' },
    scopes: GEO_SCOPES,
    phase: 5,
  },

  // ── Authentication ───────────────────────────────────────────────────────
  {
    key: 'auth.methods',
    section: 'Security',
    label: 'Sign-in methods per app',
    description:
      'Enabled sign-in methods. GOOGLE/APPLE are not implemented yet and are rejected when enabled.',
    schema: z.object({
      CUSTOMER: z.array(z.enum(AUTH_METHODS)).min(1),
      RESTAURANT: z.array(z.enum(AUTH_METHODS)).min(1),
      RIDER: z.array(z.enum(AUTH_METHODS)).min(1),
      ADMIN: z.array(z.enum(AUTH_METHODS)).min(1),
    }),
    default: {
      CUSTOMER: ['PHONE_OTP'],
      RESTAURANT: ['PHONE_OTP'],
      RIDER: ['PHONE_OTP'],
      ADMIN: ['PASSWORD'],
    },
    scopes: ['GLOBAL'],
    phase: 1,
    critical: true,
  },
  {
    key: 'auth.otp',
    section: 'Security',
    label: 'OTP policy',
    description: 'Lifetime, verify attempts, resend cooldown and hourly limit per destination.',
    schema: z.object({
      ttlSec: z.number().int().min(60).max(900),
      maxAttempts: z.number().int().min(1).max(10),
      resendCooldownSec: z.number().int().min(10).max(600),
      maxPerHour: z.number().int().min(1).max(20),
    }),
    default: { ttlSec: 300, maxAttempts: 5, resendCooldownSec: 30, maxPerHour: 5 },
    scopes: ['GLOBAL'],
    phase: 1,
    critical: true,
  },
  {
    key: 'auth.adminLockout',
    section: 'Security',
    label: 'Admin lockout',
    description: 'Failed password attempts before an admin account is locked, and for how long.',
    schema: z.object({
      maxFailedLogins: z.number().int().min(3).max(20),
      lockMinutes: z.number().int().min(1).max(1440),
    }),
    default: { maxFailedLogins: 5, lockMinutes: 15 },
    scopes: ['GLOBAL'],
    phase: 1,
    critical: true,
  },

  // ── Orders ───────────────────────────────────────────────────────────────
  {
    key: 'orders.restaurantAcceptance',
    section: 'Orders',
    label: 'Restaurant acceptance timeout',
    description: 'Seconds a restaurant has to accept, and what happens on timeout.',
    schema: z.object({
      timeoutSec: z.number().int().min(30).max(900),
      fallback: z.enum(['ESCALATE_TO_OPS', 'AUTO_REJECT', 'AUTO_ACCEPT']),
      escalationGraceSec: z.number().int().min(0).max(900),
    }),
    default: { timeoutSec: 180, fallback: 'ESCALATE_TO_OPS', escalationGraceSec: 120 },
    scopes: GEO_AND_RESTAURANT,
    phase: 5,
  },
  {
    key: 'orders.preparation',
    section: 'Orders',
    label: 'Preparation time limits',
    description: 'Maximum preparation time a restaurant can set, and when a late order is flagged.',
    schema: z.object({
      maxPrepMinutes: z.number().int().min(5).max(180),
      lateAfterMinutes: z.number().int().min(1).max(120),
    }),
    default: { maxPrepMinutes: 60, lateAfterMinutes: 15 },
    scopes: GEO_AND_RESTAURANT,
    phase: 2, // maxPrepMinutes bounds branch preparation time from Phase 2; lateAfterMinutes is read in Phase 5
  },
  {
    key: 'orders.limits',
    section: 'Orders',
    label: 'Order limits',
    description: 'Minimum order value, maximum order value and maximum items per order.',
    schema: z.object({
      minOrderPaise: paise,
      maxOrderPaise: paise,
      maxItems: z.number().int().min(1).max(500),
    }),
    default: { minOrderPaise: 0, maxOrderPaise: 5_000_000, maxItems: 50 },
    scopes: GEO_AND_RESTAURANT,
    phase: 4,
    placeholder: true,
  },

  // ── Restaurants ──────────────────────────────────────────────────────────
  {
    key: 'restaurants.requiredDocuments',
    section: 'Restaurants',
    label: 'Documents required for approval',
    description:
      'Document kinds a restaurant must upload before review and have verified before approval (RESTAURANTS.md §2).',
    schema: z.object({ kinds: z.array(z.enum(DOCUMENT_KINDS)).max(DOCUMENT_KINDS.length) }),
    default: { kinds: ['FSSAI', 'PAN'] },
    scopes: GEO_SCOPES,
    phase: 2,
    critical: true,
    legalReview: true,
  },
  {
    key: 'restaurants.operations',
    section: 'Restaurants',
    label: 'Pause and busy mode',
    description:
      'Longest pause a restaurant can set, and minutes busy mode adds to preparation time (Phase 5 ETAs).',
    schema: z.object({
      maxPauseMinutes: z.number().int().min(15).max(720),
      busyExtraPrepMinutes: z.number().int().min(0).max(60),
    }),
    default: { maxPauseMinutes: 120, busyExtraPrepMinutes: 10 },
    scopes: GEO_AND_RESTAURANT,
    phase: 2,
  },
  {
    key: 'restaurants.packaging',
    section: 'Restaurants',
    label: 'Default packaging charge',
    description:
      'Per-item packaging charge used when a product does not set its own. Passed through to the restaurant, no markup (A-10); tax treatment pending Q-3.',
    schema: z.object({ perItemPaise: paise }),
    default: { perItemPaise: 0 },
    scopes: GEO_AND_RESTAURANT,
    phase: 4,
    placeholder: true,
  },

  // ── Delivery & dispatch ──────────────────────────────────────────────────
  {
    key: 'delivery.distance',
    section: 'Delivery',
    label: 'Distance rules',
    description:
      'Maximum delivery distance and what to do when road distance is unavailable (road distance is always preferred).',
    schema: z.object({
      maxDistanceM: z.number().int().min(500).max(50_000),
      fallback: z.enum(['HAVERSINE_FACTOR', 'REJECT']),
      roadFactorBps: z.number().int().min(10_000).max(30_000),
    }),
    default: { maxDistanceM: 7000, fallback: 'HAVERSINE_FACTOR', roadFactorBps: 13_000 },
    scopes: GEO_AND_RESTAURANT,
    phase: 3,
  },
  {
    key: 'dispatch.offers',
    section: 'Delivery',
    label: 'Dispatch offers',
    description:
      'When dispatch starts, offer timeout, max offers before escalation, rider capacity, how fresh a rider’s location must be, how far a rider may be from the restaurant, and how often dispatch retries (D-75).',
    schema: z.object({
      startAt: z.enum(['ON_ACCEPT', 'PREP_TIME_MINUS_LEAD']),
      leadMinutes: z.number().int().min(0).max(60),
      offerTimeoutSec: z.number().int().min(10).max(300),
      maxOffers: z.number().int().min(1).max(50),
      noRiderEscalationSec: z.number().int().min(60).max(3600),
      maxActiveOrders: z.number().int().min(1).max(5),
      maxLocationAgeSec: z.number().int().min(30).max(900).default(120),
      maxPickupDistanceM: z.number().int().min(500).max(30_000).default(7_000),
      retrySec: z.number().int().min(15).max(600).default(60),
    }),
    default: {
      startAt: 'ON_ACCEPT',
      leadMinutes: 10,
      offerTimeoutSec: 30,
      maxOffers: 5,
      noRiderEscalationSec: 600,
      maxActiveOrders: 1,
      maxLocationAgeSec: 120,
      maxPickupDistanceM: 7_000,
      retrySec: 60,
    },
    scopes: GEO_SCOPES,
    phase: 6,
  },

  {
    key: 'delivery.eta',
    section: 'Delivery',
    label: 'Delivery time estimate',
    description:
      'Estimate shown to customers: preparation time + travel at this average speed + buffer, as a range (A-24). An estimate, not a promise.',
    schema: z.object({
      avgSpeedKmph: z.number().int().min(5).max(60),
      bufferMinutes: z.number().int().min(0).max(60),
      rangeMinutes: z.number().int().min(0).max(60),
    }),
    default: { avgSpeedKmph: 18, bufferMinutes: 5, rangeMinutes: 10 },
    scopes: GEO_SCOPES,
    phase: 3,
  },

  // ── Payments & COD ───────────────────────────────────────────────────────
  {
    key: 'payments.methods',
    section: 'Payments',
    label: 'Payment methods',
    description: 'Methods offered at checkout and how long an online payment may stay pending.',
    schema: z.object({
      enabled: z.array(z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD'])).min(1),
      expirySec: z.number().int().min(120).max(3600),
    }),
    default: { enabled: ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD'], expirySec: 900 },
    scopes: GEO_AND_RESTAURANT,
    phase: 7,
  },
  {
    key: 'cod',
    section: 'COD',
    label: 'Cash on delivery',
    description:
      'COD availability, maximum COD order, rider cash limit, netting against earnings, and the limit of refused deliveries / cancellations after acceptance before a customer loses COD (D-70).',
    schema: z.object({
      enabled: z.boolean(),
      maxOrderValuePaise: paise,
      riderLimitPaise: paise,
      maxRefusedOrders: z.number().int().min(0).max(20),
      netAgainstEarnings: z.boolean(),
    }),
    default: {
      enabled: true,
      maxOrderValuePaise: 100_000,
      riderLimitPaise: 500_000,
      maxRefusedOrders: 2,
      netAgainstEarnings: true,
    },
    scopes: GEO_AND_RESTAURANT,
    phase: 6,
    placeholder: true,
    critical: true,
  },
  {
    key: 'payments.gatewayFees',
    section: 'Payments',
    label: 'Payment gateway fee estimate',
    description:
      'Estimated gateway fee per method, used only for the platform-margin figures in the admin (D-54). Actual fees come from the provider (Phase 7).',
    schema: z.object({
      methods: z.record(
        z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']),
        z.object({ bps, fixedPaise: paise }),
      ),
      gstBps: bps,
      defaultMethod: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']),
    }),
    default: {
      methods: {
        UPI: { bps: 0, fixedPaise: 0 },
        CARD: { bps: 200, fixedPaise: 0 },
        NETBANKING: { bps: 190, fixedPaise: 0 },
        WALLET: { bps: 190, fixedPaise: 0 },
        COD: { bps: 0, fixedPaise: 0 },
      },
      gstBps: 1800,
      defaultMethod: 'UPI',
    },
    scopes: ['GLOBAL'],
    phase: 4,
    placeholder: true,
  },
  {
    key: 'refunds.approval',
    section: 'Payments',
    label: 'Refund approval threshold',
    description: 'Refunds above this amount need a second approver.',
    schema: z.object({ thresholdPaise: paise }),
    default: { thresholdPaise: 100_000 },
    scopes: ['GLOBAL'],
    phase: 7,
    placeholder: true,
    critical: true,
  },

  // ── Pricing (display & rounding; money rules are versioned rule tables) ──
  {
    key: 'pricing.finalRounding',
    section: 'Pricing',
    label: 'Final bill rounding',
    description: 'Rounding of the payable amount. The difference is always shown as its own bill line.',
    schema: z.object({
      mode: z.enum(['NONE', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10']),
      direction: z.enum(['HALF_UP', 'UP', 'DOWN']),
      absorbedBy: z.enum(['PLATFORM', 'RESTAURANT']),
    }),
    default: { mode: 'NEAREST_1', direction: 'HALF_UP', absorbedBy: 'PLATFORM' },
    scopes: GEO_SCOPES,
    phase: 4,
    critical: true,
  },
  {
    key: 'pricing.markupDisclosure',
    section: 'Pricing',
    label: 'Markup disclosure',
    description:
      'How customer prices above the restaurant menu price are disclosed. Pending legal confirmation (Q-4).',
    schema: z.enum(['NONE', 'NOTE', 'ITEMISED']),
    default: 'NONE',
    scopes: GEO_SCOPES,
    phase: 4,
    critical: true,
    legalReview: true,
  },
  {
    key: 'pricing.surcharges',
    section: 'Pricing',
    label: 'Surcharge cap and promotion stacking',
    description: 'Maximum total surcharges per order and how promotions stack.',
    schema: z.object({
      maxTotalPaise: paise,
      promotionStacking: z.enum(['ONE_PROMO_ONE_COUPON', 'BEST_OF', 'COUPON_ONLY']),
    }),
    default: { maxTotalPaise: 5000, promotionStacking: 'ONE_PROMO_ONE_COUPON' },
    scopes: GEO_SCOPES,
    phase: 4,
    placeholder: true,
  },
  {
    key: 'tips',
    section: 'Pricing',
    label: 'Tips',
    description:
      'Whether tipping is offered and the delivery partner share (default 100%). Tips are never platform revenue.',
    schema: z.object({ enabled: z.boolean(), riderShareBps: bps, presetsPaise: z.array(paise).max(6) }),
    default: { enabled: true, riderShareBps: 10_000, presetsPaise: [1000, 2000, 3000] },
    scopes: GEO_SCOPES,
    phase: 4,
    critical: true,
  },

  // ── Settlements ─────────────────────────────────────────────────────────
  {
    key: 'settlements.restaurants',
    section: 'Settlements',
    label: 'Restaurant settlements',
    description: 'Default schedule (overridable per restaurant), weekly run day, minimum payout, reserve.',
    schema: z.object({
      schedule: z.enum(['DAILY', 'T_PLUS_1', 'T_PLUS_2', 'WEEKLY', 'MANUAL']),
      weeklyRunDay: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
      minPayoutPaise: paise,
      reservePercentBps: bps,
    }),
    default: { schedule: 'WEEKLY', weeklyRunDay: 'MONDAY', minPayoutPaise: 10_000, reservePercentBps: 0 },
    scopes: GEO_AND_RESTAURANT,
    phase: 8,
    placeholder: true,
    critical: true,
  },
  {
    key: 'settlements.riders',
    section: 'Settlements',
    label: 'Delivery partner payouts',
    description: 'Payout schedule and minimum payout.',
    schema: z.object({ schedule: z.enum(['DAILY', 'WEEKLY', 'MANUAL']), minPayoutPaise: paise }),
    default: { schedule: 'WEEKLY', minPayoutPaise: 10_000 },
    scopes: GEO_SCOPES,
    phase: 8,
    placeholder: true,
    critical: true,
  },
  {
    key: 'riders.location',
    section: 'Delivery',
    label: 'Delivery partner location updates',
    description: 'Location reporting interval while on a trip and while idle online.',
    schema: z.object({
      tripIntervalSec: z.number().int().min(3).max(60),
      idleIntervalSec: z.number().int().min(10).max(300),
    }),
    default: { tripIntervalSec: 10, idleIntervalSec: 30 },
    scopes: GEO_SCOPES,
    phase: 6,
  },
  {
    key: 'riders.requiredDocuments',
    section: 'Delivery',
    label: 'Delivery partner documents',
    description:
      'Documents a delivery partner must have approved before going live, by vehicle (D-73). Aadhaar numbers are never collected.',
    schema: z.object({
      motorised: z
        .array(z.enum(['DRIVING_LICENCE', 'VEHICLE_RC', 'PAN', 'ID_PROOF', 'PHOTO', 'INSURANCE']))
        .min(1),
      bicycle: z
        .array(z.enum(['DRIVING_LICENCE', 'VEHICLE_RC', 'PAN', 'ID_PROOF', 'PHOTO', 'INSURANCE']))
        .min(1),
    }),
    default: {
      motorised: ['DRIVING_LICENCE', 'VEHICLE_RC', 'PAN', 'ID_PROOF', 'PHOTO'],
      bicycle: ['PAN', 'ID_PROOF', 'PHOTO'],
    },
    scopes: GEO_SCOPES,
    phase: 6,
    critical: true,
    legalReview: true,
  },
  {
    key: 'maps.provider',
    section: 'Delivery',
    label: 'Maps provider',
    description:
      'Road distances come from this provider; NONE uses straight line × road factor, clearly marked (D-48, D-81). The API key is kept in the server environment, never here.',
    schema: z.object({ provider: z.enum(['NONE', 'GOOGLE']) }),
    default: { provider: 'NONE' },
    scopes: ['GLOBAL'],
    phase: 6,
    critical: true,
  },
  {
    key: 'customer.guestBrowsing',
    section: 'Customer',
    label: 'Guest browsing',
    description: 'Allow browsing restaurants before signing in (sign-in is always required at checkout).',
    schema: z.boolean(),
    default: true,
    scopes: GEO_SCOPES,
    phase: 3,
  },
];

const BY_KEY = new Map(DEFINITIONS.map((d) => [d.key, d]));
if (BY_KEY.size !== DEFINITIONS.length) throw new Error('Duplicate setting key in registry');
for (const d of DEFINITIONS) {
  const parsed = d.schema.safeParse(d.default);
  if (!parsed.success) throw new Error(`Default for ${d.key} is invalid: ${parsed.error.message}`);
}

export const SETTINGS = Object.freeze(DEFINITIONS);
export const SETTING_SECTIONS = Object.freeze([...new Set(DEFINITIONS.map((d) => d.section))]);

/** @param {string} key */
export function getSettingDefinition(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * Validates a value for a key and scope.
 * @param {string} key
 * @param {string} scope
 * @param {unknown} value
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string, issues?: import('zod').core.$ZodIssue[] }}
 */
export function validateSetting(key, scope, value) {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: `Unknown setting "${key}"` };
  if (!def.scopes.includes(scope)) {
    return {
      ok: false,
      error: `"${key}" cannot be overridden at ${scope} scope (allowed: ${def.scopes.join(', ')})`,
    };
  }
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: 'Invalid value', issues: parsed.error.issues };
  return { ok: true, value: parsed.data };
}
