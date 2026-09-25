// Starts an isolated backend for the E2E run: embedded PostgreSQL → migrations → seed → API on :4100,
// plus an in-process outbox worker (media renditions, order notifications and jobs), and a few real orders
// placed through the API so the order screens have data (Phase 5).
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apiEnvSchema, loadEnv } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { startPostgresServer } from '@jamzo/database/postgres-server';
import { createTemplateDatabase, urlForDatabase } from '@jamzo/database/testing';
import { seed } from '@jamzo/database/seed';
import { createFieldCipher } from '@jamzo/auth';
import {
  createConsoleEmailProvider,
  createConsolePushProvider,
  createConsoleSmsProvider,
} from '@jamzo/notifications';
import { createOrderJobs } from '@jamzo/api/order-jobs';
import { createNotificationDispatcher, mergeHandlers } from '@jamzo/api/notification-dispatch';
import { createDispatch } from '@jamzo/api/dispatch';
import { createLedgerJobs } from '@jamzo/api/ledger-jobs';
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
  const sms = createConsoleSmsProvider();
  const app = await buildApp({
    env,
    prisma,
    sms,
    email: createConsoleEmailProvider(),
    storage,
    logger: false,
  });
  await app.listen({ host: '127.0.0.1', port: 4100 });

  const relay = createOutboxRelay({
    prisma,
    log: console,
    workerId: 'e2e',
    handlers: mergeHandlers(
      { 'media.uploaded': createMediaUploadedHandler({ prisma, storage }) },
      createNotificationDispatcher({ prisma, push: createConsolePushProvider() }),
      createOrderJobs({ prisma }),
      createDispatch({ prisma }).handlers,
      // Same fake gateway instance as the API, so refunds created in the admin are processed (Phase 7).
      app.services.payments.handlers,
      createLedgerJobs({ prisma }),
    ),
  });
  process.env.E2E_ORDERS = JSON.stringify(await placeDemoOrders(app, prisma, sms));
  const timer = setInterval(() => relay.tick().catch((e) => console.error('e2e worker', e)), 500);

  return async () => {
    clearInterval(timer);
    await app.close();
    await prisma.$disconnect();
    await pg.stop();
  };
}

/**
 * Real orders through the real API (E2E data only): Pizza Point is opened all day while they are placed, so
 * the run does not depend on the time of day, then its seeded hours are restored. Returns the order numbers.
 */
async function placeDemoOrders(app, prisma, sms) {
  const pizza = await prisma.restaurant.findUniqueOrThrow({
    where: { slug: 'pizza-point-unjha' },
    include: { branches: true },
  });
  const branchId = pizza.branches[0].id;
  const originalHours = await prisma.restaurantBusinessHours.findMany({ where: { branchId } });
  await prisma.restaurantBusinessHours.deleteMany({ where: { branchId } });
  await prisma.restaurantBusinessHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      branchId,
      dayOfWeek,
      opensAt: '00:00',
      closesAt: '23:59',
    })),
  });
  const h = (appId, token, extra = {}) => ({
    'x-app-id': appId,
    'x-platform': 'IOS',
    'x-app-version': '1.0.0',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const call = async (method, url, appId, token, payload, extra) => {
    const res = await app.inject({ method, url, headers: h(appId, token, extra), payload });
    if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const login = async (appId, phone) => {
    const { challengeId } = await call('POST', '/v1/auth/otp/request', appId, null, {
      channel: 'SMS',
      destination: phone,
    });
    const code = /(\d{6})/.exec([...sms.sent].reverse().find((m) => m.to === phone).text)[1];
    return (await call('POST', '/v1/auth/otp/verify', appId, null, { challengeId, code })).accessToken;
  };
  const customer = await login('CUSTOMER', '+919876500001');
  await prisma.user.updateMany({ where: { phone: '+919876500001' }, data: { name: 'Meera Joshi' } });
  const address = await call('POST', '/v1/customer/addresses', 'CUSTOMER', customer, {
    label: 'Home',
    line1: '14 Station Road',
    lat: 23.805,
    lng: 72.39,
  });
  const bread = await prisma.product.findFirstOrThrow({
    where: { restaurantId: pizza.id, name: 'Garlic Bread' },
  });
  const place = async (quantity, note, paymentMethod = 'COD') => {
    const body = {
      restaurantId: pizza.id,
      addressId: address.id,
      lines: [{ key: 'a', productId: bread.id, quantity }],
    };
    const q = await call('POST', '/v1/customer/cart/quote', 'CUSTOMER', customer, body);
    const { order } = await call(
      'POST',
      '/v1/orders',
      'CUSTOMER',
      customer,
      {
        ...body,
        paymentMethod,
        expectedTotalPaise: q.bill.totalPayablePaise,
        restaurantInstructions: note,
      },
      { 'idempotency-key': crypto.randomUUID() },
    );
    return order;
  };
  const waiting = await place(2, 'Extra oregano');
  // Phase 7: an online (UPI) order paid through the fake gateway's signed webhook.
  const online = await place(1, null, 'UPI');
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: online.id } });
  const hook = app.services.payments.provider.simulate(payment.providerOrderId, { outcome: 'success' });
  const paid = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/fake',
    headers: { 'content-type': 'application/json', ...hook.headers },
    payload: hook.rawBody,
  });
  if (paid.statusCode !== 200) throw new Error(`fake payment webhook: ${paid.statusCode} ${paid.body}`);
  const ready = await place(3, null);
  const toCancel = await place(4, null);
  const owner = await login('RESTAURANT', pizza.phone);
  const accepted = await call('POST', `/v1/restaurant/orders/${ready.id}/accept`, 'RESTAURANT', owner, {
    prepTimeMinutes: 15,
    version: 0,
  });
  await call('POST', `/v1/restaurant/orders/${ready.id}/ready`, 'RESTAURANT', owner, {
    version: accepted.version,
  });
  await call('POST', `/v1/restaurant/orders/${toCancel.id}/accept`, 'RESTAURANT', owner, {
    prepTimeMinutes: 20,
    version: 0,
  });
  await prepareRiders({ app, call, login, h });
  // Back to the seeded hours: other specs check them, and the order screens do not need the restaurant open.
  await prisma.restaurantBusinessHours.deleteMany({ where: { branchId } });
  await prisma.restaurantBusinessHours.createMany({ data: originalHours });
  return {
    waiting: waiting.orderNumber,
    ready: ready.orderNumber,
    toCancel: toCancel.orderNumber,
    online: online.orderNumber,
  };
}

