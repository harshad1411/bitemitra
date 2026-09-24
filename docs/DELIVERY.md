# Delivery: service areas, dispatch, rider earnings, location

Status: **Phase 0 design.** Geo/serviceability in Phase 1, dispatch + rider app in Phase 6.
Package: `packages/delivery-engine` (this is MASTER_SPEC Part A's "dispatch-engine").

Covers MASTER_SPEC §14, §16, §21, §22, §23, §37, B3, B8.

## 1. Service areas (§37)

`Country → State → City → Zone → ServiceArea`. Nothing about Unjha is hard-coded: Unjha is seed data.

- **City**: `isActive` = accepting orders; timezone; centre point.
- **Zone**: GeoJSON polygon + bbox; operational unit for riders, surge, fees, targeting.
- **ServiceArea**: POLYGON or RADIUS inside a zone; a customer address is serviceable if it lies in an active service area.
- **Restaurant reach**: branch location + `restaurant_zones` (zones it serves) + max delivery distance (setting `delivery.maxDistanceM`, restaurant override) + the delivery pricing rule's `maxDistanceM`.

`serviceability(point)` → `{ serviceable, city, zone, reason }` with reasons NO_CITY, CITY_NOT_LIVE,
OUTSIDE_ZONES, OUTSIDE_SERVICE_AREA. Point-in-polygon is ray casting on GeoJSON with bbox pre-filter;
tests cover vertices, edges, holes and MultiPolygons.

## 2. Distance

Distance feeds customer delivery fees and rider pay, so its source is a money decision
(**⚠ [Q9](DECISIONS.md#q9-distance-used-for-pricing)**). Design: a `MapsProvider.routeDistance(a, b)`
adapter with cache (rounded coordinates, 24 h TTL) and a deterministic fallback of
`haversine × roadFactor` (setting `delivery.roadFactor`, default 1.3) when the provider is down. The
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
- Tips pass through 100% (**⚠ Q10**).

## 5. Rider location

- Rider app sends location every `rider.locationIntervalSec` (default 10 s while on a trip, 30 s online-idle; distance filter 25 m) via REST batch (`POST /v1/rider/locations`, up to 50 points) — batches survive reconnects; sockets are only for live fan-out to customer tracking.
- Latest point → `rider_availability` (hot row); breadcrumbs → `rider_locations` (partitioned/TTL later).
- Customer tracking receives rider location only between ACCEPTED and DELIVERED, rounded, and never the rider's personal details beyond name/photo/vehicle (privacy §49).
- Background location is required while online so offers and tracking work with the app backgrounded — platform specifics in [MOBILE.md §5](MOBILE.md#5-rider-app-platform-specifics).

## 6. Contact abstraction

Customer ↔ rider calls go through a `CallBridge` interface (masked-number provider, e.g. Exotel/Knowlarity) so
neither side sees the other's real number (§21, §49). Until a provider is chosen, the app shows a
support-routed number; direct numbers are never exposed.

## 7. Tests

Point-in-polygon edge cases · serviceability reasons · slab/per-km boundaries (shared with pricing) ·
earning rule combinations (min earning, waiting cap, night window, batch) · dispatch filtering (COD
headroom, stale location, capacity) · deterministic ranking · offer timeout → next rider · race of two
accepts · no-rider escalation · manual assignment audit.
