#!/usr/bin/env node
// Restore drill (D-103): restores the newest dump in var/backups/ (or BACKUP_DIR) into a scratch database on
// the same server, compares the row count of every table with the live database, then drops the scratch
// database. A backup is only proven once it has been restored.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dir = path.resolve(process.env.BACKUP_DIR ?? 'var/backups');
const dumps = readdirSync(dir)
  .filter((f) => f.endsWith('.dump'))
  .sort();
if (!dumps.length) throw new Error(`No dump in ${dir}: run pnpm db:backup first`);
const dump = path.join(dir, dumps.at(-1));
const bin = (name) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name);
const scratch = `jamzo_restore_drill_${Date.now()}`;
const scratchUrl = (() => {
  const u = new URL(url);
  u.pathname = `/${scratch}`;
  return u.toString();
})();

const counts = async (connectionString) => {
  const c = new pg.Client({ connectionString });
  await c.connect();
  const tables = (
    await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)
  ).rows.map((r) => r.tablename);
  const out = {};
  for (const t of tables) out[t] = Number((await c.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
  await c.end();
  return out;
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`CREATE DATABASE "${scratch}"`);
try {
  execFileSync(
    bin('pg_restore'),
    ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', scratchUrl, dump],
    {
      stdio: 'inherit',
    },
  );
  const [live, restored] = [await counts(url), await counts(scratchUrl)];
  const diff = Object.keys(live).filter((t) => live[t] !== restored[t]);
  const tables = Object.keys(live).length;
  const rows = Object.values(restored).reduce((n, x) => n + x, 0);
  if (diff.length) {
    console.error(
      `✗ restore differs in ${diff.length} tables: ${diff.map((t) => `${t} ${live[t]}→${restored[t]}`).join(', ')}`,
    );
    console.error(
      '  (a busy live database can change between the backup and the drill; rerun on a quiet copy)',
    );
    process.exitCode = 1;
  } else
    console.log(
      `✓ restore drill: ${path.basename(dump)} → ${tables} tables, ${rows} rows, every count matches`,
    );
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
  await admin.end();
}
