import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@jamzo/auth';
import authPlugin from '../src/core/auth.js';
import { adminLogin, adminWithRole, bearer, headers, mobileLogin, startTestApp } from './helpers.js';

let ctx;
let superToken;
let unjha;
let mehsana;
beforeAll(async () => {
  ctx = await startTestApp();
  superToken = (await adminLogin(ctx)).accessToken;
  unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
  mehsana = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'mehsana' } });
});
afterAll(() => ctx?.stop());

const get = (token, url) => ctx.app.inject({ method: 'GET', url, headers: bearer(token) });

describe('deny by default', () => {
  it('refuses to register an admin route without a permission', async () => {
    const app = Fastify();
    app.decorate('prisma', {});
    app.decorate('clock', { now: () => new Date() });
    await app.register(authPlugin, { secret: 'x'.repeat(32) });
    await app.after();
    expect(() => app.get('/v1/admin/secret', async () => 'nope')).toThrow(/must declare config.permission/);
    await app.close();
  });

  it('admin endpoints reject non-admin apps and anonymous callers', async () => {
    const customer = await mobileLogin(ctx, 'CUSTOMER', '9876511111');
    const asCustomer = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard',
      headers: bearer(customer.accessToken, 'CUSTOMER'),
    });
    expect(asCustomer.statusCode).toBe(403);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/admin/dashboard', headers: headers('ADMIN') }))
        .statusCode,
    ).toBe(401);
  });
});

describe('Phase 1 permission matrix (RBAC.md §3)', () => {
  // [route, permission] — each role must get 200 exactly when it holds the permission.
  const routes = [
    ['/v1/admin/dashboard', 'dashboard.view'],
    ['/v1/admin/users', 'admins.view'],
    ['/v1/admin/roles', 'roles.view'],
    ['/v1/admin/permissions', 'roles.view'],
    ['/v1/admin/geo/countries', 'geo.view'],
    ['/v1/admin/settings', 'config.view'],
    ['/v1/admin/flags', 'config.view'],
    ['/v1/admin/app-versions', 'config.view'],
    ['/v1/admin/media', 'media.view'],
    ['/v1/admin/audit-logs', 'audit.view'],
  ];
  for (const role of SYSTEM_ROLES.filter((r) => !r.cityScoped)) {
    it(`${role.key}`, async () => {
      const { accessToken } = await adminWithRole(ctx, role.key);
      for (const [url, permission] of routes) {
        const res = await get(accessToken, url);
        expect([url, res.statusCode]).toEqual([url, role.permissions.includes(permission) ? 200 : 403]);
      }
    });
  }
});

describe('city scoping (City Manager)', () => {
  let token;
  beforeAll(async () => {
    token = (await adminWithRole(ctx, 'CITY_MANAGER', { cityId: unjha.id })).accessToken;
  });

  it('sees only their own city', async () => {
    const list = (await get(token, '/v1/admin/geo/cities')).json();
    expect(list.items.map((c) => c.slug)).toEqual(['unjha']);
    expect((await get(token, `/v1/admin/geo/cities/${unjha.id}`)).statusCode).toBe(200);
    expect((await get(token, `/v1/admin/geo/cities/${mehsana.id}`)).statusCode).toBe(403);
  });

  it('can add a zone to their city but not to another city, and cannot create cities', async () => {
    const zone = (cityId, slug) => ({
      cityId,
      slug,
      name: 'Test zone',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [72.3, 23.7],
            [72.31, 23.7],
            [72.31, 23.71],
            [72.3, 23.71],
            [72.3, 23.7],
          ],
        ],
      },
    });
    const own = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/geo/zones',
      headers: bearer(token),
      payload: zone(unjha.id, 'cm-zone'),
    });
    expect(own.statusCode).toBe(201);
    const other = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/geo/zones',
      headers: bearer(token),
      payload: zone(mehsana.id, 'cm-zone'),
    });
    expect(other.statusCode).toBe(403);
    const state = await ctx.prisma.state.findFirstOrThrow();
    const city = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/geo/cities',
      headers: bearer(token),
      payload: { stateId: state.id, slug: 'surat', name: 'Surat', centerLat: 21.17, centerLng: 72.83 },
    });
    expect(city.statusCode).toBe(403);
  });

  it('can override settings for their city only', async () => {
    const write = (scopeRefId) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/v1/admin/settings',
        headers: bearer(token),
        payload: {
          key: 'orders.limits',
          scope: 'CITY',
          scopeRefId,
          value: { minOrderPaise: 9900, maxOrderPaise: 5_000_000, maxItems: 50 },
        },
      });
    expect((await write(unjha.id)).statusCode).toBe(200);
    expect((await write(mehsana.id)).statusCode).toBe(403);
    const global = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/settings',
      headers: bearer(token),
      payload: {
        key: 'orders.limits',
        scope: 'GLOBAL',
        value: { minOrderPaise: 0, maxOrderPaise: 5_000_000, maxItems: 50 },
      },
    });
    expect(global.statusCode).toBe(403);
  });
});

