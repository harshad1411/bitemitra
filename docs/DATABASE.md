# Database

Status: **Phases 3 + 4.** 58 of 98 designed tables are active (migrated). Decisions: D-5, D-6, D-18, D-19, D-35 … D-41, D-46 … D-57, OD-20, OD-21.

| File | Purpose |
|---|---|
| [`prisma/design/schema.design.prisma`](../packages/database/prisma/design/schema.design.prisma) | Full long-term design — 98 tables. Edit models **here**. |
| [`prisma/active-models.json`](../packages/database/prisma/active-models.json) | Which models are active in the current phase. |
| [`prisma/schema.prisma`](../packages/database/prisma/schema.prisma) | **Generated** active schema (what Prisma migrates and the client uses). |
| [`prisma/constraints.sql`](../packages/database/prisma/constraints.sql) | Partial unique indexes + CHECK constraints Prisma cannot express (all tables). |
| `prisma/constraints.active.sql` | Generated subset for active tables, applied as a migration. |
| `prisma/migrations/` | Migrations (Phase 1: init + constraints; Phase 2: catalog + constraints; Phases 3 + 4: discovery & pricing + constraints). |

`pnpm --filter @jamzo/database schema:generate` regenerates the active files; `pnpm verify:schema` fails if they
are stale, validates both schemas, checks that the migration chain produces **exactly** the active schema
and constraints (structural comparison of columns, indexes, constraints and enums), applies the full design
to PostgreSQL and exercises the constraints.

## 1. Technology

PostgreSQL (tests: real PostgreSQL 18 embedded locally and 17 in CI; schema checks: PGlite 18.3; production ≥ 16). All timestamps are `timestamptz` (D-26) · Prisma 6 `prisma-client-js` (D-6) ·
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

**CORE** = active now (migrated): Phase 1–6 tables. **LATER PHASE** = designed, migrated in the named phase.
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

### 3.1a CORE — Phase 2, restaurants & menus (16 tables)

| Table | Why it exists |
|---|---|
| restaurant_branches | Location, zone, preparation time and the open / pause / busy state of each outlet (OD-6, D-38) |
| restaurant_business_hours | Weekly opening intervals per branch; "no hours = closed" |
| branch_delivery_areas | The branch's own reach (radius or polygon), one active per branch (D-19, D-41) |
| restaurant_documents | FSSAI / PAN / GST … numbers, private files and review status for approval (D-34, D-36) |
| restaurant_bank_accounts | Encrypted account number, last 4, IFSC, four-eyes verification (D-35) |
| restaurant_settings | Per-restaurant capabilities that are not hierarchical settings (D-40) |
| restaurant_zones | Zones where a restaurant is listed — discovery index for Phase 3 (D-41) |
| categories | Platform food taxonomy for discovery and rule scoping (D-37) |
| menu_categories | Each restaurant's own menu sections and their order |
| products | Menu items: restaurant base price (never mutated by markup), food type, flags, status, sold-out switch, version |
| product_variants | Sizes with full prices, exactly one default |
| product_addon_groups, product_addons | Customisation with min/max selection and food-type consistency |
| product_images | Ordered product images from the media library |
| product_availability | Dated sold-out windows ("sold out for today") |
| product_schedules | Recurring windows when a product can be ordered |

### 3.1b CORE — Phases 3 + 4, customer discovery and pricing (15 tables)

| Table | Why it exists |
|---|---|
| customer_addresses | Saved delivery addresses with location and resolved zone (soft delete; orders copy the address) |
| favorite_restaurants | Customer favourites |
| consent_records | Terms / privacy / marketing consents with version (DPDP, Q-12) |
| home_sections, banners | CMS-driven home page: ordered, scheduled, city/zone-targeted sections and banners (D-56) |
| cms_pages | Terms, privacy, FAQ and other static pages |
| markup_rules, commission_rules, tax_rules, platform_fee_rules, delivery_pricing_rules, surge_rules | Versioned commercial rules resolved by the pricing engine (OD-7..OD-16, D-50, D-51) |
| rider_earning_rules | Rider pay rule, needed for every quote's rider-cost estimate (moved from Phase 6 — D-53) |
| coupons, promotions | Discounts with targeting, funding source and limits (D-52) |

### 3.1c CORE — Phase 5, orders (12 tables)

| Table | Why it exists |
|---|---|
| orders | The order: both tracks, derived status, `version` for optimistic concurrency, `orderSeq` for order numbers (D-63), `needsAttention` for operations (D-68) |
| order_items, order_item_addons | Frozen per-line prices: restaurant base, customer display, markup, tax, commission share (per line, largest remainder) |
| order_status_history | Append-only log of every transition with actor, reason and metadata (spec §18) |
| order_pricing_snapshots | The frozen financial snapshot incl. the customer bill and the full engine output (D-64) |
| order_addresses | Copy of the delivery address at order time |
| order_notes | Internal admin notes |
| order_cancellations | Who cancelled, stage, rule snapshot, fee / refund / compensations / platform loss (D-66) |
| cancellation_rules | Versioned stage × actor cancellation money rules (D-66) |
| coupon_usages | One usage per order; released on cancellation (D-65) |
| notifications, notification_templates | Recorded order notifications and their editable templates (D-69) |

### 3.1d CORE — Phase 6, riders and delivery (8 tables)

