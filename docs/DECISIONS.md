# Decisions, assumptions & open questions

**This file is the authoritative record of architectural and business decisions** (owner directive
OD-30). Other documents describe *how*; this file records *what was decided, by whom, and why*.

- **OD-n** — owner decisions (binding; changed only by the owner).
- **D-n** — engineering decisions (made by the build team within the owner's rules; revisable).
- **A-n** — assumptions: configurable defaults, safe to change.
- **Q-n** — questions only the owner (or their CA/lawyer) can answer.
- **CH-n** — changes from MASTER_SPEC, with approval status.

Last updated: 2026-09-25 (Phase 5 complete — awaiting owner review).

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
| OD-40 | **Hosting** (owner, 2026-09-25, Q-11): a **single provider — DigitalOcean, Bangalore region** — for the API, worker, admin website, managed PostgreSQL and file storage (Spaces). Replaces the brief Supabase + Vercel idea. **Nothing is hosted during development** ($0); a pilot setup (~$54/month: 1 API, worker, admin, 1 GiB database without standby, Spaces) when testing with real phones and restaurants; the launch setup (~$114/month: 2 API instances, worker, admin, 2 GiB database **with standby** + daily backups, Spaces) before real customers. Prices checked 2026-09-25 on digitalocean.com (excl. 18% GST); **re-check and show the owner the final price at launch time**. → D-71. |

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
BiteMitra logo kit is kept in `assets/legacy/bitemitra-logo-kit/` and is **not used**. Final assets: Q-13.

### D-17. Provisional Jamzo colour palette
Until brand guidelines exist, tokens in `@jamzo/ui` use a provisional palette (deep plum primary
`#5B2A86`, saffron accent `#F2A516`, neutral greys, semantic success/warning/critical/info) chosen to be
distinct from Shopify's green and from competitors' reds/oranges. All colour lives in tokens, so the final
palette is a one-file change. Per-app accents: customer plum, restaurant partner teal `#0F766E`,
delivery partner saffron. (Q-13)

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
Password + lockout + rate limits in Phase 1; TOTP 2FA before any production admin use (Q-15).

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
| CH-8 | Admin 2FA deferred to before production | Phase 1 scope | admin must not be exposed publicly until done | Needs approval |
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
| Q-20 | Cancellation money | OD-38 / D-70 (rider compensation with Phase 6) |
| Q-16 | GitHub push | Pushed 2026-09-24 using `https://harshad1411@github.com/harshad1411/bitemitra.git` (the username in the URL selects the right saved credential) |

### Open — must be answered before **production financial launch** (do not block development)
- **Q-3 (CA)** GST liability on food (platform as e-commerce operator vs restaurant) and taxable value when marked up; GST on delivery / platform / small-order fees, surcharges, packaging; GST on commission; TCS (GST) and TDS (income tax) on restaurant payouts; invoice issuer per document type. See [PRICING.md §11](PRICING.md#11-open-tax--legal-questions-owner--ca-must-decide).
- **Q-4 (legal)** Is customer-price markup over the restaurant's menu price permitted for Jamzo's model; must it be disclosed; does it make Jamzo seller of record?
- **Q-5b** Payouts (OD-39): automatic payout when the restaurant requests it and an admin approves, with a manual (bank transfer) mode too — Phase 8; provider (e.g. RazorpayX) to be chosen then.
- **Q-12 (legal)** Legal entity + GSTIN, FSSAI obligations as aggregator, policies (privacy, terms, refunds), rider engagement model, DPDP compliance.

### Open — needed for later phases or real-device testing
- **Q-6b** MSG91 account, DLT sender id and templates (owner); email provider; Google/Apple sign-in later.
- **Q-11** Hosting decided: DigitalOcean Bangalore (OD-40). Still open: SaaS processors such as Sentry for error reports.
- **Q-13** Jamzo brand assets: logo, colours, typography (placeholders in use — D-16, D-17). Should the legacy BiteMitra kit be deleted?
- **Q-14** Maps/distance provider (Google Maps Platform vs Ola Maps / Mappls) — cost-driven; needed by Phase 3/6.
- **Q-15** Admin 2FA method (TOTP app vs email OTP) — before production (CH-8).
- **Q-17 (toolchains)** — install **approved** (OD-39). Native builds and simulator runs need Xcode's iOS simulator runtime + CocoaPods and the Android SDK + Java 17, none of which are installed on this Mac (multi-GB installs; not done without approval). Alternatives: rely on the CI native build jobs, or on EAS Build once the Expo account exists (Q-18).
- **Q-18 (Expo/EAS)** — owner will create it (OD-39). An Expo account and three EAS projects are needed for push tokens, OTA updates and store builds; the owner creates them (no store publication during development).
