# BiteMitra — Master Build Specification

> This is the governing product/engineering specification supplied by the project owner.
> It is stored verbatim (formatting normalised to Markdown). Where engineering documents in
> `docs/` interpret or refine it, those documents reference the section number here.
> Part B (multi-app structure) is a mandatory addendum and takes precedence on repository layout.

---

# Part A — Food Delivery Platform: Master Build Specification

## 1. Role and objective

You are the lead architect, senior full-stack engineer, mobile engineer, QA engineer and DevOps engineer for this project.

Build a production-quality, scalable food-delivery marketplace initially launching in Unjha, Gujarat, India, but architected from day one to support:

- Multiple cities
- Multiple zones within cities
- Thousands of restaurants
- Large product/menu catalogs
- Large customer base
- Large rider network
- High concurrent order volume
- Multiple payment methods
- Multiple pricing models
- Future expansion across India

Do NOT build this as a temporary prototype. Build a clean, maintainable system that can evolve without major rewrites.

The platform consists of:

1. Customer mobile application
2. Restaurant mobile application
3. Rider mobile application
4. Super Admin web application
5. Shared backend/API
6. Shared database
7. Pricing engine
8. Order engine
9. Delivery/dispatch engine
10. Payment/settlement/ledger engine
11. Notification system
12. CMS/content management system
13. Analytics/reporting system

The experience should take inspiration from mature food-delivery platforms such as Zomato/Swiggy in terms of speed, usability and order flow, but DO NOT copy proprietary code, assets, branding or exact UI. The Admin experience should be clean and information-dense, inspired by modern Shopify Admin patterns.

## 2. Core principle: everything possible must be configurable

Avoid hard-coded business values. Administrators should be able to configure commercial and operational behavior without requiring a code deployment.

Examples: product markup, restaurant commission, GST/tax behavior, platform fees, delivery charges, minimum order, small-order fees, packaging charges, night charges, surge pricing, rider earnings, cancellation fees, refund rules, settlement periods, COD limits, restaurant radius, customer delivery radius, free-delivery thresholds, coupons, promotions, home-page sections, banners, images, categories, search ordering, restaurant ordering, product ordering, app text where appropriate, feature flags.

Use configuration hierarchy wherever applicable:

GLOBAL → COUNTRY → STATE → CITY → ZONE → RESTAURANT → CATEGORY → PRODUCT

The most-specific applicable override should win. Never modify historical orders when configuration changes. Every order must store an immutable pricing/configuration snapshot.

## 3. Monorepo architecture

Use one monorepo. Suggested structure:

```
food-platform/
  apps/        customer/ restaurant/ rider/ admin/
  services/    api/ workers/
  packages/    database/ pricing-engine/ order-engine/ dispatch-engine/ settlement-engine/
               shared-types/ validation/ auth/ notifications/ config/ ui/ logger/
  docs/        MASTER_SPEC.md ARCHITECTURE.md DATABASE.md API.md PRICING.md ORDERS.md
               PAYMENTS.md SETTLEMENTS.md DELIVERY.md SECURITY.md TESTING.md
               DEPLOYMENT.md CHANGELOG.md
```

Use workspace tooling suitable for a modern monorepo. Avoid unnecessary complexity, but keep clear boundaries between business domains.

## 4. Recommended technology

Unless there is a documented technical reason to change:

- Customer: React Native / Expo
- Restaurant: React Native / Expo
- Rider: React Native / Expo
- Admin: Next.js
- Admin UI: Shopify Polaris where technically appropriate, supplemented by custom accessible components when Polaris does not fit.
- Backend: Node.js
- Database: PostgreSQL
- ORM: Prisma or another mature strongly maintained ORM.
- Cache: Redis when required.
- Background processing: Queue-based worker architecture.
- Realtime: WebSockets or equivalent.
- Storage: S3-compatible object storage.
- Maps: Provider abstraction so Google Maps or another provider can be changed later.
- Push notifications: Firebase Cloud Messaging / APNs through an abstraction.
- Payments: Payment-provider abstraction. Do not tightly couple business logic to one gateway.
- Validation: Shared schemas between clients and API where practical.
- API: Versioned REST or another documented API architecture.

Use TypeScript throughout unless an existing project constraint makes that inappropriate.

## 5. Database requirements

Use UUIDs or similarly safe identifiers. Implement proper foreign keys, constraints and indexes.

