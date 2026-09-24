# API conventions

Status: **Phase 0 — conventions only.** Endpoints are documented here as each phase implements them
(§70); an OpenAPI 3.1 document is generated from the zod schemas and served at `/v1/docs` (non-production).

## 1. Style

- REST over HTTPS, JSON, UTF-8. Base path **`/v1`**. Realtime via Socket.IO (change notifications only).
- Resource audiences are separated by prefix: `/v1/customer/*`, `/v1/restaurant/*`, `/v1/rider/*`,
  `/v1/admin/*`, plus shared `/v1/auth/*`, `/v1/app-config`, `/v1/webhooks/*`. A token issued for one
  app is rejected on another app's prefix.
- Resource ids are UUIDs; money in **integer paise**, rates in **bps**, distance in **metres**,
  timestamps **ISO-8601 UTC**.
- Field names camelCase. Enums UPPER_SNAKE.

## 2. Required client headers

| Header | Example | Purpose |
|---|---|---|
| `x-app-id` | `CUSTOMER` | which product is calling |
| `x-app-version` | `1.5.0` | version policy (§72) |
| `x-platform` | `ANDROID` / `IOS` / `WEB` | per-platform minimum versions |
| `x-request-id` | uuid (optional) | echoed; generated if absent |
| `Idempotency-Key` | uuid | **required** on order creation, payments, refunds, ledger adjustments; optional elsewhere |
| `Authorization` | `Bearer <access token>` | authenticated routes |

A client below `minSupportedVersion` gets `426 UPGRADE_REQUIRED` on every route except `/v1/app-config`,
so it can still show the update screen.

## 3. Responses

Success: the resource or `{ items, nextCursor }` for lists. **Cursor pagination** (opaque, keyset-based)
by default; `limit` max 100. Offset pagination only for admin tables that need page numbers (capped).

Error (§71) — always this shape, never a stack trace outside development:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields are invalid.",
    "fieldErrors": { "phone": ["Enter a valid 10-digit mobile number"] },
    "requestId": "0192…",
    "details": {}
  }
}
```

| HTTP | code(s) |
|---|---|
| 400 | VALIDATION_FAILED |
| 401 | UNAUTHENTICATED, TOKEN_EXPIRED, OTP_INVALID, OTP_EXPIRED |
| 403 | FORBIDDEN, ACCOUNT_SUSPENDED |
| 404 | NOT_FOUND |
| 409 | CONFLICT, INVALID_STATE_TRANSITION, IDEMPOTENCY_CONFLICT, PRICE_CHANGED |
| 422 | NOT_SERVICEABLE, ITEM_UNAVAILABLE, RESTAURANT_CLOSED, COUPON_INVALID |
| 423 | ACCOUNT_LOCKED |
| 426 | UPGRADE_REQUIRED (`details.minVersion`, `details.storeUrl`) |
| 429 | RATE_LIMITED, OTP_ATTEMPTS_EXCEEDED (`Retry-After`) |
| 503 | MAINTENANCE |
| 500 | INTERNAL (message generic; details only in logs by requestId) |

## 4. Idempotency

`Idempotency-Key` + authenticated principal are stored in `idempotency_records` with a hash of the
request body. Same key + same body → the stored response is replayed. Same key + different body →
`409 IDEMPOTENCY_CONFLICT`. In-flight duplicate → `409` with `Retry-After`. Records expire after 24 h.
Business-level uniqueness (orders, refunds, ledger) backs this up in the database.

## 5. Compatibility & versioning (§72, B10)

Released mobile apps live for months, so:
- Within `/v1`, changes are **additive only**: new optional fields, new endpoints, new enum values (clients must treat unknown enum values gracefully — enforced by client tests).
- Removing/renaming a field → keep serving the old one until `minSupportedVersion` of every app that used it has passed it; tracked in `docs/API.md#deprecations`.
- Behaviour that depends on client capability is gated by `x-app-version` (e.g. new payment method shown only to ≥ 1.4.0).
- Breaking redesigns → `/v2` alongside `/v1`.
- Contract tests run the current API against the request/response fixtures of every *supported* app version.

