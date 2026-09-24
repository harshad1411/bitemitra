# Testing strategy

Covers MASTER_SPEC §53–§58, §81, B8 and OD-28, OD-33. **Rule:** nothing is reported as tested or
working unless the automated check was actually executed; everything else is listed under "Not tested"
with why and how the owner can test it.

## 1. Test layers

| Layer | Tool | Scope | Phase 1 |
|---|---|---|---|
| Unit (pure logic) | Vitest | money math, geo, config resolution, semver, flags, permissions, OTP/token helpers, validation schemas | yes |
| Database invariants | `pnpm verify:schema` (PGlite) | design + active schema apply cleanly; constraint behaviour with expected SQLSTATEs; active ⊆ design consistency; table classification complete | yes |
| API integration | Vitest + Fastify `inject` + **PGlite** (fresh migrated database per test file via `@jamzo/database/testing`) | every Phase 1 route: auth, sessions, RBAC matrix, audit, idempotency, geography, serviceability, settings, flags, app versions, remote config, media, error format | yes |
| Worker | Vitest + PGlite | outbox claim/lease/retry/park, media renditions | yes |
| CI parity | same suites against a PostgreSQL 17 service container | PGlite-vs-Postgres differences | CI workflow (runs on GitHub) |
| Static | ESLint 9, Prettier check, `tsc --checkJs` (Node packages/services), no-TS-file guard | | yes |
| Mobile foundations & screens | Jest-Expo + React Native Testing Library | gates, login flow, shells, error/loading states | yes |
| Mobile bundles / config | `expo export` (android + ios), `expo prebuild --no-install`, `expo-doctor` | | yes |
| Admin components | Vitest + Testing Library (jsdom) | design-system components, permission-aware nav | yes |
| Admin E2E | Playwright against real API + PGlite + Next build | login → cities/zones → settings → roles → audit | yes if browsers install |
| Mobile E2E | Maestro (Android emulator **and** iOS simulator) | | **not possible on this machine yet** ([MOBILE.md §7](MOBILE.md#7-verification-b8--what-can-and-cannot-be-proven-on-the-current-machine)) |
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