Important entities include: Users, Customers, CustomerAddresses, Restaurants, RestaurantUsers, RestaurantBranches, RestaurantBusinessHours, RestaurantDocuments, RestaurantBankAccounts, RestaurantSettings, RestaurantZones, Categories, MenuCategories, Products, ProductVariants, ProductAddons, ProductAddonGroups, ProductImages, ProductAvailability, ProductSchedules, Cities, Zones, ServiceAreas, Riders, RiderDocuments, RiderVehicles, RiderAvailability, RiderLocations, RiderShifts, RiderEarnings, RiderPayouts, Orders, OrderItems, OrderItemAddons, OrderStatusHistory, OrderPricingSnapshot, OrderAddresses, OrderNotes, OrderAssignments, Payments, PaymentAttempts, Refunds, PaymentEvents, RestaurantLedgers, RestaurantLedgerEntries, RestaurantSettlements, RiderLedgers, RiderLedgerEntries, RiderSettlements, PlatformLedgerEntries, Coupons, Promotions, CouponUsage, DeliveryPricingRules, CommissionRules, MarkupRules, TaxRules, PlatformFeeRules, RiderEarningRules, SurgeRules, Reviews, SupportTickets, Notifications, CMSPages, HomeSections, Banners, Media, AuditLogs, AdminUsers, Roles, Permissions, FeatureFlags.

Do not store financial information using floating point. Use decimal/minor currency units safely.

## 6. Customer application

The customer application must feel extremely fast. Implement: splash/startup, authentication, guest browsing where allowed, phone/email authentication architecture, home, location/address selection, restaurant discovery, search, filters, categories, restaurant details, menu, product customization, add-ons, variants, cart, checkout, payment, COD, order confirmation, live order tracking, order history, reorder, favorites, saved addresses, coupons, offers, ratings/reviews, customer support, profile, notifications.

**Home page.** The home page must be CMS driven. Admin should be able to create/reorder/enable/disable sections. Examples: banner carousel, categories, top restaurants, popular near you, recommended, offers, new restaurants, free delivery, under ₹X, top-rated, cuisine collections, custom restaurant collection, custom product collection, image promotional section, text section.

Each section should support appropriate settings: title, subtitle, image, background, CTA, deep link, position, start/end date, city/zone targeting, customer targeting where appropriate, enabled/disabled.

Do not require an app update to change normal home-page content.

## 7. Restaurant listing

Cards should support: restaurant image, logo, name, cuisine, rating, ETA, distance, delivery fee, offer, vegetarian indicator, open/closed, promoted indicator where applicable.

Filters: cuisine, rating, delivery time, price, vegetarian, offers, distance, open now, free delivery.

Sorting configuration should be controlled by backend/admin.

## 8. Restaurant detail / menu

Support: restaurant header, images, rating, address, distance, ETA, offers, opening hours, restaurant information, menu categories, search within menu, veg/non-veg, bestseller, recommended, product images, variants, add-ons, customizations, quantity, availability, sold out, scheduled products, product descriptions, tax information where required.

Sticky cart behavior. Menu must remain performant even with large catalogs.

## 9. Cart

Cart calculations MUST come from the backend pricing engine. Never trust prices calculated only on the device.

Cart response should include: restaurant base subtotal, displayed food subtotal, markup, discount, restaurant discount, platform discount, packaging, tax/GST, delivery, platform fee, small-order fee, surge, night surcharge, other configured fees, tip if enabled, rounding adjustment, final payable.

Customer-facing presentation can hide internal commercial values such as restaurant commission.

## 10. Pricing engine

Build pricing as an independent business domain.

Support: fixed markup, percentage markup, restaurant-level markup, category-level markup, product-level markup, variant-level override if needed.

Example: Global markup = 5%, City = 7%, Restaurant = 10%, Specific product = 15%. Product override wins.

Support optional rounding rules: no rounding, nearest ₹1, nearest ₹5, nearest ₹10, custom psychological pricing if enabled.

Never mutate restaurant base price when applying customer markup.

Store `restaurant_base_price`, `customer_display_price`, `markup_type`, `markup_value`, `markup_amount` on order snapshots.

## 11. Restaurant commission

Commission must be independent from product markup.

Support: percentage, fixed, hybrid if enabled.

Configuration: global, city, zone, restaurant, potential category/product override for future use.

Example: Restaurant food value ₹500; commission 10%; platform commission ₹50; restaurant gross payable before other adjustments ₹450.

Keep commission calculation fully auditable.

## 12. GST / tax engine

Tax behavior MUST be configurable and isolated.

Support: tax-inclusive prices, tax-exclusive prices, tax-exempt items, different tax rates, restaurant-specific configuration, product-specific configuration where legally applicable.

Do NOT hard-code assumptions about Indian tax treatment into scattered application code. Keep tax rules centralized so rules can be changed after professional tax/legal review.

Invoices and settlement reports must show the required breakdown.

## 13. Platform fees

Admin can enable/disable platform fees.

Support: fixed, percentage, fixed + percentage, minimum, maximum.

Targeting: global, city, zone, restaurant. Allow scheduling.

## 14. Delivery pricing engine

Do not implement delivery as only distance × rate.

Support: base delivery charge, included distance, per-km amount, distance slabs, minimum delivery charge, maximum delivery charge, free delivery threshold, restaurant-specific delivery fee, zone-specific delivery fee, small-order surcharge, night surcharge, demand/surge surcharge, weather/manual surcharge, promotional free delivery.

Example: 0–2 km = ₹20; 2–4 km = ₹30; 4–6 km = ₹40. OR: base ₹15 includes 1 km; additional ₹7/km; minimum ₹20; maximum ₹80.

