# Restaurants & menus

Status: **Phase 2.** Covers MASTER_SPEC §8 (menu data), §19 (restaurant app: menu, availability, store
status), §31 (products admin), §32 (restaurant admin), §74 (onboarding). Decisions: D-34 … D-44 in
[DECISIONS.md](DECISIONS.md). Customer-facing browsing of this data is Phase 3; prices customers pay
(markup, tax, fees) are Phase 4.

## 1. Model

```
Restaurant (city, onboarding status, profile, legal ids)
├── RestaurantSettings        per-restaurant capabilities (self-edit menu, auto-accept)
├── RestaurantUser            team: OWNER / MANAGER / STAFF (approval ≠ sign-in, OD-13)
├── RestaurantDocument        FSSAI, PAN, GST … with a PRIVATE file and review status
├── RestaurantBankAccount     encrypted account number, four-eyes verification
├── RestaurantZone            zones where the restaurant is listed (discovery index)
├── RestaurantBranch          address, location, zone, prep time, open / pause / busy
│   ├── RestaurantBusinessHours   weekly intervals (several per day, past-midnight allowed)
│   └── BranchDeliveryArea        the branch's reach: radius or polygon (one active)
├── MenuCategory              the restaurant's own sections ("Starters"), ordered
└── Product                   base price (paise), food type, flags, status, availability, version
    ├── ProductVariant        full price per size ("Half" / "Full"); exactly one default
    ├── ProductAddonGroup     min/max selection  ─ ProductAddon (price, food type, availability)
    ├── ProductImage          ordered images from the media library
    ├── ProductAvailability   dated sold-out windows ("sold out until 11 pm")
    └── ProductSchedule       recurring windows ("breakfast 07:00–11:00")
Category                      platform-wide food taxonomy (Pizza, Thali…) for discovery and rule scoping
```

Money is integer paise; a product's `basePricePaise` is the **restaurant's** price and is never changed by
markup (spec §10). The customer price is computed by the pricing engine in Phase 4.

## 2. Onboarding workflow (spec §74, D-34)

```
DRAFT ──submit──▶ REVIEW ──approve──▶ APPROVED ──go live──▶ ACTIVE ◀──reinstate── SUSPENDED
  │                 │                                         └───────suspend────────▲
  └─docs missing─▶ DOCUMENTS_PENDING ◀─request changes─┘
                    └──resubmit──▶ REVIEW
```

| Transition | Permission | Checks (server-side) | Reason required |
|---|---|---|---|
| DRAFT/DOCUMENTS_PENDING → REVIEW (submit) | `restaurants.manage` | profile complete; ≥ 1 branch with location, zone, hours and delivery area; every required document uploaded; a bank account added; an active OWNER | no |
| DRAFT → DOCUMENTS_PENDING | `restaurants.manage` | — | yes |
| REVIEW → DOCUMENTS_PENDING (request changes) | `restaurants.approve` | — | yes |
| REVIEW → APPROVED | `restaurants.approve` | everything for submit **plus** every required document VERIFIED and not expired, and a verified primary bank account | no |
| APPROVED → ACTIVE (go live) | `restaurants.approve` | everything for approve **plus** ≥ 1 active, available product | no |
| ACTIVE → SUSPENDED | `restaurants.approve` | — | yes |
| SUSPENDED → ACTIVE (reinstate) | `restaurants.approve` | same as go live | yes |

The admin shows the same checklist the server evaluates (`readiness` in the restaurant response), so the
UI can never disagree with the API. Every transition is audit-logged with old → new and the reason.
Required document kinds come from the setting `restaurants.requiredDocuments` (default FSSAI + PAN —
assumption A-21, legal review Q-12).

Partner-app access: only members (`isActive`) of an **APPROVED or ACTIVE** restaurant may use partner
endpoints; SUSPENDED blocks them. Orders can only reach an ACTIVE (live) restaurant, because only live
restaurants are listed to customers (D-47).

**Orders (Phase 5).** New orders ring in the app (looping placeholder chime + vibration, also with the iPhone
silent switch on) until each is accepted or rejected, and arrive as push notifications with the same sound
when the app is closed (once the Expo projects exist, Q-18). The restaurant sees its own prices and money,
never customer prices, markup, platform fees or the customer's phone and address (D-67). If nobody responds
within `orders.restaurantAcceptance.timeoutSec` the configured fallback runs (D-68). A restaurant with
`autoAccept` gets every order accepted at once with the branch preparation time.

## 3. Opening state (D-38)

A branch **is open now** when all of these hold (evaluated in the city's timezone by the pure
`@jamzo/catalog-engine`):

1. the restaurant is ACTIVE;
2. `isOpen` is true (the restaurant/admin "closed" switch; default true);
3. `pausedUntil` is empty or in the past ("pause for 30 minutes");
4. now falls inside a business-hours interval. Intervals are `HH:mm` local time; several per day are
   allowed (lunch and dinner); `closesAt` earlier than `opensAt` means "past midnight" (it belongs to the
   opening day); `24:00` means end of day. Overlapping intervals are rejected. **No hours = closed.**

