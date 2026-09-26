#!/usr/bin/env node
// Logical backup (D-103): a compressed pg_dump of the database in DATABASE_URL, written to var/backups/ (or
// BACKUP_DIR). In production the managed database also keeps daily backups and 7-day point-in-time restore;
// this dump is the extra copy that is uploaded to Spaces (see docs/DEPLOYMENT.md).
// Needs pg_dump 18+ on PATH (or PG_BIN=/path/to/bin).
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dir = path.resolve(process.env.BACKUP_DIR ?? 'var/backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '')
  .replace(/\.\d+Z$/, 'Z');
const file = path.join(dir, `jamzo-${stamp}.dump`);
const bin = (name) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name);
execFileSync(
  bin('pg_dump'),
  ['--format=custom', '--compress=9', '--no-owner', '--no-privileges', '--file', file, url],
  {
    stdio: 'inherit',
  },
);
console.log(`✓ backup written: ${file} (${(statSync(file).size / 1024).toFixed(0)} KiB)`);
