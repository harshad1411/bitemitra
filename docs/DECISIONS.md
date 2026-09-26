# Decisions, assumptions & open questions

**This file is the authoritative record of architectural and business decisions** (owner directive
OD-30). Other documents describe *how*; this file records *what was decided, by whom, and why*.

- **OD-n** — owner decisions (binding; changed only by the owner).
- **D-n** — engineering decisions (made by the build team within the owner's rules; revisable).
- **A-n** — assumptions: configurable defaults, safe to change.
- **Q-n** — questions only the owner (or their CA/lawyer) can answer.
- **CH-n** — changes from MASTER_SPEC, with approval status.

Last updated: 2026-09-26 (brand kit, fonts and the new app look — OD-44).

---

## 1. Owner decisions (Phase 0 approval, 2026-09-24)

| # | Decision |
|---|---|
| OD-1 | **JavaScript only.** Source files are `.js` / `.jsx` / `.mjs`; never `.ts` / `.tsx`. The TypeScript compiler **may** be used purely as a static checker of JavaScript (JSDoc + `checkJs`). No gradual migration to TypeScript without explicit owner approval. |
| OD-2 | **Admin UI:** Shopify-Admin-level quality and density, but not blindly Polaris. Verify Polaris licensing/maintenance; if any concern → Next.js + JavaScript + Tailwind CSS + shadcn/ui (or another maintained MIT system) with Jamzo's own design system. Shopify-inspired *UX patterns* allowed; no Shopify branding/assets/lookalike UI. → outcome **D-12**. |
| OD-3 | **Brand: Jamzo**, domain **jamzo.in**. Proposed identifiers `in.jamzo.customer`, `in.jamzo.restaurant`, `in.jamzo.rider`. Identifiers centralised, never scattered. **No production store publication during development.** |
| OD-4 | Four independent frontends: Customer app, Restaurant Partner app, Delivery Partner app (Expo, Android + iOS each) and Jamzo Admin (Next.js). Independent ids, icons, splash, versions, build config, release process, push config. Shared code only in packages. Never one combined mobile app. |
| OD-5 | Backend: Node.js + Fastify + PostgreSQL + Prisma 6, **modular monolith**, no premature microservices. Workers separately runnable. |
| OD-6 | **Multi-city is mandatory.** Unjha is the first city, not a platform assumption. Hierarchy Country → State → City → Service Zone → Restaurant → Restaurant Branch → Delivery Area. Cities/zones can differ in delivery charges, minimum order, commission, platform fee, distance rules, rider payouts, surge, taxes, operating hours, promotions, serviceability, payment options. |
| OD-7 | **Configuration-first.** Business rules are centrally managed, versioned configuration; admin-controllable over time; old orders stay reproducible. |
| OD-8 | **Pricing:** restaurant-level markup + item-level override (item wins); full pipeline incl. discounts by funding source, fees, tips, rounding. Complete frozen financial snapshot per order. **Markup disclosure behaviour is configurable**, not hard-coded, pending legal confirmation. |
| OD-9 | **Tax (GST/TCS/TDS/invoice ownership) is configurable and must not be guessed.** CA/legal items are marked; they do not block development but **must be resolved before production financial launch**. |
| OD-10 | Discounts: platform / restaurant / shared funding. **Commission basis (pre- vs post-discount) is configurable**, not assumed. Snapshot shows original item total, markup, discount, funding source, commission basis + amount, taxes, fees, restaurant payable, rider payable, platform amount. |
| OD-11 | **Payments:** provider abstraction; **Razorpay first**; payments and orders are separate concepts; webhook idempotency; server-side verification only. |
| OD-12 | **COD** required architecturally (enable/disable per city later) with a proper COD ledger and reconciliation (collected, pending, rider liability, deposits, adjustments, shortages/excess, history). Never "payment_status = paid". |
| OD-13 | **Authentication is provider-based:** phone OTP, email OTP, Google, Apple; methods enable/disable by configuration. SMS provider behind an interface (DLT provider chosen later — does not block Phase 1). **Authenticating never implies an approved restaurant or rider**; approval status is checked separately. |
| OD-14 | **Distance:** route/road distance is the normal source for delivery fees and rider distance; maps provider abstracted; explicit configurable fallback; distance frozen in the order snapshot. |
| OD-15 | **Tips:** default 100% to the delivery partner, allocation configurable, tips separate in financial records and ledgers, never platform revenue. |
| OD-16 | **Rounding** configurable and always shown explicitly as a rounding adjustment line. |
| OD-17 | Separate kitchen and delivery tracks; kitchen states like NEW, ACCEPTED, PREPARING, READY_FOR_PICKUP, COMPLETED with rejection/cancellation paths; dispatch may start while food is being prepared. |
| OD-18 | Dispatch is its own module; two riders must never own the same active assignment (keep DB-level protection). |
| OD-19 | Transactional outbox / reliable events; retries safe; idempotency at API, business and DB levels. |
| OD-20 | Classify every table CORE / LATER PHASE / FUTURE with its reason; migrate only what the implemented functionality needs; keep the long-term design; money = integer paise, percentages = basis points, no floats. |
| OD-21 | Append-only, immutable ledgers (restaurant, rider, platform); corrections are new reversal/adjustment entries. |
| OD-22 | Restaurant settlement default **weekly**, configurable; no real payouts in Phase 1. |
| OD-23 | Rider earnings separate from restaurant settlement (base, distance, waiting, surge/incentive, tips, COD adjustment, penalties where legal, payout status); amounts are placeholders. |
| OD-24 | RBAC enforced server-side; roles: Super Admin, Admin, Operations, City Manager, Support, Finance, Restaurant Owner, Restaurant Manager, Restaurant Staff, Rider, Customer; audit logs for admin/financial/config actions; no committed secrets. |
| OD-25 | Phase 1 admin: login, dashboard shell, navigation, users, roles, permissions, cities, zones, configuration/settings, media, audit basics — built to host future modules; server-side pagination/filtering. |
| OD-26 | Phase 1 mobile foundations in all three apps: auth, secure token storage, API client, env config, version check, forced/optional update, remote config, push registration, deep linking, network/offline state, error handling, loading states, app lifecycle, logging, analytics abstraction. **No fake screens.** |
| OD-27 | Performance first; pagination; indexes; no N+1; cache only where justified; **Redis only where actually needed, documented**; never trade correctness for caching. |
| OD-28 | Testing mandatory against a real PostgreSQL-compatible engine; never claim "tested"/"working" without executing tests. |
| OD-29 | Phase 1 scope as proposed (tooling, env, shared packages, DB, API, three mobile shells, admin). **Stop before Phase 2.** |
| OD-30 | Docs stay in sync; deviations are documented (what/why/consequence/needs approval?); DECISIONS.md is authoritative. |
| OD-31 | Cloud-agnostic; easy local development; no expensive infrastructure before traffic. |
| OD-32 | Design for growth; no premature distributed systems. |
| OD-33 | **No fake completeness:** placeholders, mocks, simulations, unconnected or untested pieces are labelled explicitly. |
| OD-34 | Detailed Phase 1 completion report (22 items), then stop. |
| OD-35 | **Phase 1 accepted; start Phase 2** (owner, 2026-09-24: "now start phase 2"). Phase 2 = MASTER_SPEC §82 "Restaurant/Menu": restaurant management, categories, products, variants, add-ons, availability, admin UI, tests. The same working rules apply (docs first, JavaScript only, no fake completeness, stop for review after the phase). Items that asked for explicit approval in Phase 1 (CH-5, CH-8, CH-9, D-30) have not been answered and stay open. |
| OD-36 | **Complete Phases 3 and 4 together** (owner, 2026-09-25: "Complete 3rd and 4th phase"). Taken as acceptance of Phase 2. Phase 3 = customer discovery (§82: customer auth, location, home CMS, restaurant listing, search, restaurant detail, menu, cart); Phase 4 = pricing (§82: pricing engine, markup, commission, taxes, delivery, platform fee, surcharges, coupons, promotions). One review after both; still stop before Phase 5. Open approvals (CH-5, CH-8, CH-9, CH-12/D-39, D-30) remain open. |
| OD-37 | **Start Phase 5 — Orders** (owner, 2026-09-25: "next phase strt"). Taken as acceptance of Phases 3 + 4. Phase 5 = §78: checkout, order creation, restaurant acceptance, order state machine, restaurant app, complete lifecycle tested. Stop for review after Phase 5. Open approvals (CH-5, CH-8, CH-9, CH-12/D-39, CH-17/Q-14, D-30, Q-19) remain open. |
| OD-38 | **Cancellation money** (owner, 2026-09-25, answers Q-20): (1) a customer who cancels **after the restaurant accepted** gets **no refund** of an online payment; if the restaurant or Jamzo cancels, the customer gets a full refund. (2) Cash-on-delivery customers who cancel after acceptance lose cash on delivery (they can still pay online) after **2** such cancellations (setting `cod.maxRefusedOrders`); cancelling before acceptance never counts; support can switch it back on. (3) **Jamzo absorbs the loss**: when a customer cancels after acceptance the restaurant is paid its full food value (its own prices minus the discount it funds), paid by Jamzo. Rider compensation is decided with dispatch (Phase 6). → D-70. |
| OD-39 | **Owner answers of 2026-09-25** (questions listed after Phase 5): CH-5 **approved**; CH-9 **approved**; D-30 **acknowledged**; add-on prices get the markup's rounding (Q-19 → D-59 changed); a rider who has to give up a trip because of a cancellation gets the trip pay estimate, paid by Jamzo (Phase 6); the owner creates the Expo account and projects (Q-18); installing the iOS/Android build tools on the development Mac is **approved** (Q-17); SMS/OTP provider **MSG91**, Google/Apple sign-in later (Q-6); commission basis **after restaurant-funded discounts** (Q-7, as built); restaurants may edit their menus (CH-12, approval mode being confirmed); payouts automatic on request with admin approval, manual also possible (Q-5b, Phase 8); legal details to follow (Q-12). Being clarified with the owner: admin login method (CH-8/Q-15), maps provider (Q-14), brand assets upload (Q-13), tax treatment (Q-3), markup model (Q-4), hosting (Q-11). |
| OD-40 | **Hosting** (owner, 2026-09-25, Q-11): a **single provider — DigitalOcean, Bangalore region**. **Nothing is hosted during development** ($0). Launch plan **"Option 2" (≈ $35/month before GST, prices checked 2026-09-25):** one 2 GiB Droplet running the API, worker and admin (automatic security updates, restarts, alerts), **managed PostgreSQL 1 GiB** (daily backups, point-in-time restore, separate from the server) and Spaces for files. Domain stays at GoDaddy (DNS records point to DigitalOcean). Upgrade to a standby database and a second server (~$114/month) only when downtime would really hurt — no code changes. **Speed is a launch condition (D-72):** if the pre-launch load test misses the targets, the owner is shown the upgrade price before launch. **Re-check prices and show the owner the final cost on launch day.** Considered and not chosen: Supabase (cannot run the API/worker), Hostinger VPS (cheaper, but no managed database — database on the server with weekly backups), HostGator India/BigRock (website-oriented, more expensive). → D-71, D-72. |
| OD-41 | **Start Phase 6 — Riders** (owner, 2026-09-25: "next phase start"). Taken as acceptance of Phase 5. Phase 6 = §78: rider app, location, assignment, pickup, delivery, COD; tested. Maps: Google Maps behind a provider switch in Jamzo Admin (owner's suggestion accepted in principle; key from the owner). Open for later phases: CH-8/Q-15 (admin login), CH-12 approval mode, Q-13 asset upload, Q-3/Q-4 tax and markup confirmations, commission GST payer, rider payout style. |
| OD-42 | **Complete the remaining phases** (owner, 2026-09-25: "Complete remaininng phase"). Taken as acceptance of Phase 6 and as permission to build Phases 7–10 one after another **without stopping for review between them**. Each phase is still documented first, fully tested, committed and pushed separately, with its report. Payment gateway: **Razorpay** (already OD-11), built and tested in test mode and against a fake gateway only. No real money moves, and nothing is published to the stores. Things only the owner can do (keys, accounts, CA/legal answers, Xcode update) stay listed as open. |
| OD-43 | **Admin sign-in code by email or SMS** (owner, 2026-09-26: "Code by email or sms"). Answers Q-15 / CH-8. After the password, the admin types a one-time code sent to their email — or by SMS when their admin account has a phone number. Required on staging and production (D-106). The owner also asked whether the coding is done: the real SMS (MSG91) and email senders were still missing, so they are built now (D-104, D-105). |
| OD-44 | **Jamzo logo kit and a food-app look** (owner, 2026-09-26). The owner sent the Jamzo logo kit (v7: logos, J mark, app icons; colours midnight navy `#1B2250`, turmeric `#F2B21B`, leaf green `#2F8F6B`, cool white `#F4F5FB`; font Poppins) and asked for a very user-friendly look like Zomato or Swiggy, with back buttons, using Zomato screenshots as the reference ("looks very good but not ours"). Fonts: Poppins for titles and prices, Inter for text ("update fonts"). Answers Q-13. Implemented as D-107 … D-109, in steps with screenshots. |


## 2. Engineering decisions

### D-1. JavaScript-only monorepo with optional JSDoc checking (OD-1)
ESM JavaScript; zod schemas are the runtime contract; JSDoc annotations for editors. `tsc --noEmit`
with `checkJs` runs over Node packages and services as a **static checker only** (config lives in
`tsconfig.json` files, which are JSON, not TypeScript source). `pnpm check:docs` fails on any `.ts`/`.tsx` file.
Strictness is deliberately moderate (`strict: false`, `strictNullChecks: true`, `noImplicitAny: false`) so the
checker catches real mistakes without forcing TypeScript-style annotation everywhere.

### D-2. pnpm workspaces (hoisted) + Turborepo + catalog
**Changed during Phase 1.** pnpm's default isolated layout produced *several physical copies* of React Native,
Expo modules and React (one per peer-dependency context), which breaks React Native at runtime. The
workspace now uses `nodeLinker: hoisted` (one flat `node_modules`, the layout Expo recommends for pnpm
monorepos), a pnpm **catalog** pinning one version of the Expo/React Native stack for all apps and shared
packages, and `overrides` pinning one `react`/`react-dom`. Verified: exactly one copy of `react`,
`react-native`, `expo`, `expo-notifications`; `expo-doctor` passes 21/21 for every app. Install scripts are
denied by default; each allowed/denied package is listed with its reason in `pnpm-workspace.yaml`.

### D-3. Modular monolith API (Fastify) + separately runnable worker (OD-5)
API modules (built so far in **bold**): **auth**, **rbac/access**, **audit**, **geography** (countries, states, cities, zones, service areas, serviceability), **configuration** (settings, feature flags, app versions, remote config), **media**, customers, **restaurants** (incl. branches, team, documents, bank accounts, partner endpoints — Phase 2), **catalog** (categories, menus, products — Phase 2), cart, pricing, promotions, orders, payments, refunds, delivery, dispatch, riders, ledger, settlements, notifications, reviews, support, analytics. A module owns its tables; other modules call its service functions.

### D-4. Pure business engines
Pricing, order state machine, dispatch/earnings, settlement postings are side-effect-free (time injected).

### D-5. PostgreSQL, integer paise, basis points, versioned rules, immutable snapshots (OD-7, OD-20)

### D-6. Prisma 6 pinned
Prisma 7's new generator writes TypeScript into the project, conflicting with OD-1. Prisma 6 (`prisma-client-js`) generates into `node_modules`.

### D-7. Two order tracks + derived overall status (OD-17)
Kitchen track renamed to the owner's vocabulary: `NEW → ACCEPTED → PREPARING → READY_FOR_PICKUP → COMPLETED`, with `REJECTED` and `CANCELLED`. "Restaurant notified" is a timestamp (`restaurantNotifiedAt`) on a NEW order; the overall status still derives the spec's `RESTAURANT_NOTIFIED`. See [ORDERS.md](ORDERS.md).

### D-8. Order status `PAYMENT_FAILED` added (CH-5).

### D-9. Transactional outbox **polled from PostgreSQL** in Phase 1 — no Redis yet (OD-19, OD-27)
Workers claim outbox rows with `SELECT … FOR UPDATE SKIP LOCKED`, handle them idempotently, retry with
backoff, and park failures after N attempts. Delayed jobs use `availableAt`. This removes Redis from
Phase 1 entirely. **Redis will be introduced only when needed**: (1) more than one API instance needs a
shared rate-limit store and Socket.IO adapter; (2) measured hot reads (remote config, menus) exceed what
Postgres + in-process caching handle; (3) queue throughput outgrows Postgres polling. Replaces the Phase 0
plan of BullMQ from day one (CH-7).

### D-10. Socket.IO for realtime (from Phase 5), REST for truth.

### D-11. Expo SDK 57, JavaScript, Expo Router, EAS per app; shared `@jamzo/mobile-foundation` (OD-4, OD-26)
Session, secure storage, API binding, version gate, remote config, push registration, network state,
error boundary, lifecycle, logging and analytics abstractions are shared React Native code in
`packages/mobile-foundation`. Screens, navigation and product flows stay inside each app.

### D-12. Admin: Next.js (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui (JSX) + TanStack Table (OD-2)
**Polaris findings (verified 2026-09-24):**
- Licence (read from the published `@shopify/polaris@13.9.5` package and the repository): a custom MIT-based licence that restricts use to applications that integrate or interoperate with Shopify; stand-alone apps must be "dissimilar and visually distinct from Shopify products and services (including the internal administration page of a Shopify merchant store), as determined by Shopify in its sole discretion". Icons/images are under a separate Polaris Design Guidelines licence.
- Maintenance: Polaris React is deprecated; the [`Shopify/polaris-react` repository was archived on 11 Sep 2026](https://github.com/Shopify/polaris-react) ("no longer accepting contributions or feature requests"). Its successor, Polaris Web Components (released 1 Oct 2025), targets apps embedded in Shopify surfaces.
- Conclusion: **licensing, maintenance and long-term-dependency concerns all apply → Polaris is not used.**

Chosen instead (all MIT, actively maintained): Next.js, Tailwind CSS 4, shadcn/ui components generated
as **`.jsx`** into `apps/admin/src/components/ui` (we own that code), Radix primitives, TanStack Table,
lucide-react icons. On top of these we build the **Jamzo Admin design system** (`apps/admin/src/components/jamzo/`:
AppShell, PageHeader, ResourceTable with server-side pagination/filter/search, StatusBadge,
FilterBar, EmptyState, ErrorState, ConfirmDialog, SettingsSection, InheritedValue…), using
`@jamzo/ui` tokens. UX patterns are Shopify-inspired (dense tables, saved views, contextual actions,
resource detail pages); visual identity is Jamzo's own. The Pages Router + React 18 constraint from
Phase 0 no longer applies (CH-2).

### D-13. Tests on real PostgreSQL; Playwright for admin; Jest component tests for mobile
**Changed during Phase 1.** Integration tests run on **real PostgreSQL 18** started from the npm package
`embedded-postgres` (no Docker or system install) — PGlite's wire-protocol server closed the connection
after every SQL error (Prisma `P1017`), which made constraint-violation tests impossible. CI uses a
PostgreSQL 17 service container through the same code path (`TEST_DATABASE_URL`; verified locally against
a separate server). PGlite remains only in `pnpm verify:schema`, which uses it in-process. Each test file
gets its own database cloned from a migrated template. Admin: Playwright E2E against a real API + database.
Mobile: Jest-Expo + React Native Testing Library render the real Expo Router layouts; Maestro device
flows wait for simulators/emulators (Q-17).
### D-14. `delivery-engine` package holds geo + dispatch domain logic; the API has separate `delivery` and `dispatch` modules.

### D-15. Centralised product/brand registry (OD-3)
`packages/config/src/apps.js` is the **only** place that defines product names, domain, bundle/package
ids, URL schemes, colours and per-app metadata. Each app's `app.config.js`, the admin, the API
(`x-app-id` validation, remote config) and docs generation read from it. A test fails if an identifier
literal appears anywhere else in source.

### D-16. Placeholder Jamzo icons and splash screens
No Jamzo logo exists yet. Each app gets a **generated, clearly-labelled placeholder** icon/splash
(wordmark-free "J" monogram on per-app colour) produced by `scripts/generate-app-assets.mjs`. The previous
BiteMitra logo kit is kept in `assets/legacy/bitemitra-logo-kit/` and is **not used**. Final assets: Q-13. **Superseded by D-107** (real logo kit, OD-44).

### D-17. Provisional Jamzo colour palette
Until brand guidelines exist, tokens in `@jamzo/ui` use a provisional palette (deep plum primary
`#5B2A86`, saffron accent `#F2A516`, neutral greys, semantic success/warning/critical/info) chosen to be
distinct from Shopify's green and from competitors' reds/oranges. All colour lives in tokens, so the final
palette is a one-file change. Per-app accents: customer plum, restaurant partner teal `#0F766E`,
delivery partner saffron. (Q-13) **Superseded by D-107.**

### D-18. Schema split: active vs design (OD-20)
`packages/database/prisma/schema.prisma` contains **only migrated (active) tables**.
`packages/database/prisma/design/schema.design.prisma` keeps the full long-term design. A check
(`pnpm verify:schema`) validates both, applies both to PostgreSQL, and asserts every active model is
identical to its design counterpart (except relation fields to not-yet-active models) — so the design
cannot silently drift. Table classification: [DATABASE.md §3](DATABASE.md#3-table-classification).

### D-19. Geography: Service Zone = `zones`; Delivery Area = zone `service_areas` + branch `branch_delivery_areas`; new `BRANCH` config scope (OD-6)
Platform serviceability comes from zone service areas; a restaurant branch's reach is its own delivery
area (radius or polygon). `ConfigScope` gains `BRANCH` between RESTAURANT and CATEGORY.

### D-20. Provider-based authentication (OD-13)
`auth_identities` (provider, providerSubject) links any number of login methods to one user. Providers:
`PHONE_OTP`, `EMAIL_OTP`, `GOOGLE`, `APPLE`, `PASSWORD` (admin). Enabled per app by setting
`auth.methods` (scoped GLOBAL/app). Phase 1 implements PHONE_OTP, EMAIL_OTP and admin PASSWORD; **Google
and Apple have provider slots and configuration but no token verification yet — requests return
`AUTH_METHOD_UNAVAILABLE`** (needs OAuth client ids; Q-6b). Approval is separate: `/v1/me` returns the
restaurant/rider approval status and privileged routes check it.

### D-21. OTP delivery via provider interfaces
`SmsProvider` and `EmailProvider` interfaces; Phase 1 ships only a **console provider** (writes the OTP
to the API log) which is refused at startup when `APP_ENV` is `staging` or `production`. Real login on a
phone therefore needs Q-6.

### D-22. Admin sessions via same-origin proxy
The admin calls `/api/v1/*` on its own origin; Next.js rewrites to the API. The refresh token is an
httpOnly, Secure, `SameSite=Strict` cookie scoped to `/api/v1/admin/auth`; the access token lives in
memory. Refresh requires the `x-app-id: ADMIN` header (a cross-site form cannot set it) → CSRF-safe.

### D-23. Media storage: local driver in Phase 1, S3-compatible interface
`Storage` interface with a filesystem driver (development/test). The S3 driver is **not implemented in
Phase 1** (no bucket available to test against); production needs it (Phase 10 or earlier). Image
renditions (thumb/small/medium) are generated by the worker from an outbox event.

### D-24. Rate limiting in-process in Phase 1
`@fastify/rate-limit` memory store — correct for a single API instance; moves to Redis with D-9's trigger (1).

### D-25. Admin 2FA deferred (was assumption A-12)
Password + lockout + rate limits in Phase 1; TOTP 2FA before any production admin use (Q-15). **Superseded by D-106** (code by email/SMS, OD-43).

### D-26. All timestamps are `timestamptz` (bug found during Phase 1)
Prisma's default `DateTime` is `timestamp` *without* time zone. Raw SQL comparisons (the outbox relay)
then depended on the database session's time zone: on an IST session every lease looked expired and two
workers processed the same events (caught by the concurrency test: 25 handler runs for 20 events). Every
DateTime in the design is now `@db.Timestamptz(3)`; the test passes with exactly 20.

### D-27. Scope of JSDoc type checking
`pnpm typecheck` checks all Node packages and services with `checkJs`. Fastify's decorated properties are
described in `services/api/src/core/types.js` (JavaScript JSDoc, no `.d.ts`). Prisma query arguments are
typed through a deliberate `Db = any` typedef: Prisma's generated types demand TypeScript literal-enum
annotations, which in JavaScript would mean casts on almost every query. Query inputs are validated by zod
at the API edge and every query runs against real PostgreSQL in the integration tests. React code (admin,
mobile) is not type-checked; it is covered by ESLint and tests.

### D-28. Setting history survives "reset to inherited" (bug found during Phase 1)
The Phase 0 design cascaded `setting_history` on delete, so resetting an override would have erased its
history (spec §63). History now uses `ON DELETE SET NULL` and records key, scope and target itself.

### D-29. Mobile foundations shared, including sign-in; state libraries deferred
`@jamzo/mobile-foundation` owns session, secure token storage, API binding, remote config, the
maintenance/update gate, push registration, network state, error boundary, lifecycle, logging, analytics
and the phone-OTP sign-in flow (authentication is a foundation, not a product flow). Each app composes its
own layout and home screen. TanStack Query and Zustand (planned in MOBILE.md) are not introduced until a
feature needs them (Phase 3).

### D-30. Consequence of sharing foundations: coordinated Expo SDK upgrades — **acknowledged (OD-39)**
Because the three apps share mobile packages (and the catalog pins one Expo SDK), an Expo SDK upgrade is
done for all three apps together. **Releases stay independent** (Customer 1.5.0 can ship while Rider stays
1.3.0, B10), and each app keeps its own identifiers, version, config, credentials and store listing.

### D-31. Admin React aligned with the mobile apps
The admin runs React 19.2.3 (the version Expo SDK 57 requires) instead of 19.2.8 so the hoisted workspace
has a single React. Next.js 16 supports it; the admin build and all E2E tests pass on it.

### D-32. Admin sign-in is tested with Playwright, not by the assistant typing passwords
The engineering assistant does not type credentials into browsers. Signed-in admin screens are verified
by Playwright tests against an isolated, freshly seeded backend with fixture credentials; screenshots are
reviewed from the test run. The owner can sign in to a local instance with the credentials in `.env`.

### D-33. API endpoint docs are generated from the code
`pnpm docs:api` writes the endpoint table in API.md from the registered routes (method, path, auth, apps,
permission, rate limit); `pnpm check:docs` fails when it drifts.

## 2a. Engineering decisions — Phase 2 (restaurants & menus)

Design detail: [RESTAURANTS.md](RESTAURANTS.md).

### D-34. Restaurant onboarding is a server-enforced state machine
`DRAFT → REVIEW → APPROVED → ACTIVE ⇄ SUSPENDED`, with `DOCUMENTS_PENDING` for missing or rejected
documents. Each transition has a permission, server-side readiness checks and (for backward steps and
suspensions) a mandatory reason; all are audit-logged. The API returns the readiness checklist it
evaluates, and the admin renders exactly that list. Required document kinds are a setting
(`restaurants.requiredDocuments`, A-21). Partner endpoints accept members of APPROVED or ACTIVE
restaurants (approved but not yet live restaurants can prepare their menu and hours); SUSPENDED blocks them.

### D-35. Bank account numbers are encrypted at the application layer; four-eyes verification
AES-256-GCM with `FIELD_ENCRYPTION_KEY` (32 random bytes, base64; required by the API in every
environment, never committed). Ciphertext format `<keyId>.<iv>.<tag>.<data>` where `keyId` is derived
from the key, so a wrong key is detected instead of producing garbage. Only the last 4 digits are
returned or audit-logged; Phase 2 has no decrypting endpoint. A new account is unverified and not
primary; a **different** admin with `restaurants.approve` verifies it, which atomically makes it primary
(partial unique index: one primary per restaurant). Rationale: bank-detail changes are a classic payout
fraud path (spec §43 lists "restaurant bank account changed" as an audited event).

### D-36. KYC documents use private storage, never the public media route
Documents are media of kind `DOCUMENT` stored under `private/…` keys. The public file route only serves
`media/…` keys of kind `IMAGE`, the media library lists images only, and document files are downloaded
through an authenticated, permission-checked, audit-logged admin endpoint. PDFs are accepted for
documents (content-sniffed like images).

### D-37. Catalog modelling
- Platform `categories` (taxonomy for discovery and rule scoping) are separate from each restaurant's
  `menu_categories` (its own sections).
- Variants carry the **full** price of the size; the product's base price mirrors the default variant.
- Add-on groups belong to one product (a shared add-on library is future work).
- A product is written as one document (variants, groups, add-ons, images, schedules). Children are
  upserted by id and removed when missing; this is safe because order items (Phase 5) copy names and
  prices and have no foreign keys to catalog rows (see the design schema). Products are archived, never
  deleted.
- Optimistic concurrency: `products.version`; a stale write returns `409 CONFLICT`.
- Food-type consistency and pure-veg rules are enforced by the server (RESTAURANTS.md §5).

### D-38. Opening hours and availability are evaluated by a pure engine (`@jamzo/catalog-engine`)
Same rules for API, admin previews and (Phase 3) customer listings; time and timezone are inputs (D-4).
Several intervals per day, past-midnight intervals, `24:00` end of day, overlap rejection, "no hours =
closed". Branch `isOpen` now defaults to **true** and means "not manually closed" (the Phase 0 design
defaulted it to false, which would have kept every new restaurant closed until someone remembered to
switch it on).

### D-39. Restaurant self-editing of menu content is not built in Phase 2
Spec §19 lists menu/product management in the restaurant app; the owner's flag `restaurant_self_edit_menu`
(default off) gates it. Phase 2 builds the admin-side catalog and, in the partner app, **read-only menu,
sold-out toggles and store status controls** — the daily operational needs. Self-editing prices and
content needs a review/approval flow (price changes affect customers and commission) and is proposed for a
later phase. Needs approval (CH-12).

### D-40. Restaurant settings: one source of truth per value
The Phase 0 `restaurant_settings` table duplicated values that the settings registry already resolves
hierarchically (minimum order, acceptance timeout, COD, settlement schedule, packaging, delivery radius).
Two sources would disagree. Those columns are removed from the design; the registry's RESTAURANT and
BRANCH scopes are now enabled in the configuration service, so the admin can override those settings
for one restaurant or branch. `restaurant_settings` keeps only per-restaurant capabilities that are not
hierarchical: `selfEditMenu` and `autoAccept` (Phase 5). The delivery radius is the branch's delivery area.

### D-41. Zones and delivery areas of a restaurant
A branch's `zoneId` is derived from its location on every save (point-in-zone within the restaurant's
city); a branch outside every zone cannot be submitted for review. `restaurant_zones` (where the restaurant
is listed) always contains its branches' zones and may add neighbouring zones chosen by an admin. Each
branch has one active delivery area (radius or polygon; partial unique index). Customer serviceability in
Phase 3 = inside a zone service area **and** inside the branch delivery area (D-19).

### D-42. Restaurant partner endpoints live under `/v1/restaurant/…`
Only the Restaurant Partner app may call them (`x-app-id` + app-bound token). Every request re-checks the
membership, its role and the restaurant status (no cached approval). Role capabilities are code
(`RESTAURANT_ROLE_CAPABILITIES` in `@jamzo/auth`), listed in RESTAURANTS.md §7.

### D-43. Bulk product actions are all-or-nothing
Up to 200 products per request, all must be visible to the admin (city scope); either every product
changes (one transaction, one audit entry per product) or none does.

### D-44. Seed catalog is realistic but fictional
11 fictional Unjha restaurants (mostly pure veg, reflecting the town), 120+ products with variants,
add-ons (including Jain preparation choices), hours and delivery areas. Demo documents have fake numbers
and no files; demo bank accounts (fake numbers, fictional bank code `JMZO`) are seeded only when
`FIELD_ENCRYPTION_KEY` is available, because they are encrypted like real ones.

### D-45. PATCH bodies never apply defaults (bug found in Phase 2; affected Phase 1)
Update schemas were built with zod's `.partial()`, which keeps field defaults: an omitted field was filled
with its default. Renaming a live city sent `isActive: false` (refused for lacking a reason, so a rename
was impossible); renaming a zone silently re-activated it. All update schemas now use `patchOf()`, which
removes defaults; a test asserts every PATCH schema turns `{}` into `{}`, and API tests cover the city and
zone cases.

## 2b. Engineering decisions — Phases 3 + 4 (customer discovery, pricing)

### D-46. The cart lives on the device; the server quote is authoritative
There is no cart table in the design. The customer app keeps the cart locally (one restaurant per cart)
and asks `POST /v1/customer/cart/quote` for a fully priced, re-validated breakdown whenever it changes.
Clients never compute a price (spec §9, B5). The quote lists problems (item sold out, restaurant closed,
address not serviceable, coupon not applicable) instead of silently dropping items. ORDER_FLOW's
`/v1/cart/quote` is placed under the customer prefix (CH-15). Phase 5 checkout re-quotes and freezes the result.

### D-47. When a restaurant is shown for a location
Listed only when: the customer point is serviceable (city live, inside a zone service area — D-19); the
restaurant is ACTIVE; `restaurant_zones` contains the customer's zone; the point is inside the branch's
active delivery area; and the distance is within `delivery.distance.maxDistanceM` and the delivery rule's
maximum. Closed or paused restaurants are still listed (sorted after open ones) with "Opens at …", so
customers can plan; they cannot be ordered from (Phase 5 re-checks). Guest browsing follows the setting
`customer.guestBrowsing`.

### D-48. Distance: provider interface, fallback until a maps provider is chosen (OD-14, A-19, Q-14)
`DistanceProvider` interface; the only implementation today is `none`, so every quote uses the configured
fallback (`HAVERSINE_FACTOR`: straight line × `roadFactorBps`, default 1.3) and is flagged
`distanceSource = FALLBACK`. With the setting on `REJECT`, no quote is given. Real road distance arrives
when Q-14 is answered (CH-17). ETA shown to customers = branch preparation time (+ busy-mode minutes) +
travel time at the setting `delivery.eta` average speed + buffer, as a range — an estimate, labelled so.

### D-49. Pricing engine implements PRICING.md exactly (`@jamzo/pricing-engine`, engine version `2026.09-1`)
Pure `quote(cart, context, rules, now)`; the 14-step pipeline and the 6 invariants of PRICING.md §4/§8,
including conservation (every paise of the payable is assigned to restaurant, rider, tax, gateway or
platform). The PRICING.md §6 worked example is a golden test with exact paise. Menus show customer prices
from the same markup function, so a menu price and a cart line can never disagree.

### D-50. Versioned commercial rules: write model
A rule change creates a **new version**; the open version for the same target (rule type, scope,
target, restaurant qualifier, priority, and kind for surge) is closed at the new version's
`effectiveFrom`, linked by `supersedesId`. "End rule" closes a version without replacement (the parent
scope's rule applies again). Back-dating is refused (old quotes must stay reproducible); future-dated
versions are allowed. A partial unique index guarantees one open version per target for every rule table.
Every change needs a change note, is audit-logged, and needs the rule type's permission (markup, delivery,
platform fee, small order: `pricing.manage`; surge/night: `pricing.surge`; commission:
`commissions.manage`; tax: `taxes.manage`; rider earnings: `pricing.manage`).

### D-51. Tax and withholdings are rules, and every default is a placeholder pending the CA (OD-9, Q-3)
`tax_rules.params.appliesTo` selects the charge (FOOD, PACKAGING, DELIVERY_FEE, PLATFORM_FEE,
SMALL_ORDER_FEE, SURCHARGE, COMMISSION) or `WITHHOLDING` (TCS/TDS on restaurant payouts). Development
seed: food 5% exclusive (CGST 2.5% + SGST 2.5%), packaging same as food, 18% on delivery, platform fee,
small-order fee, surcharges and commission, **no withholdings**. The admin and every quote label tax as
"pending CA review". Nothing here is tax advice; production financial launch waits for Q-3.

### D-52. Coupon limits that need order history are enforced from Phase 5
Coupon/promotion targeting, dates, minimum order, caps and funding work now. Per-user limits, total
usage limits and "first order only" depend on `coupon_usages` and orders (Phase 5); until then the quote
evaluates them with zero past orders/usages and says so in the response (`limitsCheckedAtCheckout`).

### D-53. Rider earning rules activated in Phase 4 (moved from Phase 6)
Every quote needs the rider-cost estimate for the conservation invariant and the admin's margin preview.
Only the rule table moves; rider earnings, ledgers and payouts stay in Phases 6/8 (CH-16).

### D-54. Payment gateway cost is an admin-only estimate
Setting `payments.gatewayFees` (per method, placeholder) estimates gateway cost for the platform-net
figure in admin previews. Actual fees come from the payment provider in Phase 7.

### D-55. Customer app state and location
TanStack Query is introduced (as planned in D-29). The cart is persisted on the device with AsyncStorage
(not secure storage — it holds no secrets). Location: "Use my current location" with foreground permission
(`expo-location`) plus saved addresses entered as text with the device location; a map pin picker needs
the maps provider (Q-14).

### D-56. Home screen is CMS-driven and resolved on the server
Admins create, order, schedule and target (city/zone) home sections and banners. Dynamic section types
(top rated, new, free delivery, under ₹X, cuisine, chosen restaurants/products) are filled on the server
from the same listing rules as D-47, so the app never shows a restaurant it cannot deliver from.
Ratings are not collected yet (Phase 5 `reviews`): "top rated" uses the stored rating (0 for everyone
today) and says so in the admin.

### D-57. Customer data in the admin is masked by default
Customer list/detail show masked phone numbers and addresses unless the admin holds `customers.pii`
(RBAC §2). Viewing unmasked data is audit-logged.

### D-58. Customer app: cart line keys, when sign-in is asked, what the app computes
A cart line is identified by product + size + sorted add-ons, hashed to a short key (the quote API
accepts keys of at most 64 characters; a raw id list with two add-ons is longer). Guests browse, build a
cart and see the server bill; sign-in is asked for only for saved addresses and favourites (and, from
Phase 5, checkout). The app never computes a bill: the price on the "Add" button of the customise
screen is menu price × quantity for guidance, and the cart shows only the server quote.

### D-59. Add-on markup rounding — changed by the owner (OD-39): add-ons now get the rule's rounding
PRICING.md §4.2 says add-ons get "the same markup rule" but does not say whether its rounding applies.
Originally the engine rounded only the main item (Sweet corn ₹25 +10% = ₹27.50). The owner chose rounding
for add-ons too (₹28); free add-ons stay free and FIXED markups still apply to the main item only.

## 2c. Engineering decisions — Phase 5 (orders)

### D-60. Phase 5 takes cash on delivery only; online payment arrives with the gateway (Phase 7)
Online methods need the payment gateway, signed webhooks and reconciliation (Phase 7); accepting them
earlier would mean trusting the client that it paid, which is never allowed. So `POST /v1/orders` accepts
`COD` (when the `cod` flag and the `cod` setting allow it and the total is within
`cod.maxOrderValuePaise`) and orders whose total is ₹0; any other method is refused with
`PAYMENT_METHOD_UNAVAILABLE`. The customer app shows online methods as "coming soon". No `payments` row
is written for COD in Phase 5; the COD amount is on the order (`codAmountPaise`) and collection is
recorded by the rider in Phase 6.

### D-61. Phase 5 runs the kitchen track; the delivery track starts with dispatch (Phase 6)
`@jamzo/order-engine` implements **every** transition in ORDERS.md (both tracks, cancellations,
derived status) and is tested exhaustively. The API in Phase 5 drives the payment phase, the kitchen
track (NEW → ACCEPTED → PREPARING → READY_FOR_PICKUP) and cancellations. The dispatch trigger
(`dispatch.startAt`) and every rider event arrive with dispatch in Phase 6, so a Phase 5 order waits at
READY_FOR_PICKUP with delivery NOT_STARTED; nothing marks an order delivered without a rider. Stuck
orders are visible to operations and can be cancelled by an admin.

### D-62. Realtime: PostgreSQL NOTIFY → Socket.IO; REST stays the truth (D-10)
State changes call `pg_notify('jamzo_realtime', …)` **inside** their transaction, so a notification is
delivered only if the change commits, and from any process (API or workers). Each API instance
`LISTEN`s and forwards to Socket.IO rooms: `restaurant:<id>`, `order:<id>`, `ops`. Messages carry ids
and the new status only; clients re-fetch over REST. Sockets authenticate with the access token and
join only rooms they are allowed to see. Apps also poll (restaurant: 15 s, customer tracking: 20 s) so a
dropped socket never hides an order. No Redis adapter until there is more than one API instance (D-9).

### D-63. Order numbers
`<CITY CODE>-<YYMMDD>-<sequence>` (e.g. `UNJ-250925-00042`), the sequence from one PostgreSQL sequence
(never reused, gap-tolerant, race-free). The date is the city's local date. Restaurants and riders use
the last four digits verbally.

### D-64. Checkout re-prices and revalidates inside the order transaction
`POST /v1/orders` (Idempotency-Key required) runs the same revalidation and pricing as the cart quote
(D-46) from current database state immediately before writing, then compares the total with `expectedTotalPaise` — the total the
customer saw. Different → `409 PRICE_CHANGED` with the fresh quote; any blocking issue (closed,
unavailable item, not deliverable, coupon no longer valid, below minimum order, COD limit) →
`422 CHECKOUT_BLOCKED` with the issues; nothing is created. The order, items, add-ons, address copy,
frozen pricing snapshot (engine output incl. restaurant/rider/platform side), coupon usage, status
history and outbox events are written in one transaction, which also re-checks what can be raced: the
customer row is locked (per-customer coupon rules), the coupon's global limit is a conditional update backed
by a constraint, and `(customerId, idempotencyKey)` is unique. A menu change in the milliseconds between
pricing and the write is not re-checked. The delivery address must be a saved address (it is copied into
the order).

### D-65. Coupon limits enforced at checkout (completes D-52)
Usage is counted from `coupon_usages` that are not reversed: `firstOrderOnly` (no earlier order that
reached PLACED, excluding cancelled/failed ones), `perUserLimit`, and the global `usageLimit` through a
conditional increment of `coupons.usedCount` (`… WHERE usedCount < usageLimit`), so two customers cannot
take the last use. Cancellation before pickup releases the usage (`reversedAt`) and decrements the count.

### D-66. Cancellation rules are versioned commercial rules
`cancellation_rules` joins the rule framework of D-50 (versions, history, stale-edit guard, admin UI in
Pricing). One rule per target holds a matrix stage × actor → `{ allowed, customerFee, refund,
restaurantCompensation, riderCompensation }`. The engine computes the outcome and it is stored in
`order_cancellations` with the rule snapshot. The default values follow the owner's rule (OD-38, D-70) and no
money moves in Phase 5: refunds are Phase 7 and ledger postings Phase 8. With COD-only orders nothing has
been collected, so a Phase 5 cancellation never owes the customer a refund.

### D-67. What the restaurant sees of an order
Restaurant screens show the restaurant's own prices (base prices), restaurant-funded discounts,
packaging, commission, and net payable from the frozen snapshot — never customer display prices, markup,
platform fees or platform revenue (spec §19). The customer's name is shown as the first name; phone and
address are not shown to the restaurant.

### D-68. Restaurant acceptance timeout
When an order is placed, a delayed outbox job is scheduled for `orders.restaurantAcceptance.timeoutSec`.
The job re-reads the order and acts only if the kitchen is still NEW: `AUTO_ACCEPT`, `AUTO_REJECT`, or
`ESCALATE_TO_OPS` (default) → the order is flagged for operations (`needsAttention`, shown in the admin)
and a second job auto-rejects after `escalationGraceSec`. Accept vs timeout races are decided by the
order's version (optimistic concurrency); exactly one wins.

### D-69. Notifications: rows first, providers second
Order events create `notifications` rows from `notification_templates` (seeded, editable by
`notifications.manage`), which appear in the apps' order screens and are pushed through the push
provider. Development and tests use the console provider. The Expo push provider is implemented and
tested against a fake Expo endpoint only — **not verified against Expo's service** until the EAS projects
exist (Q-18). The restaurant app also alerts in-app (looping sound + vibration) while an order is NEW. Android channels:
`new-orders` (restaurant, maximum importance, custom sound) and `order-updates` (customer).

### D-70. Cancellation rule from OD-38, and losing cash on delivery
The seeded cancellation rule (all cities) becomes: before acceptance the customer cancels free with a full
refund; after acceptance (accepted, preparing or ready) the customer may still cancel in the app, keeps
**no refund** (`customerFee = FULL_AMOUNT`, i.e. everything paid) and the restaurant gets its **food value**,
Jamzo absorbing whatever the kept payment does not cover (`platformLoss`). Restaurant and admin
cancellations refund in full and compensate nobody by default (admins can override, audited). The app shows
the consequence before the customer confirms. A new amount type `FULL_AMOUNT` was added for this. For cash on
delivery nothing has been paid, so Jamzo absorbs the whole food value; each such cancellation after
acceptance counts, and when the count reaches `cod.maxRefusedOrders` (default 2) the customer's
`codDisabled` is set in the same transaction (audit-logged) and checkout refuses cash on delivery with a
message. Support switches it back on in Jamzo Admin (`customers.manage`, reason required, audited).
Existing environments keep their current rule version until an admin saves the new one (Pricing →
Cancellations); the development seed creates it.

### D-71. Deployment on DigitalOcean (OD-40)
- **One region (Bangalore, BLR1):** App Platform services for the API (HTTP + Socket.IO; clients use the
  WebSocket transport, so several API instances need no sticky sessions, and realtime notices reach every
  instance through PostgreSQL NOTIFY — D-62), the worker and the admin website; Managed PostgreSQL; Spaces
  (S3-compatible) for files, with a private bucket for KYC documents. Full availability of all four in BLR1
  was confirmed on DigitalOcean's regional-availability page (verified by them 2026-09-24).
- **Before deployment (Phase 10):** an S3 storage driver for Spaces (the code has the `Storage` interface
  with a local driver only — D-23); production env values; database connection pooling settings; health
  checks and alerts; backup restore drill.
- **Single region, stated plainly:** a whole-datacenter outage would stop Jamzo until it recovers. The
  standby database and two API instances cover the common failures. Multi-region is for much larger scale.
- **Portability:** standard PostgreSQL and S3-compatible storage only; a later move (e.g. to AWS Mumbai) is a
  migration, not a rewrite.

### D-72. Speed targets (owner concern, OD-40)
Measured before launch with a load test of the expected lunch/dinner rush (customers browsing and ordering,
restaurants accepting, riders sending locations) on the chosen DigitalOcean setup, and watched with alerts
after launch:
- API: **95% of requests answered in under 300 ms** on the server at that load.
- Customer app: **home screen with restaurants in under 2 s** on 4G; screens already seen appear instantly
  from the on-device cache and refresh in the background.
- Images: resized renditions (thumb/small/medium) through the Spaces CDN; never the originals.
If the targets are missed, the fix (optimisation or a larger setup) and its price go to the owner before
launch.

## 2d. Engineering decisions — Phase 6 (riders and delivery)

### D-73. Rider onboarding
A rider signs up in the rider app with phone OTP, then fills in an application: name, city, vehicle
(type, registration number) and documents — driving licence, vehicle RC, PAN and one identity proof — as
photos stored privately (like restaurant KYC, D-36). Document numbers are encrypted with the field cipher
(D-35) and shown masked (last 4). Aadhaar numbers are **not** collected; if Aadhaar is used as identity
proof, only its photo with the number masked by the rider is accepted (legal review Q-12). Admins with
`riders.approve` review each document and move the rider APPLIED → DOCUMENT_PENDING → UNDER_REVIEW →
ACTIVE (or REJECTED / SUSPENDED), audit-logged. Signing in never makes someone an active rider (OD-13).

### D-74. Online, location and availability
An ACTIVE rider goes online/offline (a `rider_shifts` row per online period). While online the app sends
location in batches (`POST /v1/rider/locations`, up to 50 points, every 10 s on a trip / 30 s idle —
setting `riders.location`); the latest point updates `rider_availability` (zone resolved on the server),
the rest is kept as breadcrumbs for 30 days (later: partitioning). A rider whose last location is older
than `dispatch.maxLocationAgeSec` is not offered orders. Background location on the phone uses
`expo-location` + `expo-task-manager` with the platform disclosures of MOBILE.md §5.

### D-75. Dispatch
When the restaurant accepts (`dispatch.startAt` = ON_ACCEPT) the order's delivery track starts
(DISPATCH_START) and the pure `rankCandidates` strategy in `@jamzo/delivery-engine` ranks eligible riders:
online, ACTIVE, fresh location, in the order's zone (or neighbouring zones), fewer than
`dispatch.maxActiveOrders` active orders, COD enabled with headroom under the rider's COD limit for COD
orders, not already offered this order. Score: pickup distance first, then fewer active orders; acceptance
history is not used (setting off, §22). The best rider gets an **offer** for `dispatch.offerTimeoutSec`
(30 s); reject or timeout → next rider; after `dispatch.maxOffers` or `dispatch.noRiderEscalationSec` →
NO_RIDER_FOUND, the order is flagged for operations and dispatch retries every minute. Admins with
`orders.assign_rider` can assign a rider directly (audit-logged) or reassign. **Two riders can never both
hold an order**: the partial unique index on accepted assignments decides, plus the order version. The
strategy is an interface; the first algorithm is not baked in (§22).

### D-76. Pickup and delivery
Rider flow: accept → at restaurant → pickup (the rider types the **last 4 digits of the order number**,
and the kitchen must have marked the order ready) → on the way → arrived → delivered. Delivery OTP (flag `delivery_otp`, **on** in the seed): a 4-digit code shown to the customer and entered by the
rider. *As built:* the code is derived from the order id with a server secret (HMAC), so it is never stored;
5 wrong attempts flag the order for operations. Proof photo (flag `proof_of_delivery`, off by default). Navigation opens Google Maps / Apple Maps on
the phone with the destination; no in-app map for the rider in Phase 6. Rider problems (accident, food
damaged, cannot reach customer) are reported from the trip screen and flag the order for operations.

### D-77. Cash on delivery
At delivery the rider confirms the cash collected (must equal the order's COD amount). This writes a
`payments` row (provider `cod`, SUCCEEDED, `codCollectedById`, `codCollectedAt`) — the `payments` table is
activated now for COD only; online payments follow in Phase 7. A rider's **COD balance** = cash collected
minus cash deposited and verified; deposits and their verification are Phase 8 (`rider_cod_deposits`), so
until then the balance only grows and admins see it. Dispatch will not offer a COD order to a rider whose
balance plus the order would exceed the rider's limit (`riders.codLimitPaise` or setting
`cod.riderLimitPaise`); admins can disable COD per rider. COD is never counted as platform cash (§23).

### D-78. Rider earnings
Computed at DELIVERED from the rider earning rule in force (D-53) with the **actual** trip: pickup
distance (rider's position at acceptance → restaurant) and delivery distance (restaurant → customer, the
same distance source as the quote), waiting time (at restaurant → picked up, beyond the free minutes),
incentives by time window, plus the customer's tip (100%, OD-15) as a separate line → one `rider_earnings`
row with the full breakdown. When an order a rider had accepted is cancelled before pickup, the rider gets
the trip estimate, paid by Jamzo (OD-39) — recorded in the cancellation outcome and as a `rider_earnings`
row marked as a cancelled trip. Ledgers and payouts are Phase 8. The rider sees their own earnings only —
never food prices, commission or restaurant money (§21).

### D-79. What the customer sees of the rider
From rider acceptance until delivery: the rider's first name, vehicle type, the rider's position rounded
to about 100 m, the delivery status and an ETA. Never the rider's phone number: calls go through a
`CallBridge` interface; until a masked-calling provider is chosen, both apps show Jamzo support's number
(D-80). In-app live maps for customers need the maps key (Google Maps on Android; Q-14): Phase 6 shows
distance and ETA text and an "open in maps" link; the map view is switched on when the key exists.
*As built in Phase 6:* first name, vehicle, the rounded position with the time it was taken, the
delivery code, a **"See on map"** link (Google Maps pin at the rounded position; needs no key) and an
**arrival estimate** (`arrivalEstimate` in `@jamzo/delivery-engine`): before pickup, the later of the
partner reaching the restaurant and the food being ready, plus the quoted restaurant → customer distance;
after pickup, partner → customer; travel at `delivery.eta.avgSpeedKmph` + buffer, shown as a range
labelled "estimate". Partner legs use road distance when the maps provider is on, otherwise the labelled
fallback (`source`). No traffic data until a maps key exists; the in-app live map also waits for the key.

### D-80. Contact between customer and rider
`CallBridge` interface with a `support-routed` implementation (shows support.contact) until a masked-number
provider (Exotel, Knowlarity…) is chosen (new question Q-21). Real numbers are never exposed.

### D-81. Maps provider switch
`DistanceProvider` gets a Google implementation (Routes API "computeRoutes" distance) selected by the
setting `maps.provider` (NONE | GOOGLE) in Jamzo Admin; the API key stays in the server environment
(`GOOGLE_MAPS_API_KEY`). Tested against a fake endpoint only — **not verified with Google** until the key
exists. With NONE or a failure, the existing labelled fallback applies (D-48).

## 2e. Engineering decisions — Phase 7 (online payments)

### D-82. Payment providers
`PaymentProvider` interface (PAYMENTS.md §2) with two adapters selected by `PAYMENT_PROVIDER`:
**`fake`** (development and tests: it signs its webhooks with a test secret and can succeed, fail, delay
or duplicate) and **`razorpay`** (Orders API, fetch an order's payments, capture, refunds, webhook
signature = HMAC-SHA256 of the raw body with the webhook secret). Environment guards: `fake` is refused in
staging/production; Razorpay live keys (`rzp_live_`) are only allowed in production, and production
refuses test keys. The Razorpay adapter is tested against a fake Razorpay HTTP endpoint. It is **not verified
with Razorpay** until the owner creates test keys.

### D-83. Online checkout
The customer chooses **Pay online** (UPI, card, netbanking or wallet, from `payments.methods`) or cash
on delivery. In the order transaction: order `PAYMENT_PENDING` and a `payments` row `INITIATED` for the
exact total, plus outbox jobs `payment.reconcile` (after 2 min, repeating) and `payment.expire` (after
`payments.methods.expirySec`). Right after the commit the API creates the gateway order (→ `PENDING`) so
the app can pay at once. If that call fails, the order stays waiting and the app retries it with
`POST /v1/customer/orders/:id/payment`. The coupon is held while payment is pending and released if
payment fails or expires.

### D-84. How the customer pays
The app opens a small **payment page served by the API** (`GET /v1/pay/:paymentId?t=…`, a short-lived
signed link) in the in-app browser (`expo-web-browser`). The page runs Razorpay Checkout, then returns to
the app via `jamzo://payment`. No native payment SDK is needed, and no card data touches Jamzo (§48).
With the fake provider (development only) the page shows "Pay (test)" / "Fail (test)", which send a
signed webhook through the real webhook endpoint. Back in the app, `POST …/payment/verify` makes the
**server** ask the gateway. The app never marks anything paid (§24).

### D-85. Confirming a payment
Webhook (`POST /v1/webhooks/payments/:provider`, raw body, stored in `payment_events` before processing;
duplicates are no-ops), app verify, reconcile job and expiry job all call one idempotent
`confirmPayment`. Rules:
- **Success** needs captured amount = payment amount, in INR. An authorised-only payment is captured first.
- **Amount mismatch:** never confirms; the order is flagged for operations.
- **Success:** payment `SUCCEEDED` (conditional update), order `PAYMENT_CONFIRMED` → `PLACED`, then the
  same after-placement steps as cash orders (auto-accept or the acceptance timer).
- **Failure or expiry:** order `PAYMENT_FAILED`, coupon released.
- **Late success** (money captured after the order failed or was cancelled): the payment is recorded and
  an automatic full refund is created (`late:<paymentId>`).
- The gateway fee and its tax are stored on the payment when the gateway reports them.

### D-86. Refunds
`refunds` rows come from three places:
1. **Cancellations** (`refundDuePaise` of the outcome, OD-38): the system actor, key `cancel:<orderId>`.
2. **Late success**: the system actor, key `late:<paymentId>`.
3. **Admins** (`refunds.create`), with a reason: types FULL, PARTIAL (an amount), ITEM (chosen lines),
   DELIVERY, PLATFORM_FEE, MANUAL.

Approval: admin refunds above `refunds.approval.thresholdPaise` wait for **a different admin** with
`refunds.approve` (maker-checker).

Processing:
- Statuses: `PENDING_APPROVAL → REQUESTED → PROCESSING → SUCCEEDED | FAILED` (`REJECTED` by the approver).
- Worker job `refund.process` calls the gateway. Completion comes from the refund webhook or a status check.
- Failures retry 3 times with back-off, then flag the order.
- `payments.refundedPaise` never exceeds `capturedPaise` (database rule), and the total of open refunds is
  checked before a new one.
- Order `financialStatus`: `REFUND_PENDING` → `PARTIALLY_REFUNDED` | `REFUNDED`.

Cash-on-delivery refunds are paid back outside the gateway and recorded with a manual reference (no
payment). Who bears a refund (restaurant or Jamzo) is recorded on the refund (`bearer`); ledger postings
are Phase 8.

### D-87. Admin payments and refunds
Jamzo Admin gets:
- a **Payments** list with filters, and a payment detail: attempts, gateway events, fee, refunds, and
  "Check with gateway" (`payments.reconcile`);
- a **Refunds** list with approve/reject;
- a **Refund** dialog on the order.

Every refund action is audit-logged.

## 2f. Engineering decisions — Phase 8 (ledgers and settlements)

### D-88. When money is posted
Postings are pure functions in `@jamzo/settlement-engine`. The worker writes them from the order's outbox
events (`order.delivered`, `order.cancelled`, `order.refunded`), not inside the order transaction, so a
ledger problem can never block a delivery. Each entry has a unique idempotency key, so a repeated or late
job never posts twice.
- **Delivered:** restaurant FOOD_SALE (food + packaging + any rounding it absorbs), RESTAURANT_FUNDED_DISCOUNT,
  COMMISSION, COMMISSION_TAX, WITHHOLDING. Rider: the final earning split into base, distance, waiting,
  incentive and tip, plus COD_COLLECTED for cash orders. Platform: markup, commission, fees, surcharges,
  platform-funded discounts, the **actual** rider cost and the **actual** gateway fee, rounding, and the
  liabilities (taxes collected, withholding, tips passed through) kept apart from revenue.
- **Cancelled:** the restaurant's compensation (credit); a cancelled trip's pay (rider); the fee kept
  from the customer, the compensation costs and any gateway fee (platform).
- **Refunded after delivery:** RESTAURANT → restaurant REFUND debit; PLATFORM → platform REFUND_LOSS.
  Refunds before delivery only return money that was never recognised, so nothing is posted.

The conservation rule of SETTLEMENTS.md §5 is checked per delivered order with the actual amounts (a
Finance "Checks" view), together with a recomputation of every cached balance from its entries.

### D-89. Settlements (no real payouts)
A settlement takes a ledger's unsettled entries up to the period's cut-off, per schedule (`settlements.restaurants`
per restaurant; `settlements.riders`), in India time. One settlement per ledger per period (database rule).
A net below the minimum payout creates nothing: it carries forward. Lifecycle:
**DRAFT → (Finance approves) PROCESSING → PAID** (the payout reference is typed in after paying outside
Jamzo; a SETTLEMENT / PAYOUT debit is posted) **or FAILED / CANCELLED** (the entries are released for the
next run). **Jamzo does not move money:** payout rails are Q-5b. Settlements are created by "Run
settlements" in Jamzo Admin and by a daily worker job at 06:00 India time. The reserve percentage is not
applied yet (the setting stays 0).

### D-90. Cash on delivery deposits
The rider reports a deposit in the app (UPI, bank or cash at a hub, amount, reference), or an admin records
cash received at a hub. Finance verifies it (COD_SUBMITTED: cash held goes down by the amount) or rejects
it with a reason. Collected cash payments are marked reconciled in collection order once the verified
deposits cover them (FIFO). A deposit above the cash held becomes COD_EXCESS: Jamzo owes the rider. Cash
held used by dispatch is now collected minus verified deposits.

### D-91. Delivery partner settlement and netting
Earnings in the period minus the cash held (when `cod.netAgainstEarnings`) is what gets paid. When paid,
the netted cash is closed with an earnings debit and a COD_SUBMITTED entry ("netted"). A negative result
pays nothing and carries forward; the rider app shows what the rider owes.

### D-92. Adjustments, statements, invoices
- **Adjustments:** manual ledger adjustments need `ledgers.adjust`, a reason and an idempotency key, and are
  audit-logged. A second approver for large adjustments is **not built yet**.
- **Statements:** CSV from the ledger entries (Jamzo Admin). The restaurant app shows the balance and each
  settlement's breakdown. PDFs come later.
- **Invoices and credit notes** are **not built**: who issues which document is the CA's decision (Q-3,
  Q-12). The `invoices` tables stay LATER.

## 2g. Engineering decisions — Phase 9 (admin operations)

### D-93. Customer support
- **Raising a ticket:** a customer raises one from an order ("Get help": missing item, wrong item, food
  quality, late delivery, delivery partner, restaurant, payment, refund, other — §47) or without an order.
  Ticket number `SUP-YYMMDD-NNNNN`; one open ticket per order and issue type (a repeat tap returns it).
- **Conversation:** the customer and support write messages. Agents can also add **internal notes** that
  the customer never sees. The customer gets a push when support replies (template `support.reply`).
- **Agents** (`support.manage`): assign to themselves or another admin, move through
  OPEN → IN_PROGRESS → WAITING_ON_CUSTOMER → RESOLVED (a resolution note is required) → CLOSED, reopen on a
  new customer message. The ticket page shows the full order (the admin order view), so refunds use the
  existing Refund dialog (`refunds.create`).
- **Scope and measures:** tickets carry the order's city, for city-scoped support; first-response and
  resolution times are recorded.
- **Not built:** tickets raised by restaurants and delivery partners, and photo attachments.

### D-94. Orders page: filters, saved views, bulk actions
- **Filters:** status, delivery status, money status (refunds), payment method, city, zone, restaurant,
  delivery partner, amount range and dates. Search also matches the partner's name, and a customer's full
  phone number, but only for admins with `customers.pii`.
- **Saved views:** the filter set, private or shared with every admin who can see orders
  (`admin_saved_views`).
- **Bulk actions (only safe ones):** export the filtered orders as CSV (phones masked without
  `customers.pii`, at most 5 000 rows, audited), and "mark handled" for flagged orders (`orders.edit`, one
  note, audited per order). There is no bulk cancel or refund: each needs its own check.

### D-95. Analytics (computed on demand)
KPIs are computed from orders and the Jamzo ledger when asked, with no data warehouse:
- orders, GMV (delivered orders' totals), net platform revenue (Phase 8 ledger), average order value;
- completed, cancelled and refunded;
- active restaurants, active and online delivery partners;
- average delivery time (placed → delivered) and preparation time (accepted → ready).

Filters are a date range and a breakdown by city, zone, restaurant or payment method, limited to the admin's
cities. Results are cached for 60 seconds. None of this is on the ordering path (§44).

### D-96. Restaurant and delivery partner analytics
- **Restaurant app** (owners and managers): orders, sales at their own prices, average order value, top
  products, cancelled orders, commission, their discounts, net, and busy hours — today / 7 / 30 days (§45).
- **Delivery Partner app:** trips, distance, earnings, tips, incentives, cash collected, online hours (from
  shifts) and acceptance rate (offers accepted ÷ offered) (§46).

### D-97. Audit log
The audit log (Phase 1) already records actor, action, entity, old and new values, IP and device. Phase 9
adds, in Jamzo Admin, filters by action prefix and dates and a CSV export (`audit.view`, audited).
Notification preferences (`notification_preferences`) stay LATER: there are no promotional messages yet.

## 2h. Engineering decisions — Phase 10 (production hardening)

### D-98. File storage on DigitalOcean Spaces
Until now there was only a local-disk driver (refused in staging/production), so the API could not start in
production. Phase 10 adds `MEDIA_STORAGE_DRIVER=spaces`, an S3-compatible driver (AWS SDK v3) with
`SPACES_ENDPOINT` (e.g. `https://blr1.digitaloceanspaces.com`), `SPACES_BUCKET`, `SPACES_KEY` and
`SPACES_SECRET`. Image renditions are uploaded public-read, so `MEDIA_PUBLIC_BASE_URL` can point at the Spaces
CDN (speed, D-72). Private documents (`private/…`) stay private and are read only through the API. The driver
is tested against a fake S3 server and is **not verified with DigitalOcean** until the owner creates the Space
and its keys.

### D-99. Health, readiness and metrics
- `/health`: the process is up.
- `/ready`: the database answers and the outbox is not stuck (oldest waiting job < 5 min); otherwise 503.
- `/metrics`: Prometheus text behind `METRICS_TOKEN` — requests by route and status, a latency histogram,
  outbox waiting / parked counts and age, payments waiting, refunds failed, settlements to pay.

DigitalOcean's uptime checks and alerts watch `/ready` (launch runbook). Error reporting to a SaaS (Sentry) is
not wired in: Q-11 is still open.

### D-100. Security hardening
- **Proxy:** `TRUST_PROXY` so client IPs are right behind the reverse proxy (for rate limits and audit IPs).
- **Responses:** compression.
- **Admin site:** security headers (HSTS, frame denial, no sniffing, a referrer policy and a CSP that allows
  only this origin; inline scripts are allowed because Next.js needs them for hydration).
- **Shutdown:** graceful — the API drains requests on SIGTERM, and the worker finishes its current batch.
- **CI checks:** a secret scan (`pnpm check:secrets`: private keys, live gateway keys, cloud keys) and a
  dependency audit report.

Admin two-factor authentication: built after the owner's answer (OD-43, D-106).

### D-101. Deployment on DigitalOcean (Option 2)
One Docker image holds the API and the worker (two commands), and a second holds the admin site. They run on
the 2 GiB Droplet with Docker Compose behind **Caddy**, which gets and renews HTTPS certificates
automatically:
- `api.jamzo.in` → API;
- `admin.jamzo.in` → admin site.

Deploys run `prisma migrate deploy` (expand-only migrations) before the new containers start. Rollback means
running the previous image tag. The images are built in CI; the Mac has no Docker. The runbook in
DEPLOYMENT.md covers GoDaddy DNS, the managed database (SSL), Spaces, and the order of first-time steps.
**Nothing is created or bought without the owner** (OD-40).

### D-102. Load test and speed
`pnpm load-test` runs a rush-hour mix: home, menus, cart quotes, order tracking and checkout, against an API
with the seeded catalog. It reports p50 / p95 / p99 and throughput against D-72 (p95 < 300 ms). Phase 10 runs
it on the development Mac. That is **not** DigitalOcean hardware, so the D-72 launch condition stays open
until the same test runs on the staging Droplet.

### D-103. Backups and restore
- The managed PostgreSQL has daily backups and 7-day point-in-time restore (DigitalOcean).
- In addition, `pnpm db:backup` writes a compressed `pg_dump`, which is uploaded to Spaces in production.
- `pnpm db:restore-drill` restores the latest dump into a scratch database and compares table row counts.
  It is run in Phase 10 on the development database; the launch runbook repeats it on staging.

### D-104. SMS through MSG91 (Q-6, OD-39)
`SMS_PROVIDER=msg91` sends sign-in codes through MSG91's **Flow API** (`POST /api/v5/flow`). Indian rules
(DLT) only allow SMS text that matches a registered template, so Jamzo does not send free text: it sends the
template id and the code as a template variable.
- Env (server only): `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_OTP_VAR` (the variable name in the
  template, default `otp`). Staging/production refuse to start without them.
- The template the owner registers must read like: `##otp## is your Jamzo verification code. It expires in
  5 minutes. Do not share it with anyone.`
- A `type: "error"` reply, an HTTP error or a 10 s timeout counts as not sent: the code is withdrawn and the
  person sees "We could not send the code".
- **Tested only against a fake MSG91 server** — not verified with MSG91 until the owner's account, DLT sender
  id and template exist (Q-6b).

### D-105. Email over SMTP
`EMAIL_PROVIDER=smtp` sends plain-text email through any SMTP service (for example Zoho Mail, Amazon SES, Brevo
or Google Workspace), using **nodemailer**. Env: `SMTP_HOST`, `SMTP_PORT` (587 = STARTTLS, 465 = TLS),
`SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (e.g. `Jamzo <no-reply@jamzo.in>`). Staging/production refuse to start
without them. Tested against a local SMTP server in the test suite; the real service is the owner's choice
(Q-6b). The sending domain needs SPF/DKIM records at GoDaddy so codes do not land in spam.

### D-106. Admin two-step sign-in (OD-43, replaces D-25)
1. `POST /v1/admin/auth/login` checks the password (lockout unchanged). If two-step sign-in is on, it returns
   `{ twoFactor: { challengeId, channel, sentTo (masked), expiresAt } }` and **no tokens**.
2. The code goes by SMS when the admin's user has a phone number, otherwise by email. It is an
   `otp_challenges` row with purpose `ADMIN_2FA`, with the same expiry, attempt limit, resend wait and hourly
   limit as other sign-in codes (Jamzo Admin → `auth.otp`).
3. `POST /v1/admin/auth/verify` with `{ challengeId, code }` issues the session and cookie. Wrong codes count
   toward the attempt limit; a fresh password sign-in sends a new code.
4. `ADMIN_2FA=required|off`. Staging and production **must** be `required`; development and tests default to
   `off` so local sign-in stays quick. The admin E2E tests run with it on.
5. The mobile sign-in endpoints refuse admin challenges, and the admin verify endpoint refuses mobile ones.
6. Audit: `admin.login_code_sent`, `admin.login` (after the code), `admin.login_code_failed`.

TOTP apps (Google Authenticator) are not built; the owner chose email/SMS.

### D-107. Brand: logo kit, colours and fonts (OD-44, replaces D-16 and D-17)
- **Logo files** live in `assets/brand/jamzo-logo-kit/` (the owner's kit, unchanged). App icons, Android
  adaptive icons, splash screens and the admin favicon are copied from it by `scripts/brand-assets.mjs`.
- **Colours** (`@jamzo/ui` tokens): primary = midnight navy `#1B2250` (headers, titles), accent = turmeric
  `#F2B21B` (offers, highlights, the logo smile), action = leaf green. White text on the kit's leaf green
  `#2F8F6B` is only 3.99:1, below WCAG AA (4.5:1), so buttons and green text use a darker leaf `#267A5B`
  (5.23:1); `#2F8F6B` stays for icons and veg marks. Background = cool white `#F4F5FB`.
- **All three apps use the same Jamzo icon** (the kit has one). The partner apps are told apart by their
  names on the phone ("Jamzo Restaurant Partner", "Jamzo Delivery Partner") and a label on their sign-in screens.
- **Fonts:** Poppins (titles, prices, buttons) and Inter (reading text), both SIL Open Font License, bundled in
  the apps (`@expo-google-fonts/*`) and served by `next/font` in the admin. Hind Vadodara is the planned
  Gujarati font if the apps are translated.
- **Prices in the apps** show whole rupees without ".00" (`₹180`, `₹180.50`) through `formatPrice`. The admin
  and the partner apps' money screens (payouts, settlements, order money) keep `formatPaise` (always two decimals). Display only: money stays integer paise.

### D-108. Navigation: bottom tabs and back buttons (OD-44)
- Customer app: bottom tabs **Home, Search, Orders, Account**. Every other screen opens on top of them.
- **Every screen that is not a tab has a back arrow** at the top left (shared `Header` in `@jamzo/mobile-ui`).
  If there is nothing to go back to (the screen was opened from a notification link), it goes to Home.
  iPhone swipe-back and the Android back button keep working.
- Dish options open as a **bottom sheet** over the menu (iOS form sheet), closed by swiping down or ✕.

### D-109. Customer screens in the food-app style (OD-44)
Patterns taken from the owner's Zomato screenshots, in Jamzo's colours and words (no copied images, names or
text):
- **Menu rows:** veg mark, bestseller tag, name, price, two-line description with "more"; the dish photo on
  the right with an **ADD** button overlapping its bottom edge; after adding, the button becomes a − 1 +
  stepper. Dishes without a photo show the button without a photo box.
- **Cart bar:** a green bar pinned to the bottom, "2 items added · ₹360 · View cart".
- **Cart:** header with the restaurant, delivery time and address; item steppers; "Add more items"; coupon,
  tip and bill in cards; a pinned bottom bar with the total and the next step.
- **Account:** a profile card and grouped rows with icons and chevrons.
- **Ratings stay hidden** until a restaurant has ratings (customers cannot rate orders yet).
- Photos are optional: without them, cards fall back to a neat tinted box with the restaurant's initial.

## 3. Changes from MASTER_SPEC (OD-30)



| # | Change | Why | Consequence | Approval |
|---|---|---|---|---|
| CH-1 | Brand BiteMitra → **Jamzo**; ids `in.jamzo.*` (spec examples used `com.platform.*`) | OD-3 | docs/packages renamed `@jamzo/*` | Owner-directed |
| CH-2 | **No Polaris**; Tailwind + shadcn/ui + own design system (spec §4, §28, B4) | licence/maintenance findings, D-12 | admin visuals are Jamzo's own | Pre-authorised by OD-2 — please confirm you accept the findings |
| CH-3 | JavaScript instead of TypeScript (spec §4) | OD-1 | correctness relies on zod, checkJs, tests | Owner-directed |
| CH-4 | Kitchen/delivery tracks with derived §18 status | kitchen and dispatch run concurrently | spec statuses preserved as the derived overall status | Owner-endorsed (OD-17) |
| CH-5 | Extra overall status `PAYMENT_FAILED` | §56 needs a terminal state | one more enum value | **Approved (OD-39)** |
| CH-6 | `delivery-engine` holds dispatch logic (spec A §3 lists `dispatch-engine`) | B6 mandates `delivery-engine`; API still has a separate dispatch module | none | Informational |
| CH-7 | No Redis/BullMQ in Phase 1 (spec §4 "Redis when required") | OD-27; Postgres outbox polling suffices | revisit at the D-9 triggers | Informational |
| CH-8 | Admin 2FA deferred to before production | Phase 1 scope | admin must not be exposed publicly until done | Done — OD-43, D-106 |
| CH-10 | pnpm hoisted layout instead of isolated installs (Phase 0 D-2) | duplicate React Native copies | single versions across apps; coordinated SDK upgrades (D-30) | **Please acknowledge D-30** |
| CH-11 | Tests on embedded real PostgreSQL instead of PGlite | PGlite socket server dropped connections after errors | closer to production | Informational |
| CH-12 | Restaurant self-editing of menu content not built in Phase 2 (spec §19) | needs a price/content review flow; flag stays off | restaurants use sold-out toggles and store controls; Jamzo edits menus | Needs approval (D-39) |
| CH-13 | Product admin shows no customer-price preview yet (spec §31 "customer/display price preview, markup, tax") | markup and tax rules are Phase 4 | the editor says so; preview added with the pricing engine | Informational |
| CH-14 | `restaurant_settings` slimmed; hierarchical values use the settings registry | avoid two sources of truth | admins override per restaurant/branch in Configuration | Informational (D-40) |
| CH-15 | Cart quote endpoint `/v1/customer/cart/quote` (ORDER_FLOW said `/v1/cart/quote`) | customer resources share one prefix (API.md §1) | none | Informational |
| CH-16 | `rider_earning_rules` activated in Phase 4 instead of 6 | quotes need the rider-cost estimate (D-53) | rule editing available earlier | Informational |
| CH-17 | Delivery fees use straight-line distance × 1.3, flagged FALLBACK, until a maps provider is chosen (OD-14 wants road distance) | no provider decided (Q-14) | fees may differ from road distance; every quote says which source was used | **Needs Q-14** |
| CH-18 | Phase 5 accepts COD and ₹0 orders only; online payment waits for Phase 7 (D-60) | payments are Phase 7; the client can never be trusted to have paid | customers cannot pay online until Phase 7 | Recorded |
| CH-19 | Phase 5 orders stop at READY_FOR_PICKUP; delivery starts with dispatch in Phase 6 (D-61) | riders are Phase 6 | the full lifecycle is proven in the engine tests, not end to end, until Phase 6 | Recorded |
| CH-21 | Customers may cancel after the restaurant accepted (ORDERS.md §5 left it to the rule) — with no refund, per OD-38 | owner decision | fewer support calls; the app warns before confirming | Recorded |
| CH-22 | `payments` activated in Phase 6 for cash-on-delivery collection only (planned for Phase 7) | COD collection must be recorded when the rider delivers (§23) | online payment still Phase 7 | Recorded |
| CH-23 | Aadhaar numbers are not collected (spec lists KYC generally) | Aadhaar storage rules; not needed for delivery partners | identity proof by photo only, number masked by the rider | Recorded (legal review Q-12) |
| CH-20 | `reviews` and `notification_preferences` move from Phase 5 to Phase 6 / Phase 9 | reviews need delivered orders; preferences need the marketing notifications of Phase 9 | none now | Recorded |
| CH-9 | Extra admin roles beyond OD-24 kept from spec §42 (Rider Manager, Marketing, Content Manager) and spec's platform "Restaurant Manager" renamed **Partner Manager** to avoid clashing with the restaurant-side "Restaurant Manager" | naming collision | clearer RBAC | **Approved (OD-39)** |

## 4. Assumptions (configurable defaults)

| # | Assumption |
|---|---|
| A-1 | INR only; India; timezone per city (Asia/Kolkata). Multi-currency modelled, not implemented. |
| A-2 | One branch per restaurant at launch; chains/multi-branch supported by schema. |
| A-3 | Delivery orders only at launch; pickup and scheduled orders modelled for later. |
| A-4 | No cross-city delivery. |
| A-5 | Ledger postings recognised at delivery. |
| A-6 | Weekly settlement for restaurants (OD-22) and riders; per-restaurant override. |
| A-7 | Restaurant acceptance timeout 180 s → escalate → auto-reject after 120 s. |
| A-8 | Final bill rounding: nearest ₹1, shown as an explicit line (OD-16); who absorbs it: platform (configurable). |
| A-9 | At most one coupon + one automatic promotion per order. |
| A-10 | Packaging set by restaurant, no markup, passed through; tax treatment pending Q-3. |
| A-11 | Customers log in with phone OTP; guest browsing on; login required at checkout. |
| A-13 | Rider pay estimated at placement, finalised at delivery. |
| A-14 | Rider acceptance history not used in dispatch scoring until ops/legal agree. |
| A-16 | All money amounts in configuration defaults are **placeholders**. |
| A-17 | Commission basis default for development: food value after restaurant-funded discount — **placeholder** (OD-10, Q-7). |
| A-18 | Markup disclosure default for development: `NONE` (customer sees final item prices only) — **pending legal (Q-4)**; setting `pricing.markupDisclosure` = NONE \| NOTE \| ITEMISED. |
| A-19 | Route-distance fallback: `haversine × 1.3` with the order flagged `distanceSource = FALLBACK`; alternative setting value `REJECT` refuses to quote. |
| A-21 | Required restaurant documents before approval: FSSAI and PAN (setting `restaurants.requiredDocuments`); GST certificate only when the restaurant has a GSTIN. **Legal review** (Q-12). |
| A-22 | New branch preparation time 20 minutes; pause limited to 15–120 minutes; busy mode adds 10 minutes (setting `restaurants.operations`). |
| A-23 | Development pricing defaults (all **placeholders**, A-16): no global markup (demo: Pizza Point +10% with Farmhouse +15%, the owner's example); commission 15% on food value after restaurant-funded discount; platform fee ₹5; delivery slabs 0–2 km ₹20, 2–4 km ₹30, 4–6 km ₹40, max 7 km, free above ₹499; small-order fee ₹15 below ₹99; night surcharge ₹10 23:00–06:00 (only while flag `night_pricing` is on); rider ₹25 incl. 2 km + ₹6/km; tax per D-51. |
| A-24 | ETA estimate: average rider speed 18 km/h, 5-minute buffer, shown as a 10-minute range (setting `delivery.eta`). |
| A-25 | ~~Placeholder cancellation rule~~ — replaced by the owner's rule OD-38 / D-70. Rider compensation stays 0 until Phase 6. |
| A-26 | Restaurant reject reasons: item unavailable, too busy, closing soon, cannot deliver this order, other (text). Prep time on accept: 5–60 minutes in 5-minute steps (bounded by `orders.preparation.maxPrepMinutes`). |
| A-20 | Store names: "Jamzo", "Jamzo Restaurant Partner", "Jamzo Delivery Partner"; URL schemes `jamzo`, `jamzo-restaurant`, `jamzo-rider` (Q-8). |

## 5. Questions

### Resolved
| # | Question | Resolution |
|---|---|---|
| Q-1 | Polaris licence | Not used — D-12 |
| Q-2 | tsc as JSDoc checker | Allowed — OD-1, D-1 |
| Q-8 | Identifiers & domain | `in.jamzo.*`, jamzo.in (OD-3); store names still proposal A-20 |
| Q-9 | Distance source | Road distance preferred, configurable fallback (OD-14, A-19) |
| Q-10 | Tips / rounding | Tips 100% to rider, configurable (OD-15); rounding configurable & explicit (OD-16) |
| Q-5a | First payment gateway | Razorpay (OD-11) |
| Q-19 | Add-on markup rounding | Round add-ons too (OD-39, D-59) |
| Q-7 | Commission basis | After restaurant-funded discounts (OD-39) |
| Q-6 | SMS/OTP provider | MSG91; Google/Apple sign-in later (OD-39) |
| Q-13 | Brand assets | Jamzo logo kit v7, Poppins + Inter (OD-44, D-107). The legacy BiteMitra kit stays unused |
| Q-15 | Admin 2FA method | Code by email, or SMS if the admin has a phone (OD-43, D-106) |
| Q-20 | Cancellation money | OD-38 / D-70 (rider compensation with Phase 6) |
| Q-16 | GitHub push | Pushed 2026-09-24 using `https://harshad1411@github.com/harshad1411/bitemitra.git` (the username in the URL selects the right saved credential) |

### Open — must be answered before **production financial launch** (do not block development)
- **Q-3 (CA)** GST liability on food (platform as e-commerce operator vs restaurant) and taxable value when marked up; GST on delivery / platform / small-order fees, surcharges, packaging; GST on commission; TCS (GST) and TDS (income tax) on restaurant payouts; invoice issuer per document type. See [PRICING.md §11](PRICING.md#11-open-tax--legal-questions-owner--ca-must-decide).
- **Q-4 (legal)** Is customer-price markup over the restaurant's menu price permitted for Jamzo's model; must it be disclosed; does it make Jamzo seller of record?
- **Q-5b** Payouts (OD-39): automatic payout when the restaurant requests it and an admin approves, with a manual (bank transfer) mode too — Phase 8; provider (e.g. RazorpayX) to be chosen then.
- **Q-12 (legal)** Legal entity + GSTIN, FSSAI obligations as aggregator, policies (privacy, terms, refunds), rider engagement model, DPDP compliance.

### Open — needed for later phases or real-device testing
- **Q-6b** MSG91 account, DLT sender id and the OTP template (owner) — the code is built (D-104). Email: which SMTP service, and SPF/DKIM at GoDaddy (D-105). Google/Apple sign-in later.
- **Q-11** Hosting decided: DigitalOcean Bangalore, Option 2 (OD-40, D-72). Still open: SaaS processors such as Sentry for error reports.
- **Q-14** Maps/distance provider (Google Maps Platform vs Ola Maps / Mappls) — cost-driven; needed by Phase 3/6.
- **Q-17 (toolchains)** — install **approved** (OD-39). Native builds and simulator runs need Xcode's iOS simulator runtime + CocoaPods and the Android SDK + Java 17, none of which are installed on this Mac (multi-GB installs; not done without approval). Alternatives: rely on the CI native build jobs, or on EAS Build once the Expo account exists (Q-18).
- **Q-21** Masked calling provider for customer ↔ rider calls (Exotel, Knowlarity, …) — until then calls go to Jamzo support (D-80).
- **Q-18 (Expo/EAS)** — owner will create it (OD-39). An Expo account and three EAS projects are needed for push tokens, OTA updates and store builds; the owner creates them (no store publication during development).
