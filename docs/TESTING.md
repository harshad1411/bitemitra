# Testing strategy

Status: **Phase 0.** The only executable check today is `pnpm verify:schema` (see §6). The toolchain
below is installed in Phase 1.

Covers MASTER_SPEC §53–§58, §81, B8. Rule: nothing is reported as working unless the relevant
automated check was run, or it is listed under "Not tested" with why and how the owner can test it.

## 1. Test pyramid

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit (pure engines) | Vitest | pricing, order state machine, dispatch, earnings, settlement postings, config resolution, semver, money math | every commit |
| Property-based | Vitest + fast-check | pricing/settlement invariants over random carts & rule sets (conservation, non-negativity, allocation sums) | every commit |
| Integration (API + DB) | Vitest + Fastify `inject` + **PGlite** (real Postgres in-process, fresh schema per worker) | routes, transactions, constraints, RBAC matrix, idempotency, outbox | every commit |
| Integration (CI parity) | same suite against a PostgreSQL service container | catches PGlite-vs-Postgres differences | CI |
| Contract | recorded request/response fixtures per supported app version | backwards compatibility (§72) | CI |
| Component (mobile) | Jest-Expo + React Native Testing Library | screens: loading/empty/error states, forms, keyboard, accessibility labels | every commit |
| Component (admin) | Vitest + Testing Library | tables, filters, forms, permission-aware rendering | every commit |
| E2E (API scenarios) | Vitest driving the real API with fake payment/SMS/push adapters | all §56 scenarios | CI |
| E2E (admin) | Playwright (desktop + tablet + mobile viewports) | orders, config preview, refunds, settlements | CI |
| E2E (mobile) | **Maestro** on Android emulator **and** iOS simulator | login, ordering, restaurant accept, rider trip, deep links, permissions | nightly + before release |
| Load | k6 (JS) | quote, checkout, listing, admin orders at seed ×100 volume | Phase 10 + before launch |
| Security | `pnpm audit`, ZAP baseline on staging, dependency review | | CI / Phase 10 |

## 2. Highest-priority suites (§54)

Pricing (full matrix in [PRICING.md §10](PRICING.md#10-test-matrix-phase-4--written-first)) ·
commission · tax · delivery · surcharges · coupons · restaurant payable · rider payable · COD ·
settlement · refund · cancellation · payment idempotency · order state transitions · permissions.

**Golden tests**: the worked example in PRICING.md and its ledger postings in SETTLEMENTS.md are
encoded exactly; they must never change silently.

## 3. End-to-end scenarios (§56)

Online happy path through settlement · restaurant rejects · restaurant timeout · rider rejects · no rider
available · customer cancels before/after acceptance · payment fails · payment succeeds, callback
delayed · duplicate webhook · late success after cancel · restaurant goes offline · rider loses
connectivity · COD delivery · COD cancellation/refusal · full refund · partial refund · coupon order ·
night order · surge order · product unavailable during checkout · restaurant closes during checkout ·
price changes while cart open · double-tap place order.

## 4. Test data

- **Factories** (deterministic, seeded) for unit/integration tests.
- **Seed dataset** (§53) generated *through the engines* so it is financially consistent; used by E2E, admin demos and load tests.
- Time is injected (`now` parameter / fake timers), never read from the wall clock inside engines — night-window and settlement-cutoff tests are exact.

## 5. Rules (§58)

No skipped/deleted failing tests, no blanket lint disables, no mocking of the unit under test, no
hard-coded expected values derived from the implementation (golden values are computed by hand and
reviewed). External providers are replaced by **fakes that implement the same interface** (signed
webhooks, delivery receipts), never by stubbing business logic. Coverage gates: engines ≥ 95% lines
and branches; API modules ≥ 85%.

## 6. What Phase 0 actually verified

`pnpm verify:schema`:
1. `prisma validate` on the full schema;
2. generates the SQL (96 tables, 141 indexes, 84 foreign keys) and applies it to an empty PostgreSQL 18.3 (PGlite);
3. applies `constraints.sql`;
4. inserts fixtures and proves 12 database guarantees reject invalid writes **with the expected SQLSTATE** (unique vs check violation), so a typo cannot pass as a success.

**Not tested in Phase 0** (nothing else exists yet): all application code, mobile builds, admin, API.

## 7. Per-phase gate (§57)

`pnpm install` → `pnpm lint` → `pnpm typecheck` (JSDoc checking if approved, **⚠ Q2**; otherwise
skipped and stated) → `pnpm test` → integration → relevant E2E → `pnpm build` for affected apps
(including `expo export` for Android and iOS, and native prebuild checks) → review logs → fix → repeat.
Each phase report lists commands run, results, and a **Not tested / why / how the owner can test** section.
