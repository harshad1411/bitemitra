// Prisma client factory and re-exports. Only services (API, workers) import this package — never clients.
import { PrismaClient, Prisma } from '@prisma/client';

export { PrismaClient, Prisma };

/**
 * Database handle type used in services' JSDoc. Deliberately `any`: Prisma's generated argument types
 * demand TypeScript literal-enum annotations; queries are instead validated by zod at the edge and
 * exercised against real PostgreSQL in integration tests (DECISIONS D-1).
 * @typedef {any} Db
 */

/**
 * @param {{ url?: string, log?: ('query' | 'info' | 'warn' | 'error')[] }} [options]
 */
export function createPrismaClient({ url, log = ['warn', 'error'] } = {}) {
  return new PrismaClient({ datasources: url ? { db: { url } } : undefined, log });
}

/**
 * True when the error is a unique-constraint violation (Prisma P2002 or SQLSTATE 23505).
 * @param {unknown} err
 */
export function isUniqueViolation(err) {
  const e = /** @type {any} */ (err);
  return e?.code === 'P2002' || e?.meta?.code === '23505' || /23505|unique constraint/i.test(String(e?.message ?? ''));
}
