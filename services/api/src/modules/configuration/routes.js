import { z } from 'zod';
import { appVersionPolicyBody, configScope, featureFlagUpdateBody, settingWriteBody, uuid } from '@jamzo/validation';
import { compareVersions } from '@jamzo/config';
import { AppError, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { canInCity, requireGlobal } from '../../core/auth.js';
import { idPage, toPage } from '../../core/pagination.js';

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function configurationRoutes(app) {
  const { config } = app.services;
  const prisma = app.prisma;

  // ── Public: remote configuration (CONFIGURATION.md §5) ──
  app.get('/v1/app-config', { config: { auth: 'optional' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const q = parse(z.object({ cityId: uuid.optional() }), request.query);
    reply.header('cache-control', 'private, max-age=60');
    return config.remoteConfig(request.client, { userId: request.auth?.userId ?? null, cityId: q.cityId ?? null });
  });

  // ── Admin: settings ──
  /** City-scoped admins (City Manager) may only touch CITY/ZONE targets within their city. */
  async function assertCanConfigure(request, scope, scopeRefId, permission) {
    if (request.auth.admin.global.has(permission)) return;
    const ctx = await config.contextFor(scope, scopeRefId);
    if (!ctx.cityId || !canInCity(request, permission, ctx.cityId)) throw forbidden('You can only configure your own city.');
  }

  app.get('/v1/admin/settings', { config: { permission: 'config.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const q = parse(z.object({ scope: configScope.default('GLOBAL'), scopeRefId: uuid.optional() }), request.query);
    await assertCanConfigure(request, q.scope, q.scopeRefId ?? null, 'config.view');
    return { scope: q.scope, scopeRefId: q.scopeRefId ?? null, items: await config.listForScope(q.scope, q.scopeRefId ?? null) };
  });

  app.put('/v1/admin/settings', { config: { permission: 'config.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const body = parse(settingWriteBody, request.body);
    await assertCanConfigure(request, body.scope, body.scopeRefId ?? null, 'config.manage');
    const row = await config.write(request, body);
    return { id: row.id, key: row.key, scope: row.scope, scopeRefId: row.scopeRefId, value: row.value, updatedAt: row.updatedAt };
  });

  app.delete('/v1/admin/settings', { config: { permission: 'config.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(z.object({ key: z.string().min(1), scope: configScope, scopeRefId: uuid.nullable().optional(), reason: z.string().trim().min(3).max(500).optional() }), request.body);
    await assertCanConfigure(request, body.scope, body.scopeRefId ?? null, 'config.manage');
    await config.reset(request, body);
    reply.code(204);
    return null;
  });

  app.get('/v1/admin/settings/history', { config: { permission: 'config.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const q = parse(z.object({ key: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), request.query);
    const page = idPage(q);
    const rows = await prisma.settingHistory.findMany({ where: { ...(q.key ? { key: q.key } : {}), ...page.where }, orderBy: page.orderBy, take: page.take });
    const actors = await actorsById(prisma, rows.map((r) => r.changedById));
    return toPage(rows.map((r) => ({ ...r, changedBy: actors.get(r.changedById) ?? null })), q.limit);
  });

  // ── Admin: feature flags ──
  app.get('/v1/admin/flags', { config: { permission: 'config.view' } }, async () => ({ items: await prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }) }));

  app.put('/v1/admin/flags/:key', { config: { permission: 'flags.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { key } = parse(z.object({ key: z.string().regex(/^[a-z0-9_]+$/) }), request.params);
    const body = parse(featureFlagUpdateBody, request.body);
    requireGlobal(request, 'flags.manage');
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.featureFlag.findUnique({ where: { key } });
      if (!before) throw notFound('Feature flag');
      const after = await tx.featureFlag.update({
        where: { key },
        data: { enabled: body.enabled, rules: body.rules, description: body.description ?? before.description, updatedById: request.auth.userId },
      });
      await audit(tx, request, { action: 'feature_flag.update', entityType: 'feature_flag', entityId: key, oldValue: pick(before), newValue: { ...pick(after), reason: body.reason ?? null } });
      return after;
    });
    config.invalidate();
    return updated;
  });

  // ── Admin: app version policies (spec §72) ──
  app.get('/v1/admin/app-versions', { config: { permission: 'config.view' } }, async () => ({
    items: await prisma.appVersionPolicy.findMany({ orderBy: [{ appId: 'asc' }, { platform: 'asc' }] }),
  }));

  app.put('/v1/admin/app-versions/:appId/:platform', { config: { permission: 'config.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const params = parse(z.object({ appId: z.enum(['CUSTOMER', 'RESTAURANT', 'RIDER']), platform: z.enum(['IOS', 'ANDROID']) }), request.params);
    const body = parse(appVersionPolicyBody, request.body);
    requireGlobal(request, 'config.manage');
    if (compareVersions(body.minSupportedVersion, body.recommendedVersion) > 0) {
      throw new AppError('VALIDATION_FAILED', 'Minimum version cannot be higher than the recommended version.', { fieldErrors: { minSupportedVersion: ['Must be ≤ recommended version'] } });
    }
    const where = { appId_platform: params };
    const saved = await prisma.$transaction(async (tx) => {
      const before = await tx.appVersionPolicy.findUnique({ where });
      if (before && compareVersions(body.minSupportedVersion, before.minSupportedVersion) > 0 && !body.reason) {
        throw new AppError('VALIDATION_FAILED', 'A reason is required when raising the minimum version (it forces users to update).', { fieldErrors: { reason: ['Required'] } });
      }
      const data = { minSupportedVersion: body.minSupportedVersion, recommendedVersion: body.recommendedVersion, forceUpdate: body.forceUpdate, storeUrl: body.storeUrl ?? null, updatedById: request.auth.userId };
      const after = await tx.appVersionPolicy.upsert({ where, create: { ...params, ...data }, update: data });
      await audit(tx, request, { action: 'app_version_policy.update', entityType: 'app_version_policy', entityId: `${params.appId}:${params.platform}`, oldValue: before, newValue: { ...after, reason: body.reason ?? null } });
      return after;
    });
    config.invalidate();
    return saved;
  });
}

function pick(f) {
  return { enabled: f.enabled, rules: f.rules, description: f.description };
}

/** Batch-load actor display info (avoids N+1). */
export async function actorsById(prisma, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, phone: true } });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));
}