Admin selects strategy. Store exact rule used with every order.

## 15. Night / surge pricing

Support automatic scheduled rules.

Example — night surcharge: enabled yes; start 23:00; end 06:00; type percentage / fixed; value ₹10. Allow different configuration by city/zone.

Also support manual surge. Example: normal 1.0x; busy 1.2x; high demand 1.5x.

Admin must be able to enable/disable immediately. Customer must see applicable customer-facing charges before payment.

## 16. Rider earning engine

Customer delivery charge and rider earning MUST be separate calculations. Example: customer delivery charge = ₹40; rider earning = ₹28.

Support rider earning based on: base amount, pickup distance, delivery distance, total distance, per-km rate, distance slabs, minimum earning, waiting time, night incentive, peak incentive, rain/manual incentive, batch delivery, bonus, manual adjustment.

Admin should control these independently.

## 17. Checkout

Checkout should include: delivery address, address validation, restaurant availability check, item availability revalidation, price revalidation, coupon, payment method, COD, online payment, delivery instructions, restaurant instructions, tip if enabled, contactless delivery option if enabled, complete bill breakdown.

Immediately before order creation, backend must recalculate everything. Never trust cart totals sent by client.

## 18. Order state machine

Use an explicit order state machine.

Possible states: CREATED, PAYMENT_PENDING, PAYMENT_CONFIRMED, PLACED, RESTAURANT_NOTIFIED, RESTAURANT_ACCEPTED, RESTAURANT_REJECTED, PREPARING, READY_FOR_PICKUP, RIDER_SEARCHING, RIDER_ASSIGNED, RIDER_ACCEPTED, RIDER_AT_RESTAURANT, PICKED_UP, ON_THE_WAY, ARRIVED, DELIVERED.

Cancellation states: CUSTOMER_CANCELLED, RESTAURANT_CANCELLED, RIDER_ISSUE, ADMIN_CANCELLED.

Financial states: REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED.

Do not allow invalid transitions. Store status, timestamp, actor, reason, metadata for every transition.

## 19. Restaurant application

Restaurant app should support: login, dashboard, new-order alerts, loud/repeating order notification, accept, reject, set preparation time, preparing, ready, order history, order details, customer instructions, rider details after assignment, menu, products, variants, add-ons, availability, sold-out toggle, opening/closing, temporary pause, busy mode, preparation-time adjustment, offers, analytics, earnings, commission, settlements, settlement history, support, restaurant profile.

Restaurant should clearly see: food value, applicable restaurant-funded discounts, commission, adjustments, net payable. Do not expose unnecessary platform internal margins.

## 20. Restaurant order experience

Incoming orders must be difficult to miss.

Display: order number, items, quantities, customizations, customer notes, amount, payment status, estimated pickup, accept/reject controls.

Restaurant acceptance timeout should be configurable. If timeout occurs, execute configured fallback.

## 21. Rider application

Implement: authentication, KYC/document status, online/offline, current location, availability, incoming delivery request, accept/reject, pickup navigation, restaurant details, order verification, pickup confirmation, customer navigation, customer call/contact abstraction, delivery OTP if enabled, proof of delivery if enabled, delivered, daily earnings, weekly earnings, incentives, COD balance, settlement, payout history, support, issue reporting.

Rider should NOT see unnecessary platform/restaurant financial data.

## 22. Rider assignment engine

Build dispatch as an independent service/domain.

Initial algorithm may consider: online status, availability, distance to restaurant, current active orders, zone, vehicle, COD eligibility, rider acceptance history if legally/operationally appropriate, restaurant preparation time.

Support: automatic assignment, manual admin assignment, reassignment, rider timeout, rider rejection, no-rider-found escalation.

Do not permanently couple the architecture to the first assignment algorithm.

## 23. COD

COD needs proper accounting.

Track: order COD amount, rider who collected, collection timestamp, rider COD balance, cash submitted, settlement reference, outstanding COD.

Admin can configure: rider COD limit, disable COD for rider, disable COD for customer, disable COD by zone/restaurant/order amount, maximum COD order value.

Never treat COD as normal platform cash until properly reconciled.

## 24. Payment system

Implement payment provider abstraction.

Support: online payment, UPI, cards, wallet/provider-supported methods, COD.

Architecture must handle: payment initiated, pending, success, failed, expired, duplicate callback, webhook retry, refund, partial refund, payment reconciliation.

Payment webhook processing must be idempotent. Never mark an order paid only because the client says payment succeeded.

## 25. Restaurant settlements

Maintain a proper restaurant ledger.

Entries can include: food sales, commission, restaurant-funded discount, platform-funded discount, tax adjustments, refund, cancellation, penalty if applicable, manual credit, manual debit, settlement.

Support settlement schedules: daily, T+1, T+2, weekly, manual. Admin can configure per restaurant.

Restaurant app shows: opening balance, orders, deductions, adjustments, settled, pending, next settlement.

Generate downloadable statements.

## 26. Rider settlements

