# Database

Status: **Phase 0 design — schema written and verified; no migrations generated yet.**

- Schema: [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma) (96 tables)
- Extra constraints: [`packages/database/prisma/constraints.sql`](../packages/database/prisma/constraints.sql)
- Verification: `pnpm verify:schema` ([`scripts/verify-schema.mjs`](../scripts/verify-schema.mjs))

## 1. Technology

| | Choice | Why |
|---|---|---|
| Database | PostgreSQL (16+; verified on 18.3) | Transactions, partial indexes, CHECK constraints, JSONB, full-text search, PostGIS path. |
| ORM | **Prisma 6.x** with the `prisma-client-js` generator | Readable schema DSL doubles as design documentation; mature migrations; JS client is generated inside `node_modules`, so no TypeScript enters project source. Prisma 7's new generator emits TypeScript source files, so we stay on 6.x until that is re-evaluated (Phase 10, [DECISIONS D6](DECISIONS.md#d6-prisma-6-pinned)). |
| Raw SQL | `constraints.sql` migration + `$queryRaw` (tagged, parameterised) for hot/report queries | Partial unique indexes and CHECKs are not expressible in Prisma. |
| Local/CI Postgres | Docker Postgres for development; **PGlite** (Postgres-in-WASM) for fast isolated tests; Postgres service container in CI | No system install required to run tests. |

## 2. Conventions

| Rule | Detail |
|---|---|
| Identifiers | UUIDv7 (`@default(uuid(7))`) — unguessable yet time-ordered, so B-tree inserts stay local. Human references (`orderNumber`, `ticketNumber`, invoice `number`) are separate unique columns. |
| Money | **Integer paise** in `*Paise` columns (`Int`). Ledger balances and settlement totals are `BigInt` paise. **No floats anywhere.** JSON APIs send paise as integers; `BigInt` is serialised as a JSON number after a safe-integer check (limit ≈ ₹90 trillion). |
| Rates | Integer basis points (`*Bps`): 5% = 500, 12.5% = 1250. |
| Distance / time | Integer metres (`*M`); minutes/seconds named explicitly. |
| Coordinates | `Decimal(9,6)` (~0.1 m). |
| Timestamps | `timestamptz` in UTC; business-time logic uses the city timezone. |
| Naming | Prisma models PascalCase, tables snake_case plural (`@@map`), columns camelCase. |
| Deletes | Business records are never hard-deleted: soft delete (`deletedAt`) or status. Account deletion scrubs PII in place (§49) so financial history keeps referential integrity. |
| Append-only tables | `order_status_history`, `*_ledger_entries`, `payment_events`, `audit_logs`, `setting_history`, rule tables (versioned), `order_pricing_snapshots`. Corrections are new rows. |

## 3. Domain map

| Domain | Tables |
|---|---|
| Identity & access | users, otp_challenges, sessions, devices, admin_users, roles, permissions, role_permissions, admin_user_roles, consent_records, notification_preferences |
| Geography | countries, states, cities, zones, service_areas |
| Customers | customers, customer_addresses, favorite_restaurants |
| Restaurants | restaurants, restaurant_branches, restaurant_business_hours, restaurant_users, restaurant_documents, restaurant_bank_accounts, restaurant_settings, restaurant_zones |
| Catalog | categories (platform taxonomy), menu_categories (per restaurant), products, product_variants, product_addon_groups, product_addons, product_images, product_availability, product_schedules |
| Riders | riders, rider_documents, rider_vehicles, rider_availability, rider_locations, rider_shifts, rider_earnings, rider_payouts, rider_cod_deposits |
| Commercial rules (versioned) | markup_rules, commission_rules, tax_rules, platform_fee_rules, delivery_pricing_rules, rider_earning_rules, surge_rules, cancellation_rules |
| Operational config | settings, setting_history, feature_flags, app_version_policies |
| Promotions | coupons, coupon_usages, promotions |
| Orders | orders, order_items, order_item_addons, order_status_history, order_pricing_snapshots, order_addresses, order_notes, order_assignments, order_cancellations |
| Payments | payments, payment_attempts, payment_events, refunds |
| Ledgers & settlements | restaurant_ledgers, restaurant_ledger_entries, restaurant_settlements, rider_ledgers, rider_ledger_entries, rider_settlements, platform_ledger_entries, invoices, invoice_sequences |
| Engagement | reviews, support_tickets, support_ticket_messages, notifications, notification_templates |
| CMS & media | media, cms_pages, home_sections, banners |
| Platform plumbing | audit_logs, idempotency_records, outbox_events, admin_saved_views, search_queries |

