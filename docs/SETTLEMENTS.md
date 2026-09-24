# Ledgers & settlements

Status: **Design (updated for OD-21..OD-23).** Implemented in Phase 8. **No real payouts are made before
that, and none in Phase 1.** Payout rails: Q-5b. All commercial amounts are placeholders (A-16).

Covers MASTER_SPEC §23, §25, §26, §27, §68, §69, §82.

## 1. Model

Three sub-ledgers, all **append-only** with positive amounts and a direction:

| Ledger | Balance meaning | Tables |
|---|---|---|
| Restaurant (one per restaurant) | `balancePaise` > 0 → platform owes restaurant | restaurant_ledgers, restaurant_ledger_entries, restaurant_settlements |
| Rider (one per rider) | `earningsBalancePaise` → platform owes rider; `codHeldPaise` → rider owes platform | rider_ledgers, rider_ledger_entries, rider_settlements, rider_cod_deposits, rider_payouts |
| Platform | revenue, costs, liabilities by type | platform_ledger_entries |

Entries are **immutable**: a correction is a new `REVERSAL` or adjustment entry referencing the original, never an edit (OD-21). Financial truth is always the ledgers, never mutable order fields. Every entry has a deterministic `idempotencyKey` (`order:<id>:<TYPE>`, `refund:<id>:<TYPE>`,
`settlement:<id>`, `manual:<uuid>`), so replaying a posting job can never double-post (DB-enforced).
Posting functions in `settlement-engine` are pure: `(order snapshot | refund | cancellation) → entries[]`.
The `ledger` module writes them in the triggering transaction, updating cached balances under
`SELECT … FOR UPDATE`. Balances can always be recomputed from entries (nightly check job).

## 2. Restaurant ledger

### 2.1 When entries are posted

Revenue is recognised **at DELIVERED** (not at placement), so cancelled orders never need reversal of
sales entries.

