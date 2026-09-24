# @jamzo/database

PostgreSQL schema (Prisma 6, `prisma-client-js`), hand-written constraints, and (from Phase 1) migrations, client export and deterministic seed data.

- `prisma/schema.prisma` — full data model (96 tables), **Phase 0 design**
- `prisma/constraints.sql` — partial unique indexes + CHECK constraints Prisma cannot express
- Verify: `pnpm verify:schema` from the repo root

Design: [docs/DATABASE.md](../../docs/DATABASE.md)
