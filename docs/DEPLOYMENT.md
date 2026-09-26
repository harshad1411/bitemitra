# Environments & deployment

Status: **Runbook ready (Phase 10, D-98 … D-103). Hosting: DigitalOcean Bangalore, Option 2 (OD-40).** Nothing is
created, bought or published until the owner does it or approves it; prices are re-checked at launch.
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

## 2. Production topology (OD-40 Option 2, D-101)

| Piece | DigitalOcean product | Notes |
|---|---|---|
| API + worker + admin | one 2 GiB Droplet (BLR1) with Docker Compose (`deploy/docker-compose.prod.yml`) | Caddy in front: HTTPS for `api.jamzo.in` and `admin.jamzo.in`, renewed automatically |
| Database | managed PostgreSQL 1 GiB (BLR1) | daily backups, 7-day point-in-time restore, SSL; the Droplet in its trusted sources only |
| Files | Spaces (BLR1) + Spaces CDN | `MEDIA_STORAGE_DRIVER=spaces`; public renditions via the CDN, `private/…` documents private (D-98) |
| DNS | stays at GoDaddy | A records `api` and `admin` → the Droplet's IP |
| Monitoring | DigitalOcean uptime checks + alerts | `https://api.jamzo.in/ready` every minute; CPU / memory / disk alerts on the Droplet (D-99) |

Grow (no code change): a second Droplet behind a load balancer, a database standby, a bigger plan — the
owner sees the price first.

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

## 5. Backups & recovery (D-103)

- **Managed PostgreSQL:** daily backups + 7-day point-in-time restore (RPO ≈ minutes). Restore = DigitalOcean
  → Database → Restore from backup to a **new** cluster, check it, then switch `DATABASE_URL`.
- **Extra copy:** `pnpm db:backup` (compressed `pg_dump`) weekly from the Droplet, uploaded to a private Spaces
  folder (`backups/`), kept 8 weeks.
- **Drill:** `pnpm db:restore-drill` restores the latest dump into a scratch database and compares every
  table's row count. Run 2026-09-25 on the development database: 94 tables, 1 591 rows, all equal. Repeat on
  staging before launch, then every quarter.
- **Files:** renditions can be regenerated from originals; enable Spaces versioning for `private/` documents.

## 6. First-time setup (owner + me, in this order)

1. Owner: create the DigitalOcean account and billing (approves the price shown at launch — OD-40).
2. Create the Droplet (Ubuntu 24.04, BLR1, SSH key only), the managed PostgreSQL cluster (BLR1; trusted
   source = the Droplet) and a Space with CDN; create a Spaces key.
3. On the Droplet: install Docker; `git clone` the repository; copy `deploy/.env.production` from the template
   below (never committed); `docker login` to the registry holding the images built by CI.
4. GoDaddy: add A records `api` and `admin` → the Droplet IP. Caddy then gets certificates by itself.
5. `deploy/deploy.sh <tag>` — pulls images, runs migrations, starts the containers, waits for `/ready`.
6. Seed only reference data in production (`SEED_DEMO=false pnpm db:seed` with `SEED_ADMIN_EMAIL` /
   `SEED_ADMIN_PASSWORD` set once for the first Super Admin).
7. Razorpay webhook (§4), MSG91 sender and templates, Expo push credentials, Google Maps key — as each account
   exists.

`deploy/.env.production` (template — values from the owner's accounts):

```
APP_ENV=production
DATABASE_URL=postgresql://…?sslmode=require
JWT_ACCESS_SECRET=… (48+ random chars)   OTP_PEPPER=… (48+ random chars)
FIELD_ENCRYPTION_KEY=… (32 random bytes, base64 — keep a copy in a password manager)
TRUST_PROXY=true   COOKIE_SECURE=true   CORS_ORIGINS=https://admin.jamzo.in
MEDIA_STORAGE_DRIVER=spaces  SPACES_ENDPOINT=https://blr1.digitaloceanspaces.com  SPACES_BUCKET=…  SPACES_KEY=…  SPACES_SECRET=…
MEDIA_PUBLIC_BASE_URL=https://<space>.blr1.cdn.digitaloceanspaces.com
PAYMENT_PROVIDER=razorpay  RAZORPAY_KEY_ID=rzp_live_…  RAZORPAY_KEY_SECRET=…  RAZORPAY_WEBHOOK_SECRET=…
SMS_PROVIDER=…  EMAIL_PROVIDER=…  PUSH_PROVIDER=expo  EXPO_ACCESS_TOKEN=…
GOOGLE_MAPS_API_KEY=…   METRICS_TOKEN=… (24+ random chars)
```

The API refuses to start with development-only providers, local file storage, test gateway keys or insecure
cookies in production.

## 7. Deploy, rollback, incidents

- **Deploy:** CI builds `jamzo-api:<tag>` and `jamzo-admin:<tag>` → `deploy/deploy.sh <tag>` on the Droplet.
  Migrations are expand-only, so the previous version keeps working against the new schema.
- **Rollback:** `deploy/deploy.sh <previous tag>`. A database restore is only for data loss, never for a bad
  release.
- **Readiness went red (`/ready` 503):** `DATABASE` → check the managed database status; `OUTBOX_STUCK` → the
  worker is down or failing: `docker compose logs worker`, then `docker compose restart worker`. Parked jobs are
  visible in `/metrics` (`jamzo_outbox_parked`).
- **Watch daily in Jamzo Admin:** orders needing attention, failed refunds, cash deposits to check,
  settlements to approve, Finance → Checks.

## 8. Launch checklist

- [ ] Owner: DigitalOcean price confirmed at launch (OD-40); accounts: Razorpay (KYC), MSG91 + DLT, Expo,
      Apple Developer, Google Play, Google Maps key.
- [ ] CA answers on tax (Q-3) and legal pages / markup (Q-4, Q-12); placeholder amounts replaced (A-16).
- [ ] Admin two-factor sign-in built (Q-15 — the owner chooses the method).
- [ ] Staging load test on the Droplet meets p95 < 300 ms (docs/PERFORMANCE.md §4); home < 2 s on 4G.
- [ ] Restore drill on staging; uptime alert tested by stopping the worker once.
- [ ] Razorpay test payments, refunds and webhooks verified on staging with test keys; then live keys.
- [ ] Apps: EAS builds for internal testing (TestFlight / Play internal); store listings — the owner submits.