| Event | Entries (direction from the restaurant's view) |
|---|---|
| Order DELIVERED | FOOD_SALE credit (food value = restaurant base subtotal + packaging) · RESTAURANT_FUNDED_DISCOUNT debit · COMMISSION debit · COMMISSION_TAX debit · withholdings (TCS/TDS) debit if configured |
| Cancelled with restaurant compensation | CANCELLATION credit (compensation amount) |
| Cancelled by restaurant with penalty | PENALTY debit |
| Refund attributed to restaurant (e.g. missing item) | REFUND debit (amount per refund breakdown) |
| Admin adjustment | MANUAL_CREDIT / MANUAL_DEBIT (reason required, `ledgers.adjust` permission, audit log, maker-checker above threshold) |
| Settlement paid | SETTLEMENT debit (= amount paid) |
| Settlement payout failed | REVERSAL referencing the settlement entry |
| TCS/TDS withheld (if enabled after CA review, Q-3) | WITHHOLDING debit |
| Fee charged to restaurant (if configured) | RESTAURANT_FEE debit |

The restaurant never sees markup, platform fee, delivery margin or platform-funded discounts (§19):
its statement starts from **its own food prices**.

### 2.2 Worked example (from [PRICING.md §6](PRICING.md#6-worked-example-illustrative-numbers-tax-treatment-pending--q-3))

| Entry | Direction | Paise | Balance after |
|---|---|---:|---:|
| FOOD_SALE (40 000 food + 1 000 packaging) | CREDIT | 41 000 | 41 000 |
| RESTAURANT_FUNDED_DISCOUNT | DEBIT | 2 200 | 38 800 |
| COMMISSION (12%) | DEBIT | 4 536 | 34 264 |
| COMMISSION_TAX (18%) | DEBIT | 816 | **33 448** = restaurant payable ✓ |

### 2.3 Settlement schedules (§25) — default **weekly** (OD-22)

Per restaurant `restaurant_settings.settlementSchedule`; cut-offs in the city timezone:

| Schedule | Period covered | Run |
|---|---|---|
| DAILY | entries up to 23:59:59 yesterday | daily 06:00 |
| T_PLUS_1 | orders delivered on day D | D+1 |
| T_PLUS_2 | orders delivered on day D | D+2 |
| WEEKLY | Mon 00:00 – Sun 23:59:59 | Monday (setting `settlements.weeklyRunDay`) |
| MANUAL | admin-selected range | on demand |

### 2.4 Settlement run (deterministic)

1. For the period, select unsettled entries (`settlementId IS NULL`, `createdAt < cutoff`) under a ledger row lock.
2. `net = opening carry-forward + credits − debits` (optional reserve/holdback % from setting `settlements.reservePercentBps` for refund exposure, default 0).
3. `net ≤ 0` (or below `settlements.minPayoutPaise`) → nothing paid; balance carries forward.
4. Otherwise create `restaurant_settlements` with the breakdown columns (previous balance, gross sales, commission, taxes, withholding, fees, restaurant-funded discounts, refunds, adjustments, COD information, final payable) (DRAFT; unique per restaurant+period ⇒ no duplicate run), link entries, generate the statement (PDF/CSV to media), status PENDING.
5. Finance approves → PROCESSING → payout (manual reference or payout API) → PAID (SETTLEMENT debit posted) or FAILED (retry/reversal).

### 2.5 What the restaurant app shows (§25)

Opening balance · orders in period (count, food value) · deductions (commission, commission tax,
restaurant-funded discounts, penalties, refunds) · adjustments · settled · pending · next settlement
date and estimated amount · downloadable statements (per settlement, CSV + PDF).

## 3. Rider ledger & settlement

### 3.1 Entries

| Event | Entry | Effect |
|---|---|---|
| DELIVERED | DELIVERY_EARNING, DISTANCE_EARNING, WAITING_CHARGE, INCENTIVE (night/peak/rain), from `rider_earnings.breakdown` | earnings +|
| Tip | TIP (share per `tips.riderShareBps`, default 100% — OD-15); the platform side is `TIP_PASS_THROUGH`, a liability, never revenue | earnings + |
| Bonus / adjustment | BONUS / ADJUSTMENT (credit or debit, reason, audit) | earnings ± |
| Penalty (only where legally appropriate) | PENALTY (reason, audit) | earnings − |
| COD shortage / excess on a verified deposit | COD_SHORTAGE / COD_EXCESS | codHeld ± |
| COD collected | COD_COLLECTED | codHeld + |
| COD deposit verified | COD_SUBMITTED | codHeld − |
| Payout | PAYOUT | earnings − |
| Cancelled after rider effort | DELIVERY_EARNING per cancellation rule compensation | earnings + |

### 3.2 Display (§26)

Today's earnings · pending payout (`earningsBalance`) · COD held (`codHeld`) · **amount rider owes
platform** = max(0, codHeld − earningsBalance) · **amount platform owes rider** = max(0, earningsBalance − codHeld)
(when netting is on) · payout history. Riders never see restaurant or platform financials (§21).

### 3.3 Settlement (weekly by default, setting `riders.settlementSchedule`)

`netPayable = earnings in period − COD held (if netting)`. Positive → payout; negative → rider owes,
carried forward and COD offers are blocked above the limit. Unique per rider+period.

## 4. Platform ledger

Posted at DELIVERED (and on refunds/cancellations/reconciliation) from the snapshot: MARKUP_REVENUE,
COMMISSION_REVENUE, PLATFORM_FEE, DELIVERY_FEE, SMALL_ORDER_FEE, SURCHARGE, PLATFORM_FUNDED_DISCOUNT,
RIDER_COST, GATEWAY_FEE, REFUND_LOSS, TAX_COLLECTED (liability), ADJUSTMENT. This is the basis for
"net platform revenue" (§44) and the per-order "where did every rupee go" view (§30, §82).

## 5. The conservation invariant

For every delivered order, checked in tests and by a nightly job:

```
customer paid (captured − refunded)
  = restaurant entries net + rider entries for the order + tax liabilities
    + gateway fee + platform net
```

For the worked example: 47 900 = 33 448 + 3 720 + 3 656 + 1 130 + 5 946 ✓. Any order that fails the
check is listed in the Finance alerts and blocks its restaurant's next settlement until resolved.

## 6. Invoices & statements

Invoice documents and numbering (gap-free per series and financial year via `invoice_sequences` row
lock) are generated from the snapshot. Which invoices exist and who issues them depends on
**⚠ [Q-3/Q-12](DECISIONS.md#5-questions)**. Credit notes accompany refunds that reverse taxed amounts.

## 7. Tests (Phase 8)

Posting rules for every order outcome (delivered, each cancellation stage/actor, each refund type) ·
idempotent re-posting · balance recomputation equals cached balance · each schedule's period boundaries
(incl. month/week edges in IST) · carry-forward when net ≤ 0 · duplicate settlement run rejected ·
payout failure reversal · COD netting (positive and negative) · deposit FIFO allocation · conservation
invariant over the full seed dataset · statement totals equal ledger totals.
