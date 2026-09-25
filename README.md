# Jamzo

Food-delivery platform launching in **Unjha, Gujarat**, built for many cities (jamzo.in).

> **Status: Phase 6 (delivery partners and dispatch) complete — awaiting owner review.** Phases 1–5 were
> accepted. Online payments and settlements arrive in Phases 7–8. Decisions and open
> questions: [docs/DECISIONS.md](docs/DECISIONS.md).

## Products

| Product | Folder | Tech | Platforms | Identifier |
|---|---|---|---|---|
| Jamzo (customer) | `apps/customer` | Expo / React Native (JS) | Android + iOS | `in.jamzo.customer` |
| Jamzo Restaurant Partner | `apps/restaurant` | Expo / React Native (JS) | Android + iOS | `in.jamzo.restaurant` |
| Jamzo Delivery Partner | `apps/rider` | Expo / React Native (JS) | Android + iOS | `in.jamzo.rider` |
| Jamzo Admin | `apps/admin` | Next.js + Tailwind + shadcn/ui (JS) | Web (desktop-first) | — |
| API | `services/api` | Node.js, Fastify, Prisma 6, PostgreSQL | — | — |
| Workers | `services/workers` | Node.js (outbox relay on PostgreSQL) | — | — |

**JavaScript only** — no TypeScript source (owner decision OD-1). Identifiers live only in
[`packages/config/src/apps.js`](packages/config/src/apps.js).

## Run it locally

Requires Node.js ≥ 22.12 and pnpm 11. No Docker needed (a real PostgreSQL runs from npm).

```bash
pnpm install
```

```bash
cp .env.example .env
```

Edit `.env`: replace `JWT_ACCESS_SECRET` and `OTP_PEPPER` with long random strings, set `FIELD_ENCRYPTION_KEY`
to 32 random bytes in base64 (the command is in `.env.example`; it encrypts bank account numbers) and set
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` for your first Super Admin. Then, in separate terminals:

```bash
pnpm dev:db
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev:api
```

```bash
pnpm dev:workers
```

```bash
pnpm dev:admin
```

Open http://localhost:3000 and sign in with the seed admin credentials.

Mobile apps (need an iOS simulator, Android emulator or a phone with Expo Go/a development build; see
`apps/<app>/.env.example` for the API URL — Android emulators use `http://10.0.2.2:4000`):

```bash
pnpm dev:customer
```

**OTP codes in development** are not sent by SMS: the API prints them in its log (`console SMS provider`).
Demo partner numbers seeded for testing: restaurant owner `9000000001`, delivery partner `9000000002`,
pending delivery partner `9000000003`, manager of a not-yet-approved restaurant `9000000004`. The demo catalog
adds 12 fictional Unjha restaurants with 108 products; each demo restaurant's owner signs in with the
restaurant's phone (`9000000102` … `9000000111`, e.g. `9000000105` = Pizza Point).

## Checks

Everything that runs locally (lint, format, JSDoc types, schema + constraints, docs/API sync, all tests):

```bash
pnpm check
```

Admin end-to-end tests (Playwright; starts its own database and API):

```bash
pnpm --filter @jamzo/admin test:e2e
```

Mobile JavaScript bundles for Android and iOS (per app):

```bash
pnpm --filter @jamzo/rider export
```

Mobile dependency health (per app):

```bash
cd apps/rider && npx expo-doctor
```

CI (`.github/workflows/ci.yml`) additionally builds every app natively for Android (Gradle) and iOS
(simulator `xcodebuild`), which this development machine cannot do yet.

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [DECISIONS](docs/DECISIONS.md) · [DATABASE](docs/DATABASE.md) ·
[API](docs/API.md) · [CONFIGURATION](docs/CONFIGURATION.md) · [RBAC](docs/RBAC.md) · [SECURITY](docs/SECURITY.md) ·
[MOBILE](docs/MOBILE.md) · [TESTING](docs/TESTING.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [PRICING](docs/PRICING.md) ·
[ORDERS](docs/ORDERS.md) · [ORDER_FLOW](docs/ORDER_FLOW.md) · [PAYMENTS](docs/PAYMENTS.md) · [SETTLEMENTS](docs/SETTLEMENTS.md) ·
[DELIVERY](docs/DELIVERY.md) · [CHANGELOG](docs/CHANGELOG.md) · [MASTER_SPEC](docs/MASTER_SPEC.md)

## Brand

Jamzo brand assets do not exist yet: icons and splash screens are **placeholders** (a "J" monogram per app
colour, `pnpm assets:generate`). The earlier BiteMitra logo kit is kept, unused, in
[assets/legacy/](assets/legacy/) (DECISIONS Q-13).