Rider ledger includes: delivery earning, distance earning, waiting charge, incentive, bonus, tip allocation, adjustment, COD collected, COD submitted, payout.

Display: today earnings, pending payout, COD held, amount rider owes platform, amount platform owes rider.

Make settlement logic deterministic and auditable.

## 27. Immutable order financial snapshot

This is mandatory. When an order is placed, store all applied values.

For each item/order store as applicable: restaurant base price, displayed price, markup %, markup amount, GST/tax rate, tax amount, commission %, commission amount, packaging, delivery rule, delivery amount, platform fee, small-order fee, night surcharge, surge, coupon, coupon funding source, rider earning calculation, restaurant payable, platform revenue components.

Changing admin settings tomorrow MUST NOT alter yesterday's order.

## 28. Admin application

Build admin in Next.js. Use Shopify Polaris patterns/components where appropriate.

Admin should feel similar in quality to a modern commerce operations dashboard: persistent navigation, fast tables, saved views, search, filtering, bulk actions, pagination, responsive layouts, clear status badges, contextual actions, drawers/modals where appropriate.

Primary navigation: Home, Orders, Restaurants, Products, Customers, Riders, Deliveries, Payments, Settlements, Promotions, Content, Analytics, Reports, Cities & Zones, Configuration, Users & Permissions, Audit Logs.

## 29. Admin orders page

This is one of the most important screens.

Table columns: order, date/time, customer, restaurant, items, total, payment, restaurant status, delivery status, rider, city/zone, settlement status.

Filters: date, order status, restaurant, customer, rider, payment method, payment status, COD/online, city, zone, settlement status, delivery status, amount, refund status.

Support search by order ID, customer name, phone, restaurant, rider. Saved filter views. Bulk operations where safe.

## 30. Admin order detail

Order detail should be extremely comprehensive.

Sections: order summary, customer, address, restaurant, products, variants, add-ons, notes, payment, delivery, rider, timeline, refund, settlement, internal notes, audit trail.

Financial section: restaurant base subtotal, customer food subtotal, markup revenue, tax, restaurant commission, packaging, delivery charged, rider cost, delivery margin, platform fee, small-order fee, night surcharge, surge, discount, restaurant-funded discount, platform-funded discount, gateway cost if available, restaurant payable, rider payable, platform gross revenue, estimated/actual contribution.

Admin must understand exactly where every rupee went.

## 31. Products admin

Create Shopify-like product management.

Support: product title, description, images, restaurant, menu category, food category, base price, customer/display price preview, markup, tax, variants, add-ons, veg/non-veg, availability, schedules, inventory/quantity where applicable, preparation time, bestseller, featured, status.

Bulk editor. Bulk enable/disable. Bulk price update. CSV import/export eventually.

## 32. Restaurant admin

Restaurant detail should contain: overview, orders, menu, financials, commission, pricing, delivery, settlement, offers, documents, users, operating hours, service area, analytics, settings, audit history.

Allow overrides without modifying global defaults. Clearly show "Using global setting" versus "Custom override" and allow "Reset to inherited value".

## 33. CMS / content management

I must be able to customize application content without development.

Build media library. Admin can upload/manage: banners, restaurant images, product images, category icons, promotional images, home-section images.

Home page builder should allow: create section, choose section type, configure content, upload/select image, choose target, reorder using drag/drop, enable/disable, schedule, preview.

Support city-specific content. Example: Unjha users can see different banners than Ahmedabad users in future.

## 34. Promotions / coupons

Support: fixed discount, percentage, free delivery, restaurant-specific, category-specific, product-specific, first order, minimum order, maximum discount, usage limit, per-user limit, start/end, city/zone, payment-method targeting if needed.

Funding source: PLATFORM, RESTAURANT, SHARED. For shared funding, support percentage allocation. Store funding snapshot with order.

## 35. Cancellations

Configurable cancellation rules. Different rules depending on: before restaurant accepts, after restaurant accepts, after preparation begins, after rider pickup.

Record: who cancelled, reason, refund, restaurant compensation, rider compensation, platform loss.

Admin can override with audit trail.

## 36. Refunds

Support: full refund, partial refund, item refund, delivery refund, platform fee refund, manual adjustment.

Every refund must reference: order, payment, amount, reason, actor, gateway reference, timestamp.

Prevent accidental duplicate refunds.

## 37. Service areas

Architecture: Country → State → City → Zone → Service area. Support polygons/radius as appropriate.

Restaurant delivery availability should depend on service rules. Do not hard-code Unjha. Initial city: Unjha, Gujarat, India, but architecture must support unlimited future cities.

## 38. Search

Customer search should support: restaurant, dish, cuisine, category.

Design search abstraction so implementation can begin with PostgreSQL search and later move to a dedicated search engine without rewriting apps.

Support: recent searches, popular searches, suggestions, typo tolerance when search engine supports it.

## 39. Performance

Performance is a first-class requirement.

Customer app must: start quickly, avoid unnecessary API requests, use pagination, cache intelligently, optimize images, use thumbnails, lazy load, prefetch useful data, avoid blocking UI, use skeleton loaders, handle poor mobile networks, avoid excessive re-rendering.