| Table | Why it exists |
|---|---|
| rider_documents | Licence, RC, PAN, identity proof and photo with private files, encrypted numbers (last 4 shown) and review status (D-73) |
| rider_vehicles | The rider's active vehicle (type decides the documents required) |
| rider_availability | Hot row: online, active orders, latest position and zone (D-74) |
| rider_locations | Breadcrumbs from location batches (30-day retention planned) |
| rider_shifts | One row per online period; one open shift per rider |
| order_assignments | Offers and accepted trips; the database allows one accepted assignment per order (D-75) |
| rider_earnings | Final pay per delivered order, or the cancelled-trip pay, with the full breakdown (D-78) |
| payments | Cash-on-delivery collection now (who, when, how much — D-77); online payments in Phase 7 (CH-22) |

### 3.2 LATER PHASE (19 tables)

| Phase | Tables | Why |
|---|---|---|
| 6+ — Ratings | reviews | Ratings of delivered orders (CH-20); built with the ratings flag |
| 7 — Payments | payment_attempts, payment_events, refunds | Provider-agnostic payments (Razorpay first), idempotent webhooks, refunds |
| 8 — Financials | restaurant_ledgers, restaurant_ledger_entries, restaurant_settlements, rider_ledgers, rider_ledger_entries, rider_settlements, rider_payouts, rider_cod_deposits, platform_ledger_entries, invoices, invoice_sequences | Append-only ledgers, COD reconciliation, settlements, statements, invoices |
| 9 — Admin operations | support_tickets, support_ticket_messages, admin_saved_views, notification_preferences | Support with full order context, saved table views |

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
| One primary branch per restaurant; one default variant per product; one active delivery area per branch | partial unique indexes | Phase 2 |
| Only a verified bank account can be primary; one primary per restaurant | CHECK + partial unique | Phase 2 |
| Menu section names unique per restaurant (case-insensitive) | unique `(restaurantId, lower(name))` | Phase 2 |
| Valid hours/schedule times, sold-out windows, prices, stock, prep time, add-on selection limits, IFSC | CHECKs | Phase 2 |
| GLOBAL settings have no target; scoped ones must | CHECK `settings_scope_ref_present` | Phase 1 |
| Valid geography / bbox / media size / OTP attempts | CHECKs | Phase 1 |
| Two riders cannot both own an order | partial unique `order_assignments(orderId) WHERE status IN (ACCEPTED, COMPLETED)` | Phase 6 |
| Double-tap creates one order | unique `orders(customerId, idempotencyKey)` | Phase 5 |
| Duplicate payment webhook | unique `payment_events(provider, providerEventId)` | Phase 7 |
| One successful payment per order; refund ≤ capture; duplicate refund | partial unique + CHECK + unique key | Phase 7 |
| Same ledger posting twice; non-positive amounts | unique idempotency key + CHECK | Phase 8 |
| Duplicate settlement | unique `(restaurant|rider, periodStart, periodEnd)` | Phase 8 |
| Two open versions of one rule (per rule type; tax per charge, surge per kind) | partial unique on open versions | Phase 4 |
| Rule windows valid; GLOBAL rules untargeted; upper-case coupon codes; valid promotion values | CHECKs | Phase 4 |

Application complements: `SELECT … FOR UPDATE` for ledgers/sequences, conditional updates for state
changes, optimistic `version` columns, atomic counters for limits.

## 6. Indexing strategy

Every lookup foreign key and every admin list's default sort is indexed. Phase 1 lists (admin users,
audit logs, cities, zones, media, settings) use keyset (cursor) pagination on `(createdAt, id)` or name,
backed by indexes. Later phases add indexes driven by measured admin filter usage on seed-scale data.

## 7. Migrations

- Phase 1: `…_phase1_init` (generated from the active schema) and `…_phase1_constraints` (from `constraints.active.sql`).
- Phases 3 + 4: `…_phase3_4_discovery_pricing` (15 new tables, no change to existing tables) and `…_phase3_4_constraints`.
- Phase 2: `…_phase2_catalog` (`prisma migrate diff` from the Phase 1 active schema to the Phase 2 one: 16 new tables, no changes to existing tables) and `…_phase2_constraints` (the constraint statements that became active).
- Activating a table = add it to `active-models.json`, regenerate, `prisma migrate dev`, plus a constraints migration if new statements apply.
- Production: forward-only, expand → migrate → contract across releases so older mobile versions keep working.

## 8. Seed data

Phase 1 seed (idempotent, deterministic): India → Gujarat → **Unjha** (first city, `isActive = true`) with
3 zones and service areas; **Mehsana** (inactive, proves multi-city); permissions and system roles;
settings defaults from the settings registry; feature flags; app version policies for 3 apps × 2 platforms;
a development Super Admin (credentials from env, never committed); demo restaurant + restaurant member and
demo rider (both approved) plus a pending rider, so the partner-app approval gates can be exercised.
Seed geography polygons are **approximate development shapes, not surveyed boundaries**.
Phase 2 adds the demo catalog (`seed --demo`, D-44): 14 food categories and 12 fictional Unjha restaurants (9 live, one APPROVED, one in REVIEW, one DRAFT) with branches, hours, delivery areas, documents, owners and **108 products** with sizes, add-ons and schedules; demo bank accounts only when `FIELD_ENCRYPTION_KEY` is set. Customers, riders and orders (spec §53) arrive with Phases 3–6.

## 9. Data retention (proposal — confirm with counsel)

Orders, payments, ledgers, invoices ≥ 8 years · rider breadcrumbs 90 days raw · OTP challenges, expired
sessions, idempotency records 30 days · financial audit logs ≥ 8 years.
