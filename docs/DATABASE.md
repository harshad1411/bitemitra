# Database

Status: **Phase 1.** 27 of 98 designed tables are active (migrated). Decisions: D-5, D-6, D-18, D-19, OD-20, OD-21.

| File | Purpose |
|---|---|
| [`prisma/design/schema.design.prisma`](../packages/database/prisma/design/schema.design.prisma) | Full long-term design — 98 tables. Edit models **here**. |
| [`prisma/active-models.json`](../packages/database/prisma/active-models.json) | Which models are active in the current phase. |
| [`prisma/schema.prisma`](../packages/database/prisma/schema.prisma) | **Generated** active schema (what Prisma migrates and the client uses). |
| [`prisma/constraints.sql`](../packages/database/prisma/constraints.sql) | Partial unique indexes + CHECK constraints Prisma cannot express (all tables). |
| `prisma/constraints.active.sql` | Generated subset for active tables, applied as a migration. |
| `prisma/migrations/` | Migrations (Phase 1: init + constraints). |

`pnpm --filter @jamzo/database schema:generate` regenerates the active files; `pnpm verify:schema` fails if they
are stale, validates both schemas, applies both to PostgreSQL and exercises the constraints.

## 1. Technology

PostgreSQL (verified on 18.3 via PGlite; production ≥ 16) · Prisma 6 `prisma-client-js` (D-6) ·
raw parameterised SQL only for constraints and measured hot/report queries.

## 2. Conventions

| Rule | Detail |
|---|---|
| Identifiers | UUIDv7 — unguessable, time-ordered. Human references (`orderNumber`, invoice `number`) are separate unique columns. |
| Money | **Integer paise** (`*Paise`, `Int`); ledger balances/settlement totals `BigInt`. **No floats.** BigInt is sent to clients as a JSON number after a safe-integer check. |
| Percentages | Integer basis points (`*Bps`): 5% = 500. |
| Distance / time | Integer metres (`*M`); named seconds/minutes. Coordinates `Decimal(9,6)`. |
| Time | `timestamptz` UTC; business rules evaluated in `cities.timezone`. |
| Naming | Models PascalCase, tables snake_case plural, columns camelCase. |
| Deletes | No hard deletes of business records: soft delete or status; account deletion scrubs PII in place. |
| Append-only | status history, ledger entries, payment events, audit logs, setting history, versioned rule tables, pricing snapshots. Corrections are new rows (REVERSAL / ADJUSTMENT). |

## 3. Table classification

**CORE** = active in Phase 1 (migrated now). **LATER PHASE** = designed, migrated in the named phase.
**FUTURE** = designed for a capability not yet scheduled; kept so the design stays coherent.

### 3.1 CORE — Phase 1 (27 tables)

| Table | Why it exists |
|---|---|
| users | One identity per person across all apps |
| auth_identities | Provider-based login methods (phone OTP, email OTP, Google, Apple, password) per user (D-20) |
| otp_challenges | Hashed OTPs with attempts/expiry for phone and email OTP |
| sessions | Refresh-token rotation per app, theft detection via token families |
| devices | Push tokens per app/platform (registration in Phase 1; sending later) |
| admin_users | Admin profile, lockout state |
| roles, permissions, role_permissions, admin_user_roles | Server-side RBAC; city-scoped grants for City Managers |
| audit_logs | Who changed what, old → new, for admin/financial/config actions |
| countries, states, cities, zones, service_areas | Multi-city geography and serviceability (OD-6) |
| settings, setting_history | Hierarchical operational configuration with history (OD-7) |
| feature_flags | Controlled rollout |
| app_version_policies | Min/recommended/force-update per app and platform |
| media | Central media library (admin uploads; renditions by worker) |
| outbox_events | Reliable post-commit side effects and delayed jobs (D-9) |
| idempotency_records | API-level Idempotency-Key replay/conflict detection |
| customers | Customer profile created at first customer-app login |
| restaurants, restaurant_users | Needed now only for the **approval gate**: logging into the restaurant app must not imply being an approved restaurant member (OD-13). Full restaurant management is Phase 2. |
| riders | Needed now only for the rider **approval gate** (onboarding status). Onboarding flows are Phase 6. |

### 3.2 LATER PHASE (70 tables)

| Phase | Tables | Why |
|---|---|---|
| 2 — Restaurants & menu | restaurant_branches, restaurant_business_hours, restaurant_documents, restaurant_bank_accounts, restaurant_settings, restaurant_zones, branch_delivery_areas, categories, menu_categories, products, product_variants, product_addon_groups, product_addons, product_images, product_availability, product_schedules | Branch-level operations and reach (OD-6), onboarding documents/bank details, full catalog with variants, add-ons, availability and schedules |
| 3 — Customer discovery | customer_addresses, favorite_restaurants, consent_records, home_sections, banners, cms_pages | Saved addresses, favourites, legal consents, CMS-driven home page |
| 4 — Pricing | markup_rules, commission_rules, tax_rules, platform_fee_rules, delivery_pricing_rules, surge_rules, coupons, promotions | Versioned commercial rules and promotions (OD-7..OD-10) |
| 5 — Orders | orders, order_items, order_item_addons, order_status_history, order_pricing_snapshots, order_addresses, order_notes, order_cancellations, cancellation_rules, coupon_usages, notifications, notification_templates, notification_preferences, reviews | Order lifecycle, frozen financial snapshot, cancellations, notifications, ratings |
| 6 — Riders & dispatch | rider_documents, rider_vehicles, rider_availability, rider_locations, rider_shifts, rider_earnings, rider_earning_rules, order_assignments | KYC, live availability/location, offers & single-winner assignment, earnings |
| 7 — Payments | payments, payment_attempts, payment_events, refunds | Provider-agnostic payments (Razorpay first), idempotent webhooks, refunds |
| 8 — Financials | restaurant_ledgers, restaurant_ledger_entries, restaurant_settlements, rider_ledgers, rider_ledger_entries, rider_settlements, rider_payouts, rider_cod_deposits, platform_ledger_entries, invoices, invoice_sequences | Append-only ledgers, COD reconciliation, settlements, statements, invoices |
| 9 — Admin operations | support_tickets, support_ticket_messages, admin_saved_views | Support with full order context, saved table views |