Backend: indexes, pagination, query optimization, caching, connection pooling, background workers, rate limiting, avoid N+1 queries.

Admin tables must handle large datasets. Test realistic data volumes.

## 40. Offline / bad network handling

India/mobile-network conditions must be considered.

Handle: slow connection, temporary disconnection, API timeout, duplicate button taps, payment callback delay, restaurant app reconnect, rider reconnect.

Never create duplicate orders because user tapped twice. Use idempotency keys where appropriate.

## 41. Notifications

Central notification service.

Channels: push, email, SMS/WhatsApp architecture for future integration.

Events: order placed, restaurant accepted, restaurant rejected, preparing, rider assigned, picked up, arriving, delivered, cancelled, refund, settlement, promotions.

Templates should be admin configurable where safe.

## 42. Role-based access control

Admin roles: Super Admin, Operations, Finance, Restaurant Manager, Rider Manager, Support, Marketing, Content Manager.

Granular permissions: view orders, edit orders, refund, manage settlements, manage restaurants, manage riders, change pricing, change commissions, manage CMS, view reports, manage admins.

Never rely solely on frontend permission hiding. Enforce permissions in backend.

## 43. Audit log

Record important admin/business changes.

Store: actor, action, entity, old value, new value, timestamp, IP/device metadata where appropriate.

Examples: commission changed 10% → 12%; restaurant bank account changed; order manually cancelled; ₹500 refund issued; rider payout adjusted; surge enabled.

Financial/admin changes must be traceable.

## 44. Analytics

Admin dashboard should eventually show: orders today, GMV, net platform revenue, average order value, completed orders, cancelled orders, refunds, active restaurants, active riders, online riders, average delivery time, average preparation time.

Break down by: date, city, zone, restaurant, payment method.

Do not block core ordering functionality on advanced analytics.

## 45. Restaurant analytics

Restaurant sees only its own information: orders, sales, average order value, top products, cancelled orders, commission, discounts, net settlement, busy hours.

## 46. Rider analytics

Rider sees: trips, distance, earnings, tips, incentives, COD, online hours, acceptance/completion information where appropriate.

## 47. Customer support

Build support architecture.

Order-related issue types: missing item, wrong item, food quality, late delivery, rider issue, restaurant issue, payment issue, refund issue, other.

Admin support screen should show full order context.

## 48. Security

Follow secure production practices.

Mandatory: password hashing, OTP security, JWT/session security, refresh token handling, RBAC, input validation, SQL injection protection, XSS protection, CSRF where relevant, rate limiting, brute-force protection, secure headers, secrets in environment variables, webhook signature validation, payment idempotency, sensitive-field protection, safe logging.

Never store raw card numbers or CVV. Do not log secrets or authentication tokens.

## 49. Privacy

Design for: account deletion, address deletion, data export architecture, consent records, notification preferences.

Do not expose customer phone/address unnecessarily.

## 50. Observability

Implement structured logging. Production errors should be diagnosable.

Track request ID, order ID, payment ID, restaurant ID, rider ID where relevant.

Architecture should support error monitoring and performance monitoring.

## 51. Feature flags

Implement feature flags. Examples: COD, tips, ratings, scheduled orders, free delivery, night pricing, surge, restaurant self-edit menu, rider batching.

Allow controlled rollout without deployments where practical.

## 52. Environments

Maintain: development, test, staging, production.

Never use production payment credentials in development. Provide `.env.example`. Do not commit secrets.

## 53. Seed data

Create realistic development seed data. Include: 1+ city, multiple zones, 10+ restaurants, multiple cuisines, 100+ products, variants, add-ons, 20+ customers, 10+ riders, orders in every important status, COD orders, online orders, cancelled orders, refunded orders, settled/unsettled orders.

This is required for meaningful testing.

## 54. Automated testing — mandatory

Do not consider a feature finished because it compiles. Every important business feature requires tests.

Use: unit tests, integration tests, API tests, component tests, end-to-end tests where practical.

Highest priority: pricing, commission, GST/tax, delivery, surcharges, coupons, restaurant payable, rider payable, COD, settlement, refund, cancellation, payment idempotency, order state transitions, permissions.

## 55. Pricing test matrix

Test examples such as: no markup, global markup, restaurant override, product override, inclusive GST, exclusive GST, no platform fee, fixed platform fee, percentage platform fee, minimum platform fee, 0 km, 1 km, 2 km, 2.1 km, maximum distance, night boundary, surge, coupon, free delivery, restaurant discount, platform discount, shared discount, small order, large order.

Test combinations, not only individual rules.

## 56. Order end-to-end tests

Automate scenarios: customer places online order; restaurant accepts; rider assigned; rider accepts; restaurant prepares; rider picks up; rider delivers; settlement generated.

