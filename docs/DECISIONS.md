# Decisions, assumptions & open questions

**This file is the authoritative record of architectural and business decisions** (owner directive
OD-30). Other documents describe *how*; this file records *what was decided, by whom, and why*.

- **OD-n** — owner decisions (binding; changed only by the owner).
- **D-n** — engineering decisions (made by the build team within the owner's rules; revisable).
- **A-n** — assumptions: configurable defaults, safe to change.
- **Q-n** — questions only the owner (or their CA/lawyer) can answer.
- **CH-n** — changes from MASTER_SPEC, with approval status.

Last updated: 2026-09-24 (Phase 1 start).

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

## 2. Engineering decisions

### D-1. JavaScript-only monorepo with optional JSDoc checking (OD-1)
ESM JavaScript; zod schemas are the runtime contract; JSDoc annotations for editors. `tsc --noEmit`
with `checkJs` runs over Node packages and services as a **static checker only** (config lives in
`tsconfig.json` files, which are JSON, not TypeScript source). `pnpm check:docs` fails on any `.ts`/`.tsx` file.
Strictness is deliberately moderate (`strict: false`, `strictNullChecks: true`, `noImplicitAny: false`) so the
checker catches real mistakes without forcing TypeScript-style annotation everywhere.

### D-2. pnpm workspaces + Turborepo
Isolated installs keep each Expo app's native dependency graph independent; affected-only tasks.

### D-3. Modular monolith API (Fastify) + separately runnable worker (OD-5)
API modules (Phase 1 in **bold**): **auth**, **rbac/access**, **audit**, **geography** (countries, states, cities, zones, service areas, serviceability), **configuration** (settings, feature flags, app versions, remote config), **media**, customers, restaurants, restaurant branches, catalog, menus, cart, pricing, promotions, orders, payments, refunds, delivery, dispatch, riders, ledger, settlements, notifications, reviews, support, analytics. A module owns its tables; other modules call its service functions.

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

### D-13. Tests on PGlite locally + real PostgreSQL in CI; Playwright for admin; Maestro planned for mobile
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

## 3. Changes from MASTER_SPEC (OD-30)

| # | Change | Why | Consequence | Approval |
|---|---|---|---|---|
| CH-1 | Brand BiteMitra → **Jamzo**; ids `in.jamzo.*` (spec examples used `com.platform.*`) | OD-3 | docs/packages renamed `@jamzo/*` | Owner-directed |
| CH-2 | **No Polaris**; Tailwind + shadcn/ui + own design system (spec §4, §28, B4) | licence/maintenance findings, D-12 | admin visuals are Jamzo's own | Pre-authorised by OD-2 — please confirm you accept the findings |
| CH-3 | JavaScript instead of TypeScript (spec §4) | OD-1 | correctness relies on zod, checkJs, tests | Owner-directed |
| CH-4 | Kitchen/delivery tracks with derived §18 status | kitchen and dispatch run concurrently | spec statuses preserved as the derived overall status | Owner-endorsed (OD-17) |
| CH-5 | Extra overall status `PAYMENT_FAILED` | §56 needs a terminal state | one more enum value | Needs approval (low risk) |
| CH-6 | `delivery-engine` holds dispatch logic (spec A §3 lists `dispatch-engine`) | B6 mandates `delivery-engine`; API still has a separate dispatch module | none | Informational |
| CH-7 | No Redis/BullMQ in Phase 1 (spec §4 "Redis when required") | OD-27; Postgres outbox polling suffices | revisit at the D-9 triggers | Informational |
| CH-8 | Admin 2FA deferred to before production | Phase 1 scope | admin must not be exposed publicly until done | Needs approval |
| CH-9 | Extra admin roles beyond OD-24 kept from spec §42 (Rider Manager, Marketing, Content Manager) and spec's platform "Restaurant Manager" renamed **Partner Manager** to avoid clashing with the restaurant-side "Restaurant Manager" | naming collision | clearer RBAC | Needs approval |

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
| A-18 | Markup disclosure default for development: `NONE` (customer sees final item prices only) — **pending legal (Q-4)**; setting `pricing.markup.disclosure` = NONE \| NOTE \| ITEMISED. |
| A-19 | Route-distance fallback: `haversine × 1.3` with the order flagged `distanceSource = FALLBACK`; alternative setting value `REJECT` refuses to quote. |
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

### Open — must be answered before **production financial launch** (do not block development)
- **Q-3 (CA)** GST liability on food (platform as e-commerce operator vs restaurant) and taxable value when marked up; GST on delivery / platform / small-order fees, surcharges, packaging; GST on commission; TCS (GST) and TDS (income tax) on restaurant payouts; invoice issuer per document type. See [PRICING.md §11](PRICING.md#11-open-tax--legal-questions-owner--ca-must-decide).
- **Q-4 (legal)** Is customer-price markup over the restaurant's menu price permitted for Jamzo's model; must it be disclosed; does it make Jamzo seller of record?
- **Q-7 (business)** Default commission basis and the base for restaurant-funded discounts (display price incl. markup vs restaurant base price).
- **Q-5b** Payout rails for restaurant/rider settlements (manual bank transfer vs RazorpayX-style payouts API).
- **Q-12 (legal)** Legal entity + GSTIN, FSSAI obligations as aggregator, policies (privacy, terms, refunds), rider engagement model, DPDP compliance.

### Open — needed for later phases or real-device testing
- **Q-6** Indian DLT-compliant SMS/OTP provider (MSG91, Gupshup, Exotel, Twilio…) and email provider. **Q-6b** Google/Apple sign-in client ids.
- **Q-11** Hosting target and budget; acceptability of SaaS processors (e.g. Sentry) for data.
- **Q-13** Jamzo brand assets: logo, colours, typography (placeholders in use — D-16, D-17). Should the legacy BiteMitra kit be deleted?
- **Q-14** Maps/distance provider (Google Maps Platform vs Ola Maps / Mappls) — cost-driven; needed by Phase 3/6.
- **Q-15** Admin 2FA method (TOTP app vs email OTP) — before production (CH-8).
