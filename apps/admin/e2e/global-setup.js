// Starts an isolated backend for the E2E run: embedded PostgreSQL → migrations → seed → API on :4100,
// plus an in-process outbox worker so media renditions really get generated.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apiEnvSchema, loadEnv } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { startPostgresServer } from '@jamzo/database/postgres-server';
import { createTemplateDatabase, urlForDatabase } from '@jamzo/database/testing';
import { seed } from '@jamzo/database/seed';
import { createFieldCipher } from '@jamzo/auth';
import { createConsoleEmailProvider, createConsoleSmsProvider } from '@jamzo/notifications';
import { buildApp } from '@jamzo/api/app';
import { createLocalStorage } from '@jamzo/api/media-storage';
import { createOutboxRelay } from '../../../services/workers/src/outbox.js';
import { createMediaUploadedHandler } from '../../../services/workers/src/handlers/media.js';

export const E2E_ADMIN = { email: 'e2e-super@jamzo.test', password: 'E2E-Super-Admin-1' };

export default async function globalSetup() {
  const pg = await startPostgresServer({
    dataDir: path.join(os.tmpdir(), `jamzo-e2e-pg-${process.pid}`),
    fresh: true,
  });
  await createTemplateDatabase(pg.adminUrl, 'jamzo_e2e');
  const url = urlForDatabase(pg.adminUrl, 'jamzo_e2e');
  const prisma = createPrismaClient({ url });
  const fieldKey = Buffer.alloc(32, 9).toString('base64'); // fixed E2E key, not a secret
  await seed(prisma, {
    admin: E2E_ADMIN,
    demo: true,
    catalog: true,
    fieldCipher: createFieldCipher(fieldKey),
  });

  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'jamzo-e2e-media-'));
  const env = loadEnv(apiEnvSchema, {
    APP_ENV: 'test',
    DATABASE_URL: url,
    JWT_ACCESS_SECRET: 'e2e-access-secret-that-is-long-enough-12345',
    OTP_PEPPER: 'e2e-otp-pepper-that-is-long-enough-1234567',
    FIELD_ENCRYPTION_KEY: fieldKey,
    COOKIE_SECURE: 'false',
    MEDIA_LOCAL_DIR: mediaDir,
    LOG_LEVEL: 'warn',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
  });
  const storage = createLocalStorage({ root: mediaDir });
  const app = await buildApp({
    env,
    prisma,
    sms: createConsoleSmsProvider(),
    email: createConsoleEmailProvider(),
    storage,
    logger: false,
  });
  await app.listen({ host: '127.0.0.1', port: 4100 });

  const relay = createOutboxRelay({
    prisma,
    log: console,
    workerId: 'e2e',
    handlers: { 'media.uploaded': createMediaUploadedHandler({ prisma, storage }) },
  });
  const timer = setInterval(() => relay.tick().catch((e) => console.error('e2e worker', e)), 500);

  return async () => {
    clearInterval(timer);
    await app.close();
    await prisma.$disconnect();
    await pg.stop();
  };
}
