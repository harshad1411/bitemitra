// Test harness: a real PostgreSQL database (per test file), the real app, console providers whose sent
// messages we can read, a temp media directory and a controllable clock.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apiEnvSchema, loadEnv } from '@jamzo/config';
import { createPrismaClient } from '@jamzo/database';
import { startTestDatabase } from '@jamzo/database/testing';
import { DEMO_ACCOUNTS, seed } from '@jamzo/database/seed';
import { createConsoleEmailProvider, createConsoleSmsProvider } from '@jamzo/notifications';
import { normalizeIndianMobile } from '@jamzo/validation';
import { buildApp } from '../src/app.js';
import { createLocalStorage } from '../src/modules/media/storage.js';

export const SUPER = { email: 'super@jamzo.test', password: 'Super-Admin-Pass-1' };
export { DEMO_ACCOUNTS };

/** @param {{ env?: Record<string, string> }} [opts] */
export async function startTestApp(opts = {}) {
  const db = await startTestDatabase();
  const prisma = createPrismaClient({ url: db.url });
  await seed(prisma, { admin: SUPER, demo: true });
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'jamzo-media-'));
  const env = loadEnv(apiEnvSchema, {
    APP_ENV: 'test',
    DATABASE_URL: db.url,
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
    OTP_PEPPER: 'test-otp-pepper-that-is-long-enough-12345',
    COOKIE_SECURE: 'false',
    MEDIA_LOCAL_DIR: mediaDir,
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_PER_MIN: '10000',
    LOG_LEVEL: 'silent',
    ...opts.env,
  });
  let offsetMs = 0;
  const clock = { now: () => new Date(Date.now() + offsetMs), advance: (ms) => (offsetMs += ms) };
  const sms = createConsoleSmsProvider();
  const email = createConsoleEmailProvider();
  const storage = createLocalStorage({ root: mediaDir });
  const app = await buildApp({ env, prisma, clock, sms, email, storage, logger: false });
  await app.ready();
  return {
    app,
    prisma,
    sms,
    email,
    clock,
    storage,
    env,
    async stop() {
      await app.close();
      await prisma.$disconnect();
      await db.stop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}

/** Standard client headers. */
export function headers(appId = 'CUSTOMER', extra = {}) {
  return {
    'x-app-id': appId,
    'x-platform': appId === 'ADMIN' ? 'WEB' : 'IOS',
    'x-app-version': '1.0.0',
    ...extra,
  };
}

export const bearer = (token, appId = 'ADMIN', extra = {}) =>
  headers(appId, { authorization: `Bearer ${token}`, ...extra });

/** Reads the last OTP sent to a destination by the console provider. */
export function lastOtp(provider, to) {
  const msg = [...provider.sent].reverse().find((m) => m.to === to);
  return msg ? /(\d{6})/.exec(msg.text)[1] : null;
}

/** Full phone-OTP sign-in for a mobile app. */
export async function mobileLogin(ctx, appId, phone) {
  const req = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    headers: headers(appId),
    payload: { channel: 'SMS', destination: phone },
  });
  if (req.statusCode !== 200) throw new Error(`otp request failed: ${req.statusCode} ${req.body}`);
  const { challengeId } = req.json();
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: headers(appId),
    payload: { challengeId, code: lastOtp(ctx.sms, normalizeIndianMobile(phone)) },
  });
  if (res.statusCode !== 200) throw new Error(`otp verify failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Admin password sign-in; returns the access token and the refresh cookie. */
export async function adminLogin(ctx, email = SUPER.email, password = SUPER.password) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    headers: headers('ADMIN'),
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`admin login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'jz_admin_rt');
  return { ...res.json(), cookie };
}

/** Creates an admin with the given system role (optionally city-scoped) and signs in. */
export async function adminWithRole(ctx, roleKey, { cityId = null, email } = {}) {
  const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const addr = email ?? `${roleKey.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@jamzo.test`;
  const { hashPassword } = await import('@jamzo/auth');
  await ctx.prisma.user.create({
    data: {
      email: addr,
      name: roleKey,
      passwordHash: await hashPassword('Role-Admin-Pass-1'),
      identities: { create: { provider: 'PASSWORD', subject: addr } },
      adminUser: { create: { roles: { create: { roleId: role.id, cityId } } } },
    },
  });
  return adminLogin(ctx, addr, 'Role-Admin-Pass-1');
}

/** Builds a multipart/form-data payload for inject(). */
export function multipart(fields, file) {
  const boundary = `----jamzo${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    parts.push(file.content, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** A valid 2×2 PNG (generated with Pillow). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOM1mpjYGBgYgADAAyDAQ/ufyXrAAAAAElFTkSuQmCC',
  'base64',
);
