# Decisions, assumptions & open questions

Status: **Phase 0 — for owner review.** Decisions (D) are made and can be revisited; assumptions (A)
are configurable defaults; questions (Q) need the owner because they affect money, tax, legal
compliance, irreversible choices or production credentials (MASTER_SPEC §79).

## Decisions

### D1. JavaScript-only monorepo (owner directive)
ESM JavaScript everywhere; zod schemas as the runtime contract; JSDoc for editor hints. Consequence:
correctness leans on validation + tests (coverage gates in [TESTING.md](TESTING.md)).

### D2. pnpm workspaces + Turborepo
Isolated installs keep each Expo app's native dependency graph independent; Turborepo gives cached,
affected-only builds so releasing one app doesn't rebuild the others.

### D3. Modular monolith API (Fastify) + separate worker process
Per §77. Domain modules with enforced boundaries; pure engines in `packages/*-engine`.

### D4. Pure business engines
Pricing, order state machine, dispatch/earnings, settlement postings are side-effect-free functions of
their inputs (time injected). Enables exact tests, admin previews, replay of historical orders.

### D5. PostgreSQL + integer paise + versioned rule tables + immutable snapshots
See [DATABASE.md](DATABASE.md).

### D6. Prisma 6 pinned
Prisma 7's new generator writes TypeScript source into the project; Prisma 6's `prisma-client-js`
generates into `node_modules`. Stay on 6.x (currently 6.19) until Prisma 7 can be used without adding
TypeScript source; revisit in Phase 10.

### D7. Two order tracks + derived spec status
Kitchen and delivery progress in parallel; overall status (spec §18 values) is derived. See [ORDERS.md §2](ORDERS.md#2-two-tracks-one-derived-status).

### D8. Additional order status `PAYMENT_FAILED`
Needed for the §56 "payment fails" path; §18 has no terminal state for it.

### D9. Transactional outbox + BullMQ (Redis)
No lost notifications/dispatch triggers; idempotent job handlers.

### D10. Socket.IO for realtime, REST for truth
Sockets only signal change; clients re-fetch. Robust to reconnects on poor networks.

### D11. Expo SDK 57, JavaScript template, Expo Router, EAS per app
Three independent projects with own ids, credentials, versions and pipelines. See [MOBILE.md](MOBILE.md).

### D12. Admin: Next.js Pages Router + React 18 behind a UI facade
Required by Polaris React 13's React 18 peer dependency; the facade lets the component library change
if Q1 goes the other way.

### D13. Testing on PGlite + Postgres in CI; Maestro for mobile E2E on both platforms
No local Postgres/Docker required to run the suite; CI covers real-Postgres parity.

### D14. `delivery-engine` holds dispatch
Satisfies Part B's package list; Part A's `dispatch-engine` is the same domain.

### D15. Distinct icon colours per app from the owner's logo kit
Orange (customer), charcoal (restaurant), leaf green (rider) — same mark, instantly distinguishable on a
phone that has more than one of the apps installed. Generated from `assets/brand/` in Phase 1.

## Assumptions (configurable defaults — change any time in Admin or by telling me)

| # | Assumption |
|---|---|
| A1 | Currency INR only; country India; timezone Asia/Kolkata per city. Multi-currency is modelled (`countries.currencyCode`) but not implemented. |
| A2 | One branch per restaurant at launch; chains/multi-branch supported by the schema. |
| A3 | Delivery orders only at launch; `OrderType.PICKUP` and `scheduledFor` exist for later. |
| A4 | Cross-city delivery is not allowed. |
| A5 | Revenue and ledger postings are recognised at DELIVERED. |
| A6 | Default settlement schedule WEEKLY for restaurants and riders; per-restaurant override. |
| A7 | Restaurant acceptance timeout 180 s → escalate to ops → auto-reject after 120 s more. |
| A8 | Final bill rounded to nearest ₹1; difference absorbed by platform (see Q10). |
| A9 | At most one coupon + one automatic promotion per order. |
| A10 | Packaging charge set by restaurant, no markup, passed through 100%, taxed like food (pending Q3). |
| A11 | Customer login by phone OTP; guest browsing allowed; login required at checkout. |
| A12 | Admin login email + password + TOTP 2FA. |
| A13 | Rider pay estimate stored at order placement; final pay computed at delivery from actual distance/wait. |
| A14 | Rider acceptance history is **not** used for dispatch scoring until ops/legal agree (switch exists). |
| A15 | App identifiers `com.bitemitra.{customer,restaurant,rider}` and names as in MOBILE.md (see Q8). |
| A16 | All numeric money defaults in CONFIGURATION.md are placeholders to be set by the owner before launch. |

## Critical questions

**Needed before Phase 1 starts**

### Q1. Shopify Polaris licence
Polaris React's licence (checked in the published package, v13.9.5) grants use outside Shopify only for
apps that are *"dissimilar and visually distinct from Shopify products and services (including the
internal administration page of a Shopify merchant store), as determined by Shopify in its sole
discretion."* The spec asks for an admin inspired by Shopify Admin, which is close to what that clause
restricts. Polaris React also hasn't shipped a release since March 2025 and supports React 18 only.
Options:
- **(a)** Use Polaris with a clearly distinct BiteMitra visual theme (own colours, typography, logo, layouts) and accept the residual risk — ideally after a quick legal opinion.
- **(b)** Use a permissively licensed (MIT) admin component library with similar information density (e.g. Mantine or Ant Design) and follow Shopify-*style* UX patterns without Polaris code.
- Recommendation: **(b)** for long-term safety, or (a) only with counsel's OK. Either way the admin code imports components via an internal facade, so switching later is contained.