## 6. Security defaults

Rate limits per IP and per principal (stricter on auth/OTP), body size limits, strict zod validation
(unknown keys rejected), secure headers, CORS allow-list (admin origin only; mobile apps don't need
CORS). Webhooks verify provider signatures on the raw body. See [SECURITY.md](SECURITY.md).

## 7. Endpoint index (Phase 1)

Request/response schemas are the zod schemas in `packages/validation/src/index.js` (the single source of
truth); errors follow §3. Every admin route requires an ADMIN access token **and** the listed permission,
checked on the server; City Manager grants are additionally limited to their city (RBAC.md). Mutating
admin routes write an audit log entry in the same transaction.

<!-- routes:start -->

_Generated from the route definitions by `pnpm docs:api` (51 endpoints). Do not edit by hand — CI fails if this drifts from the code._

| Method | Path | Auth | Apps | Permission | Rate limit |
|---|---|---|---|---|---|
| `GET` | `/health` | none | — | — |  |
| `GET` | `/ready` | none | — | — |  |
| `GET` | `/v1/admin/app-versions` | admin token | ADMIN | `config.view` |  |
| `PUT` | `/v1/admin/app-versions/:appId/:platform` | admin token | ADMIN | `config.manage` |  |
| `GET` | `/v1/admin/audit-logs` | admin token | ADMIN | `audit.view` |  |
| `POST` | `/v1/admin/auth/login` | none | ADMIN | — | auth limit/min |
| `GET` | `/v1/admin/dashboard` | admin token | ADMIN | `dashboard.view` |  |
| `GET` | `/v1/admin/flags` | admin token | ADMIN | `config.view` |  |
| `PUT` | `/v1/admin/flags/:key` | admin token | ADMIN | `flags.manage` |  |
| `GET` | `/v1/admin/geo/cities` | admin token | ADMIN | `geo.view` |  |
| `POST` | `/v1/admin/geo/cities` | admin token | ADMIN | `geo.manage` |  |
| `GET` | `/v1/admin/geo/cities/:id` | admin token | ADMIN | `geo.view` |  |
| `PATCH` | `/v1/admin/geo/cities/:id` | admin token | ADMIN | `geo.manage` |  |
| `GET` | `/v1/admin/geo/countries` | admin token | ADMIN | `geo.view` |  |
| `POST` | `/v1/admin/geo/countries` | admin token | ADMIN | `geo.manage` |  |
| `POST` | `/v1/admin/geo/service-areas` | admin token | ADMIN | `geo.manage` |  |
| `PATCH` | `/v1/admin/geo/service-areas/:id` | admin token | ADMIN | `geo.manage` |  |
| `POST` | `/v1/admin/geo/states` | admin token | ADMIN | `geo.manage` |  |
| `POST` | `/v1/admin/geo/zones` | admin token | ADMIN | `geo.manage` |  |
| `GET` | `/v1/admin/geo/zones/:id` | admin token | ADMIN | `geo.view` |  |
| `PATCH` | `/v1/admin/geo/zones/:id` | admin token | ADMIN | `geo.manage` |  |
| `GET` | `/v1/admin/media` | admin token | ADMIN | `media.view` |  |
| `POST` | `/v1/admin/media` | admin token | ADMIN | `media.manage` |  |
| `DELETE` | `/v1/admin/media/:id` | admin token | ADMIN | `media.manage` |  |
| `GET` | `/v1/admin/media/:id` | admin token | ADMIN | `media.view` |  |
| `PATCH` | `/v1/admin/media/:id` | admin token | ADMIN | `media.manage` |  |
| `GET` | `/v1/admin/permissions` | admin token | ADMIN | `roles.view` |  |
| `GET` | `/v1/admin/roles` | admin token | ADMIN | `roles.view` |  |
| `POST` | `/v1/admin/roles` | admin token | ADMIN | `roles.manage` |  |
| `DELETE` | `/v1/admin/roles/:id` | admin token | ADMIN | `roles.manage` |  |
| `GET` | `/v1/admin/roles/:id` | admin token | ADMIN | `roles.view` |  |
| `PATCH` | `/v1/admin/roles/:id` | admin token | ADMIN | `roles.manage` |  |
| `DELETE` | `/v1/admin/settings` | admin token | ADMIN | `config.manage` |  |
| `GET` | `/v1/admin/settings` | admin token | ADMIN | `config.view` |  |
| `PUT` | `/v1/admin/settings` | admin token | ADMIN | `config.manage` |  |
| `GET` | `/v1/admin/settings/history` | admin token | ADMIN | `config.view` |  |
| `GET` | `/v1/admin/users` | admin token | ADMIN | `admins.view` |  |
| `POST` | `/v1/admin/users` | admin token | ADMIN | `admins.manage` |  |
| `GET` | `/v1/admin/users/:id` | admin token | ADMIN | `admins.view` |  |
| `PATCH` | `/v1/admin/users/:id` | admin token | ADMIN | `admins.manage` |  |
| `GET` | `/v1/app-config` | optional | any | — |  |
| `POST` | `/v1/auth/logout` | optional | any | — |  |
| `POST` | `/v1/auth/otp/request` | none | CUSTOMER, RESTAURANT, RIDER | — | auth limit/min |
| `POST` | `/v1/auth/otp/verify` | none | CUSTOMER, RESTAURANT, RIDER | — | 2× auth limit/min |
| `POST` | `/v1/auth/refresh` | none | any | — | 60/min |
| `POST` | `/v1/auth/social/:provider` | none | CUSTOMER, RESTAURANT, RIDER | — |  |
| `GET` | `/v1/geo/serviceability` | optional | any | — | 60/min |
| `GET` | `/v1/me` | required | any | — |  |
| `PATCH` | `/v1/me` | required | CUSTOMER, RESTAURANT, RIDER | — |  |
| `POST` | `/v1/me/devices` | required | CUSTOMER, RESTAURANT, RIDER | — |  |
| `GET` | `/v1/media/files/*` | none | browser (no headers) | — |  |

