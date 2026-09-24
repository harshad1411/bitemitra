// Worker entry point. Runs independently of the API (OD-5): `pnpm dev:workers`.
import os from 'node:os';
import { loadEnv, workerEnvSchema } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { createLogger } from '@jamzo/logger';
import { createStorage } from '@jamzo/api/media-storage';
import { createOutboxRelay } from './outbox.js';
import { createMediaUploadedHandler } from './handlers/media.js';

const env = loadEnv(workerEnvSchema);
const log = createLogger({ name: 'workers', level: env.LOG_LEVEL });
const prisma = createPrismaClient({ url: env.DATABASE_URL });
const storage = createStorage(env);
const relay = createOutboxRelay({
  prisma,
  log,
  workerId: `${os.hostname()}:${process.pid}`,
  batchSize: env.WORKER_BATCH_SIZE,
  maxAttempts: env.WORKER_MAX_ATTEMPTS,
  leaseSec: env.WORKER_LEASE_SEC,
  handlers: { 'media.uploaded': createMediaUploadedHandler({ prisma, storage }) },
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
