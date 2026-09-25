# Changelog

All notable changes to the Jamzo platform. Each mobile app, the admin and the API also keep
release notes per version tag (`customer@x.y.z`, `restaurant@x.y.z`, `rider@x.y.z`, `admin@x.y.z`, `api@x.y.z`).

## Phase 6 — Delivery partners and dispatch (2026-09-25) — awaiting owner review

### Added
- Jamzo Delivery Partner app: apply (details, vehicle, document photos), go online with background location after a disclosure, requests with countdown and vibration, the whole trip (at restaurant, pickup check, arrived, delivery code, cash, optional proof photo), navigation in Google/Apple Maps, report a problem, give an order back, cash in hand, earnings.
- Dispatch (`@jamzo/delivery-engine` ranking + API service): automatic offers with timeouts, next rider, no-rider escalation and retry; admin assign, reassign and take back (audited). Two riders can never both hold an order (database rule).
- Rider earnings at delivery from the earning rule (trip, distance, waiting, incentives, tip); a cancelled trip after acceptance pays the trip estimate (OD-39).
- Cash on delivery: payment row at delivery, per-rider cash balance, limit and switch.
- Database: rider tables activated (documents, vehicles, availability, shifts, locations, assignments, earnings, payments for COD); 2 migrations; new database rules.
- Jamzo Admin: Delivery partners (list, document review, approve/suspend, cash settings), Dispatch board, Delivery card with assign/take back on the order.
- Customer app: delivery partner's name, vehicle, location time and the delivery code. Restaurant Partner app: who collects the order and when they are at the counter.
- Road distance from Google Maps behind the admin setting Maps provider (off until the key exists; tested against a fake endpoint only).

### Changed
- Add-on prices get the same markup as items (Q-19); free add-ons stay free.
- Cancellation: rider compensation is paid only when a rider was engaged; new fee type "full amount" (OD-38).
- The "ready" status text for customers now says the food is waiting for a delivery partner.
- Decisions D-76 and D-79 corrected to what was built (delivery code derived, never stored; no customer ETA or maps link yet).

## Phase 5 — Orders (2026-09-25) — accepted

### Added
- `@jamzo/order-engine`: the ORDERS.md state machine (kitchen and delivery tracks, derived status, actor rules, cancellation stages and money), tested against a separately written table for every state × event × actor.
- Database: 12 tables (orders, items, add-ons, status history, frozen pricing snapshot, address copy, notes, cancellations, cancellation rules, coupon usages, notifications, templates); 2 migrations; 19 more database rules.
- Checkout (`POST /v1/orders`): cash on delivery and ₹0 orders (online payment is Phase 7), full re-pricing with `PRICE_CHANGED`, `CHECKOUT_BLOCKED` with reasons, frozen snapshot of every price component, coupon limits, double-tap safety.
- Restaurant order handling (seen, accept with prep time, reject, preparing, ready, +prep time, cancel), auto-accept, acceptance timeout with escalation to operations.
- Cancellations by customer, restaurant and admin with a versioned cancellation rule (placeholder amounts) and an audited admin override.
- Notifications from editable templates; console and Expo push providers (Expo not verified against the real service); realtime order notices over Socket.IO fed by PostgreSQL NOTIFY.
- API (+22 endpoints, 153 total).
- Jamzo Admin: Orders (list, views, search, detail, cancel, notes, needs attention), Cancellations tab in Pricing, Notifications, live order counts on the dashboard, recent orders on customers.
- Customer app: checkout, order tracking with live updates, cancel before acceptance, order list, active-order card on home.
- Restaurant Partner app: orders screen with a looping new-order alert (placeholder chime), accept/reject/preparing/ready, order detail with the restaurant's money.

### Changed
- Pricing engine: commission is also allocated per order line (largest remainder).
- `canCheckout` in the cart quote now reflects whether the order can be placed.
- Cancellation rule set by the owner (OD-38): customers may cancel after acceptance with no refund, Jamzo pays the restaurant its food value, and cash on delivery is switched off after 2 such cash-on-delivery cancellations (support can switch it back on).

## Phases 3 + 4 — Customer discovery & pricing (2026-09-25) — accepted

### Added
- `@jamzo/pricing-engine`: the full PRICING.md pipeline — markup with rounding, promotions and coupons with funding split, packaging, per-charge tax (inclusive/exclusive/exempt), delivery fee strategies with free-delivery threshold and small-order fee, night/demand/weather/manual surcharges with cap and kill switch, platform fee, tips, final rounding, commission and withholdings, restaurant payable, rider earning estimate, gateway cost estimate, and invariant checks (engine `2026.09-1`, D-49).
- Database: 15 tables (customer addresses, favourites, consents, home sections, banners, CMS pages, 7 versioned rule tables, coupons, promotions); 2 migrations; 34 more database rules including "one open version per rule target".
- API (+44 endpoints, 131 total): customer discovery (restaurants for a location, search, CMS home, restaurant menu with Jamzo prices), server cart quote, addresses/favourites/consents, published CMS pages; admin pricing rules with versions, history, stale-edit protection and surge kill switch, effective rules, preview and test quote, coupons, promotions, home sections, banners, pages, masked customers with an audited reveal.
- Distance: provider interface with a straight-line × road-factor fallback, clearly flagged (D-48).
- Jamzo Admin: Pricing (rules per type, new versions, history, test quote showing customer/restaurant/platform side), Offers & coupons, Home & content, Customers; restaurant Pricing tab and customer-price preview on products.
- Customer app: location (current / saved / development demo point), CMS home, search, restaurant menus, item customisation, cart with the server bill, coupons and tips, sign-in when needed, saved addresses, favourites, legal pages. Checkout is Phase 5.
- Seed: placeholder pricing rules, 2 coupons, 1 promotion, home layout, draft legal pages (A-23).

### Changed
- Settings `delivery.eta` and `payments.gatewayFees` added.
- Customer app: guests can browse (A-11); iOS asks only for "while using" location.

### Fixed
- `pnpm db:migrate` could not find the Prisma CLI with the hoisted pnpm layout (Phase 1 script bug); it now resolves the CLI through Node.

## Phase 2 — Restaurants & menus (2026-09-25) — accepted

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
