# Changelog

All notable changes to the Jamzo platform. Each mobile app, the admin and the API also keep
release notes per version tag (`customer@x.y.z`, `restaurant@x.y.z`, `rider@x.y.z`, `admin@x.y.z`, `api@x.y.z`).

## Phase 1 — Foundation (in progress)

### Changed (owner decisions OD-1..OD-34, see DECISIONS.md)
- Brand renamed to **Jamzo** (jamzo.in); identifiers `in.jamzo.{customer,restaurant,rider}`; packages `@jamzo/*`.
- Polaris dropped after licence/maintenance review; admin uses Tailwind + shadcn/ui with a Jamzo design system.
- Database: design schema moved to `prisma/design/`; generated active schema (27 tables); table classification; new `auth_identities`, `branch_delivery_areas`, `BRANCH` scope, owner kitchen-state vocabulary, COD shortage/excess, withholding, tip and rounding ledger types, commission basis and distance source in snapshots, outbox leasing fields.
- Docs updated for all decisions; DECISIONS.md is now the authoritative decision record.

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
