# Architecture

Status: **Phase 0 — proposed, awaiting owner review.** Nothing here is implemented yet except the
database schema design and its verification script.

Related: [DATABASE](DATABASE.md) · [PRICING](PRICING.md) · [ORDERS](ORDERS.md) · [ORDER_FLOW](ORDER_FLOW.md) ·
[PAYMENTS](PAYMENTS.md) · [SETTLEMENTS](SETTLEMENTS.md) · [DELIVERY](DELIVERY.md) · [RBAC](RBAC.md) ·
[SECURITY](SECURITY.md) · [API](API.md) · [CONFIGURATION](CONFIGURATION.md) · [MOBILE](MOBILE.md) ·
[TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [DECISIONS](DECISIONS.md)

## 1. System overview

```
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
 │ Customer app │ │Restaurant app│ │  Rider app   │ │ Admin (Next.js)  │
 │ Expo · RN    │ │ Expo · RN    │ │ Expo · RN    │ │ Polaris* · React │
 │ Android+iOS  │ │ Android+iOS  │ │ Android+iOS  │ │ desktop-first    │
 └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘
        │  HTTPS /v1 REST + Socket.IO (realtime) · x-app-id / x-app-version headers
        └────────────────┴────────┬───────┴──────────────────┘
                         ┌────────▼─────────┐        ┌─────────────────────┐
                         │  services/api    │        │  services/workers   │
                         │  modular monolith│◄──────►│  BullMQ consumers   │
                         │  (Fastify, JS)   │ Redis  │  + schedulers       │
                         └──┬─────┬─────┬───┘        └──┬──────┬───────────┘
                            │     │     │               │      │
                ┌───────────▼┐ ┌──▼──┐ ┌▼───────────┐ ┌─▼────┐ ▼ external providers (behind adapters)
                │ PostgreSQL │ │Redis│ │ S3-compat. │ │ ...  │  payments · SMS/OTP · push (FCM/APNs)
                │ (Prisma)   │ │     │ │ media      │ │      │  maps/geocoding · email
                └────────────┘ └─────┘ └────────────┘ └──────┘
```

\* Polaris usage is subject to the licence question in [DECISIONS.md](DECISIONS.md#q1-shopify-polaris-licence).

**Four frontend products, one backend.** Every client talks to the same versioned API. No client
computes an authoritative price, fee, tax, commission, earning or payable — clients only *display*
numbers the API returns (MASTER_SPEC §9, §17, B5).

## 2. Language and toolchain (owner directive: JavaScript only)

| Concern | Choice | Notes |
|---|---|---|
| Language | Modern JavaScript (ES2023), **ESM** (`"type": "module"`) everywhere Node runs | No `.ts/.tsx` in source. Generated vendor code inside `node_modules` (e.g. Prisma client) is not project source. |
| Types / contracts | **Zod schemas are the single source of truth** for every API request/response, config value and rule `params`. JSDoc `@typedef`s derived from them for editor help. | Runtime validation matters more than compile-time types for money. Whether JSDoc may be *checked* by the TypeScript compiler (no `.ts` files) is [question Q2](DECISIONS.md#q2-jsdoc-type-checking). |
| Runtime | Node.js 22 LTS (≥ 22.12) | Matches the dev machine; move to Node 24 LTS in Phase 10. |
| Package manager | pnpm workspaces | Strict, fast, good monorepo support; isolated `node_modules` keep each mobile app's native deps independent. |
| Task runner | Turborepo | Cached `lint` / `test` / `build` per workspace; only affected apps rebuild. |
| Lint / format | ESLint (flat config) + `eslint-plugin-jsdoc` + Prettier | No blanket rule disables (§58). |
| Tests | Vitest (Node packages + API), Jest-Expo + React Native Testing Library (mobile components), Playwright (admin E2E), Maestro (mobile E2E on Android **and** iOS), k6 (load) | See [TESTING.md](TESTING.md). |

## 3. Repository layout

```
bitemitra/
├── apps/
│   ├── customer/          Expo app → com.bitemitra.customer   (Android + iOS)
│   ├── restaurant/        Expo app → com.bitemitra.restaurant (Android + iOS)
│   ├── rider/             Expo app → com.bitemitra.rider      (Android + iOS)
│   └── admin/             Next.js web app (responsive, desktop-first)
├── services/
│   ├── api/               HTTP + realtime API (modular monolith)
│   └── workers/           queue consumers & schedulers (same domain modules, separate process)
├── packages/
│   ├── database/          Prisma schema, migrations, constraints.sql, client, seed
│   ├── shared-types/      enums/constants + JSDoc typedefs shared by all apps (no TS)
│   ├── validation/        zod schemas shared by clients and API
│   ├── config/            env schemas, settings registry, hierarchical resolution, app registry
│   ├── auth/              RBAC catalogue, password/OTP/token primitives
│   ├── logger/            pino with redaction
│   ├── notifications/     events, templates, channel adapters (push/SMS/email/WhatsApp)
│   ├── pricing-engine/    PURE: money math, rule precedence, cart/order pricing, snapshot builder
│   ├── order-engine/      PURE: state machine, transition guards, derived status
│   ├── delivery-engine/   PURE: geo, serviceability, dispatch scoring, rider earnings  (= spec's "dispatch-engine")
│   ├── settlement-engine/ PURE: ledger posting rules, settlement periods, COD netting
│   ├── ui/                design tokens (colour, type, spacing, radius, elevation, status)
│   ├── mobile-ui/         shared React Native primitives built on tokens (optional sharing, B9)
│   └── api-client/        fetch client: version headers, idempotency keys, retries, token refresh
├── assets/brand/          owner-supplied BiteMitra logo kit (source of truth for icons/splash)
├── scripts/               repo tooling (e.g. verify-schema.mjs)
└── docs/                  this documentation set
```

Folder names follow MASTER_SPEC Part B. Part A §3 also lists `dispatch-engine`; dispatch lives in
`delivery-engine` to satisfy Part B's mandated list without two overlapping packages.

### Dependency rules (enforced by lint in Phase 1)

```
apps/*  ──► api-client, validation, shared-types, config(public parts), ui, mobile-ui
apps/*  ──✗ database, *-engine (never compute money on device)
services/* ──► everything in packages/
*-engine ──► shared-types only (pure: no DB, no network, no clock — time is passed in)
```

The engines being **pure functions** is the key design choice: the same code prices a cart, builds
the immutable snapshot, previews a config change in admin (§65) and replays historical orders in
tests, deterministically.

## 4. Backend: modular monolith (§77)

`services/api` is one deployable with strict internal module boundaries:

| Module | Owns | Uses engine |
|---|---|---|
| `identity` | users, OTP, sessions, devices | auth |
| `access` | admin users, roles, permissions, audit log | auth |
| `geo` | countries → zones, service areas, serviceability | delivery-engine |
| `config` | settings, feature flags, app version policy, remote config | config |
| `catalog` | restaurants, branches, hours, menu, products, variants, add-ons, availability | — |
| `cms` | media library, home sections, banners, pages | — |
| `pricing` | commercial rules (versioned), cart quote, config preview | pricing-engine |
| `promotions` | coupons, promotions, usage | pricing-engine |
| `orders` | checkout, order creation, state transitions, cancellations | order-engine, pricing-engine |
| `dispatch` | offers, assignment, reassignment, rider availability & location | delivery-engine |
| `payments` | provider adapters, webhooks, refunds, reconciliation, COD | — |
| `ledger` | restaurant/rider/platform ledgers, settlements, statements, invoices | settlement-engine |
| `support` | tickets, messages | — |
| `notifications` | templates, dispatching via outbox → queue | notifications |
| `analytics` | read models / reports (never on the ordering hot path, §44) | — |

Rules: a module only touches its own tables directly; cross-module calls go through the other
module's service functions (not its tables). This keeps each domain extractable later (§77).

**Workers** (`services/workers`) import the same modules and run: outbox relay, restaurant acceptance
timeouts, dispatch offers/timeouts, payment expiry & reconciliation, notification sending, media
renditions, settlement runs, COD reconciliation, analytics roll-ups.

### Reliability patterns

- **Transactions** for every financial/order mutation (§68). One transaction = state change + history row + ledger postings + outbox event.
- **Transactional outbox** (`outbox_events`): side effects (push, dispatch, webhooks-out) are triggered only from committed events → no "order placed but restaurant never notified".
- **Idempotency** at three levels: HTTP `Idempotency-Key` (idempotency_records), business keys (`orders(customerId, idempotencyKey)`, `refunds.idempotencyKey`, ledger `idempotencyKey`), provider event ids (`payment_events(provider, providerEventId)`).
- **Optimistic concurrency** on orders (`version` column) plus DB constraints for races (see [DATABASE.md](DATABASE.md#5-concurrency-guarantees)).
- **Queues** (BullMQ on Redis) with retries + dead-letter; every job handler idempotent.

## 5. Realtime

Socket.IO on the API process (Redis adapter for horizontal scale). Rooms: `order:<id>`,
`restaurant:<id>`, `rider:<id>`, `admin:ops:<cityId>`. Sockets carry **notifications of change
only**; clients re-fetch authoritative state over REST, so a missed socket message is never data loss
(important for restaurant/rider reconnects, §40). Push notifications are the fallback when the app is
backgrounded; restaurant new-order alerts use a high-priority push + looping in-app sound.

## 6. External providers — all behind adapters

| Capability | Interface (Phase) | Default adapter proposal | Dev/test adapter |
|---|---|---|---|
| Payments | `PaymentProvider` (P7) | Razorpay **or** Cashfree — [Q5](DECISIONS.md#q5-payment-gateway) | fake provider with signed webhooks |
| OTP/SMS | `SmsProvider` (P1) | MSG91 / Twilio — [Q6](DECISIONS.md#q6-sms--otp-provider) | console logger (blocked in production) |
| Push | `PushProvider` (P1) | Expo Push Service (wraps FCM + APNs) | in-memory recorder |
| Maps / distance | `MapsProvider` (P3/P6) | Google Maps Platform; Ola/Mappls alternative — [Q9](DECISIONS.md#q9-distance-used-for-pricing) | haversine × road factor |
| Object storage | `Storage` (P1) | S3-compatible (AWS S3 / Cloudflare R2) | local filesystem / MinIO |
| Email | `EmailProvider` | SES / Postmark | console |
| Search | `SearchIndex` (P3) | PostgreSQL full-text + trigram | same |

Business code depends only on the interface. Switching provider = new adapter + config, no domain change (§4, §24, §38).

## 7. Mobile applications

Three **independent** Expo (React Native) projects — separate `package.json`, `app.json`/`app.config.js`,
`eas.json`, identifiers, icons, splash, push credentials, version numbers and release pipelines.
They share only libraries from `packages/` (never screens or navigation). Details: [MOBILE.md](MOBILE.md).

## 8. Admin application

Next.js (Pages Router, JavaScript) served separately from the API. Polaris React 13 requires React 18,
which is why the Pages Router is used (App Router needs React 19). All UI imports go through an
internal `src/ui/` facade so the component library can be swapped without touching feature code —
this hedges both the Polaris licence question and Polaris React being in maintenance.
Admin authenticates against the API with short-lived access tokens held in memory + an httpOnly,
`SameSite=Strict` refresh cookie; CSRF token on state-changing cookie requests (§48).

## 9. Cross-cutting

- **Configuration hierarchy** GLOBAL → COUNTRY → STATE → CITY → ZONE → RESTAURANT → CATEGORY → PRODUCT (→ VARIANT for markup). One resolver in `packages/config`, used by every rule type. [CONFIGURATION.md](CONFIGURATION.md), [PRICING.md](PRICING.md#2-rule-precedence).
- **Immutable snapshots**: orders copy every applied value and rule id at placement (§27).
- **Audit log** for every admin/business mutation, written in the same transaction (§43).
- **Observability**: pino JSON logs with `requestId`, `orderId`, `paymentId`, `restaurantId`, `riderId` bound as context; OpenTelemetry-compatible tracing hooks; error monitoring (Sentry proposed — [Q11](DECISIONS.md#q11-hosting-and-third-party-saas)).
- **Money**: integer paise everywhere; percentages in basis points; one rounding function. [PRICING.md](PRICING.md#1-money-rules).
- **Time**: stored UTC; business rules (night surcharge, hours, settlement cut-offs) evaluated in the city's timezone (`cities.timezone`, default Asia/Kolkata).

## 10. Scalability path (not built now)

Start: 1 API + 1 worker instance, managed Postgres (+ read replica later), managed Redis.
Growth levers in order: horizontal API/worker scaling → Postgres read replicas for listing/analytics →
partition `rider_locations`, `order_status_history`, `audit_logs` by month → move search to a dedicated
engine behind `SearchIndex` → extract `dispatch` or `notifications` as separate services if (and only if)
load demands it. PostGIS can replace JSON geometry + bbox pre-filter without API changes.