### Q2. JSDoc type checking
With no `.ts` files, may the TypeScript compiler be used purely as a **checker** of JSDoc-annotated
`.js` files (`checkJs`, no TypeScript source, nothing emitted)? It catches a class of bugs cheaply,
especially in money code. If "no TypeScript" includes the tool, we rely on zod + ESLint + tests only.
Recommendation: allow it as a dev-only checker.

### Q8. App identifiers, names and store accounts (irreversible once published)
Confirm `com.bitemitra.customer` / `com.bitemitra.restaurant` / `com.bitemitra.rider`, the store names
(BiteMitra / BiteMitra Partner / BiteMitra Rider), the website domain for universal links, and that the
Apple Developer and Google Play accounts will be registered to the business (organisation account).

**Needed before Phase 4 (pricing) — money/tax/legal**

### Q3. GST treatment (needs your CA)
Who is liable for GST on food (platform as e-commerce operator vs restaurant), taxable value when marked
up, GST on delivery fee / platform fee / small-order fee / surcharges / packaging, GST on commission,
and whether GST TCS / income-tax TDS apply to restaurant payouts (rates, thresholds). The engine supports
all variants; only the defaults are unknown. See [PRICING.md §11](PRICING.md#11-open-tax--legal-questions-owner--ca-must-decide---q3-q4).

### Q4. Markup legality and disclosure
Is a customer price above the restaurant's own menu price permitted for your model, and must it be
disclosed? Does marking up make BiteMitra the seller of record (affects invoicing and tax)?

### Q7. Discount and commission bases
- (a) Restaurant-funded discounts are computed on the **customer display price** (which includes platform markup) — so a restaurant funding 50% of a 10% coupon pays 50% of 10% of the marked-up price. Alternative: compute the restaurant's share on its own base price and have the platform fund the markup portion. Also: commission base = food value **after** restaurant-funded discount (default) or before?
- (b) Should a platform-wide category rule (e.g. "all desserts +8%") override a restaurant-specific rule? Spec order says yes (default).

### Q9. Distance used for pricing
Customer delivery fee and rider pay depend on distance. Road distance from a maps API (accurate, costs
per call) vs straight-line × 1.3 (free, less fair on winding routes)? Default: road distance with the
straight-line fallback, and the used value stored per order. Also: Google Maps vs an India-focused
provider (Ola Maps / Mappls) — cost differs significantly.

### Q10. Who keeps what
Tips 100% to rider (default)? Final-bill rounding absorbed by platform (default)? Rider compensated when
an order is cancelled after they reached the restaurant (default yes, per rule)?

**Needed before Phase 7 (payments) / launch**

### Q5. Payment gateway
Razorpay, Cashfree, PhonePe PG, PayU… (fees, UPI success rates, settlement speed, payout API for
restaurant/rider settlements, onboarding requirements). The abstraction supports any; the first adapter
needs a choice and a business account. Also: are restaurant/rider payouts manual bank transfers at
first, or via a payouts API?

### Q6. SMS / OTP provider
Indian SMS requires DLT registration of sender ID and templates. MSG91 / Gupshup / Twilio / Exotel — or
WhatsApp OTP? Needed before a real login can be tested on a phone (dev uses a console adapter).

### Q11. Hosting and third-party SaaS
Preferred cloud (AWS Mumbai / GCP Mumbai / Azure India / DigitalOcean Bangalore / a PaaS)? Monthly
budget range? Are SaaS processors acceptable for logs/errors (e.g. Sentry) given customer data
(data residency / DPDP)?

### Q12. Legal entity, compliance and policies
Business entity and GSTIN that will operate the platform and issue invoices; FSSAI obligations as an
aggregator; privacy policy, terms, refund/cancellation policy text; rider engagement model (independent
partners vs employees — affects incentives, insurance and data use); DPDP Act compliance approach.
