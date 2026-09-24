// Authentication + authorisation (SECURITY.md, RBAC.md). Route options declare requirements:
//   config: { auth: 'required' | 'optional' | 'none', apps?: string[], permission?: string | string[] }
// /v1/admin/* routes MUST declare a permission — startup fails otherwise (deny by default).
import fp from 'fastify-plugin';
import { verifyAccessToken } from '@jamzo/auth';
import { AppError, forbidden, unauthenticated } from './errors.js';
import { ACTOR_TYPE_BY_APP } from './client.js';

/**
 * Loads an admin's effective permissions. Grants without a city apply everywhere; grants with a city
 * (City Manager) apply only to that city (RBAC.md §1.3).
 * @param {import('@jamzo/database').Db} prisma
 * @param {string} userId
 */
export async function loadAdminAccess(prisma, userId) {
  const admin = await prisma.adminUser.findUnique({
    where: { userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!admin) return null;
  const global = new Set();
  /** @type {Map<string, Set<string>>} */
  const byCity = new Map();
  for (const grant of admin.roles) {
    const keys = grant.role.permissions.map((rp) => rp.permission.key);
    if (grant.cityId) {
      const set = byCity.get(grant.cityId) ?? new Set();
      keys.forEach((k) => set.add(k));
      byCity.set(grant.cityId, set);
    } else {
      keys.forEach((k) => global.add(k));
    }
  }
  return {
    id: admin.id,
    isActive: admin.isActive,
    roles: admin.roles.map((g) => ({ key: g.role.key, name: g.role.name, cityId: g.cityId })),
    global,
    byCity,
  };
}

/** @param {{ global: Set<string>, byCity: Map<string, Set<string>> }} access */
export function allPermissions(access) {
  const out = new Set(access.global);
  for (const set of access.byCity.values()) set.forEach((p) => out.add(p));
  return out;
}

/**
 * @param {import('./types.js').JamzoApp} app
 * @param {{ secret: string }} opts
 */
async function authPlugin(app, { secret }) {
  app.decorateRequest('auth', null);

  // Deny-by-default guard: collected at route registration.
  app.addHook('onRoute', (route) => {
    const url = route.url ?? '';
    if (url.startsWith('/v1/admin/') && !url.startsWith('/v1/admin/auth/')) {
      if (!(/** @type {any} */ (route.config)?.permission))
        throw new Error(`Admin route ${route.method} ${url} must declare config.permission`);
    }
  });

  app.addHook('preHandler', async (/** @type {import('./types.js').JamzoRequest} */ request) => {
    const config = /** @type {any} */ (request.routeOptions.config ?? {});
    const url = request.routeOptions.url ?? '';
    if (!url.startsWith('/v1/')) return;
    const mode = config.auth ?? 'required';
    const isAdminRoute = url.startsWith('/v1/admin/');

    if (isAdminRoute && request.client.appId !== 'ADMIN')
      throw forbidden('Admin endpoints are only available to Jamzo Admin.');
    if (config.apps && !config.apps.includes(request.client.appId))
      throw forbidden('This endpoint is not available to this app.');
    if (mode === 'none') return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (mode === 'optional') return;
      throw unauthenticated();
    }
    const verified = await verifyAccessToken(header.slice(7), secret, request.client.appId);
    if ('reason' in verified) {
      if (mode === 'optional' && verified.reason === 'INVALID') return;
      throw verified.reason === 'EXPIRED'
        ? new AppError('TOKEN_EXPIRED', 'Your session has expired.')
        : unauthenticated();
    }
    const { sub, sid } = /** @type {{ claims: { sub: string, sid: string } }} */ (verified).claims;
    const session = await app.prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    const now = app.clock.now();
    if (
      !session ||
      session.userId !== sub ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.appId !== request.client.appId
    ) {
      throw unauthenticated('Your session is no longer valid. Please sign in again.');
    }
    if (session.user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 'This account is not active.');

    /** @type {any} */
    const auth = {
      userId: session.userId,
      sessionId: session.id,
      familyId: session.familyId,
      appId: session.appId,
      actorType: ACTOR_TYPE_BY_APP[session.appId],
      user: session.user,
      admin: null,
    };
    if (session.appId === 'ADMIN') {
      const access = await loadAdminAccess(app.prisma, session.userId);
      if (!access || !access.isActive)
        throw new AppError('ACCOUNT_SUSPENDED', 'This admin account is not active.');
      auth.admin = access;
    }
    /** @type {import('./types.js').JamzoRequest} */ (request).auth = auth;

    if (config.permission) {
      const needed = Array.isArray(config.permission) ? config.permission : [config.permission];
      const held = auth.admin ? allPermissions(auth.admin) : new Set();
      if (!needed.every((p) => held.has(p))) throw forbidden();
    }
  });
}

export default fp(authPlugin);

/**
 * @param {import('./types.js').JamzoRequest} request
 * @param {string} permission
 */
export function hasGlobal(request, permission) {
  return Boolean(request.auth?.admin?.global.has(permission));
}

/**
 * True when the admin holds the permission everywhere, or through a grant for this city.
 * @param {import('./types.js').JamzoRequest} request
 * @param {string} permission
 * @param {string | null | undefined} cityId
 */
export function canInCity(request, permission, cityId) {
  const admin = request.auth?.admin;
  if (!admin) return false;
  if (admin.global.has(permission)) return true;
  return Boolean(cityId && admin.byCity.get(cityId)?.has(permission));
}

/**
 * City ids the admin may use for a permission, or null meaning "all cities".
 * @param {import('./types.js').JamzoRequest} request
 * @param {string} permission
 * @returns {string[] | null}
 */
export function allowedCityIds(request, permission) {
  const admin = request.auth?.admin;
  if (!admin) return [];
  if (admin.global.has(permission)) return null;
  return [...admin.byCity.entries()].filter(([, set]) => set.has(permission)).map(([cityId]) => cityId);
}

/** @param {import('./types.js').JamzoRequest} request @param {string} permission */
export function requireGlobal(request, permission) {
  if (!hasGlobal(request, permission))
    throw forbidden('This action needs a permission that is not limited to a city.');
}
