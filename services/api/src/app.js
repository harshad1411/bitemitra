// Builds the Fastify application. All dependencies are injected so tests use a real database with a
// controllable clock and in-memory providers.
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { REDACT_PATHS } from '@jamzo/logger';
import { AppError } from './core/errors.js';
import { readClient } from './core/client.js';
import authPlugin from './core/auth.js';
import { createConfigService } from './modules/configuration/service.js';
import { createAuthService } from './modules/auth/service.js';
import authRoutes from './modules/auth/routes.js';
import rbacRoutes from './modules/rbac/routes.js';
import auditRoutes from './modules/audit/routes.js';
import geographyRoutes from './modules/geography/routes.js';
import configurationRoutes from './modules/configuration/routes.js';
import mediaRoutes from './modules/media/routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import restaurantRoutes from './modules/restaurants/routes.js';
import partnerRoutes from './modules/restaurants/partner-routes.js';
import catalogRoutes from './modules/catalog/routes.js';
import customerRoutes from './modules/customer/routes.js';
import pricingRoutes from './modules/pricing/routes.js';
import cmsRoutes from './modules/cms/routes.js';
import customersRoutes from './modules/customers/routes.js';
import { createDistanceProvider } from './modules/delivery/distance.js';
import { mediaBase } from './modules/media/urls.js';
import { createFieldCipher } from '@jamzo/auth';

const MOBILE = new Set(['CUSTOMER', 'RESTAURANT', 'RIDER']);
/** Routes that browsers load directly (no custom headers possible). */
const HEADERLESS_PREFIXES = ['/v1/media/files/'];
/** Routes a blocked (maintenance / outdated) app may still call. */
const GATE_EXEMPT = new Set(['/v1/app-config']);

/**
 * @param {{
 *   env: any,
 *   prisma: import('@jamzo/database').Db,
 *   clock?: { now: () => Date },
 *   sms: import('@jamzo/notifications').SmsProvider,
 *   email: import('@jamzo/notifications').EmailProvider,
 *   storage: import('./modules/media/storage.js').Storage,
 *   logger?: boolean | object,
 *   onRoute?: (route: any) => void,
 *   distance?: import('./modules/delivery/distance.js').DistanceProvider,
 * }} deps
 */
export async function buildApp(deps) {
  const { env, prisma } = deps;
  const clock = deps.clock ?? { now: () => new Date() };

  const app = Fastify({
    logger: deps.logger ?? { level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
  });

  if (deps.onRoute) app.addHook('onRoute', deps.onRoute); // used by scripts/generate-api-docs.mjs

  const config = createConfigService(prisma, clock);
  const auth = createAuthService({
    prisma,
    env,
    clock,
    config,
    sms: deps.sms,
    email: deps.email,
    log: app.log,
  });
  app.decorate('prisma', prisma);
  app.decorate('clock', clock);
  app.decorate('services', {
    env,
    config,
    auth,
    storage: deps.storage,
    sms: deps.sms,
    email: deps.email,
    fieldCipher: createFieldCipher(env.FIELD_ENCRYPTION_KEY),
    distance: deps.distance ?? createDistanceProvider(),
    mediaBase: mediaBase(env),
  });
  app.decorateRequest('client', null);

  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, { origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false, credentials: true });
  await app.register(cookie);
  await app.register(multipart);
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', {
        details: { retryAfterSec: Math.ceil(ctx.ttl / 1000) },
      });
      /** @type {any} */ (err).statusCode = 429;
      return err;
    },
  });

  // Client headers, then the maintenance / forced-update gate for mobile apps (spec §72, §73).
  app.addHook('onRequest', async (/** @type {import('./core/types.js').JamzoRequest} */ request, reply) => {
    reply.header('x-request-id', request.id);
    const url = request.url.split('?')[0];
    if (!url.startsWith('/v1/')) return;
    const headerless = HEADERLESS_PREFIXES.some((p) => url.startsWith(p));
    request.client = readClient(request, { required: !headerless });
    const appId = request.client.appId;
    if (!MOBILE.has(appId) || GATE_EXEMPT.has(url)) return;
    const maintenance = (await config.resolve('maintenance')).value;
    if (maintenance.enabled && maintenance.apps.includes(appId)) {
      throw new AppError(
        'MAINTENANCE',
        maintenance.message ?? 'Jamzo is under maintenance. Please try again soon.',
      );
    }
    const version = await config.clientVersion(request.client);
    if (version.status === 'UPDATE_REQUIRED') {
      throw new AppError('UPGRADE_REQUIRED', 'Please update the app to continue.', {
        details: {
          minSupportedVersion: version.minSupportedVersion,
          recommendedVersion: version.recommendedVersion,
          storeUrl: version.storeUrl,
        },
      });
    }
  });

  // Error handlers must be set BEFORE child plugins/routes are registered: Fastify copies them into each
  // child context at registration time.
  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: request.id } });
  });

  app.setErrorHandler((err, request, reply) => {
    const e = /** @type {any} */ (err);
    let appErr;
    if (err instanceof AppError) appErr = err;
    else if (e.statusCode === 429)
      appErr = new AppError('RATE_LIMITED', 'Too many requests. Please slow down.');
    else if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || e.statusCode === 413)
      appErr = new AppError('PAYLOAD_TOO_LARGE', 'The request is too large.');
    else if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || e.statusCode === 415)
      appErr = new AppError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.');
    else if (
      e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      e instanceof SyntaxError
    ) {
      appErr = new AppError('VALIDATION_FAILED', 'The request body is not valid JSON.');
    } else if (e.code === 'P2025') appErr = new AppError('NOT_FOUND', 'Resource not found.');
    else if (e.code === 'P2002') appErr = new AppError('CONFLICT', 'This conflicts with an existing record.');
    else {
      request.log.error({ err }, 'unhandled error');
      appErr = new AppError('INTERNAL', 'Something went wrong on our side. Please try again.');
    }
    if (appErr.status >= 500) request.log.error({ err, code: appErr.code }, appErr.message);
    reply.code(appErr.status).send({
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.fieldErrors ? { fieldErrors: appErr.fieldErrors } : {}),
        requestId: request.id,
        ...(appErr.details ? { details: appErr.details } : {}),
      },
    });
  });

  await app.register(authPlugin, { secret: env.JWT_ACCESS_SECRET });

  app.get('/health', { config: { auth: 'none' } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { auth: 'none' } }, async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      reply.code(503);
      return { status: 'unavailable' };
    }
  });

  await app.register(authRoutes);
  await app.register(configurationRoutes);
  await app.register(rbacRoutes);
  await app.register(auditRoutes);
  await app.register(geographyRoutes);
  await app.register(mediaRoutes);
  await app.register(dashboardRoutes);
  await app.register(restaurantRoutes);
  await app.register(catalogRoutes);
  await app.register(partnerRoutes);
  await app.register(customerRoutes);
  await app.register(pricingRoutes);
  await app.register(cmsRoutes);
  await app.register(customersRoutes);

  return app;
}
