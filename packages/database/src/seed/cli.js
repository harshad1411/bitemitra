#!/usr/bin/env node
// Usage: pnpm db:seed   (reads DATABASE_URL, APP_ENV, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_DEMO)
import { createFieldCipher } from '@jamzo/auth';
import { createPrismaClient } from '../index.js';
import { seed } from './index.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const appEnv = env.APP_ENV ?? 'development';
const live = appEnv === 'staging' || appEnv === 'production';
const demo = (env.SEED_DEMO ?? (live ? 'false' : 'true')) === 'true';
if (demo && live) {
  console.error(
    'Refusing to seed demo data (approximate geography, fake partner accounts) in staging/production.',
  );
  process.exit(1);
}
const admin =
  env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD
    ? { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, name: env.SEED_ADMIN_NAME }
    : undefined;
if (!admin) console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no Super Admin will be created.');

// Demo bank accounts are encrypted like real ones, so they are only seeded when the key is configured.
let fieldCipher;
try {
  fieldCipher = env.FIELD_ENCRYPTION_KEY ? createFieldCipher(env.FIELD_ENCRYPTION_KEY) : undefined;
} catch {
  console.warn('FIELD_ENCRYPTION_KEY is not a valid 32-byte base64 key — demo bank accounts are skipped.');
}

const prisma = createPrismaClient();
try {
  await seed(prisma, { admin, demo, catalog: demo, fieldCipher, log: (m) => console.log(`✓ ${m}`) });
} finally {
  await prisma.$disconnect();
}
