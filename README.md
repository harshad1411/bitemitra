# BiteMitra

*Good Food. Closer to You.* — a food-delivery marketplace launching in **Unjha, Gujarat**, architected
for many cities.

> **Status: Phase 0 (architecture) complete — awaiting owner review.** No application code exists yet
> by design; Phase 1 starts after review. See [docs/DECISIONS.md](docs/DECISIONS.md) for open questions.

## Products

| Product | Folder | Tech | Platforms |
|---|---|---|---|
| Customer app | `apps/customer` | Expo / React Native (JS) | Android + iOS |
| Restaurant app | `apps/restaurant` | Expo / React Native (JS) | Android + iOS |
| Rider app | `apps/rider` | Expo / React Native (JS) | Android + iOS |
| Admin | `apps/admin` | Next.js (JS) | Web (desktop-first, responsive) |
| API | `services/api` | Node.js, Fastify, Prisma, PostgreSQL | — |
| Workers | `services/workers` | Node.js, BullMQ, Redis | — |
| Shared engines & libraries | `packages/*` | JavaScript (ESM) | — |

**JavaScript only** — no TypeScript source in this repository (owner directive, MASTER_SPEC Part C).

## Documentation

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Specification: [docs/MASTER_SPEC.md](docs/MASTER_SPEC.md).

| Topic | Doc |
|---|---|
| Database design | [DATABASE.md](docs/DATABASE.md) |
| Pricing hierarchy & calculation | [PRICING.md](docs/PRICING.md) |
| Order state machine | [ORDERS.md](docs/ORDERS.md) · [ORDER_FLOW.md](docs/ORDER_FLOW.md) |
| Payments & COD | [PAYMENTS.md](docs/PAYMENTS.md) |
| Ledgers & settlements | [SETTLEMENTS.md](docs/SETTLEMENTS.md) |
| Service areas, dispatch, rider earnings | [DELIVERY.md](docs/DELIVERY.md) |
| Roles & permissions | [RBAC.md](docs/RBAC.md) |
| Security & privacy | [SECURITY.md](docs/SECURITY.md) |
| API conventions | [API.md](docs/API.md) |
| Configuration, flags, app versions | [CONFIGURATION.md](docs/CONFIGURATION.md) |
| Mobile apps | [MOBILE.md](docs/MOBILE.md) |
| Testing | [TESTING.md](docs/TESTING.md) |
| Environments & releases | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Decisions & questions | [DECISIONS.md](docs/DECISIONS.md) |
| Changelog | [CHANGELOG.md](docs/CHANGELOG.md) |

## What you can run today

Requires Node.js ≥ 22.12 and pnpm 11.

```bash
pnpm install
```

```bash
pnpm verify:schema
```

This validates the database schema, applies it to an empty PostgreSQL (in-process, no install needed)
and proves the database-level guarantees (no double rider acceptance, no duplicate orders/webhooks/
refunds/ledger postings/settlements, money CHECKs).

## Brand

Logo kit: [assets/brand/](assets/brand/) (see its `README.txt`). Colours: Orange `#F37321`,
Charcoal `#25282B`, Leaf green `#3E9B37`.