Every entity named in MASTER_SPEC §5 is present. Additions beyond §5, and why:

| Added | Reason |
|---|---|
| `sessions`, `otp_challenges`, `devices` | Refresh-token rotation, OTP security, push targets (§48). |
| `restaurantStatus` / `deliveryStatus` columns on orders | Kitchen and delivery progress run in parallel; see [ORDERS.md](ORDERS.md#2-two-tracks-one-derived-status). |
| `PAYMENT_FAILED` order status | §56 requires a "payment fails" path; §18's list has no terminal state for it. |
| `order_cancellations`, `cancellation_rules` | §35 needs who/why/refund/compensation/platform-loss per cancellation. |
| `rider_cod_deposits` | §23 "cash submitted" + "settlement reference" need a record of their own. |
| `invoices`, `invoice_sequences` | §12 invoices; GST invoice numbers must be gap-free per series/financial year. |
| `outbox_events`, `idempotency_records` | Reliability (§40, §68, §69). |
| `admin_saved_views`, `search_queries` | §29 saved views, §38 popular searches. |
| `support_ticket_messages` | Conversation thread per ticket (§47). |
| `app_version_policies`, `setting_history` | §72 version policy, §63 configuration history. |

## 4. Key modelling decisions

### 4.1 Identity: one `users` row, many profiles
A person can be a customer *and* a restaurant manager *and* an admin. `users` holds identity and auth;
`customers`, `riders`, `restaurant_users`, `admin_users` are profiles. Sessions record `appId`, so a
rider token is useless in the admin app and vice versa.

### 4.2 Versioned commercial rules = configuration history
Each rule table row is immutable. "Editing" a rule closes the current row (`effectiveTo = now`) and
inserts a new row with `supersedesId` → old row, in one transaction with an audit log entry. This gives:
- full history with who/when/why (`createdById`, `changeNote`) for §63 without a separate history table;
- **point-in-time evaluation** — the engine can answer "what rule applied at 21:14 on 3 Sept?";
- future-dated changes (`effectiveFrom` in the future) and scheduled platform fees (§13).

A partial unique index guarantees at most one *open* version per (scope, target, qualifier, priority).
Rule `params` are JSON validated by zod schemas in `pricing-engine` both on write (API) and on read (engine).

### 4.3 Immutable order snapshot (§27, §82)
`order_pricing_snapshots` (1:1 with orders) + per-line columns on `order_items`/`order_item_addons`
store every amount, rate, rule id and rule `params` used. They are written once, in the order-creation
transaction, and never updated. Refunds, cancellations and ledger postings are separate rows that
*reference* the order. Reconstructing any rupee requires no current configuration.

### 4.4 Geometry without PostGIS (for now)
Zones and polygon service areas store GeoJSON plus a bounding box (`minLat…maxLng`, indexed). Lookup =
bbox pre-filter in SQL → exact point-in-polygon in `delivery-engine`. With few zones per city this is
fast; PostGIS can replace it later without an API change. (PGlite, used in tests, does not ship PostGIS.)

### 4.5 Ledgers
Three sub-ledgers (restaurant, rider, platform), append-only entries with a positive `amountPaise` and a
`direction`. Every posting has a deterministic `idempotencyKey` such as `order:<id>:COMMISSION`, making
re-runs harmless. Cached balances on `restaurant_ledgers` / `rider_ledgers` are updated in the same
transaction under a row lock and can always be recomputed from entries. Details: [SETTLEMENTS.md](SETTLEMENTS.md).

### 4.6 Sensitive fields
Bank account numbers and rider/KYC document numbers are encrypted at the application layer
(AES-256-GCM, key from env / KMS) with a `last4` column for display. OTPs and refresh tokens are stored
only as hashes. No card data is ever stored (§48).

## 5. Concurrency guarantees

These are enforced **by the database**, not only by application code, and are exercised by
`pnpm verify:schema`, which inserts conflicting rows and asserts PostgreSQL rejects each one with the
expected SQLSTATE:

| Race / error (§69) | Guard |
|---|---|
| Two riders accept the same order | partial unique index `order_assignments(orderId) WHERE status IN (ACCEPTED, COMPLETED)` |
| Double-tap creates two orders | unique `orders(customerId, idempotencyKey)` |
| Duplicate payment webhook | unique `payment_events(provider, providerEventId)` |
| Two successful payments recorded for one order | partial unique `payments(orderId) WHERE status = SUCCEEDED` |
| Refund exceeds capture | CHECK `refundedPaise <= capturedPaise` |
| Duplicate refund request | unique `refunds.idempotencyKey` |
| Same ledger posting twice | unique `*_ledger_entries.idempotencyKey` |
| Duplicate settlement | unique `(restaurantId|riderId, periodStart, periodEnd)` |
| Two live versions of a rule | partial unique index on open versions |
| Invalid money values | CHECKs: non-negative prices/totals, positive ledger amounts, COD ≤ total, coupon % ≤ 100 |

Application-level complements: `SELECT … FOR UPDATE` on ledger rows and invoice sequences; conditional
updates (`UPDATE … WHERE status = 'PENDING'`) for payment state; optimistic `orders.version` for transitions;
atomic `UPDATE coupons SET usedCount = usedCount + 1 WHERE usedCount < usageLimit` for coupon limits and
stock-tracked products.

## 6. Indexing strategy

Indexes are declared for every foreign key used in lookups and for the main list screens:
orders by (restaurant, status, time), (city, zone, time), (status, time), (customer, time), (deliveryStatus, time);
products by (restaurant, status, availability) and (menu category, sort); rules by (scope, target, effectiveFrom).
Phase 3 adds `pg_trgm` + `tsvector` GIN indexes for search; Phase 9 adds indexes driven by admin
filter usage measured under the seed-data load test.

## 7. Migrations & environments

- Phase 1 generates the first migration from this schema, followed by a hand-written migration that applies `constraints.sql`.
- Migrations are forward-only in production; destructive changes use expand → migrate data → contract across releases so older mobile app versions keep working (§72, B10).
- `prisma migrate deploy` runs in CI/CD before the new API version receives traffic.

## 8. Seed data (Phase 1–2)

Per §53: Unjha (Gujarat) with ≥3 zones, ≥10 restaurants across cuisines, ≥100 products with variants
and add-ons, ≥20 customers, ≥10 riders, orders in every status (COD/online, cancelled, refunded,
settled/unsettled). Seeds are deterministic (fixed random seed) so tests can rely on them. Seed orders
are produced **through the pricing and order engines**, not hand-typed totals, so seed data is financially consistent.

## 9. Data retention (proposal — confirm legal requirements)

| Data | Retention |
|---|---|
| Orders, payments, ledgers, invoices | ≥ 8 years (Indian tax record-keeping; confirm with CA) |
| Rider location breadcrumbs | 90 days raw, then aggregated |
| OTP challenges, expired sessions, idempotency records | 30 days |
| Audit logs | ≥ 8 years for financial actions |
