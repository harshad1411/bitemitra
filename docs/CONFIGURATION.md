# Configuration, feature flags, remote config & app versions

Status: **Phase 2 enables RESTAURANT and BRANCH overrides** (edited on the restaurant's Settings tab, D-40) and adds three `restaurants.*` keys. **Phase 1 implements** the settings registry, hierarchical resolution, settings API + history, feature flags, app version policies and remote config (`packages/config`, API `configuration` module, Admin → Settings). Covers MASTER_SPEC §2, §51, §63, §64, §65, §72, §73.

## 1. Three kinds of configuration

| Kind | Storage | Examples | History |
|---|---|---|---|
| **Commercial rules** (money) | versioned rule tables | markup, commission, tax, platform fee, delivery pricing, surge/night, rider earnings, cancellation | immutable versions (`supersedesId`) + audit log |
| **Operational settings** | `settings` (key × scope × target, JSON value) | acceptance timeout, COD limits, min order, packaging defaults, dispatch weights, support phone, maintenance mode | `setting_history` + audit log |
| **Feature flags** | `feature_flags` | cod, tips, ratings, scheduled_orders, free_delivery, night_pricing, surge, restaurant_self_edit_menu, rider_batching, delivery_otp, proof_of_delivery | audit log |

Deploy-time configuration (secrets, URLs, provider keys) is **environment variables** only, never
editable in Admin.

## 2. Settings registry

Every setting key is declared once in `packages/config/src/settings-registry.js` (JavaScript, OD-1):

```js
{
  key: 'orders.restaurantAcceptance.timeoutSec',
  section: 'Orders',                       // admin grouping (§64)
  label: 'Restaurant acceptance timeout',
  schema: z.number().int().min(30).max(900),
  default: 180,
  scopes: ['GLOBAL', 'CITY', 'ZONE', 'RESTAURANT'],   // where overrides are allowed
  critical: false,                         // critical → requires reason + shows in config history (§63)
}
```

Unknown keys cannot be written; values are validated on write and on read; the registry powers the
admin settings UI (sections + search, §64), the "Using global setting / Custom override / Reset to
inherited value" display (§32), and documentation generation.

Resolution uses the same hierarchy and ranking as pricing rules ([PRICING.md §2](PRICING.md#2-rule-precedence)).
Resolution reads settings from PostgreSQL with a short in-process cache (per API instance, invalidated on write in that instance, ≤ 30 s staleness elsewhere). **No Redis in Phase 1** (D-9); a shared cache is introduced only if measurements show it is needed.

## 3. Setting keys (generated from the registry)

Every key below exists in `packages/config/src/settings-registry.js` with a zod schema. **Phase** = when code first reads the value (earlier, it is stored and editable but has no effect — the admin labels this). Money is integer paise, rates are basis points. Placeholder amounts must be set by the owner before launch (A-16).

| Section | Key | Label | Overridable at | Phase | Flags | Default |
|---|---|---|---|---|---|---|
| General | `support.contact` | Support contact | GLOBAL, COUNTRY, STATE, CITY, ZONE | 1 | — | `{"phone": null, "email": null, "whatsapp": null}` |
| General | `maintenance` | Maintenance mode | GLOBAL | 1 | reason required | `{"enabled": false, "message": null, "apps": ["CUSTOMER", "RESTAURANT", "RIDER"]}` |
| General | `operations.serviceHours` | Service hours | GLOBAL, COUNTRY, STATE, CITY, ZONE | 5 | — | `{"start": "00:00", "end": "00:00"}` |
| Security | `auth.methods` | Sign-in methods per app | GLOBAL | 1 | reason required | `{"CUSTOMER": ["PHONE_OTP"], "RESTAURANT": ["PHONE_OTP"], "RIDER": ["PHONE_OTP"], "ADMIN": ["PASSWORD"]}` |
| Security | `auth.otp` | OTP policy | GLOBAL | 1 | reason required | `{"ttlSec": 300, "maxAttempts": 5, "resendCooldownSec": 30, "maxPerHour": 5}` |
| Security | `auth.adminLockout` | Admin lockout | GLOBAL | 1 | reason required | `{"maxFailedLogins": 5, "lockMinutes": 15}` |
| Orders | `orders.restaurantAcceptance` | Restaurant acceptance timeout | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 5 | — | `{"timeoutSec": 180, "fallback": "ESCALATE_TO_OPS", "escalationGraceSec": 120}` |
| Orders | `orders.preparation` | Preparation time limits | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 2 | — | `{"maxPrepMinutes": 60, "lateAfterMinutes": 15}` |
| Orders | `orders.limits` | Order limits | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 4 | **placeholder** | `{"minOrderPaise": 0, "maxOrderPaise": 5000000, "maxItems": 50}` |
| Restaurants | `restaurants.requiredDocuments` | Documents required for approval | GLOBAL, COUNTRY, STATE, CITY, ZONE | 2 | reason required, **legal review** | `{"kinds": ["FSSAI", "PAN"]}` |
| Restaurants | `restaurants.operations` | Pause and busy mode | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 2 | — | `{"maxPauseMinutes": 120, "busyExtraPrepMinutes": 10}` |
| Restaurants | `restaurants.packaging` | Default packaging charge | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 4 | **placeholder** | `{"perItemPaise": 0}` |
| Delivery | `delivery.distance` | Distance rules | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 3 | — | `{"maxDistanceM": 7000, "fallback": "HAVERSINE_FACTOR", "roadFactorBps": 13000}` |
| Delivery | `dispatch.offers` | Dispatch offers | GLOBAL, COUNTRY, STATE, CITY, ZONE | 6 | — | `{"startAt": "ON_ACCEPT", "leadMinutes": 10, "offerTimeoutSec": 30, "maxOffers": 5, "noRiderEscalationSec": 600, "maxActiveOrders": 1}` |
| Delivery | `delivery.eta` | Delivery time estimate | GLOBAL, COUNTRY, STATE, CITY, ZONE | 3 | — | `{"avgSpeedKmph": 18, "bufferMinutes": 5, "rangeMinutes": 10}` |
| Payments | `payments.methods` | Payment methods | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 7 | — | `{"enabled": ["UPI", "CARD", "NETBANKING", "WALLET", "COD"], "expirySec": 900}` |
| COD | `cod` | Cash on delivery | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 6 | reason required, **placeholder** | `{"enabled": true, "maxOrderValuePaise": 100000, "riderLimitPaise": 500000, "maxRefusedOrders": 2, "netAgainstEarnings": true}` |
| Payments | `payments.gatewayFees` | Payment gateway fee estimate | GLOBAL | 4 | **placeholder** | `{"methods": {"UPI": {"bps": 0, "fixedPaise": 0}, "CARD": {"bps": 200, "fixedPaise": 0}, "NETBANKING": {"bps": 190, "fixedPaise": 0}, "WALLET": {"bps": 190, "fixedPaise": 0}, "COD": {"bps": 0, "fixedPaise": 0}}, "gstBps": 1800, "defaultMethod": "UPI"}` |
| Payments | `refunds.approval` | Refund approval threshold | GLOBAL | 7 | reason required, **placeholder** | `{"thresholdPaise": 100000}` |
| Pricing | `pricing.finalRounding` | Final bill rounding | GLOBAL, COUNTRY, STATE, CITY, ZONE | 4 | reason required | `{"mode": "NEAREST_1", "direction": "HALF_UP", "absorbedBy": "PLATFORM"}` |
| Pricing | `pricing.markupDisclosure` | Markup disclosure | GLOBAL, COUNTRY, STATE, CITY, ZONE | 4 | reason required, **legal review** | `"NONE"` |
| Pricing | `pricing.surcharges` | Surcharge cap and promotion stacking | GLOBAL, COUNTRY, STATE, CITY, ZONE | 4 | **placeholder** | `{"maxTotalPaise": 5000, "promotionStacking": "ONE_PROMO_ONE_COUPON"}` |
| Pricing | `tips` | Tips | GLOBAL, COUNTRY, STATE, CITY, ZONE | 4 | reason required | `{"enabled": true, "riderShareBps": 10000, "presetsPaise": [1000, 2000, 3000]}` |
| Settlements | `settlements.restaurants` | Restaurant settlements | GLOBAL, COUNTRY, STATE, CITY, ZONE, RESTAURANT, BRANCH | 8 | reason required, **placeholder** | `{"schedule": "WEEKLY", "weeklyRunDay": "MONDAY", "minPayoutPaise": 10000, "reservePercentBps": 0}` |
| Settlements | `settlements.riders` | Delivery partner payouts | GLOBAL, COUNTRY, STATE, CITY, ZONE | 8 | reason required, **placeholder** | `{"schedule": "WEEKLY", "minPayoutPaise": 10000}` |
| Delivery | `riders.location` | Delivery partner location updates | GLOBAL, COUNTRY, STATE, CITY, ZONE | 6 | — | `{"tripIntervalSec": 10, "idleIntervalSec": 30}` |
| Customer | `customer.guestBrowsing` | Guest browsing | GLOBAL, COUNTRY, STATE, CITY, ZONE | 3 | — | `true` |

## 4. Feature flags (§51)

`{ key, enabled, rules: { cityIds?, zoneIds?, apps?, minAppVersion?, rolloutPercent? } }`.
Evaluation is deterministic: `rolloutPercent` buckets by `hash(flagKey + userId) % 100`, so a user stays
in the same bucket. Flags are evaluated **server-side**; the app receives the evaluated booleans in
remote config. Business rules (e.g. COD eligibility) re-check flags on the server — the client value is
only for UI.

## 5. Remote app config (§73)

`GET /v1/app-config` (no auth required; cached 60 s; ETag) returns per app + platform:

```json
{
  "appId": "CUSTOMER", "platform": "ANDROID",
  "maintenance": { "enabled": false, "message": null },
  "version": { "minSupportedVersion": "1.2.0", "recommendedVersion": "1.5.0",
               "forceUpdate": false, "storeUrl": "…", "status": "UPDATE_RECOMMENDED" },
  "featureFlags": { "cod": true, "tips": false },
  "support": { "phone": "…", "email": "…", "whatsapp": "…" },
  "serviceAvailability": { "cityLive": true },
  "serverTime": "2026-09-24T10:00:00Z"
}
```

Home-page content is served by its own CMS endpoint (Phase 3). Phase 1 also returns `auth.methods` for the calling app so login screens show only enabled methods.

## 6. App version policy (§72)

`app_version_policies` per (app, platform): `minSupportedVersion`, `recommendedVersion`, `forceUpdate`,
`storeUrl`. Status rules: `version < min` or `forceUpdate && version < recommended` → UPDATE_REQUIRED
(blocking screen, API returns 426); `version < recommended` → UPDATE_RECOMMENDED (dismissible). Semver
comparison is shared code with tests. Changing policy is audit-logged. A client that sends no version (or an unparsable one) is treated as UPDATE_REQUIRED for mobile apps.

## 7. Change safety

- Critical settings and all commercial rules require a **reason**, show a **before/after preview** (§65), and are audit-logged.
- Future-dated changes supported (`effectiveFrom`), e.g. commission change from the 1st of next month.
- Emergency switches (surge off, COD off, pause restaurant, maintenance) take effect within one cache TTL (≤ 60 s) and are available from the Admin home screen with confirmation.