<!-- routes:end -->

### Notes per area

| Area | Behaviour worth knowing |
|---|---|
| OTP | `POST /v1/auth/otp/request` answers the same whether or not an account exists; resend cooldown and hourly cap per destination come from setting `auth.otp`; codes are stored only as HMAC hashes. `verify` counts attempts atomically. |
| Sessions | Mobile apps get `refreshToken` in the body; the admin gets it as an httpOnly `SameSite=Strict` cookie scoped to `ADMIN_COOKIE_PATH`. Refresh rotates the token; reusing a rotated token revokes the whole session family. |
| `/v1/me` | Returns `access.status` — `OK`, `PENDING_APPROVAL`, `NOT_REGISTERED` or `BLOCKED` — so partner apps never treat sign-in as approval (OD-13). |
| Social sign-in | `/v1/auth/social/:provider` returns `501 AUTH_METHOD_UNAVAILABLE` until Google/Apple verification is implemented (D-20). |
| Version gate | Mobile requests below the minimum version get `426 UPGRADE_REQUIRED`; maintenance returns `503 MAINTENANCE`; `/v1/app-config` always answers so apps can show the right screen. |
| Settings | `PUT /v1/admin/settings` validates against the settings registry (key, allowed scope, value schema, business rules) and requires a reason for critical keys; `DELETE` resets to the inherited value; history survives resets. |
| Media | `POST /v1/admin/media` takes one multipart image (JPEG/PNG/WebP detected from file content; SVG refused), stores it, and enqueues renditions via the outbox. `GET /v1/media/files/*` serves library images only. |
| Idempotency | Create endpoints accept `Idempotency-Key`; replays return the original response with header `idempotent-replayed: true`. |

## Deprecations

None yet.
