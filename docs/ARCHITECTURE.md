# Architecture

Status: **Phase 0 approved; Phase 1 accepted (2026-09-24); Phase 2 accepted (2026-09-25); Phases 3 + 4 accepted (2026-09-25); Phase 5 accepted (2026-09-25); Phase 6 accepted; Phases 7 (online payments) and 8 (ledgers, settlements) complete; Phases 9–10 in progress (OD-42).** Decisions referenced as OD-/D-/CH- are
recorded in [DECISIONS.md](DECISIONS.md), which is authoritative.

Related: [DATABASE](DATABASE.md) · [PRICING](PRICING.md) · [ORDERS](ORDERS.md) · [ORDER_FLOW](ORDER_FLOW.md) ·
[PAYMENTS](PAYMENTS.md) · [SETTLEMENTS](SETTLEMENTS.md) · [DELIVERY](DELIVERY.md) · [RBAC](RBAC.md) ·
[SECURITY](SECURITY.md) · [API](API.md) · [CONFIGURATION](CONFIGURATION.md) · [MOBILE](MOBILE.md) ·
[TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [DECISIONS](DECISIONS.md)

## 1. System overview

```
 ┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
 │ Jamzo        │ │ Jamzo Restaurant │ │ Jamzo Delivery   │ │ Jamzo Admin          │
 │ (customer)   │ │ Partner          │ │ Partner (rider)  │ │ Next.js · Tailwind · │
 │ Expo · RN    │ │ Expo · RN        │ │ Expo · RN        │ │ shadcn/ui (JSX)      │
 │ Android+iOS  │ │ Android+iOS      │ │ Android+iOS      │ │ desktop-first web    │
 └──────┬───────┘ └────────┬─────────┘ └────────┬─────────┘ └──────────┬───────────┘
        │   HTTPS /v1 REST (+ Socket.IO from Phase 5) · x-app-id / x-app-version / x-platform
        └──────────────────┴──────────┬──────────┴──────────────────────┘
                           ┌──────────▼──────────┐       ┌────────────────────────┐
                           │  services/api       │       │  services/workers      │
                           │  modular monolith   │       │  outbox relay + jobs   │
                           │  Fastify · Prisma 6 │       │  (polls PostgreSQL)    │
                           └──────────┬──────────┘       └───────────┬────────────┘
                                      │      ┌───────────────────────┘
                              ┌───────▼──────▼───┐   ┌───────────────────┐   external providers
                              │   PostgreSQL     │   │ object storage     │   (behind adapters):
                              │ (truth + outbox) │   │ local FS → S3-API  │   Razorpay, SMS/email,
                              └──────────────────┘   └───────────────────┘   push, maps
```

Redis is **not** part of Phase 1 (D-9): the outbox and delayed jobs are polled from PostgreSQL. It is
added when the documented triggers occur (multiple API instances, measured hot reads, queue throughput).

**Four frontend products, one backend.** No client computes an authoritative price, fee, tax,
commission, earning or payable; clients display what the API returns (spec §9, §17, B5).

## 2. Language and toolchain (OD-1)

| Concern | Choice |
|---|---|
| Language | JavaScript (ES2023), **ESM**; `.js` / `.jsx` / `.mjs` only — never `.ts`/`.tsx` |
| Contracts | zod schemas in `@jamzo/validation` are the runtime source of truth; JSDoc `@typedef`s for editors |
| Static checking | `tsc --noEmit` with `checkJs` over Node packages and services (checker only, D-1) |
| Runtime | Node.js ≥ 22.12 (22 LTS today; 24 LTS in Phase 10) |
| Monorepo | pnpm workspaces (hoisted layout + catalog of Expo/React Native versions — D-2) + Turborepo |
| Lint / format | ESLint 9 flat config (+ react, react-hooks, jsdoc plugins) + Prettier |
| Tests | Vitest (packages, API, workers) on real PostgreSQL (embedded locally, service container in CI), Jest-Expo + React Native Testing Library (mobile), Playwright (admin E2E), Maestro (mobile E2E, when simulators are available), k6 (load, later) |

## 3. Repository layout

```
jamzo/  (repository: bitemitra)
├── apps/
│   ├── customer/          Expo app — in.jamzo.customer    (Android + iOS)
│   ├── restaurant/        Expo app — in.jamzo.restaurant  (Android + iOS)
│   ├── rider/             Expo app — in.jamzo.rider       (Android + iOS)
│   └── admin/             Next.js — Jamzo Admin (responsive, desktop-first)
├── services/
│   ├── api/               HTTP API (modular monolith)
│   └── workers/           outbox relay + background jobs (separately runnable)
├── packages/
│   ├── database/          Prisma schema (active + design), migrations, constraints, seed, test DB helper
│   ├── shared-types/      enums/constants + JSDoc typedefs
│   ├── validation/        zod schemas shared by clients and API
│   ├── config/            product/brand registry (single source of ids), env schemas, settings registry,
│   │                      scope resolution, feature flags, semver
│   ├── auth/              permission catalogue, roles, password/OTP/token primitives
│   ├── logger/            pino with redaction
│   ├── notifications/     SMS/email/push provider interfaces (+ console providers)
│   ├── pricing-engine/    PURE pricing: markup, offers, tax, delivery, fees, commission, quote (Phase 4)
│   ├── order-engine/      PURE state machine: both tracks, derived status, cancellations (Phase 5)
│   ├── delivery-engine/   PURE geo, serviceability, dispatch ranking (Phase 6)
│   ├── settlement-engine/ PURE ledger postings, settlement periods, netting, conservation (Phase 8)
│   ├── ui/                design tokens (provisional Jamzo palette, D-17)
│   ├── mobile-ui/         React Native primitives on the tokens
│   ├── mobile-foundation/ shared RN foundations: session, secure storage, API binding, version gate,
│   │                      remote config, push registration, network state, errors, lifecycle, logging, analytics
│   └── api-client/        fetch client: version headers, idempotency keys, retries, token refresh, errors
├── assets/legacy/         previous BiteMitra logo kit — not used (D-16)
├── scripts/               repo tooling (schema verification, docs check, asset generation)
└── docs/
```

### Dependency rules (checked by ESLint `no-restricted-imports`)

```
apps/*        ──► api-client, validation, shared-types, config (registry/public parts), ui, mobile-ui, mobile-foundation
apps/*        ──✗ database, *-engine, auth (server side), logger (node)   → never compute money on a device
services/*    ──► any package
*-engine      ──► shared-types only (pure: no DB, network or clock)
```

## 4. Backend: modular monolith (OD-5, D-3)

`services/api/src/modules/<module>/` each with `routes.js`, `service.js` (business logic, the only
public surface for other modules) and tests. Request/response schemas come from `@jamzo/validation`.

| Module | Phase | Owns |
|---|---|---|
| `auth` | 1 | users, auth identities, OTP challenges, sessions, devices |
| `rbac` | 1 | admin users, roles, permissions, grants |
| `audit` | 1 | audit log writing/reading |
| `geography` | 1 | countries, states, cities, zones, service areas, serviceability |
| `configuration` | 1 | settings (+ history), feature flags, app version policies, remote config |
| `media` | 1 | media library, storage driver, renditions (worker) |
| `customers` | 1 (profile) / 3 | customer profile, addresses |
| `restaurants`, `branches` | 1 (approval status) / 2 | restaurants, branches, users, hours, documents |
| `catalog`, `menus` | 2 | categories, menu categories, products, variants, add-ons, availability |
| `cart`, `pricing`, `promotions` | 3–4 | quotes, rules, coupons |
| `orders` | 5 | checkout, state machine, cancellations |
| `riders`, `delivery`, `dispatch` | 1 (approval status) / 6 | riders, availability, locations, assignments |
| `payments`, `refunds` | 7 | provider adapters (Razorpay first), webhooks, refunds, reconciliation, COD |
| `ledger`, `settlements` | 8 | ledgers, settlements, invoices, statements |
| `notifications`, `reviews`, `support`, `analytics` | 5–9 | |

Cross-cutting API plumbing (`services/api/src/core/`): env config, Prisma client, request context
(request id, actor), error mapping to the standard format, authentication, permission guard, idempotency,
audit helper, outbox helper, pagination, rate limiting, security headers.

**Workers** (`services/workers`): outbox relay with a handler registry (Phase 1: `media.uploaded` →
renditions), claiming rows with `FOR UPDATE SKIP LOCKED`; later restaurant timeouts, dispatch offers,
payment expiry/reconciliation, notifications, settlement runs.

### Reliability patterns (OD-19)

- **Transactions** for every financial/order/config mutation: state change + history + audit + outbox in one commit.
- **Transactional outbox**: side effects run only from committed events; handlers are idempotent; retries with backoff; poison events parked with the error.
- **Idempotency** at three levels: `Idempotency-Key` records (API), business unique keys (orders, refunds, ledger postings), provider event ids (webhooks).
- **Optimistic concurrency** (`version` columns) and database constraints for races (`constraints.sql`).

## 5. Realtime (Phase 5, D-62)

Order changes call `pg_notify` inside their transaction; every API process `LISTEN`s and forwards to
Socket.IO rooms (`restaurant:<id>`, `customer:<id>`). Sockets only notify; clients re-fetch over REST and
also poll, so a dropped socket never hides an order. Because the notice travels through PostgreSQL, several
API processes already work without a Redis adapter. Jamzo Admin polls (15 s) for now.

## 6. External providers — all behind interfaces

| Capability | Interface | First adapter | Phase 1 status |
|---|---|---|---|
| Payments | `PaymentProvider` | Razorpay (OD-11) | not started (Phase 7) |
| SMS OTP | `SmsProvider` | DLT provider (Q-6) | **console provider only** (dev/test) |
| Email OTP | `EmailProvider` | TBD (Q-6) | **console provider only** |
| Social login | `IdentityProvider` | Google, Apple | **slots only — returns AUTH_METHOD_UNAVAILABLE** |
| Push | `PushProvider` | Expo Push (FCM/APNs) | **console provider in development**; Expo provider implemented and tested against a fake endpoint only — not verified with Expo until the EAS projects exist (Q-18) |
| Maps / route distance | `DistanceProvider` | Q-14 | **fallback only**: straight line × road factor, flagged `FALLBACK` (D-48) |
| Object storage | `Storage` | S3-compatible | **local filesystem driver only** (D-23) |

## 7. Mobile applications

Three independent Expo projects (OD-4) with ids and names from the central registry (D-15), sharing
`mobile-foundation`, `mobile-ui`, `api-client`, `validation`, `ui`. See [MOBILE.md](MOBILE.md).

## 8. Admin application (D-12, D-22)

Next.js App Router, JavaScript/JSX, Tailwind CSS 4, shadcn/ui components owned in-repo, TanStack Table.
Jamzo Admin design system in `apps/admin/src/components/jamzo/`. Talks to the API through a same-origin
`/api/*` rewrite; refresh token in an httpOnly `SameSite=Strict` cookie, access token in memory. Resource
lists use server-side pagination, search and filters. Navigation already lists future modules as
disabled entries labelled with their phase, so nothing appears finished that is not.

## 9. Cross-cutting

- Configuration hierarchy GLOBAL → COUNTRY → STATE → CITY → ZONE → RESTAURANT → BRANCH → CATEGORY → PRODUCT (→ VARIANT for markup): one resolver in `@jamzo/config` ([CONFIGURATION.md](CONFIGURATION.md)).
- Immutable order snapshots (Phase 4–5); append-only ledgers (Phase 8).
- Audit log for admin/financial/configuration mutations in the same transaction.
- Observability: pino JSON logs with `requestId` and domain ids; secrets/PII redacted.
- Money in integer paise; rates in basis points; time stored UTC, evaluated in the city timezone.

## 10. Scalability path (not built now — OD-32)

1 API + 1 worker → horizontal API scaling (then Redis for rate limits/sockets) → read replicas for
listings/analytics → partition high-volume append-only tables → dedicated search engine behind the
search interface → extract a module (e.g. dispatch) only if load demands it. PostGIS can replace JSON
geometry without API changes.
