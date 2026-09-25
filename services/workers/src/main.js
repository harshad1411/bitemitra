// Worker entry point. Runs independently of the API (OD-5): `pnpm dev:workers`.
import os from 'node:os';
import { loadEnv, workerEnvSchema } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { createLogger } from '@jamzo/logger';
import { createStorage } from '@jamzo/api/media-storage';
import { createOutboxRelay } from './outbox.js';
import { createMediaUploadedHandler } from './handlers/media.js';
import { createOrderJobs } from '@jamzo/api/order-jobs';
import { createNotificationDispatcher, mergeHandlers } from '@jamzo/api/notification-dispatch';
import { createDispatch } from '@jamzo/api/dispatch';
import { createPayments } from '@jamzo/api/payments';
import { createPaymentProvider } from '@jamzo/api/payment-providers';
import { createLedgerJobs } from '@jamzo/api/ledger-jobs';
import { createSettlements } from '@jamzo/api/settlements';
import { createPushProvider } from '@jamzo/notifications';

const env = loadEnv(workerEnvSchema);
const log = createLogger({ name: 'workers', level: env.LOG_LEVEL });
const prisma = createPrismaClient({ url: env.DATABASE_URL });
const storage = createStorage(env);
const settlements = createSettlements({ prisma, log });
// The daily settlement run (06:00 India time) re-schedules itself; make sure one is scheduled (D-89).
await settlements.ensureScheduled();
const relay = createOutboxRelay({
  prisma,
  log,
  workerId: `${os.hostname()}:${process.pid}`,
  batchSize: env.WORKER_BATCH_SIZE,
  maxAttempts: env.WORKER_MAX_ATTEMPTS,
  leaseSec: env.WORKER_LEASE_SEC,
  handlers: mergeHandlers(
    { 'media.uploaded': createMediaUploadedHandler({ prisma, storage }) },
    createNotificationDispatcher({
      prisma,
      push: createPushProvider(env.PUSH_PROVIDER, { logger: log, accessToken: env.EXPO_ACCESS_TOKEN }),
      log,
    }),
    createOrderJobs({ prisma, log }),
    createDispatch({ prisma, log }).handlers,
    createPayments({ prisma, log, provider: createPaymentProvider(env) }).handlers,
    createLedgerJobs({ prisma, log }),
    settlements.handlers,
  ),
});

let running = true;
const stop = () => {
  running = false;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
log.info({ pollMs: env.WORKER_POLL_MS }, 'worker started');
while (running) {
  try {
    const r = await relay.tick();
    if (r.done + r.retry + r.parked === 0) await new Promise((res) => setTimeout(res, env.WORKER_POLL_MS));
  } catch (err) {
    log.error({ err }, 'worker tick failed');
    await new Promise((res) => setTimeout(res, env.WORKER_POLL_MS));
  }
}
await prisma.$disconnect();
log.info('worker stopped');
