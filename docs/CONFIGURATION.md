# Configuration, feature flags, remote config & app versions

Status: **Phase 0 design.** Implemented in Phase 1 (`packages/config`, `config` API module, admin
Configuration section). Covers MASTER_SPEC §2, §51, §63, §64, §65, §72, §73.

## 1. Three kinds of configuration

| Kind | Storage | Examples | History |
|---|---|---|---|
| **Commercial rules** (money) | versioned rule tables | markup, commission, tax, platform fee, delivery pricing, surge/night, rider earnings, cancellation | immutable versions (`supersedesId`) + audit log |
| **Operational settings** | `settings` (key × scope × target, JSON value) | acceptance timeout, COD limits, min order, packaging defaults, dispatch weights, support phone, maintenance mode | `setting_history` + audit log |
| **Feature flags** | `feature_flags` | cod, tips, ratings, scheduled_orders, free_delivery, night_pricing, surge, restaurant_self_edit_menu, rider_batching, delivery_otp, proof_of_delivery | audit log |

Deploy-time configuration (secrets, URLs, provider keys) is **environment variables** only, never
editable in Admin.

## 2. Settings registry

Every setting key is declared once in `packages/config/src/settings-registry.js`:

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
Resolved settings are cached in Redis per scope chain with invalidation on write.

## 3. Initial setting keys (defaults; all admin-editable)

| Section | Key | Default |
|---|---|---|
| General | `support.phone`, `support.email`, `support.whatsapp` | — |
| General | `maintenance.enabled` / `maintenance.message` (per app) | false |
| Orders | `orders.restaurantAcceptance.timeoutSec` / `.fallback` / `.escalationGraceSec` | 180 / ESCALATE_TO_OPS / 120 |
| Orders | `orders.minOrderPaise` | 0 |
| Orders | `orders.maxPrepTimeMinutes` | 60 |
| Delivery | `delivery.maxDistanceM`, `delivery.roadFactor` | 7000, 1.3 |
| Dispatch | `dispatch.startAt`, `.offerTimeoutSec`, `.maxOffers`, `.noRiderEscalationSec`, `.maxActiveOrders`, weights | ON_ACCEPT, 30, 5, 600, 1 |
| Payments | `payments.expirySec`, `payments.enabledMethods` | 900, [UPI, CARD, NETBANKING, COD] |
| COD | `cod.enabled`, `cod.maxOrderValuePaise`, `cod.riderLimitPaise`, `cod.maxRefusedOrders`, `cod.netAgainstEarnings` | true, 100000, 500000, 2, true |
| Pricing | `pricing.finalRounding`, `pricing.surcharges.maxTotalPaise`, `pricing.promotionStacking` | NEAREST_1, 5000, ONE_PROMO_ONE_COUPON |
| Refunds | `refunds.approvalThresholdPaise` | 100000 |
| Settlements | `settlements.defaultSchedule`, `.weeklyRunDay`, `.minPayoutPaise`, `.reservePercentBps` | WEEKLY, MONDAY, 10000, 0 |
| Riders | `riders.settlementSchedule`, `rider.locationIntervalSec` | WEEKLY, 10 |
| Customer | `customer.guestBrowsing` | true |

(All money defaults are placeholders for the owner to set before launch.)

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

Home-page content is served by its own CMS endpoint (Phase 3) so it can be cached separately.

## 6. App version policy (§72)

`app_version_policies` per (app, platform): `minSupportedVersion`, `recommendedVersion`, `forceUpdate`,
`storeUrl`. Status rules: `version < min` or `forceUpdate && version < recommended` → UPDATE_REQUIRED
(blocking screen, API returns 426); `version < recommended` → UPDATE_RECOMMENDED (dismissible). Semver
comparison is shared code with tests. Changing policy is audit-logged.

## 7. Change safety

- Critical settings and all commercial rules require a **reason**, show a **before/after preview** (§65), and are audit-logged.
- Future-dated changes supported (`effectiveFrom`), e.g. commission change from the 1st of next month.
- Emergency switches (surge off, COD off, pause restaurant, maintenance) take effect within one cache TTL (≤ 60 s) and are available from the Admin home screen with confirmation.