### 3.3 FUTURE (1 table)

| Table | Why kept |
|---|---|
| search_queries | Search analytics ("popular searches", relevance tuning). Phase 3 search can start with recent searches on-device; server-side logging is activated when there is enough traffic to matter. |

Other future capabilities (pickup orders, scheduled delivery, multi-branch chains, wallet, multi-currency)
are represented by columns/enum values in the design (`OrderType.PICKUP`, `orders.scheduledFor`,
`countries.currencyCode`), not by extra tables.

## 4. Key modelling decisions

- **One `users` row, many profiles** (customer, restaurant member, rider, admin); sessions are bound to an `appId`.
- **Approval ≠ authentication** (OD-13): `restaurant_users` (+ `restaurants.onboardingStatus`) and `riders.onboardingStatus` decide what a signed-in person may do in the partner apps.
- **Versioned commercial rules** — an edit closes the current row (`effectiveTo`) and inserts a new one (`supersedesId`); that chain *is* the configuration history; point-in-time evaluation for replays.
- **Operational settings** — one row per (key, scope, target) + `setting_history` with reason; a partial unique index guarantees a single unscoped default per key (NULL-distinct pitfall).
- **Immutable order snapshot** (Phase 4–5) with every applied value, including commission basis, distance source, tip allocation, markup disclosure mode and withholdings (OD-8..OD-16).
- **Geometry** — GeoJSON + bbox columns, exact tests in `delivery-engine`; PostGIS later without API change. Zone `service_areas` (platform reach) and `branch_delivery_areas` (restaurant reach), D-19.
- **Ledgers** — append-only with deterministic idempotency keys; cached balances recomputable; REVERSAL entries for corrections (OD-21).
- **Sensitive fields** — bank/KYC numbers encrypted at the application layer; OTPs and refresh tokens stored only as hashes.

## 5. Concurrency and invariant guarantees

Enforced by PostgreSQL and exercised by `pnpm verify:schema` (each must fail with the expected SQLSTATE):

| Guarantee | Guard | Active from |
|---|---|---|
| One unscoped default per setting key | partial unique `settings(key, scope) WHERE scopeRefId IS NULL` | Phase 1 |
| GLOBAL settings have no target; scoped ones must | CHECK `settings_scope_ref_present` | Phase 1 |
| Valid geography / bbox / media size / OTP attempts | CHECKs | Phase 1 |
| Two riders cannot both own an order | partial unique `order_assignments(orderId) WHERE status IN (ACCEPTED, COMPLETED)` | Phase 6 |
| Double-tap creates one order | unique `orders(customerId, idempotencyKey)` | Phase 5 |
| Duplicate payment webhook | unique `payment_events(provider, providerEventId)` | Phase 7 |
| One successful payment per order; refund ≤ capture; duplicate refund | partial unique + CHECK + unique key | Phase 7 |
| Same ledger posting twice; non-positive amounts | unique idempotency key + CHECK | Phase 8 |
| Duplicate settlement | unique `(restaurant|rider, periodStart, periodEnd)` | Phase 8 |
| Two open versions of one rule | partial unique on open versions | Phase 4 |

Application complements: `SELECT … FOR UPDATE` for ledgers/sequences, conditional updates for state
changes, optimistic `version` columns, atomic counters for limits.

## 6. Indexing strategy

Every lookup foreign key and every admin list's default sort is indexed. Phase 1 lists (admin users,
audit logs, cities, zones, media, settings) use keyset (cursor) pagination on `(createdAt, id)` or name,
backed by indexes. Later phases add indexes driven by measured admin filter usage on seed-scale data.

## 7. Migrations

- Phase 1: `…_phase1_init` (generated from the active schema) and `…_phase1_constraints` (from `constraints.active.sql`).
- Activating a table = add it to `active-models.json`, regenerate, `prisma migrate dev`, plus a constraints migration if new statements apply.
- Production: forward-only, expand → migrate → contract across releases so older mobile versions keep working.

## 8. Seed data

Phase 1 seed (idempotent, deterministic): India → Gujarat → **Unjha** (first city, `isActive = true`) with
3 zones and service areas; **Mehsana** (inactive, proves multi-city); permissions and system roles;
settings defaults from the settings registry; feature flags; app version policies for 3 apps × 2 platforms;
a development Super Admin (credentials from env, never committed); demo restaurant + restaurant member and
demo rider (both approved) plus a pending rider, so the partner-app approval gates can be exercised.
Seed geography polygons are **approximate development shapes, not surveyed boundaries**.
The spec §53 volume dataset (restaurants, 100+ products, orders…) arrives with Phases 2–5.

## 9. Data retention (proposal — confirm with counsel)

Orders, payments, ledgers, invoices ≥ 8 years · rider breadcrumbs 90 days raw · OTP challenges, expired
sessions, idempotency records 30 days · financial audit logs ≥ 8 years.