Also: restaurant rejects, rider rejects, no rider available, customer cancels before acceptance, customer cancels after acceptance, payment fails, payment succeeds but callback delayed, duplicate payment webhook, restaurant goes offline, rider loses internet, COD delivery, COD cancellation, full refund, partial refund, coupon order, night order, surge order, product becomes unavailable during checkout, restaurant closes during checkout, price changes while cart is open.

## 57. Claude must test its own work

Do not ask the project owner to manually discover basic defects.

After every implementation phase:

1. Install dependencies.
2. Run linting.
3. Run type checking.
4. Run unit tests.
5. Run integration tests.
6. Run relevant E2E tests.
7. Build affected applications.
8. Review logs.
9. Fix failures.
10. Repeat until passing.

Never claim something is complete without actually running the applicable checks.

If something cannot be tested automatically, explicitly document: WHAT WAS NOT TESTED, WHY, HOW THE OWNER CAN TEST IT. Do not silently skip testing.

## 58. Do not hide errors

Do not: disable TypeScript checks, ignore lint errors broadly, delete failing tests, replace real implementation with fake mocks merely to pass tests, catch and ignore errors, hard-code expected test results. Fix root causes.

## 59. UI quality

Do not create generic developer-looking screens. Customer app should feel like a premium consumer application.

Prioritize: whitespace, typography, touch targets, skeleton loading, animations used carefully, responsive interaction, bottom sheets, clear CTAs, fast feedback, empty states, error states, loading states.

Restaurant/rider apps prioritize speed and operational clarity. Admin prioritizes information density and usability.

## 60. Accessibility

Use: accessible labels, keyboard navigation in admin, appropriate contrast, screen-reader-friendly controls, logical focus order, large enough touch targets.

## 61. Design system

Create shared design tokens: typography, spacing, radius, elevation, icon sizing, semantic colors, status colors. Do not scatter arbitrary values throughout applications.

Customer/restaurant/rider can share foundations while maintaining role-appropriate experiences.

## 62. Images

Create a centralized media system. Admin should be able to: upload, replace, delete, search, reuse, add alt text, choose image, crop where practical. Generate/use optimized image sizes. Do not send giant original images to every mobile screen.

## 63. Configuration history

For critical settings, preserve change history. Examples: commission, markup, delivery, rider earnings, tax, settlement. Display: previous value, new value, changed by, changed at.

## 64. Admin settings

Organize settings into logical sections: general, business, cities, zones, orders, restaurants, products, pricing, commission, taxes, delivery, riders, payments, COD, settlements, notifications, promotions, CMS, customer, security, feature flags.

Provide search within settings if configuration becomes large.

## 65. Configuration preview

Where possible, admin should preview financial effects before saving.

Example: Restaurant ABC Pizza; item base price ₹100; markup 10% → customer ₹110; commission 12% → ₹12; restaurant payable preview → ₹88.

This reduces configuration mistakes.

## 66. Admin dashboard operations

Show operational alerts: orders waiting for restaurant, orders without rider, late orders, payment problems, high COD balance, failed settlement, restaurants offline unexpectedly, riders unavailable, refund pending.

These are more useful than decorative charts.

## 67. Manual admin controls

Admin needs emergency operational controls: assign rider, reassign rider, cancel order, refund, mark payment after verified reconciliation, adjust restaurant ledger, adjust rider ledger, pause restaurant, disable product, disable COD, change delivery zone, enable surge.

Dangerous actions require confirmation and audit logging.

## 68. Database transactions

Financial/order operations requiring atomicity must use database transactions. Example: order creation, payment capture processing, ledger creation, settlement, refund. Avoid partial financial state.

## 69. Concurrency

Protect against: two riders accepting same assignment, two refunds, duplicate orders, duplicate settlement, inventory/availability race, duplicate webhook. Use database constraints, locks/idempotency where appropriate.

## 70. API documentation

Document every API. Include: endpoint, authentication, permission, request, response, validation, errors. Keep API docs synchronized with implementation.

## 71. Error format

Use standardized API errors. Example concepts: `code`, `message`, `fieldErrors`, `requestId`. Do not expose stack traces to production clients.

## 72. Versioning

Design API compatibility so deployed mobile apps do not immediately break when backend changes. Support minimum supported app version and forced-update configuration.

Admin can configure: minimum Android version, minimum iOS version, recommended version, force update.

## 73. App configuration

Remote configuration should support appropriate UI/operational settings: maintenance mode, home configuration, feature flags, minimum version, support number, service availability, COD availability.

Avoid requiring App Store/Play Store releases for normal business configuration.

## 74. Restaurant onboarding

Admin workflow: create restaurant, business details, contact, address, map location, FSSAI/document details, tax details, bank details, commission, markup, settlement, delivery, operating hours, menu, images, review, activate.

Onboarding status: DRAFT, DOCUMENTS_PENDING, REVIEW, APPROVED, ACTIVE, SUSPENDED.

## 75. Rider onboarding

Workflow: personal details, phone, photo, address, vehicle, documents, bank/UPI, service zone, verification, activation.

Status: APPLIED, DOCUMENT_PENDING, UNDER_REVIEW, ACTIVE, SUSPENDED, REJECTED.

