# Performance and load testing

Status: **Phase 10.** Speed targets (D-72) are a launch condition. This page records how the API was
load-tested and what the numbers were. The launch run still has to happen on the staging Droplet (D-102).

## 1. Targets (D-72)

| Target | Measured by |
|---|---|
| API p95 < 300 ms at rush load | `pnpm load-test` (below); `/metrics` histogram in production |
| Home < 2 s on 4G | manual check on a phone at launch (not measured yet) |
| Cached screens instant | TanStack Query caching in the apps (built) |
| Images from a CDN in renditions | media renditions (Phase 1) + Spaces CDN (D-98) |

## 2. The load test

`pnpm load-test` (`scripts/load-test.mjs`) works like this:
- It starts the real API and worker as separate processes on the development database (seeded catalog).
- It signs in 8 test customers and the demo delivery partner, and places one order per customer.
- It sends a **rush-hour mix** at a fixed rate: app config 8%, home 17%, menus 22%, cart quotes 18%, order
  tracking 17%, partner location updates 13%, checkout 5%.
- Each request comes from its own address through the proxy header, as phones do in production.
- Rate limits are the real ones, except sign-in.
- Every branch is kept open during the test and restored afterwards (development data only).
- It reports p50 / p95 / p99 per request type, errors, and the API's own server-side timings from `/metrics`.

Options: `RATE` (requests/s), `DURATION` (s), `SKIP="checkout,partner location"`, `API_PROFILE=<dir>`
(CPU profile of the API).

**Expected rush load at launch (Unjha):** a few hundred orders a day, about a quarter of them in the busiest
hour. Each order is about 40 API calls (browsing, quote, checkout, tracking), plus delivery partners' location
updates every 10 s. That comes to roughly **5 requests/s**. The test runs at 5×, 10× and 20× that.

## 3. Results — development Mac (2026-09-25)

Machine: Apple M4 MacBook, embedded PostgreSQL 18 on the same machine, API + worker + load generator on the same
machine. **Not DigitalOcean hardware**: the 2 GiB Droplet has less CPU, and the managed database is on the
network.

| Rate | Duration | Overall p50 / p95 / p99 | Checkout p95 | Errors | Inside the API ≤ 300 ms |
|---|---|---|---|---|---|
| 25/s (run 1) | 60 s | 9 / 24 / 31 ms | 37 ms | none | 100% |
| 25/s (run 2) | 60 s | 9 / 24 / 31 ms | 35 ms | none | 100% |
| 25/s (run 3) | 60 s | 9 / 21 / 31 ms | 36 ms | none | 100% |
| 50/s | 60 s | 6 / 20 / 26 ms | 30 ms | 62 location updates refused (429)* | 100% |
| 100/s | 30 s | 6 / 23 / 27 ms | 31 ms | 76 location updates refused (429)* | 100% |

\* The test sends every location update from one partner (6–13 a second). A real partner sends one every
10 s, so the per-user limit of 300 a minute correctly refused the extra ones.

**What the load test found and fixed:**
- Rate limits counted per IP address only. Indian mobile networks put many phones behind one address
  (carrier-grade NAT), so real customers could have blocked each other. Signed-in requests now count per
  user (tested).
- Monitoring endpoints (`/health`, `/ready`, `/metrics`) could be rate-limited. They are exempt now.
- The first runs were misconfigured: every request came from one address, and many were refused and fast,
  which hid the real numbers. They also showed slow spikes that did not come back once the test was
  corrected. The CPU profile showed the API 88% idle, and the database had no waiting queries.

## 4. Before launch

1. On the **staging Droplet**, run the same test inside the API image against a scratch database created on the
   managed PostgreSQL cluster. The test needs development sign-in codes, so it cannot run against the real
   staging API, which sends SMS:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml run --rm \
     -e APP_ENV=development -e SMS_PROVIDER=console -e PAYMENT_PROVIDER=fake -e MEDIA_STORAGE_DRIVER=local \
     -e DATABASE_URL=<scratch database on the managed cluster> \
     api sh -c "node packages/database/scripts/prisma.mjs migrate deploy && node packages/database/src/seed/cli.js && RATE=25 DURATION=300 node scripts/load-test.mjs"
   ```
   This measures the Droplet's CPU and the network to the managed database. Delete the scratch database
   afterwards.
2. If p95 > 300 ms: show the owner the next Droplet / database size and its price (OD-40), resize, and repeat.
3. Check home on a real 4G phone in Unjha (< 2 s).
