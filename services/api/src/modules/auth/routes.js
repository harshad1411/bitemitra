// Auth routes (API.md §7). Mobile apps receive refresh tokens in the body; the admin receives an
// httpOnly SameSite=Strict cookie instead (DECISIONS D-22).
import { adminLoginBody, deviceRegisterBody, otpRequestBody, otpVerifyBody, refreshBody } from '@jamzo/validation';
import { z } from 'zod';
import { AppError, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { withIdempotency } from '../../core/idempotency.js';

const MOBILE = ['CUSTOMER', 'RESTAURANT', 'RIDER'];
export const ADMIN_REFRESH_COOKIE = 'jz_admin_rt';

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function authRoutes(app) {
  const { auth, env } = app.services;
  const cookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: /** @type {const} */ ('strict'),
    path: env.ADMIN_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  };
  const tokenBody = (t) => ({ accessToken: t.accessToken, expiresIn: t.expiresIn, refreshToken: t.refreshToken });

  app.post('/v1/auth/otp/request', { config: { auth: 'none', apps: MOBILE, rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(otpRequestBody, request.body);
    return withIdempotency(request, reply, {}, () => auth.requestOtp({ appId: request.client.appId, channel: body.channel, destination: body.destination, ip: request.ip }));
  });

  app.post('/v1/auth/otp/verify', { config: { auth: 'none', apps: MOBILE, rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MIN * 2, timeWindow: '1 minute' } } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const body = parse(otpVerifyBody, request.body);
    const result = await auth.verifyOtp({
      appId: request.client.appId,
      challengeId: body.challengeId,
      code: body.code,
      platform: request.client.platform,
      appVersion: request.client.appVersion,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { ...tokenBody(result), me: result.me };
  });

  // Social sign-in slots (D-20): configured providers exist, verification is not implemented yet.
  app.post('/v1/auth/social/:provider', { config: { auth: 'none', apps: MOBILE } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { provider } = parse(z.object({ provider: z.enum(['google', 'apple']) }), request.params);
    throw new AppError('AUTH_METHOD_UNAVAILABLE', `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not available yet.`);
  });

  app.post('/v1/auth/refresh', { config: { auth: 'none', rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const isAdmin = request.client.appId === 'ADMIN';
    const token = isAdmin ? request.cookies?.[ADMIN_REFRESH_COOKIE] : parse(refreshBody, request.body).refreshToken;
    if (!token) throw unauthenticated('Please sign in again.');
    try {
      const t = await auth.refresh({ refreshToken: token, appId: request.client.appId, ip: request.ip, userAgent: request.headers['user-agent'] });
      if (isAdmin) {
        reply.setCookie(ADMIN_REFRESH_COOKIE, t.refreshToken, cookieOptions);
        return { accessToken: t.accessToken, expiresIn: t.expiresIn };
      }
      return tokenBody(t);
    } catch (err) {
      if (isAdmin) reply.clearCookie(ADMIN_REFRESH_COOKIE, { path: env.ADMIN_COOKIE_PATH });
      throw err;
    }
  });

  app.post('/v1/auth/logout', { config: { auth: 'optional' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    if (request.auth) await auth.revokeFamily(request.auth.familyId, 'LOGOUT');
    if (request.client.appId === 'ADMIN') reply.clearCookie(ADMIN_REFRESH_COOKIE, { path: env.ADMIN_COOKIE_PATH });
    reply.code(204);
    return null;
  });

  app.post('/v1/admin/auth/login', { config: { auth: 'none', rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(adminLoginBody, request.body);
    const result = await auth.adminLogin(request, body);
    reply.setCookie(ADMIN_REFRESH_COOKIE, result.refreshToken, cookieOptions);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, me: result.me };
  });

  app.get('/v1/me', async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => auth.me({ userId: request.auth.userId, appId: request.auth.appId }));

  app.patch('/v1/me', { config: { apps: MOBILE } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(80) }), request.body);
    await app.prisma.user.update({ where: { id: request.auth.userId }, data: { name: body.name } });
    return auth.me({ userId: request.auth.userId, appId: request.auth.appId });
  });

  app.post('/v1/me/devices', { config: { apps: MOBILE } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(deviceRegisterBody, request.body);
    const device = await app.prisma.device.upsert({
      where: { appId_pushToken: { appId: request.auth.appId, pushToken: body.pushToken } },
      create: { ...body, userId: request.auth.userId, appId: request.auth.appId },
      update: { ...body, userId: request.auth.userId, disabledAt: null, lastSeenAt: app.clock.now() },
    });
    reply.code(201);
    return { id: device.id, platform: device.platform, registeredAt: device.createdAt };
  });
}
