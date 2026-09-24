// Real PostgreSQL for tests (TESTING.md §1). The Vitest global setup (./test-global-setup.js) provides a
// server — embedded locally, a service container in CI — and a migrated template database. Every call to
// startTestDatabase() creates an isolated copy of that template, so tests never share state.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/** Ordered SQL of every committed migration. */
export async function migrationSql() {
  const dirs = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return Promise.all(dirs.map((d) => readFile(path.join(migrationsDir, d, 'migration.sql'), 'utf8')));
}

/**
 * Run a callback with a pg client connected to a URL.
 * @template T
 * @param {string} url
 * @param {(client: pg.Client) => Promise<T>} fn
 */
export async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** @param {string} url @param {string} database */
export function urlForDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Creates a migrated template database on the given server (used by the global setup).
 * @param {string} adminUrl
 * @param {string} templateName
 */
export async function createTemplateDatabase(adminUrl, templateName) {
  await withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${templateName}" WITH (FORCE)`));
  await withClient(adminUrl, (c) => c.query(`CREATE DATABASE "${templateName}"`));
  await withClient(urlForDatabase(adminUrl, templateName), async (c) => {
    for (const sql of await migrationSql()) await c.query(sql);
  });
}

/**
 * @param {{ poolSize?: number }} [options]
 * @returns {Promise<{ url: string, name: string, stop: () => Promise<void> }>}
 */
export async function startTestDatabase({ poolSize = 5 } = {}) {
  const adminUrl = process.env.TEST_DATABASE_URL;
  const template = process.env.TEST_TEMPLATE_DATABASE;
  if (!adminUrl || !template) {
    throw new Error(
      'No test database server. Add `globalSetup: "@jamzo/database/test-global-setup"` to the Vitest config.',
    );
  }
  const name = `jamzo_t_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await withClient(adminUrl, (c) => c.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`));
  const url = `${urlForDatabase(adminUrl, name)}?connection_limit=${poolSize}`;
  return {
    url,
    name,
    stop: () =>
      withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(
        () => undefined,
      ),
  };
}
