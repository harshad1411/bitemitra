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

## 7. Endpoint index

Filled in per phase. Phase 1 will document: `/v1/app-config`, `/v1/auth/otp/request`,
`/v1/auth/otp/verify`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/admin/auth/login`, `/v1/me`,
`/v1/geo/serviceability`, `/v1/admin/geo/*`, `/v1/admin/settings/*`, `/v1/admin/flags/*`,
`/v1/admin/app-versions/*`, `/v1/admin/media/*`, `/v1/admin/roles/*`, `/v1/admin/audit-logs`.

Each entry will list: method + path · auth · permission · request schema · response schema ·
validation rules · error codes · example.

## Deprecations

None yet.
