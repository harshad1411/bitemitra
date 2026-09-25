# Delivery: service areas, dispatch, rider earnings, location

Status: **Design (updated for OD-6, OD-14, OD-18) — built through Phase 6.** Phase 1: geography, zones, service areas, serviceability; Phase 2: branch delivery areas; **Phase 6: rider onboarding, online/location, dispatch, pickup and delivery, cash on delivery, rider earnings** — as built in §8 (decisions D-73..D-81).
Package: `packages/delivery-engine` (this is MASTER_SPEC Part A's "dispatch-engine").

Covers MASTER_SPEC §14, §16, §21, §22, §23, §37, B3, B8.

## 1. Service areas (§37)

Owner hierarchy (OD-6): **Country → State → City → Service Zone → Restaurant → Restaurant Branch →
Delivery Area.** Tables: `countries → states → cities → zones` (service zones) `→ service_areas`
(platform-serviceable areas inside a zone); `restaurants → restaurant_branches → branch_delivery_areas`
(each branch's own reach, D-19). Nothing about Unjha is hard-coded: Unjha is seed data, and a new city
(Mehsana, Ahmedabad, Surat…) is created in Admin with its own zones and configuration.

- **City**: `isActive` = accepting orders; timezone; centre point.
- **Zone**: GeoJSON polygon + bbox; operational unit for riders, surge, fees, targeting.
- **ServiceArea**: POLYGON or RADIUS inside a zone; a customer address is serviceable if it lies in an active service area.
- **Restaurant reach**: branch location + `restaurant_zones` (zones it serves) + max delivery distance (setting `delivery.maxDistanceM`, restaurant override) + the delivery pricing rule's `maxDistanceM`.

`serviceability(point)` → `{ serviceable, city, zone, reason }` with reasons NO_CITY, CITY_NOT_LIVE,
OUTSIDE_ZONES, OUTSIDE_SERVICE_AREA. Point-in-polygon is ray casting on GeoJSON with bbox pre-filter;
tests cover vertices, edges, holes and MultiPolygons.

## 2. Distance

**Route/road distance is the normal billing source** for customer delivery fees and rider distance
(OD-14). `MapsProvider.routeDistance(a, b)` is an interface (Google Maps or another provider — Q-14) with
a short-lived cache keyed by rounded coordinates. If a route cannot be obtained, the configurable
fallback `delivery.distance.fallback` applies: `HAVERSINE_FACTOR` (straight line ×
`delivery.distance.roadFactor`, default 1.3, order flagged `FALLBACK`) or `REJECT` (quote refused).
Straight-line distance is never the normal calculation. The
distance **used** and its source are stored in the snapshot, so the customer is charged exactly what was quoted.

## 3. Dispatch (§22)

Pluggable strategy interface — the first algorithm is not baked in:

```js
/** @interface DispatchStrategy */
rankCandidates({ order, restaurant, riders, now, settings }) // → [{ riderId, score, reasons }]
```

**v1 "nearest-available, weighted"** (pure, deterministic):

1. Filter: online, ACTIVE onboarding, in the order's zone (or neighbour zones per setting), location fresher than `dispatch.maxLocationAgeSec`, active orders < `dispatch.maxActiveOrders` (1 until batching is enabled), vehicle allowed for distance, COD eligibility + headroom for COD orders, not already rejected/timed-out for this order.
2. Score: `w1·(pickup distance) + w2·(time until food ready − rider ETA)² + w3·(active orders) − w4·(acceptance rate)`; weights are settings. Use of acceptance history is switchable (setting `dispatch.useAcceptanceHistory`, default off pending ops/legal view, §22).
3. Offer to the top rider for `dispatch.offerTimeoutSec` (default 30 s); on reject/timeout offer the next; after `dispatch.maxOffers` or `dispatch.noRiderEscalationSec` → NO_RIDER_FOUND + ops alert.

Supports automatic assignment, manual admin assignment (bypasses offers, audit-logged), reassignment
(rider unassign/admin), rider timeout, rider rejection with reason, and escalation. The single-winner
rule is a DB constraint. Dispatch start is configurable (`dispatch.startAt`), e.g. offer when
`prep time remaining ≤ rider ETA + buffer` to avoid riders waiting at restaurants.

## 4. Rider earnings (§16)

Independent from the customer delivery fee. `rider_earning_rules.params`:

```
{ basePaise, includedM, perKmPaise, billingUnitM, slabs?, distanceBasis: DELIVERY|PICKUP_PLUS_DELIVERY,
  pickupPerKmPaise?, minPaise, waitingFreeMin, waitingPerMinPaise, waitingCapPaise,
  incentives: [{ kind: NIGHT|PEAK|RAIN|MANUAL, type: FIXED|PERCENTAGE, value, window? }],
  batchSecondOrderPaise? }
```

- **Estimate** at order placement (snapshot) for margin visibility; **final** at DELIVERED with actual distances and waiting time (arrived-at-restaurant → picked-up minus free minutes) → `rider_earnings` (breakdown JSON + rule id) → rider ledger entries.
- Bonuses and manual adjustments are separate ledger entries with reason + audit.
- Tips: share per `tips.riderShareBps` (default 100%, OD-15), always a separate ledger line.

## 5. Rider location

- Rider app sends location every `rider.locationIntervalSec` (default 10 s while on a trip, 30 s online-idle; distance filter 25 m) via REST batch (`POST /v1/rider/locations`, up to 50 points) — batches survive reconnects; sockets are only for live fan-out to customer tracking.
- Latest point → `rider_availability` (hot row); breadcrumbs → `rider_locations` (partitioned/TTL later).
- Customer tracking receives rider location only between ACCEPTED and DELIVERED, rounded, and never the rider's personal details beyond name/photo/vehicle (privacy §49).
- Background location is required while online so offers and tracking work with the app backgrounded — platform specifics in [MOBILE.md §5](MOBILE.md#5-rider-app-platform-specifics-built-in-phase-6).

## 6. Contact abstraction

Customer ↔ rider calls go through a `CallBridge` interface (masked-number provider, e.g. Exotel/Knowlarity) so
neither side sees the other's real number (§21, §49). Until a provider is chosen, the app shows a
support-routed number; direct numbers are never exposed.

## 8. As built in Phase 6

Where this differs from §2–§6 above, this section and DECISIONS D-73..D-81 win.

- **Onboarding (D-73):** rider app → profile, vehicle, documents (private files; numbers encrypted, shown as last 4) → submit → Admin reviews each document → *Approve (go live)* only when every required document is verified (`riders.requiredDocuments`: motorised DL, RC, PAN, ID proof, photo; bicycle PAN, ID proof, photo).
- **Online and location (D-74):** `POST /v1/rider/status` opens/closes a `rider_shifts` row (one open shift per rider is a database rule); `POST /v1/rider/locations` takes batches, keeps breadcrumbs and updates `rider_availability`. The phone keeps sending in the background (`jamzo-rider-location` task) and queues points while offline.
- **Dispatch (D-75):** `services/api/src/modules/dispatch/service.js` runs `rankCandidates` (`nearest-available@1`) from the outbox worker: offer → accept/reject/timeout (`dispatch.offer_timeout` job) → next rider → NO_RIDER_FOUND + needs attention + retry (`dispatch.offers.retrySec`). Riders beyond `dispatch.offers.maxPickupDistanceM` or with a location older than `maxLocationAgeSec` are skipped. Admin assign/reassign/unassign are audited; a pending offer is withdrawn on reassignment.
- **Trip (D-76):** at restaurant → picked up (last 4 digits of the order number, kitchen must be ready) → arrived → delivered (delivery code, cash amount, optional proof photo). Rider problems flag the order.
- **Cash (D-77):** delivery writes a `payments` row (provider `cod`); the rider's cash balance and limit are shown in Admin. Deposits are Phase 8.
- **Earnings (D-78):** `riderEarningFinal` in `@jamzo/pricing-engine` → one `rider_earnings` row; a cancelled trip after acceptance pays the trip estimate (`CANCELLED_TRIP`).
- **Distance (D-81):** `createDistanceProvider` in `modules/delivery/distance.js`: Google Routes API (two-wheeler) when Admin → Delivery → Maps provider is GOOGLE **and** `GOOGLE_MAPS_API_KEY` is set; answers cached ~10 min by ~100 m cells, 1.5 s timeout, any failure → labelled fallback. **Tested against a fake endpoint only; not verified with Google.**
- **Customer arrival estimate (D-79):** `arrivalEstimate` (pure) + `arrivalFor` in the orders module; returned as `delivery.eta` `{minMinutes, maxMinutes, estimate, source}` or `arrivingNow` once the partner has arrived.
- **Contact (D-80):** support-routed only; the customer app shows the call button only when a support number is configured. Masked calling: Q-21.

## 7. Tests

Point-in-polygon edge cases · serviceability reasons · slab/per-km boundaries (shared with pricing) ·
earning rule combinations (min earning, waiting cap, night window, batch) · dispatch filtering (COD
headroom, stale location, capacity) · deterministic ranking · offer timeout → next rider · race of two
accepts · no-rider escalation · manual assignment audit. Phase 6 test files: `packages/delivery-engine/src/dispatch.test.js`, `services/api/test/riders.test.js`, `services/api/test/distance.test.js`, `apps/rider/__tests__`, `apps/admin/e2e/riders.spec.js`.
