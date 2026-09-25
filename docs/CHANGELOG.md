# Changelog

All notable changes to the Jamzo platform. Each mobile app, the admin and the API also keep
release notes per version tag (`customer@x.y.z`, `restaurant@x.y.z`, `rider@x.y.z`, `admin@x.y.z`, `api@x.y.z`).

## Phase 2 — Restaurants & menus (2026-09-25) — awaiting owner review

### Added
- Database: 16 tables (branches, hours, delivery areas, documents, bank accounts, restaurant settings and zones, food categories, menu sections, products, variants, add-on groups and add-ons, images, sold-out windows, schedules); 2 migrations; 24 more database rules.
- `@jamzo/catalog-engine`: opening hours (several intervals per day, past midnight), product availability and schedules, product structure and food-type rules.
- API (+36 endpoints, 87 total): restaurant onboarding workflow with server-checked readiness, team, branches/hours/delivery area, open/pause/busy, private KYC documents, encrypted bank accounts with four-eyes verification, food categories, menu sections, products (whole-document writes with version check), sold-out handling, all-or-nothing bulk actions, Restaurant Partner endpoints.
- Jamzo Admin: Restaurants (list, detail with 7 tabs), Products (list with filters and bulk actions, editor), Food categories.
- Restaurant Partner app: store status controls and menu screen with sold-out toggles.
- Seed: 12 fictional Unjha restaurants, 108 products.

### Changed
- RESTAURANT and BRANCH setting overrides enabled; `restaurant_settings` slimmed (D-40); `FIELD_ENCRYPTION_KEY` is now required by the API.
- `verify:schema` compares the whole migration chain structurally.

### Fixed
- PATCH schemas injected defaults for omitted fields (D-45): renaming a live city was refused and renaming a zone re-activated it (Phase 1 bug).

## Phase 1 — Foundation (2026-09-24) — accepted

### Added
- Tooling: pnpm (hoisted) + Turborepo, ESLint 9 (architecture rules: no server packages in clients, identifiers only from the registry), Prettier, JSDoc type-checking, GitHub Actions CI (checks, admin E2E, mobile bundles, native Android/iOS builds).
- Shared packages: shared-types, config (product registry, env schemas, settings registry, scope resolution, feature flags, semver, Expo config builder), validation, logger, auth, notifications (console providers), pricing-engine (money math), delivery-engine (geo, serviceability), ui (tokens), api-client, mobile-ui, mobile-foundation.
- Database: 27 active tables, 2 migrations, seed (base + demo: Unjha live, Mehsana not launched, demo partners), real-PostgreSQL test harness.
- API (51 endpoints): phone/email OTP, admin password login with lockout, rotating sessions with reuse detection, RBAC with city scoping, audit log, idempotency, standard errors, version gate + maintenance, remote config, geography + serviceability, settings with history, feature flags, app version policies, media library.
- Workers: PostgreSQL outbox relay (lease, retry, park) and image renditions.
- Jamzo Admin: login, app shell, dashboard, cities & zones, configuration (settings / flags / app versions / history), admin users, roles, permissions, media, audit log.
- Mobile: three independent Expo app shells (sign-in, approval-aware home, update/maintenance gate, push registration, offline banner) with placeholder icons and splash screens.

### Changed
- Owner decisions OD-1..OD-34 applied (Jamzo rebrand, no Polaris, JavaScript only …); see DECISIONS.md.
- Engineering changes found during implementation: hoisted pnpm layout + catalog (D-2), real PostgreSQL for tests (D-13), `timestamptz` everywhere (D-26), setting history survives resets (D-28).

## Phase 0 — Architecture (2026-09-24) — approved

### Added
- `docs/MASTER_SPEC.md`: owner specification (Parts A, B) plus Part C owner directives (JavaScript only, Phase 0 first).
- Architecture documentation: ARCHITECTURE, DATABASE, PRICING, ORDERS, ORDER_FLOW, PAYMENTS, SETTLEMENTS, DELIVERY, RBAC, SECURITY, API, CONFIGURATION, MOBILE, TESTING, DEPLOYMENT, DECISIONS.
- Database design: `packages/database/prisma/schema.prisma` (96 tables) and `constraints.sql` (partial unique indexes and CHECK constraints for concurrency and money invariants).
- `scripts/verify-schema.mjs` (`pnpm verify:schema`): validates the schema, applies it to an empty PostgreSQL and proves 12 database guarantees reject invalid writes.
- Monorepo skeleton (pnpm workspaces) with a README per planned app/service/package.
- Owner-supplied BiteMitra logo kit in `assets/brand/` (moved to `assets/legacy/` in Phase 1 after the rebrand to Jamzo).

### Removed
- An earlier TypeScript-based scaffold started before the JavaScript-only directive (never committed).
