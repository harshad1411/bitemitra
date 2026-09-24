// API entry point: validates environment, wires real providers and starts listening.
import { apiEnvSchema, loadEnv } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { createEmailProvider, createSmsProvider } from '@jamzo/notifications';
import { createLogger } from '@jamzo/logger';
import { buildApp } from './app.js';
import { createStorage } from './modules/media/storage.js';

const env = loadEnv(apiEnvSchema);
const log = createLogger({ name: 'api-providers', level: env.LOG_LEVEL });
const prisma = createPrismaClient({ url: env.DATABASE_URL });
const app = await buildApp({
  env,
  prisma,
  sms: createSmsProvider(env.SMS_PROVIDER, { logger: log }),
  email: createEmailProvider(env.EMAIL_PROVIDER, { logger: log }),
  storage: createStorage(env),
});

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.HOST, port: env.PORT });
