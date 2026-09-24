#!/usr/bin/env node
// Generates the endpoint index in docs/API.md from the real route definitions (spec §70: API docs stay in
// sync with the implementation). `--check` fails when the committed docs differ from the code.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiEnvSchema, loadEnv } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { buildApp } from '@jamzo/api/app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docPath = path.join(root, 'docs/API.md');
const START = '<!-- routes:start -->';
const END = '<!-- routes:end -->';

const env = loadEnv(apiEnvSchema, {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://docs@localhost:1/docs', // never connected — routes are only registered
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  LOG_LEVEL: 'silent',
});
const prisma = createPrismaClient({ url: env.DATABASE_URL });
const noop = { name: 'none', send: async () => ({ providerRef: 'none' }) };
const storage = { name: 'none', put: async () => {}, get: async () => null, remove: async () => {} };
const routes = [];
const app = await buildApp({
  env,
  prisma,
  sms: noop,
  email: noop,
  storage,
  logger: false,
  onRoute: (r) => {
    for (const method of [r.method].flat()) routes.push({ method, url: r.url, config: r.config ?? {} });
  },
});
await app.close();
await prisma.$disconnect();

const authLimit = env.AUTH_RATE_LIMIT_PER_MIN;
const rows = routes
  .filter(
    (r) => r.method !== 'HEAD' && (r.url.startsWith('/v1/') || r.url === '/health' || r.url === '/ready'),
  )
  .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))
  .map(({ method, url, config: cfg }) => {
    // Every /v1/admin/* route (sign-in included) is restricted to the ADMIN app by the auth layer.
    const adminApp = url.startsWith('/v1/admin/');
    const admin = adminApp && !url.startsWith('/v1/admin/auth/');
    const auth = admin ? 'admin token' : (cfg.auth ?? (url.startsWith('/v1/') ? 'required' : 'none'));
    const apps = adminApp
      ? 'ADMIN'
      : cfg.apps
        ? cfg.apps.join(', ')
        : url.startsWith('/v1/media/files/')
          ? 'browser (no headers)'
          : url.startsWith('/v1/')
            ? 'any'
            : '—';
    const permission = cfg.permission ? `\`${[cfg.permission].flat().join(' + ')}\`` : '—';
    const max = cfg.rateLimit?.max;
    const limit =
      max === undefined
        ? ''
        : max === authLimit
          ? 'auth limit/min'
          : max === authLimit * 2
            ? '2× auth limit/min'
            : `${max}/min`;
    return `| \`${method}\` | \`${url}\` | ${auth} | ${apps} | ${permission} | ${limit} |`;
  });

const table = [
  START,
  '',
  `_Generated from the route definitions by \`pnpm docs:api\` (${rows.length} endpoints). Do not edit by hand — CI fails if this drifts from the code._`,
  '',
  '| Method | Path | Auth | Apps | Permission | Rate limit |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  END,
].join('\n');

const doc = await readFile(docPath, 'utf8');
const start = doc.indexOf(START);
const end = doc.indexOf(END);
if (start < 0 || end < 0) throw new Error(`docs/API.md must contain ${START} … ${END}`);
const next = doc.slice(0, start) + table + doc.slice(end + END.length);

if (process.argv.includes('--check')) {
  if (next !== doc) {
    console.error('✗ docs/API.md endpoint index is out of date — run: pnpm docs:api');
    process.exit(1);
  }
  console.log(`✓ docs/API.md lists all ${rows.length} endpoints`);
} else {
  await writeFile(docPath, next);
  console.log(`✓ wrote ${rows.length} endpoints to docs/API.md`);
}