## 76. Future-ready architecture

Do not necessarily implement these now, but avoid architecture that prevents: scheduled delivery, pickup orders, grocery, multiple restaurant branches, restaurant chains, subscriptions, membership, wallet, referral program, ads/promoted restaurants, sponsored products, corporate accounts, multi-language, multiple currencies, multiple countries, AI recommendations, advanced dispatch, rider batching.

Use interfaces/abstractions where they provide genuine future value.

## 77. Do not overengineer

Future-ready does NOT mean implementing everything now. Prefer a clear modular monolith initially over premature microservices. Business domains should be separated so they can be extracted later if scale requires it.

## 78. Implementation phases

Do NOT attempt everything simultaneously.

- **Phase 0 — Architecture.** Before coding: inspect existing repository. Create/update ARCHITECTURE.md, DATABASE.md, PRICING.md, ORDER_FLOW.md, SETTLEMENTS.md, TESTING.md. Define database schema. Define API conventions. Define state machine. Define pricing precedence. Identify assumptions/questions. Do not destroy existing working code unnecessarily.
- **Phase 1 — Foundation.** Monorepo, database, authentication, RBAC, shared types, validation, logging, configuration, cities/zones, media. Test everything.
- **Phase 2 — Restaurant/Menu.** Restaurant management, categories, products, variants, add-ons, availability, admin UI. Test.
- **Phase 3 — Customer Discovery.** Customer auth, location, home CMS, restaurant listing, search, restaurant detail, menu, cart. Test.
- **Phase 4 — Pricing.** Markup, tax, platform fee, delivery, night fee, surge, coupons. Build comprehensive automated tests before proceeding.
- **Phase 5 — Orders.** Checkout, order creation, restaurant acceptance, order state machine, restaurant app. Test complete lifecycle.
- **Phase 6 — Riders.** Rider app, location, assignment, pickup, delivery, COD. Test.
- **Phase 7 — Payments.** Gateway integration, webhooks, refund, reconciliation, idempotency. Test thoroughly.
- **Phase 8 — Financials.** Restaurant ledger, rider ledger, platform ledger, settlements, statements. Test every financial scenario.
- **Phase 9 — Admin Operations.** Advanced order management, filters, saved views, bulk operations, analytics, support, audit logs.
- **Phase 10 — Production Hardening.** Performance, security, load tests, failure tests, mobile optimization, monitoring, backups, deployment documentation.

## 79. Working method

For each phase:

1. Review specification.
2. Inspect existing code.
3. Write implementation plan.
4. Identify database migrations.
5. Implement backend.
6. Implement UI.
7. Add tests.
8. Run tests.
9. Run builds.
10. Fix errors.
11. Update documentation.
12. Give concise completion report.

Do not repeatedly ask the owner questions that can safely be handled with sensible architecture/configurable defaults.

If an assumption affects money, tax, legal compliance, irreversible architecture or production credentials, STOP and ask. Otherwise implement a sensible configurable default and document it.

## 80. Existing code

If files already exist: DO NOT blindly regenerate the repository. First inspect package.json, workspace configuration, apps, packages, database, environment setup, existing documentation. Preserve good existing work. Refactor when justified. Never delete substantial working functionality without explaining why.

## 81. Definition of done

A feature is NOT complete merely because UI exists. A feature is complete when: backend works, database supports it, permissions work, validation works, loading state exists, empty state exists, error state exists, mobile/responsive behavior works, audit logging exists where needed, tests exist, tests pass, typecheck passes, lint passes, build passes, documentation updated.

## 82. Financial accuracy

Financial correctness is more important than UI convenience. Every amount must be explainable.

Given an order ID, Admin must be able to answer: What did customer pay? What was restaurant's base food value? What markup was applied? What tax was applied? What discount was applied? Who funded the discount? What commission did platform earn? What delivery fee did customer pay? What did rider earn? What does restaurant receive? What does rider receive? What did payment gateway charge? What was refunded? What remains for platform?

Never create a financial calculation that cannot be reconstructed later.

## 83. Final requirement

Build this platform as if it will start small in Unjha but could eventually operate across many cities.

Priorities, in order:

1. Financial correctness
2. Order reliability
3. Configuration flexibility
4. Security
5. Customer speed
6. Operational usability
7. Maintainability
8. Scalability
9. Visual polish

Do not sacrifice the first four to make screens look finished.

Before beginning implementation, inspect the complete repository and this specification. Then: (1) report the proposed architecture; (2) report assumptions; (3) identify any critical missing decisions; (4) create the documentation; (5) establish the monorepo/foundation; (6) begin Phase 1; (7) test your own implementation before reporting completion.

Continue phase-by-phase rather than generating disconnected demo screens.

---

# Part B — Mandatory multi-app structure (addendum)

This project MUST contain three completely separate mobile applications. They are NOT three user roles inside one mobile application. They must be independently buildable, deployable, versioned and published applications.

## B1. Customer app — `apps/customer/`

