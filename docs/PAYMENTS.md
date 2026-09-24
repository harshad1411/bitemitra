# Payments & COD

Status: **Phase 0 design.** Online payments are implemented in Phase 7; COD capture in Phase 6;
COD reconciliation and ledgers in Phase 8. Gateway choice: **⚠ [Q5](DECISIONS.md#q5-payment-gateway)**.

Covers MASTER_SPEC §23, §24, §36, §48, §56, §68, §69, §82.

## 1. Principles

1. **The server decides what is paid.** A payment is SUCCEEDED only after the server has verified it,
   either from a signed provider webhook or by fetching the payment from the provider API. The client
   callback just asks the server to check; it never marks anything paid by itself (§24).
2. **Idempotent everywhere**: webhook events are deduplicated by `(provider, providerEventId)`; state
   changes are conditional (`UPDATE payments SET status='SUCCEEDED' WHERE id=$1 AND status IN ('INITIATED','PENDING')`).
3. **Amount check**: captured amount and currency must equal `payments.amountPaise`/INR; a mismatch is
   flagged for finance and never auto-confirms the order.
4. **No card data** ever touches our servers; checkout uses the provider's SDK / hosted page (§48).
5. **Business logic knows only the interface**, never the gateway.

## 2. Provider abstraction

```js
/** @interface PaymentProvider — implemented per gateway in services/api/src/payments/providers/ */
createOrder({ paymentId, amountPaise, currency, customer, methods })  // → { providerOrderId, checkoutPayload }
fetchPayment(providerOrderId)                                          // → { status, providerPaymentId, amountPaise, feePaise, taxPaise }
verifyWebhook(rawBody, headers)                                        // → { valid, eventId, type, data }
createRefund({ providerPaymentId, amountPaise, idempotencyKey })       // → { providerRefundId, status }
fetchRefund(providerRefundId)
```

Adapters: the chosen gateway (Phase 7) and a **fake provider** used in dev/tests that signs webhooks with
a test secret and can simulate success, failure, delay, duplicates and out-of-order delivery. Production
refuses to start with test keys, and dev/staging refuse live keys (key-prefix + env check, §52).

## 3. Online payment flow

States: `INITIATED → PENDING → SUCCEEDED | FAILED | EXPIRED | CANCELLED`.

1. **Order creation** (tx): order `PAYMENT_PENDING`, `payments` row `INITIATED` with the exact amount from the snapshot.
2. **After commit** (outbox): adapter `createOrder`; store `providerOrderId`; → `PENDING`; return checkout payload.
3. **Customer pays** in the provider SDK.
4. **Confirmation** — whichever arrives first, both paths run the same idempotent `confirmPayment()`:
   - **Webhook**: verify signature over the raw body → insert `payment_events` (a duplicate → 200 OK, no-op) → fetch/validate amount → tx: payment SUCCEEDED (conditional), attempt row, order PAYMENT_CONFIRMED → PLACED, outbox `order.placed`.
   - **Client verify** `POST /v1/payments/:id/verify`: server calls `fetchPayment`; same function.
5. **Failure/expiry**: webhook `failed`, or the expiry job (`payments.expirySec`, default 900 s) after a final `fetchPayment` → FAILED/EXPIRED; order PAYMENT_FAILED; coupon and stock released.
6. **Late success** (money captured after the order was failed or cancelled) → payment SUCCEEDED is recorded, and an automatic full refund is created (`refunds.idempotencyKey = late:<paymentId>`), audit-logged, surfaced in the ops alerts.
7. **Reconciliation job** (every 5 min for PENDING older than 2 min; nightly settlement-report reconciliation against the gateway): repairs missed webhooks, records gateway fee/tax on `payments.gatewayFeePaise/gatewayTaxPaise`, flags mismatches for Finance.

Webhook endpoint: `POST /v1/webhooks/payments/:provider`; raw body preserved for signature checks;
responds 2xx only after the event row is durably stored (so provider retries are safe); processing
errors are recorded in `payment_events.processingError` and retried by a worker.

## 4. COD flow

COD is **not platform cash until reconciled** (§23). The money moves:
customer → rider (cash in hand) → platform (verified deposit).

### 4.1 Eligibility (checked at quote and again at order creation)

All must pass; each is a setting/flag resolved through the hierarchy ([CONFIGURATION.md](CONFIGURATION.md)):

| Check | Source |
|---|---|
| COD globally / per city / zone enabled | feature flag `cod` + setting `cod.enabled` (GLOBAL→ZONE) |
| Restaurant accepts COD | `restaurant_settings.codEnabled` |
| Customer not COD-blocked | `customers.codDisabled` (e.g. after repeated refusals) |
| Order value ≤ max COD value | setting `cod.maxOrderValuePaise` (hierarchical) |
| Customer's unpaid/refused COD count below limit | setting `cod.maxRefusedOrders` |

### 4.2 Dispatch

Only riders with `riders.codEnabled` and `codHeld + orderCod ≤ codLimit` (rider override or setting
`cod.riderLimitPaise`) are offered COD orders. At the limit the rider app blocks new COD offers and
prompts a deposit.

### 4.3 Collection (at DELIVERED)

Rider confirms "Collected ₹X" (must equal `orders.codAmountPaise`; a short collection needs a reason
and raises an ops alert). In the DELIVERED transaction:
- `payments` (method COD): `codCollectedById`, `codCollectedAt`, status SUCCEEDED, `capturedPaise`;
- rider ledger `COD_COLLECTED` (rider **owes** platform) → `rider_ledgers.codHeldPaise += X`;
- platform ledger: cash recorded as *in transit with rider*, not as available cash.

### 4.4 Deposit & reconciliation

Rider deposits cash at a hub or by UPI/bank transfer → `rider_cod_deposits` (PENDING, idempotency key).
Finance verifies (receipt / bank statement) → VERIFIED → rider ledger `COD_SUBMITTED`
(`codHeldPaise −= amount`) and deposit amounts are allocated FIFO to that rider's collected COD
payments (`payments.codReconciledAt`, `codSettlementRef`). Only then is the cash counted as platform cash.
Rejected deposits need a reason and are audit-logged.

**Netting** (default ON, setting `cod.netAgainstEarnings`): at rider settlement, COD held can be
deducted from earnings owed ([SETTLEMENTS.md §3](SETTLEMENTS.md#3-rider-ledger--settlement)).

### 4.5 COD cancellation / refusal

Cancelled before pickup → nothing collected, no COD entries. Customer refuses at the door → order
ADMIN_CANCELLED (after rider + support confirmation), rider returns the food per ops policy, rider
compensated per cancellation rule, customer's refusal counter increments (may disable COD).

## 5. Refunds (§36)

| Type | Amount |
|---|---|
| FULL | everything captured minus previous refunds |
| PARTIAL / ITEM | chosen lines (with their allocated discount and tax) |
| DELIVERY | delivery fee + its tax |
| PLATFORM_FEE | platform fee + its tax |
| MANUAL | admin-entered amount with reason (Finance permission) |

Rules:
- Every refund records order, payment, amount, reason, actor, provider reference, timestamps, and a **breakdown** of which components it reverses (so ledgers and invoices/credit notes can be adjusted exactly).
- `refunds.idempotencyKey` (UI-generated per refund dialog) + CHECK `refundedPaise ≤ capturedPaise` prevent duplicates and over-refunds (verified by `pnpm verify:schema`).
- Refunds above `refunds.approvalThresholdPaise` need a second admin with `refunds.approve` (maker-checker).
- Execution is async through the adapter; status REQUESTED → PROCESSING → SUCCEEDED/FAILED; FAILED is retried and alerts Finance.
- COD orders are refunded to the customer by UPI/bank transfer or wallet (future) — recorded as `paymentId = null` with a manual reference.
- Who bears the refund (restaurant vs platform) is decided per refund (default from cancellation rule/issue type) and posted to the relevant ledger.

## 6. Gateway cost

Estimated in the pricing snapshot (`gatewayFeeEstimatePaise`, configured per method) and replaced by
the actual fee/tax from reconciliation; both are visible in admin order detail (§30, §82).

## 7. Tests (Phase 7)

Signature valid/invalid · duplicate webhook · out-of-order events (failed after captured) · webhook
before client verify and vice versa · delayed webhook + reconciliation repair · amount mismatch · late
success auto-refund · expiry · partial refunds summing to capture · refund double-submit · refund
failure retry · COD eligibility matrix · COD limit at dispatch · collection mismatch · deposit
allocation FIFO · netting at settlement.