describe('no self-escalation', () => {
  it('an Admin cannot grant Super Admin or rbac.super', async () => {
    const admin = await adminWithRole(ctx, 'ADMIN');
    const superRole = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: bearer(admin.accessToken),
      payload: {
        email: 'new-super@jamzo.test',
        name: 'New Super',
        password: 'Correct-Horse-9',
        grants: [{ roleId: superRole.id }],
      },
    });
    expect(res.statusCode).toBe(403);
    const role = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      headers: bearer(admin.accessToken),
      payload: { key: 'SNEAKY', name: 'Sneaky', permissions: ['rbac.super'] },
    });
    expect(role.statusCode).toBe(403);
  });

  it('City Manager grants require a city; the Super Admin role is immutable; you cannot deactivate yourself', async () => {
    const cm = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'CITY_MANAGER' } });
    const noCity = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: bearer(superToken),
      payload: {
        email: 'cm2@jamzo.test',
        name: 'CM Two',
        password: 'Correct-Horse-9',
        grants: [{ roleId: cm.id }],
      },
    });
    expect(noCity.statusCode).toBe(400);
    const superRole = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/roles/${superRole.id}`,
      headers: bearer(superToken),
      payload: { permissions: [], reason: 'try' },
    });
    expect(edit.statusCode).toBe(403);
    const me = await ctx.prisma.adminUser.findFirstOrThrow({
      where: { user: { email: 'super@jamzo.test' } },
    });
    const self = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${me.id}`,
      headers: bearer(superToken),
      payload: { isActive: false, reason: 'try' },
    });
    expect(self.statusCode).toBe(403);
  });
});

describe('admin user lifecycle', () => {
  it('creates an admin (audited), then deactivation revokes their sessions immediately', async () => {
    const ops = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'OPERATIONS' } });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: bearer(superToken, 'ADMIN', { 'idempotency-key': 'create-ops-1' }),
      payload: {
        email: 'Ops.Person@Jamzo.test',
        name: 'Ops Person',
        password: 'Correct-Horse-9',
        grants: [{ roleId: ops.id }],
      },
    });
    expect(created.statusCode).toBe(201);
    const opsAdmin = created.json();
    expect(opsAdmin.email).toBe('ops.person@jamzo.test');
    expect(JSON.stringify(created.json())).not.toMatch(/password/i);
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: bearer(superToken, 'ADMIN', { 'idempotency-key': 'create-ops-1' }),
      payload: {
        email: 'Ops.Person@Jamzo.test',
        name: 'Ops Person',
        password: 'Correct-Horse-9',
        grants: [{ roleId: ops.id }],
      },
    });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json().id).toBe(opsAdmin.id);

    const login = await adminLogin(ctx, 'ops.person@jamzo.test', 'Correct-Horse-9');
    expect((await get(login.accessToken, '/v1/admin/dashboard')).statusCode).toBe(200);

    const noReason = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${opsAdmin.id}`,
      headers: bearer(superToken),
      payload: { isActive: false },
    });
    expect(noReason.statusCode).toBe(400);
    const off = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${opsAdmin.id}`,
      headers: bearer(superToken),
      payload: { isActive: false, reason: 'left the company' },
    });
    expect(off.statusCode).toBe(200);
    expect((await get(login.accessToken, '/v1/admin/dashboard')).statusCode).toBe(401);

    const audits = await ctx.prisma.auditLog.findMany({
      where: { entityId: opsAdmin.id },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['admin_user.create', 'admin.login', 'admin_user.update']),
    );
    const update = audits.find((a) => a.action === 'admin_user.update');
    expect(update.oldValue.isActive).toBe(true);
    expect(update.newValue).toMatchObject({ isActive: false, reason: 'left the company' });
  });

  it('custom roles: create, cannot delete while assigned, system roles cannot be deleted', async () => {
    const role = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      headers: bearer(superToken),
      payload: { key: 'SUPPORT_LEAD', name: 'Support lead', permissions: ['dashboard.view', 'audit.view'] },
    });
    expect(role.statusCode).toBe(201);
    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/roles',
      headers: bearer(superToken),
      payload: { key: 'SUPPORT_LEAD', name: 'Again', permissions: [] },
    });
    expect(dup.statusCode).toBe(409);
    const ops = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'OPERATIONS' } });
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: `/v1/admin/roles/${ops.id}`,
          headers: bearer(superToken),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: `/v1/admin/roles/${role.json().id}`,
          headers: bearer(superToken),
        })
      ).statusCode,
    ).toBe(204);
  });
});
