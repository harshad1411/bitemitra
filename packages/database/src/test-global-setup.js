// Vitest global setup: one PostgreSQL server + one migrated template database per test run.
// If TEST_DATABASE_URL is already set (CI service container), that server is used instead.
import os from 'node:os';
import path from 'node:path';
import { startPostgresServer } from './postgres-server.js';
import { createTemplateDatabase, withClient } from './testing.js';

let server = null;

export async function setup() {
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    server = await startPostgresServer({ dataDir: path.join(os.tmpdir(), `jamzo-test-pg-${process.pid}`), fresh: true });
    adminUrl = server.adminUrl;
  }
  const template = `jamzo_template_${process.pid}`;
  await createTemplateDatabase(adminUrl, template);
  process.env.TEST_DATABASE_URL = adminUrl;
  process.env.TEST_TEMPLATE_DATABASE = template;
}

export async function teardown() {
  const adminUrl = process.env.TEST_DATABASE_URL;
  const template = process.env.TEST_TEMPLATE_DATABASE;
  if (adminUrl && template) {
    await withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`)).catch(() => {});
  }
  await server?.stop();
}
