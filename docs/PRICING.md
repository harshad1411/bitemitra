# Pricing

Status: **Design (Phase 0, updated for owner decisions OD-7..OD-16).** Only money math exists in Phase 1. Implemented in Phase 4 (`packages/pricing-engine`) with the test matrix below
written *before* the implementation. Items marked **⚠ Qn** depend on an owner decision in
[DECISIONS.md](DECISIONS.md#5-questions); the stated default is used until answered.

Covers MASTER_SPEC §2, §9–§17, §27, §34, §55, §65, §82.

## 1. Money rules

1. All amounts are **integer paise**. Rates are **integer basis points** (1% = 100 bps).
2. There is exactly **one rounding function** for percentage math:
   `applyBps(amountPaise, bps) = roundHalfUp(amountPaise × bps / 10 000)`, computed with integers
   (`floor((a × b + 5 000) / 10 000)` for non-negative values). Max operand ≈ ₹2 crore × 10 000 bps
   ≈ 2·10¹³ < 2⁵³, so plain JS numbers are exact. Inputs outside the safe range throw.
3. Inclusive tax extraction: `tax = roundHalfUp(gross × rate / (10 000 + rate))`.
4. Splitting one amount across N parts (discount across lines, tax across CGST/SGST) uses
   **largest-remainder allocation**, deterministic tie-break by line order, so parts always sum exactly
   to the whole.
5. The engine is **pure**: `(cart, context, rules, now) → quote`. No DB, network or clock access.
   The same function prices a live cart, builds the order snapshot, powers admin previews (§65) and
   replays old orders in tests.
6. Every quote carries `engineVersion`, the ids + params of every rule consulted, and passes an
   **invariant check** before it is returned (see §8). A quote that fails the check is an error, never shown.

## 2. Rule precedence

### 2.1 Hierarchy

`GLOBAL → COUNTRY → STATE → CITY → ZONE → RESTAURANT → BRANCH → CATEGORY → PRODUCT → VARIANT`
(VARIANT only for markup, per §10). **Most specific applicable rule wins — the whole rule, not
individual fields.** Field-level merging makes results hard to explain, so an override restates the
full rule; the admin UI pre-fills the inherited values.

| Rank | Scope | Matches when |
|---:|---|---|
| 0 | GLOBAL | always |
| 1 | COUNTRY | `scopeRefId = context.countryId` |
| 2 | STATE | `= context.stateId` |
| 3 | CITY | `= context.cityId` |
| 4 | ZONE | `= context.zoneId` (see §2.2 for *which* zone) |
| 5 | RESTAURANT | `= context.restaurantId` |
| 5.5 | BRANCH | `= context.branchId` (D-19) |
| 6 | CATEGORY | `= item.categoryId` (platform food category) and `restaurantId` qualifier is null |
| 6.5 | CATEGORY + restaurant qualifier | as above **and** `restaurantId = context.restaurantId` |
| 7 | PRODUCT | `= item.productId` |
| 8 | VARIANT | `= item.variantId` (markup only) |

Candidate filter: `effectiveFrom ≤ at < effectiveTo` (open-ended when null), where `at` is quote time
(and, for the snapshot, placement time). Tie-break inside one rank: higher `priority`, then later
`effectiveFrom`, then id — fully deterministic.

A more specific rule may **disable** a charge (`{ enabled: false }`) — e.g. "no platform fee for
restaurant X" — which stops inheritance.

**⚠ Q-7b (precedence of platform-wide category rules):** following the spec literally, a platform-wide
rule "Desserts +8%" (rank 6) beats a restaurant rule "ABC Pizza +10%" (rank 5) for ABC Pizza's desserts.
That is the default. The alternative is to rank RESTAURANT above unqualified CATEGORY.

### 2.2 Which zone?

A single order has two locations. Rules resolve against:

| Rule type | Zone / location used |
|---|---|
| Markup, commission, tax, packaging, cancellation | **restaurant branch** zone (the seller's location) |
| Delivery pricing, surge/night, small-order fee, platform fee, rider earning, COD limits | **delivery** zone (the customer's address) |

Cross-city delivery is not allowed, so city/state/country are the same for both.

### 2.3 Worked precedence examples

**Owner example (OD-8):** restaurant menu price ₹100, restaurant markup +10% → customer ₹110; the
restaurant's default is 10% but "Burger" has an item override of 15% → Burger at ₹100 shows ₹115. The
item (PRODUCT) rule wins over the RESTAURANT rule.

**Spec §10 example:**

Global 5%, City (Unjha) 7%, Restaurant (ABC Pizza) 10%, Product (Farmhouse Pizza) 15%:

| Item | Winning rule | Markup |
|---|---|---|
| Farmhouse Pizza | PRODUCT | 15% |
| Garlic Bread (same restaurant) | RESTAURANT | 10% |
| Any item at another Unjha restaurant with no override | CITY | 7% |
| Item in a future city with no rules | GLOBAL | 5% |

## 3. Rule parameter schemas (validated by zod on write *and* read)

| Rule | `params` |
|---|---|
| Markup | `{ type: PERCENTAGE\|FIXED, valueBps?, valuePaise?, rounding: { mode: NONE\|NEAREST_1\|NEAREST_5\|NEAREST_10\|PSYCHOLOGICAL, direction: HALF_UP\|UP\|DOWN, endingDigit? }, applyToAddons: bool }` |
| Commission | `{ type: PERCENTAGE\|FIXED\|HYBRID, rateBps?, fixedPaise?, hybridMode: SUM\|MAX, basis: PRE_DISCOUNT\|POST_RESTAURANT_DISCOUNT\|POST_ALL_DISCOUNTS }` — basis is **configurable per rule, never assumed** (OD-10) |
| Tax | `{ appliesTo: FOOD\|PACKAGING\|DELIVERY_FEE\|PLATFORM_FEE\|SMALL_ORDER_FEE\|SURCHARGE\|COMMISSION, mode: INCLUSIVE\|EXCLUSIVE\|EXEMPT, components: [{ code, rateBps }], liableParty: PLATFORM\|RESTAURANT }` — **all defaults need CA confirmation (Q-3)** |
| Withholding (TCS/TDS) | `{ kind: GST_TCS\|INCOME_TAX_TDS, rateBps, base, enabled }` on restaurant payouts — **disabled until CA confirms (Q-3)** |
| Platform fee | `{ enabled, fixedPaise, rateBps, basis: FOOD_SUBTOTAL, minPaise?, maxPaise?, schedule?: { days, from, to } }` |
| Delivery pricing | `{ strategy: SLABS\|BASE_PLUS_PER_KM\|FLAT, slabs?: [{ upToM, feePaise }], basePaise?, includedM?, perKmPaise?, billingUnitM: 100, minPaise?, maxPaise?, maxDistanceM, freeAboveSubtotalPaise?, smallOrder?: { belowSubtotalPaise, feePaise } }` |
| Surge / night | `{ kind: NIGHT\|DEMAND\|WEATHER\|MANUAL, type: FIXED\|PERCENTAGE\|MULTIPLIER, value, appliesTo: DELIVERY_FEE, window?: { start: "23:00", end: "06:00" } }` + row-level `isEnabled` kill-switch |
| Rider earning | see [DELIVERY.md](DELIVERY.md#4-rider-earnings-16) |
| Cancellation | see [ORDERS.md](ORDERS.md#5-cancellations-35) |

## 4. Calculation pipeline (customer side)

Executed in this order; each step's output is recorded in the quote.

1. **Revalidate** (orders module, before the engine): restaurant open/not paused, address serviceable, every item/variant/add-on exists, is available and inside its schedule, add-on group min/max satisfied, stock available.
2. **Line prices.** For each line: `base = variant.basePrice (or product.basePrice)`; resolve markup (§2); `display = round(base + markup)` per the rule's rounding; `markupAmount = display − base` (rounding delta is part of markup, so the identity always holds). Add-ons: same markup rule when `applyToAddons` (percentage rules only; FIXED markups apply to the main item only). **Restaurant base prices are never modified.**
3. **Food subtotal** `= Σ display × qty` (incl. add-ons). Restaurant base subtotal `= Σ base × qty`.
4. **Discounts.** Automatic promotion(s) first, then at most one coupon (stacking configurable, default: one promotion + one coupon). Eligibility (min order, first order, targeting, per-user/usage limits, payment method) evaluated on the **pre-discount food subtotal**. Discount computed on the display food subtotal **⚠ Q-7**, capped by `maxDiscountPaise`, never > subtotal. Funding split: PLATFORM / RESTAURANT / SHARED(`restaurantShareBps`). The discount is allocated across lines (largest remainder) so tax can be computed per line.
5. **Packaging** (restaurant-configured, per item or per order, passed through to the restaurant, no markup).
6. **Food tax** per line on `(line display total − allocated discount)`, using the line's resolved tax rule (inclusive: extracted, exclusive: added, exempt: 0). Packaging taxed by its own rule (default: same as food). **⚠ Q-3**
7. **Delivery fee** by strategy:
   - SLABS: first slab with `distance ≤ upToM` (so 2.0 km is in "0–2 km", 2.1 km in "2–4 km"); beyond the last slab or `maxDistanceM` → not serviceable.
   - BASE_PLUS_PER_KM: `base + ceil(max(0, d − included) / billingUnitM) × perKm × billingUnitM / 1000`, clamped to [min, max].
   - Then: free if `foodSubtotalAfterDiscount ≥ freeAboveSubtotalPaise`, or a FREE_DELIVERY coupon/promotion applies (funding recorded).
   - Distance: **route/road distance** from the maps provider (OD-14). If unavailable, setting `delivery.distance.fallback` decides: `HAVERSINE_FACTOR` (straight line × `delivery.distance.roadFactor`, order flagged `distanceSource = FALLBACK`) or `REJECT` (no quote). Distance, source and provider are frozen in the snapshot.
8. **Small-order fee** if food subtotal after discount < threshold.
9. **Surcharges.** Resolve each kind (NIGHT, DEMAND, WEATHER, MANUAL) independently; NIGHT is active when local time ∈ `[start, end)` (windows may cross midnight). MULTIPLIER x → `deliveryFee × (x − 1)`; PERCENTAGE → of delivery fee; FIXED → amount. Sum is capped by the setting `pricing.surcharges.maxTotalPaise`. Surcharges apply even when delivery is free unless the rule says otherwise.
10. **Platform fee** `= fixed + applyBps(foodSubtotal, rateBps)`, clamped to [min, max]; skipped outside its schedule or if disabled.
11. **Charge taxes** — delivery fee, surcharges, small-order fee, platform fee each use their own tax rule. **⚠ Q-3**
12. **Tip** (if the `tips` flag is on) — not taxed, not commissioned; allocated by setting `tips.riderShareBps` (default 10 000 = 100% to the delivery partner, OD-15). Recorded separately (`tipPaise`, `tipAllocation`) and in ledgers as `TIP` (rider) / `TIP_PASS_THROUGH` (platform liability) — **never platform revenue**.
13. **Final rounding** of the payable (settings `pricing.finalRounding.mode` NONE/NEAREST_1/NEAREST_5/NEAREST_10 and `.direction`; default nearest ₹1 half-up). Any difference is **always shown** as an explicit `roundingAdjustment` line (OD-16) and posted as `ROUNDING_ADJUSTMENT`; who absorbs it is configurable (default platform).
14. **Total payable** = sum of all customer-facing lines.

**Markup disclosure (OD-8, A-18):** the engine always computes markup separately; *how it is shown* is the
setting `pricing.markup.disclosure` — `NONE` (customer sees final item prices), `NOTE` (a "prices may
differ from restaurant menu" notice) or `ITEMISED` (markup shown as a bill line). Development default
`NONE`; **legal confirmation required before launch (Q-4)**. The applied mode is frozen in the snapshot.

## 5. Restaurant, rider and platform side (never shown to customers)

- **Restaurant food value** = restaurant base subtotal (the restaurant's own prices).
- **Restaurant-funded discount** = restaurant share of discounts.
- **Commission** = rule applied to the commission base selected by the rule's `basis` (OD-10): `PRE_DISCOUNT` (food value), `POST_RESTAURANT_DISCOUNT` (food value − restaurant-funded discount) or `POST_ALL_DISCOUNTS`. Development default `POST_RESTAURANT_DISCOUNT` is a **placeholder (Q-7)**. HYBRID = fixed + rate (SUM) or max (MAX). Basis and base amount are frozen in the snapshot.
- **Tax on commission** per the COMMISSION tax rule (default 18% GST — **⚠ Q-3**).
- **Withholdings** (GST TCS / income-tax TDS on e-commerce payouts): configurable withholding rules, **disabled until the CA confirms (Q-3)**; recorded as `restaurantWithholdingPaise` and ledger `WITHHOLDING` / `WITHHOLDING_TAX`.
- **Restaurant payable** = food value − restaurant-funded discount − commission − commission tax − withholdings + packaging.
- **Rider earning estimate** from the rider earning rule (final amount computed at delivery with actual distance/wait) — [DELIVERY.md](DELIVERY.md#4-rider-earnings-16).
- **Platform revenue components**: markup, commission, platform fee, delivery fee + surcharges − rider cost (delivery margin), small-order fee, − platform-funded discount, − rounding adjustment, − gateway cost.
- **Tax collected** is recorded as a liability, never as revenue.

## 6. Worked example (illustrative numbers; tax treatment pending ⚠ Q-3)

Order at ABC Pizza, Unjha, 23:30, card payment, 3.2 km delivery.

Config: markup 10% (nearest ₹1) · coupon SAVE10 = 10% up to ₹100, SHARED 50/50 · food GST 5% exclusive ·
packaging ₹10 · delivery slabs 0–2 km ₹20 / 2–4 km ₹30 / 4–6 km ₹40 · night surcharge ₹10 (23:00–06:00) ·
platform fee ₹5 · 18% GST on delivery, surcharge and platform fee · commission 12% on food value after
restaurant-funded discount + 18% GST · rider: ₹25 incl. 2 km + ₹6/km (per 100 m) + ₹5 night incentive ·
card gateway fee 2% + 18% GST.

Cart: 2 × Paneer Tikka Pizza, restaurant price ₹200.

**Customer bill**

| Line | Paise | ₹ |
|---|---:|---:|
| Food (2 × ₹220; base ₹200 + ₹20 markup) | 44 000 | 440.00 |
| Coupon SAVE10 (10%) | −4 400 | −44.00 |
| GST on food 5% × 396 | 1 980 | 19.80 |
| Packaging | 1 000 | 10.00 |
| GST on packaging 5% | 50 | 0.50 |
| Delivery fee (3.2 km → 2–4 km slab) | 3 000 | 30.00 |
| GST on delivery 18% | 540 | 5.40 |
| Night surcharge | 1 000 | 10.00 |
| GST on surcharge 18% | 180 | 1.80 |
| Platform fee | 500 | 5.00 |
| GST on platform fee 18% | 90 | 0.90 |
| Subtotal | 47 940 | 479.40 |
| Rounding adjustment | −40 | −0.40 |
| **Total payable** | **47 900** | **479.00** |

**Restaurant**

| Line | Paise |
|---|---:|
| Food value (2 × ₹200) | 40 000 |
| Restaurant-funded discount (50% of 4 400) | −2 200 |
| Commission 12% × 37 800 | −4 536 |
| GST on commission 18% × 4 536 = 816.48 → | −816 |
| Packaging pass-through | +1 000 |
| **Restaurant payable** | **33 448** |

**Rider**: ₹25 + ceil(1 200 m / 100 m) × ₹0.60 = ₹32.20 + ₹5 night = **3 720**.

**Where every rupee went (conservation check)**

| Recipient | Paise |
|---|---:|
| Restaurant | 33 448 |
| Rider | 3 720 |
| Tax liabilities (1 980 + 50 + 540 + 180 + 90 + 816) | 3 656 |
| Gateway (2% × 47 900 = 958, + 18% GST 172) | 1 130 |
| **Platform net** | **5 946** |
| **Total = customer paid** | **47 900** ✓ |

Cross-check from components: markup 4 000 + commission 4 536 + platform fee 500 + delivery 3 000 +
night 1 000 − rider 3 720 − platform-funded discount 2 200 − rounding 40 − gateway 1 130 = **5 946** ✓.

This exact example becomes a golden test in Phase 4.

## 7. Snapshot (what is stored per order)

Per line (`order_items`, `order_item_addons`): restaurant base price, customer display price, markup
type/value/amount + rule id, tax mode/rate/amount, commission rate/amount, packaging, line total.
Per order (`order_pricing_snapshots`): every subtotal and fee above, tax breakdown by component, the
**exact rule params** (not just ids) for delivery, platform fee, surge, commission, rider earning; coupon
code + funding snapshot; distance; restaurant payable; platform revenue breakdown; gateway estimate;
engine version; all rule ids consulted; commission **basis** and base amount; distance **source**/provider;
tip allocation; markup disclosure mode; withholdings. Together these answer OD-10's list: original item
total, markup, discount + funding source, commission basis + amount, taxes, fees, restaurant payable,
rider payable, platform amount. The customer app receives only the customer-facing subset.

## 8. Invariants checked on every quote

1. `display − base = markupAmount` for every line; no negative line.
2. `Σ allocated discount = total discount`; `restaurantFunded + platformFunded = discount`.
3. `Σ tax components = tax total` per charge.
4. Total payable = Σ customer lines; ≥ 0.
5. **Conservation**: `totalPayable = restaurantPayable + riderEarning + taxLiabilities + gatewayEstimate + platformNet` (with tip counted inside rider).
6. Restaurant payable ≥ 0, or the quote is flagged for admin review (misconfigured commission).

## 9. Admin configuration preview (§65)

`POST /v1/admin/pricing/preview` runs the same engine with a *draft* rule set and returns before/after for
sample items (or a real restaurant's menu): customer price, commission, restaurant payable, platform
margin. Saving a rule requires the preview to have been generated for that draft (UI enforced, server
re-validates the rule).

## 10. Test matrix (Phase 4 — written first)

Unit tests per component and **combination** tests (§55):

| Area | Cases |
|---|---|
| Markup | none · global · city · restaurant override · category (+ restaurant qualifier) · product · variant · fixed vs % · each rounding mode · add-ons on/off · rule expired / future-dated |
| Tax | inclusive · exclusive · exempt · per-product override · multi-component split sums exactly · tax after discount allocation |
| Platform fee | disabled · fixed · % · fixed + % · min clamp · max clamp · outside schedule · disabled by restaurant override |
| Delivery | 0 m · 1 km · 2.0 km · 2.1 km · max distance · beyond max (unserviceable) · per-km billing unit edges · min/max clamp · free threshold exactly at / 1 paise below |
| Surcharges | night boundary 22:59:59 / 23:00:00 / 05:59:59 / 06:00:00 in Asia/Kolkata · window not crossing midnight · surge 1.0/1.2/1.5 · kill-switch off · cap |
| Discounts | fixed · % with cap · free delivery · min order edge · first order · per-user limit · restaurant / platform / shared funding · discount > subtotal · allocation remainders |
| Orders | small order · large order (₹50 000) · many lines (200) · tip · final rounding up/down |
| Combinations | golden example (§6) · night + surge + coupon + free delivery · inclusive tax + shared discount + hybrid commission · property-based: random carts/rules always satisfy §8 invariants |
| Snapshot | changing any rule after placement does not change a stored order or its replayed breakdown |

## 11. Open tax / legal questions (owner + CA must decide)

Defaults exist only so development can proceed (OD-9); they **must be resolved before production financial launch** (Q-3, Q-4, Q-7):

1. Who is liable for GST on restaurant food sold via the app (default modelled: platform, as an e-commerce operator)? At what rate, and is the taxable value the marked-up price?
2. GST treatment and rates for delivery fee, platform fee, small-order fee, surcharges, packaging.
3. GST on commission charged to restaurants; TCS (GST) and TDS (income tax) on restaurant payouts — applicable rates/thresholds.
4. Whether a customer-facing markup over the restaurant's menu price is permitted/must be disclosed, and whether the platform becomes the seller of record when it marks up.
5. Which entity issues which invoice (customer food invoice, platform-services invoice, commission invoice), and invoice series format.
