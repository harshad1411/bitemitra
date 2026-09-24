# Orders — state machine

Status: **Design (updated for OD-17).** Implemented as a pure module in `packages/order-engine` (Phase 5) with
exhaustive transition tests. End-to-end narrative: [ORDER_FLOW.md](ORDER_FLOW.md).

Covers MASTER_SPEC §17, §18, §20, §35, §40, §56, §68, §69.

## 1. Principles

1. **Explicit, table-driven machine.** Every allowed transition is listed below; anything else is
   rejected with `INVALID_STATE_TRANSITION` (409). There is no "set status" endpoint.
2. **Every transition** writes an `order_status_history` row (from, to, actor type + id, reason,
   metadata, timestamp) and an `outbox_events` row, in the same transaction as the state change.
3. **Optimistic concurrency**: `UPDATE orders … WHERE id = $1 AND version = $2`; a lost race returns
   409 and the client re-fetches. Combined with DB constraints ([DATABASE.md §5](DATABASE.md#5-concurrency-and-invariant-guarantees)).
4. The engine is pure: `transition(order, event, actor, now) → { order', history, events } | error`.

## 2. Two tracks, one derived status

A kitchen prepares food **while** a rider is being found and travels to the restaurant. A single linear
status cannot represent "PREPARING *and* RIDER_ACCEPTED", and the admin orders table (§29) has separate
"Restaurant status" and "Delivery status" columns. So an order has:

| Field | Values | Driven by |
|---|---|---|
| `restaurantStatus` (kitchen track) | **NEW, ACCEPTED, PREPARING, READY_FOR_PICKUP, COMPLETED**, REJECTED, CANCELLED (owner vocabulary, OD-17) + `restaurantNotifiedAt` timestamp | restaurant app, system |
| `deliveryStatus` (delivery track) | NOT_STARTED, SEARCHING, ASSIGNED, ACCEPTED, AT_RESTAURANT, PICKED_UP, ON_THE_WAY, ARRIVED, DELIVERED, NO_RIDER_FOUND, CANCELLED | dispatch, rider app |
| `status` (overall, **spec §18 values**) | derived — see §4 | never set directly |
| `financialStatus` | NONE, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED | refunds module |

`status` is recomputed by `deriveStatus()` on every transition and stored (for indexing and listing).

## 3. Transitions

### 3.1 Payment phase (overall status, before the tracks start)

| From | Event | To | Actor |
|---|---|---|---|
| — | checkout (online) | CREATED → PAYMENT_PENDING | customer |
| — | checkout (COD, or ₹0 payable) | CREATED → PLACED | customer |
| PAYMENT_PENDING | payment verified server-side (webhook or provider API) | PAYMENT_CONFIRMED → PLACED | system |
| PAYMENT_PENDING | payment failed / expired (`payments.expiry`, default 15 min) | PAYMENT_FAILED (terminal) | system |
| CREATED, PAYMENT_PENDING | customer abandons / cancels | CUSTOMER_CANCELLED | customer |

A payment success arriving **after** PAYMENT_FAILED/CUSTOMER_CANCELLED does not revive the order; it
triggers an automatic refund ([PAYMENTS.md §3](PAYMENTS.md#3-online-payment-flow)).

### 3.2 Kitchen track (order is PLACED or later)

| From | Event | To | Actor / guard |
|---|---|---|---|
| NEW | alert acknowledged by a restaurant device (socket ack or push receipt) | NEW (sets `restaurantNotifiedAt`) | system |
| NEW | accept (with prep time, bounded by settings) | ACCEPTED | restaurant user · or system if `autoAccept` |
| NEW | reject (reason required) | REJECTED | restaurant user · or system on timeout when fallback = AUTO_REJECT |
| ACCEPTED | start preparing | PREPARING | restaurant user · or automatic on accept (setting) |
| ACCEPTED, PREPARING | mark ready | READY_FOR_PICKUP | restaurant user |
| READY_FOR_PICKUP | rider confirms pickup | COMPLETED | rider (guard: delivery track AT_RESTAURANT) |
| ACCEPTED, PREPARING, READY_FOR_PICKUP | order cancelled (§5) | CANCELLED | via cancellation |

Prep-time adjustments while ACCEPTED/PREPARING are events that update `prepTimeMinutes` (history row,
no status change).

**Acceptance timeout (§20):** settings `orders.restaurantAcceptance.timeoutSec` (default 180 s) and
`…fallback` = `ESCALATE_TO_OPS` (default) | `AUTO_REJECT` | `AUTO_ACCEPT`. ESCALATE raises an ops alert and,
after `…escalationGraceSec` (default 120 s), auto-rejects. Scheduled as a delayed queue job; the job
re-checks state before acting (idempotent).

### 3.3 Delivery track

| From | Event | To | Actor / guard |
|---|---|---|---|
| NOT_STARTED | dispatch trigger (setting `dispatch.startAt` = ON_ACCEPT (default) \| PREP_TIME_MINUS_LEAD) — **does not wait for the food to be ready** (OD-17) | SEARCHING | system |
| SEARCHING | offer sent to a rider · or manual admin assignment | ASSIGNED | system / admin |
| ASSIGNED | rider accepts (DB guarantees single winner) | ACCEPTED | rider |
| ASSIGNED | rider rejects / offer times out | SEARCHING | rider / system |
| ACCEPTED, AT_RESTAURANT | rider unassigns (reason) · admin reassigns | SEARCHING | rider / admin |
| ACCEPTED | arrived at restaurant (geofence advisory) | AT_RESTAURANT | rider |
| AT_RESTAURANT | pickup confirmed (order number verified; guard: kitchen READY_FOR_PICKUP) | PICKED_UP | rider |
| PICKED_UP | start trip (automatic) | ON_THE_WAY | system |
| ON_THE_WAY | arrived at customer | ARRIVED | rider |
| ARRIVED | delivered (guards: delivery OTP if flag on; COD collection confirmed if COD; proof photo if flag on) | DELIVERED | rider |
| SEARCHING | escalation timeout (`dispatch.noRiderEscalationSec`) | NO_RIDER_FOUND | system → ops alert |
| NO_RIDER_FOUND | retry / manual assignment | SEARCHING / ASSIGNED | admin |
| any non-terminal | order cancelled | CANCELLED | via cancellation |

### 3.4 Terminal & cancellation states (overall)

`DELIVERED`, `CUSTOMER_CANCELLED`, `RESTAURANT_CANCELLED`, `RESTAURANT_REJECTED`, `RIDER_ISSUE`,
`ADMIN_CANCELLED`, `PAYMENT_FAILED`. No transition leaves a terminal state; post-completion changes
(refunds, adjustments, support) are separate records and only move `financialStatus`.

`RIDER_ISSUE` = order could not be completed because of a rider-side failure **after pickup** (accident,
food damaged/lost). Rider problems before pickup are handled by reassignment, not cancellation.

## 4. Deriving the overall status

```
deriveStatus(order):
  if order is terminal/cancelled/failed        → that state
  if payment phase (CREATED/PAYMENT_*)          → that state
  if deliveryStatus ∈ {PICKED_UP, ON_THE_WAY, ARRIVED, DELIVERED} → same-named status
    if restaurantStatus ∈ {READY_FOR_PICKUP, COMPLETED}:
       NOT_STARTED                   → READY_FOR_PICKUP
       SEARCHING | NO_RIDER_FOUND    → RIDER_SEARCHING
       ASSIGNED                      → RIDER_ASSIGNED
       ACCEPTED                      → RIDER_ACCEPTED
       AT_RESTAURANT                 → RIDER_AT_RESTAURANT
    kitchen: NEW (not yet notified)→PLACED, NEW (restaurantNotifiedAt set)→RESTAURANT_NOTIFIED,
           ACCEPTED→RESTAURANT_ACCEPTED, PREPARING→PREPARING, REJECTED→RESTAURANT_REJECTED
```

Before the food is ready, overall status follows the kitchen (what the customer cares about); rider
progress is still visible in `deliveryStatus` and on the tracking map.

## 5. Cancellations (§35)

Stage is computed from the tracks at the moment of cancellation:

| Stage | Condition | Who may cancel (default) |
|---|---|---|
| BEFORE_ACCEPT | kitchen NEW | customer (free), restaurant (= reject), admin |
| AFTER_ACCEPT | kitchen ACCEPTED | customer (fee per rule), restaurant (penalty per rule), admin |
| AFTER_PREPARING | kitchen PREPARING/READY_FOR_PICKUP, not picked up | customer only if rule allows; restaurant; admin |
| AFTER_PICKUP | delivery PICKED_UP or later | admin / support only (→ ADMIN_CANCELLED or RIDER_ISSUE) |

`cancellation_rules.params` per (stage, actor): customer fee (fixed/% of food), refund policy
(FULL/PARTIAL/NONE), restaurant compensation (e.g. food value if prepared), rider compensation (e.g. trip
earning if rider was at restaurant), who absorbs the rest (platform loss). The outcome is written to
`order_cancellations` with the rule snapshot; ledger postings and the refund are created in the same
transaction (refund execution is async via the payment adapter). Admin may override the computed outcome;
overrides require a reason, are flagged `isAdminOverride` and audit-logged.

Coupon usages are released (`reversedAt`) and stock restored on cancellation before pickup.

## 6. Checkout & creation (§17, §40)

`POST /v1/orders` requires an `Idempotency-Key` (client generates one per checkout attempt and reuses it
on retry). In one transaction:

1. Lock nothing yet; re-run the **full pricing pipeline** from current DB state (never trust client totals). If the total differs from the quote the client confirmed, return `409 PRICE_CHANGED` with the new quote.
2. Revalidate availability, schedule, stock, restaurant open, serviceability, COD eligibility, coupon limits.
3. Insert order (unique `(customerId, idempotencyKey)` → a double tap returns the first order), items, add-ons, address copy, pricing snapshot, coupon usage (conditional increment), status history, outbox event.
4. Online payment: create provider order via adapter **after commit** (outbox) and return the payment payload; COD: order goes straight to PLACED.

## 7. Events emitted (outbox → notifications, dispatch, realtime)

`order.created`, `order.placed`, `order.restaurant_notified`, `order.accepted`, `order.rejected`,
`order.preparing`, `order.ready`, `order.dispatch_started`, `order.rider_assigned`, `order.rider_accepted`,
`order.rider_at_restaurant`, `order.picked_up`, `order.arriving`, `order.delivered`, `order.cancelled`,
`order.payment_failed`, `order.refund_*`. Notification templates map to these events ([§41](MASTER_SPEC.md#41-notifications)).

## 8. Tests (Phase 5/6)

- Exhaustive: for every (state, event, actor) triple, assert allowed/denied matches the tables above (generated, so a table change forces a test change).
- `deriveStatus` for every reachable (kitchen, delivery) pair.
- Concurrency: two riders accept simultaneously → exactly one succeeds; accept vs. timeout job race; cancel vs. accept race.
- E2E scenarios from §56, run against the real API + PGlite with fake payment/push/SMS adapters.