/**
 * Phase 6 data: a bicycle applicant waiting for review (three documents uploaded through the real API), and
 * the seeded demo partner online ~10 km north of Unjha. That is beyond the automatic dispatch radius
 * (dispatch.offers.maxPickupDistanceM), so no offer reaches them by itself and the E2E assigns manually.
 */
async function prepareRiders({ app, call, login, h }) {
  const applicant = await login('RIDER', '+919661100901');
  const me = await call('GET', '/v1/rider/me', 'RIDER', applicant);
  const unjha = me.cities.find((c) => c.name === 'Unjha');
  await call('PUT', '/v1/rider/me', 'RIDER', applicant, { name: 'Kiran Desai', cityId: unjha.id });
  await call('PUT', '/v1/rider/vehicle', 'RIDER', applicant, { type: 'BICYCLE' });
  for (const kind of ['PAN', 'ID_PROOF', 'PHOTO']) {
    const boundary = `jamzo${crypto.randomUUID()}`;
    const field = (name, value) =>
      `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const payload = Buffer.concat([
      Buffer.from(
        field('kind', kind) +
          (kind === 'PAN' ? field('number', 'ABCDE1234F') : '') +
          `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${kind}.png"\r\ncontent-type: image/png\r\n\r\n`,
      ),
      TINY_PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rider/documents',
      headers: h('RIDER', applicant, { 'content-type': `multipart/form-data; boundary=${boundary}` }),
      payload,
    });
    if (res.statusCode !== 201) throw new Error(`rider document ${kind}: ${res.statusCode} ${res.body}`);
  }
  await call('POST', '/v1/rider/application/submit', 'RIDER', applicant);

  const partner = await login('RIDER', '+919000000002');
  await call('POST', '/v1/rider/status', 'RIDER', partner, { online: true });
  await call('POST', '/v1/rider/locations', 'RIDER', partner, {
    points: [{ lat: 23.9, lng: 72.39, accuracyM: 10, recordedAt: new Date().toISOString() }],
  });
  // Phase 8: the partner reports a UPI deposit for Finance to check.
  await call('POST', '/v1/rider/cod-deposits', 'RIDER', partner, {
    amountPaise: 25_000,
    method: 'UPI',
    reference: 'UPI-E2E-4821',
    idempotencyKey: 'e2e-deposit-0001',
  });
}

// 1×1 transparent PNG (E2E document uploads).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOM1mpjYGBgYgADAAyDAQ/ufyXrAAAAAElFTkSuQmCC',
  'base64',
);
