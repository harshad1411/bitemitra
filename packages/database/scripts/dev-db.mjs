#!/usr/bin/env node
// Local development PostgreSQL without Docker (real PostgreSQL binaries from the embedded-postgres
// package, persistent in var/postgres). Prefer `docker compose up postgres` if you have Docker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPostgresServer } from '../src/postgres-server.js';
import { withClient } from '../src/testing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.DEV_DB_PORT ?? 55432);
const server = await startPostgresServer({
  dataDir: path.join(root, 'var/postgres'),
  port,
  persistent: true,
});
await withClient(server.adminUrl, async (c) => {
  const { rowCount } = await c.query(`SELECT 1 FROM pg_database WHERE datname = 'jamzo'`);
  if (!rowCount) await c.query('CREATE DATABASE jamzo');
});
console.log(
  `PostgreSQL (embedded) ready: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/jamzo`,
);
console.log('Press Ctrl+C to stop.');
const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
