# Testing strategy

Covers MASTER_SPEC §53–§58, §81, B8 and OD-28, OD-33. **Rule:** nothing is reported as tested or
working unless the automated check was actually executed; everything else is listed under "Not tested"
with why and how the owner can test it.

## 1. Test layers

| Layer | Tool | Scope | Phase 1 |
|---|---|---|---|
| Unit (pure logic) | Vitest | money math, geo, config resolution, semver, flags, permissions, OTP/token helpers, validation schemas; Phase 2: opening hours, product availability, product structure (`@jamzo/catalog-engine`), field encryption, rupee↔paise input conversion, "PATCH schemas never inject defaults" | yes |
| Database invariants | `pnpm verify:schema` (PGlite) | design + active schema apply cleanly; constraint behaviour with expected SQLSTATEs; active ⊆ design consistency; table classification complete | yes |
| API integration | Vitest + Fastify `inject` + **real PostgreSQL 18** (embedded, a fresh database per test file cloned from a migrated template — D-13) | every route: auth, sessions, RBAC matrix, audit, idempotency, geography, serviceability, settings, flags, app versions, remote config, media, error format; Phase 2: onboarding workflow and races, private documents, bank encryption + four-eyes, hours/pause/zones, products (nested write, stale-version conflict), availability, bulk all-or-nothing, partner-app gate and roles, constant SQL count for menus (no N+1) | yes |
| Worker | Vitest + real PostgreSQL | outbox claim/lease/retry/park, media renditions | yes |
| CI parity | same suites against a PostgreSQL 17 service container (`TEST_DATABASE_URL`) | version/server differences | CI workflow written; the same code path was run locally against a separate PostgreSQL server |
| Static | ESLint 9, Prettier check, `tsc --checkJs` (Node packages/services), no-TS-file guard | | yes |
| Mobile foundations & screens | Jest-Expo + React Native Testing Library | gates, login flow, shells, error/loading states | yes |
| Mobile bundles / config | `expo export` (android + ios), `expo prebuild --no-install`, `expo-doctor` | | yes |
| Admin components | Vitest + Testing Library (jsdom) | design-system components | **not written in Phase 1** — the admin is covered end to end by Playwright instead |
| Admin E2E | Playwright against the real API + embedded PostgreSQL + production Next build (desktop and phone viewports) | sign-in, dashboard, cities/zones, settings override + history, roles, admin users, media upload → worker renditions, audit, session cookie, sign-out; Phase 2: restaurants list/detail, onboarding to review, product editor with sizes/choices and a concurrent-edit conflict, bulk sold-out, food categories | yes |
| Mobile E2E | Maestro (Android emulator **and** iOS simulator) | | **not possible on this machine yet** (Q-17; [MOBILE.md §7](MOBILE.md#7-verification-b8--what-can-and-cannot-be-proven-on-the-current-machine)) |
| Native builds | Gradle `assembleDebug` / `xcodebuild` for the simulator | all three apps | CI jobs written, **not yet run** (nothing pushed — Q-16) |
| Load | k6 | | Phase 10 |

## 2. Highest-priority suites (§54) — by phase

Pricing/commission/tax/delivery/surcharges/coupons (Phase 4, matrix in [PRICING.md §10](PRICING.md#10-test-matrix-phase-4--written-first)) ·
order state transitions (5) · dispatch races (6) · payment idempotency/webhooks (7) · settlement, COD,
refund (8) · **permissions (Phase 1)**.

Golden tests: the PRICING.md worked example and its SETTLEMENTS.md postings are encoded exactly (Phase 4/8).

## 3. End-to-end scenarios (§56)

Listed in [ORDER_FLOW.md](ORDER_FLOW.md); automated from Phase 5 onwards with fake providers.

## 4. Test data

Deterministic factories; the Phase 1 seed (geography, roles, settings, flags, version policies, demo
accounts) is idempotent and used by integration and E2E tests. Time is injected; engines never read the clock.

## 5. Rules (§58)

No skipped/deleted failing tests; no blanket lint disables; no mocking the unit under test; external
providers replaced only by **fakes implementing the same interface** (console SMS/email; storage uses the
real local-filesystem driver in a temp directory); expected values computed independently.

## 6. Commands

See the root [README](../README.md). `pnpm check` runs everything that can run locally.
