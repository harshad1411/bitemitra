# Environments & deployment

Status: **Proposal; cloud-agnostic by design (OD-31).** Hosting target is open (Q-11). Nothing is deployed in Phase 1; everything runs locally.
Full runbooks come in Phase 10.

## 1. Environments (§52)

| Env | Purpose | Data | Payments | Apps |
|---|---|---|---|---|
| development | local machines | seed data; PostgreSQL from `pnpm dev:db` (embedded real PostgreSQL, no Docker) **or** `docker compose up postgres` | none yet (Phase 7: fake provider) | Expo dev builds (`.dev` ids) |
| test | CI and local | a fresh database per test file on embedded PostgreSQL (local) or a PostgreSQL service container (CI) | fake provider | — |
| staging | pre-release, owner UAT | anonymised/seed | gateway **test** keys | `preview` builds (internal distribution / TestFlight / Play internal testing) |
| production | live | real | gateway **live** keys | store builds |

Each environment has its own database, storage bucket, push credentials, gateway account/keys and
secrets. Startup validates env vars with zod and refuses unsafe combinations (live keys outside
production, console SMS/fake payments in staging/production).

## 2. Proposed production topology (India region for latency and data residency)

- API + workers: plain Node.js processes packaged as containers — runnable on any VPS, container platform or Kubernetes. Start with 1 API + 1 worker; scale horizontally later.
- PostgreSQL: managed, Multi-AZ, point-in-time recovery, daily snapshot, read replica added when needed.
- Redis: **not needed at launch scale** (D-9); added only at the documented triggers.
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

**Razorpay (Phase 7, D-82).** The owner creates the Razorpay account (KYC) and gives test keys first:
`PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID` (`rzp_test_…`), `RAZORPAY_KEY_SECRET`, and a webhook in the
Razorpay dashboard pointing to `https://api.jamzo.in/v1/webhooks/payments/razorpay` for the events
`payment.captured`, `payment.failed`, `payment.authorized`, `refund.processed` and `refund.failed`. Its
secret goes in `RAZORPAY_WEBHOOK_SECRET`. All three go in the server environment only (the apps never see the
secret). The API refuses to start with live keys outside production and with test keys in production.

## 5. Backups & recovery (Phase 10)

PITR on Postgres (target RPO ≤ 5 min, RTO ≤ 1 h), quarterly restore drills, bucket versioning for media,
infrastructure described as code.