Busy mode does not close the restaurant; it adds the busy extra minutes to the preparation time used for
ETAs (Phase 5). The engine also returns *when* the state next changes (`nextOpenAt` / `closesAt`) so the
apps can say "Opens at 6:00 pm".

## 4. Product availability (D-38)

A product is **orderable now** when:

1. `status = ACTIVE` (DRAFT is invisible to customers; ARCHIVED replaces deletion);
2. `isAvailable = true` (the indefinite sold-out switch);
3. no current `product_availability` window marks it unavailable (latest window wins; windows are
   `[startsAt, endsAt)`);
4. `stockQuantity` is null (not tracked) or > 0;
5. it has no schedules, or now is inside one of them (same interval rules as business hours).

"Sold out for today" writes a window ending at the next local midnight; "sold out" without a time sets
`isAvailable = false`; "back in stock" does both undo steps. Variants and add-ons have their own
`isAvailable`; a product whose variants are all unavailable is not orderable.

## 5. Product structure rules (D-37)

- **Variants** carry the full price of that size (not a delta). A product has either no variants or 2–20,
  exactly one default. The product's `basePricePaise` mirrors the default variant (kept by the server) so
  lists can show a "from" price without joins.
- **Add-on groups:** 0–20 per product, 1–50 add-ons each, `0 ≤ minSelect ≤ maxSelect`, `1 ≤ maxSelect ≤
  number of add-ons`. A required single choice ("Regular / Jain preparation") is `min 1, max 1`.
- **Food type consistency:** add-ons must be compatible with the product — VEGAN → VEGAN; VEG → VEG or
  VEGAN; EGG → VEG, VEGAN or EGG; NON_VEG → any. In a pure-veg restaurant every product and add-on is VEG or
  VEGAN.
- **Images:** up to 10, ordered, from the media library (images only).
- **Edits** send the whole product (with its variants, groups, add-ons, images and schedules). Existing
  children are updated by id, new ones created, missing ones removed. Orders never depend on these rows
  (order items copy names and prices, D-37), so removal is safe. Products themselves are never deleted —
  they are archived.
- **Concurrent edits:** every product has a `version`; an update must send the version it read. If
  someone else saved in between, the API returns `409 CONFLICT` with the current version and nothing is
  overwritten.

## 6. Private documents and bank details (D-35, D-36)

- Document files (PDF, JPEG, PNG; content-sniffed) are stored under a private storage prefix as media of
  kind `DOCUMENT`. They are **never** served by the public media route and never appear in the media
  library. Admins with `restaurants.view` download them through an authenticated endpoint; each download
  is audit-logged.
- Bank account numbers are encrypted with AES-256-GCM (`FIELD_ENCRYPTION_KEY`, key id stored with the
  ciphertext). The API only ever returns the last 4 digits; no Phase 2 endpoint decrypts them (payouts,
  Phase 8, will). Account numbers are never written to logs or the audit log.
- A new bank account starts **unverified and not primary**. A *different* admin with
  `restaurants.approve` verifies it, which makes it primary and demotes the previous one in the same
  transaction (four-eyes: the admin who entered the details cannot verify them).

## 7. Restaurant partner app (Phases 2 and 5)

| Capability | OWNER | MANAGER | STAFF |
|---|:-:|:-:|:-:|
| View store status, hours and menu | ✓ | ✓ | ✓ |
| Mark products / variants / add-ons sold out or back in stock | ✓ | ✓ | ✓ |
| Close / reopen, pause (15–120 min), busy mode, preparation time | ✓ | ✓ | |
| See and handle orders: accept (with prep time), reject (with reason), preparing, ready, +5 min (`orders.handle`) | ✓ | ✓ | ✓ |
| Cancel an accepted order (`orders.cancel`) | ✓ | ✓ | |
| See order money: food value, restaurant-funded discount, commission, net payable (`orders.finance`) | ✓ | ✓ | |
| Edit menu content and prices | not in Phase 2 (flag `restaurant_self_edit_menu` stays off; D-39) | | |

## 8. Admin screens

- **Restaurants** — list (search, city, status), create, detail with tabs: Overview (profile, readiness
  checklist, status actions), Branches (address, location, hours, delivery area, open/pause/busy), Menu
  (sections and products), Documents, Bank accounts, Team, Settings.
- **Products** — cross-restaurant list with filters, bulk actions (sold out, back in stock, activate,
  archive, move section) and the product editor (details, images, pricing, variants, add-ons,
  availability, schedules). The customer-price preview arrives with pricing rules (Phase 4).
- **Food categories** — the platform taxonomy.

## 9. Not built yet

Delivery partners and pickup (Phase 6), settlements and statements (Phase 8), restaurant self-edit of menu content (flagged, later), shared add-on libraries,
menu import from spreadsheets, multi-branch menu differences (one menu per restaurant; A-2).
