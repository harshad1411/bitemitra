# Environments & deployment

Status: **Phase 0 proposal.** Hosting provider is **⚠ [Q11](DECISIONS.md#q11-hosting-and-third-party-saas)**.
Full runbooks come in Phase 10.

## 1. Environments (§52)

| Env | Purpose | Data | Payments | Apps |
|---|---|---|---|---|
| development | local machines | seed data, local Postgres (Docker) or PGlite | fake provider | Expo dev builds (`.dev` ids) |
| test | CI | ephemeral PGlite / Postgres container | fake provider | — |
| staging | pre-release, owner UAT | anonymised/seed | gateway **test** keys | `preview` builds (internal distribution / TestFlight / Play internal testing) |
| production | live | real | gateway **live** keys | store builds |

Each environment has its own database, Redis, bucket, push credentials, gateway account/keys and
secrets. Startup validates env vars with zod and refuses unsafe combinations (live keys outside
production, console SMS/fake payments in staging/production).

## 2. Proposed production topology (India region for latency and data residency)

- API + workers: containers (2+ API, 1+ worker) behind a load balancer with TLS, autoscaling on CPU/latency.
- PostgreSQL: managed, Multi-AZ, point-in-time recovery, daily snapshot, read replica added when needed.
- Redis: managed (queues, cache, Socket.IO adapter, rate limits).
- Object storage + CDN for media renditions.
- Admin (Next.js): container or managed Next.js hosting, same region.
- Observability: centralised JSON logs, error monitoring, uptime checks, alerting on queue depth / payment webhook failures / settlement failures.

## 3. Release process

| Component | Trigger | Steps |
|---|---|---|
| API / workers | merge to `main` → staging; tag `api@x.y.z` → production | build → test → migrate (`prisma migrate deploy`, expand-only) → rolling deploy → smoke tests |
| Admin | merge → staging; tag `admin@x.y.z` → production | build → test → deploy |
| Customer / Restaurant / Rider | tag `customer@x.y.z` (etc.) | EAS Build (Android AAB + iOS IPA) → EAS Submit to Play internal / TestFlight → staged rollout; OTA JS fixes via EAS Update on the matching runtime version |

Mobile app versions are independent (B10). Before raising any app's `minSupportedVersion`, the API
must support every version above it (contract tests), and the version-policy change is made in Admin.

## 4. Accounts the owner will need (no credentials are ever committed)

Apple Developer Program (organisation) · Google Play Console · Expo/EAS account · Firebase project (FCM)
+ APNs key · payment gateway (test + live) · SMS/OTP provider (DLT registration for India) · maps
provider · cloud hosting · domain + DNS · error monitoring. See [DECISIONS.md](DECISIONS.md).

## 5. Backups & recovery (Phase 10)

PITR on Postgres (target RPO ≤ 5 min, RTO ≤ 1 h), quarterly restore drills, bucket versioning for media,
infrastructure described as code.