Food ordering application for customers. Must support Android and iOS. It must generate its own: Android application/package ID, iOS bundle identifier, app icon, splash screen, App Store / Play Store build, environment configuration, version number, release process. Example identifier: `com.platform.customer`.

## B2. Restaurant app — `apps/restaurant/`

Restaurant owners/managers use this application to receive and manage orders. Must support Android and iOS. It must be a completely separate application from the customer app, with its own: Android package ID, iOS bundle identifier, app icon, splash screen, push notification configuration, build configuration, versioning, store release. Example: `com.platform.restaurant`.

## B3. Rider app — `apps/rider/`

Delivery partners use this application to accept deliveries, navigate, update delivery status, manage COD and view earnings. Must support Android and iOS, with its own: Android package ID, iOS bundle identifier, app icon, splash screen, location permissions, background location configuration, push notifications, build configuration, versioning, store release. Example: `com.platform.rider`.

## B4. Admin application — `apps/admin/`

Admin is NOT a mobile application. Build it as a responsive Next.js web application. Use Shopify Polaris for the administration UI wherever practical. It must work properly on desktop, laptop, tablet and mobile browser. Desktop should be the primary admin experience.

## B5. Backend — `services/api/`

Backend must be separate from all applications. All three mobile apps and the admin communicate with the SAME backend/API. Never implement authoritative business calculations separately in each mobile application.

## B6. Required root structure

```
food-delivery-platform/
  apps/
    customer/    src/ assets/ app.json package.json
    restaurant/  src/ assets/ app.json package.json
    rider/       src/ assets/ app.json package.json
    admin/       src/ public/ package.json
  services/
    api/
    workers/
  packages/
    database/ pricing-engine/ order-engine/ delivery-engine/ settlement-engine/
    shared-types/ validation/ config/ ui/
  docs/
    MASTER_SPEC.md ARCHITECTURE.md DATABASE.md API.md PRICING.md ORDERS.md
    DELIVERY.md PAYMENTS.md SETTLEMENTS.md TESTING.md
  package.json
```

## B7. Mobile cross-platform requirement

Use React Native with Expo unless there is a documented technical reason not to. ONE customer codebase → Android + iOS customer apps. ONE restaurant codebase → Android + iOS restaurant apps. ONE rider codebase → Android + iOS rider apps. Do NOT create separate Android and iOS application source projects unless a native requirement makes that necessary. Platform-specific implementations may be used where required.

## B8. Platform testing

Claude must not test only one platform. For every mobile application verify: Android build, iOS build/configuration, navigation, authentication, API communication, push-notification configuration, deep links, permissions, image handling, loading/error states, responsive layouts, keyboard handling, safe areas, different screen sizes.

Rider app additionally requires verification of: foreground location, background location, location permissions, navigation/map integration, app background/foreground transitions, interrupted network connection, location recovery.

Platform-specific code must be isolated and documented.

## B9. Shared code

Share code only where it makes sense. Good candidates: `packages/shared-types/`, `packages/validation/`, `packages/config/`. Potentially shared: `packages/mobile-ui/`. However, DO NOT turn the three mobile applications into one giant application simply for code reuse. Customer, Restaurant and Rider applications must remain independently deployable products.

## B10. Independent releases

It must be possible to release Customer v1.5.0 while Restaurant remains v1.2.0 and Rider remains v1.3.0. Updating one application must NOT require publishing the other two applications. Backend APIs must therefore maintain compatibility with supported mobile versions.

## B11. Final architectural rule

There are FOUR frontend products: (1) Customer — React Native — Android + iOS; (2) Restaurant — React Native — Android + iOS; (3) Rider — React Native — Android + iOS; (4) Admin — Next.js Web. And shared platform infrastructure: (5) Backend API; (6) Database; (7) Workers/background jobs; (8) Shared business engines/packages. Treat these as separate applications inside ONE monorepo.

---

# Part C — Owner directives (2026-09-24)

These directives were issued by the owner after Parts A and B and **override** them where they conflict.

1. Read this specification completely; inspect the entire repository; start with **Phase 0 only**. Do not build UI screens yet.
2. Phase 0 must establish: architecture, monorepo structure, database design, pricing hierarchy, order state machine, payment/COD flows, restaurant and rider settlement models, RBAC, testing strategy and documentation.
3. **JavaScript only — absolutely no TypeScript or `.ts/.tsx` files in project source code.** This is the "existing project constraint" contemplated by §4, and it supersedes §4's TypeScript recommendation and §58's reference to "TypeScript checks" (interpreted as: do not disable lint/validation/tests).
4. Admin must use Next.js, with Shopify Polaris wherever practical.
5. Customer, Restaurant and Rider are three separate React Native applications, each supporting Android and iOS.
6. Everything reasonably possible must be configurable through Admin.
7. Financial/business calculations must be authoritative on the backend.
8. Do not claim functionality is working unless it has actually been tested.
9. After Phase 0, report: what was created, architecture decisions, database approach, assumptions, critical questions requiring the owner's decision, and the recommended Phase 1 scope. **Do not begin Phase 1 until Phase 0 has been reviewed.**
