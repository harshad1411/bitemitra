import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, headers, mobileLogin, startTestApp } from './helpers.js';

let ctx;
let token;
beforeAll(async () => {
  ctx = await startTestApp();
  token = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

const put = (payload) =>
  ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(token), payload });
const list = (q = '') =>
  ctx.app.inject({ method: 'GET', url: `/v1/admin/settings${q}`, headers: bearer(token) });
const limits = (min) => ({ minOrderPaise: min, maxOrderPaise: 5_000_000, maxItems: 50 });

describe('remote app config', () => {
  it('returns maintenance, version status, auth methods, flags, support and server time', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/app-config', headers: headers('RIDER') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      appId: 'RIDER',
      platform: 'IOS',
      maintenance: { enabled: false },
      version: { status: 'OK', minSupportedVersion: '1.0.0' },
      auth: { methods: ['PHONE_OTP'] },
      featureFlags: { cod: true, surge: false },
    });
    expect(Date.parse(body.serverTime)).not.toBeNaN();
  });
});

describe('forced update and maintenance (spec §72, §73)', () => {
  it('blocks outdated mobile builds but still serves app-config', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/app-versions/CUSTOMER/ANDROID',
      headers: bearer(token),
      payload: {
        minSupportedVersion: '2.0.0',
        recommendedVersion: '2.1.0',
        forceUpdate: false,
        storeUrl: 'https://play.google.com/store/apps/details?id=example',
        reason: 'security fix',
      },
    });
    expect(res.statusCode).toBe(200);
    const android = headers('CUSTOMER', { 'x-platform': 'ANDROID' });
    const blocked = await ctx.app.inject({
      method: 'GET',
      url: '/v1/geo/serviceability?lat=23.8&lng=72.39',
      headers: android,
    });
    expect(blocked.statusCode).toBe(426);
    expect(blocked.json().error).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      details: { minSupportedVersion: '2.0.0' },
    });
    const cfg = await ctx.app.inject({ method: 'GET', url: '/v1/app-config', headers: android });
    expect(cfg.json().version.status).toBe('UPDATE_REQUIRED');
    // iOS policy is independent
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/geo/serviceability?lat=23.8&lng=72.39',
          headers: headers('CUSTOMER'),
        })
      ).statusCode,
    ).toBe(200);
    // a newer build passes
    const newer = await ctx.app.inject({
      method: 'GET',
      url: '/v1/geo/serviceability?lat=23.8&lng=72.39',
      headers: { ...android, 'x-app-version': '2.0.1' },
    });
    expect(newer.statusCode).toBe(200);
  });

  it('rejects min > recommended and requires a reason when raising the minimum', async () => {
    const inverted = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/app-versions/RIDER/IOS',
      headers: bearer(token),
      payload: { minSupportedVersion: '3.0.0', recommendedVersion: '2.0.0', forceUpdate: false },
    });
    expect(inverted.statusCode).toBe(400);
    const noReason = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/app-versions/RIDER/IOS',
      headers: bearer(token),
      payload: { minSupportedVersion: '1.1.0', recommendedVersion: '1.1.0', forceUpdate: false },
    });
    expect(noReason.statusCode).toBe(400);
  });

  it('maintenance blocks selected apps; admin keeps working', async () => {
    const on = await put({
      key: 'maintenance',
      scope: 'GLOBAL',
      value: { enabled: true, message: 'Back at 6 AM', apps: ['RESTAURANT'] },
      reason: 'db upgrade',
    });
    expect(on.statusCode).toBe(200);
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: headers('RESTAURANT'),
      payload: { channel: 'SMS', destination: '9876522222' },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'MAINTENANCE', message: 'Back at 6 AM' });
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/app-config', headers: headers('RESTAURANT') })).json()
        .maintenance,
    ).toEqual({ enabled: true, message: 'Back at 6 AM' });
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/app-config', headers: headers('CUSTOMER') })).json()
        .maintenance.enabled,
    ).toBe(false);
    expect((await list()).statusCode).toBe(200);
    await put({
      key: 'maintenance',
      scope: 'GLOBAL',
      value: { enabled: false, message: null, apps: ['RESTAURANT'] },
      reason: 'done',
    });
  });
});

describe('hierarchical settings', () => {
  it('city override wins over global; zone inherits from its city; reset restores inheritance; history survives', async () => {
    const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
    const zone = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'unjha-central' } });
    const find = (items) => items.find((i) => i.key === 'orders.limits');

    let s = find((await list()).json().items);
    expect(s).toMatchObject({ source: { scope: 'DEFAULT' }, placeholder: true, activeNow: false, phase: 4 });

    expect((await put({ key: 'orders.limits', scope: 'GLOBAL', value: limits(5000) })).statusCode).toBe(200);
    expect(
      (await put({ key: 'orders.limits', scope: 'CITY', scopeRefId: unjha.id, value: limits(9900) }))
        .statusCode,
    ).toBe(200);

    s = find((await list(`?scope=ZONE&scopeRefId=${zone.id}`)).json().items);
    expect(s.effectiveValue.minOrderPaise).toBe(9900);
    expect(s.source).toEqual({ scope: 'CITY', scopeRefId: unjha.id });
    expect(s.override).toBeNull();

    const mehsana = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'mehsana' } });
    expect(
      find((await list(`?scope=CITY&scopeRefId=${mehsana.id}`)).json().items).effectiveValue.minOrderPaise,
    ).toBe(5000);

    const reset = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/admin/settings',
      headers: bearer(token),
      payload: { key: 'orders.limits', scope: 'CITY', scopeRefId: unjha.id },
    });
    expect(reset.statusCode).toBe(204);
    s = find((await list(`?scope=CITY&scopeRefId=${unjha.id}`)).json().items);
    expect(s.effectiveValue.minOrderPaise).toBe(5000);
    expect(s.source.scope).toBe('GLOBAL');

    const history = (
      await ctx.app.inject({
        method: 'GET',
        url: '/v1/admin/settings/history?key=orders.limits',
        headers: bearer(token),
      })
    ).json().items;
    expect(history).toHaveLength(3); // global set, city set, city reset — nothing lost on reset
    expect(history[0]).toMatchObject({
      scope: 'CITY',
      scopeRefId: unjha.id,
      reason: 'Reset to inherited value',
      settingId: null,
    });
    expect(history[0].oldValue.minOrderPaise).toBe(9900);
    expect(history[0].changedBy.email).toBe('super@jamzo.test');
  });

  it('validates keys, scopes, values, reasons and business rules', async () => {
    expect((await put({ key: 'nope', scope: 'GLOBAL', value: 1 })).statusCode).toBe(400);
    expect(
      (
        await put({
          key: 'maintenance',
          scope: 'CITY',
          scopeRefId: (await ctx.prisma.city.findFirstOrThrow()).id,
          value: { enabled: false, message: null, apps: [] },
        })
      ).statusCode,
    ).toBe(400);
    const float = await put({
      key: 'orders.limits',
      scope: 'GLOBAL',
      value: { ...limits(0), minOrderPaise: 10.5 },
    });
    expect(float.statusCode).toBe(400);
    expect(float.json().error.fieldErrors['value.minOrderPaise']).toBeTruthy();
    const critical = await put({
      key: 'tips',
      scope: 'GLOBAL',
      value: { enabled: true, riderShareBps: 9000, presetsPaise: [] },
    });
    expect(critical.statusCode).toBe(400);
    expect(critical.json().error.fieldErrors.reason).toBeTruthy();
    const google = await put({
      key: 'auth.methods',
      scope: 'GLOBAL',
      value: { CUSTOMER: ['GOOGLE'], RESTAURANT: ['PHONE_OTP'], RIDER: ['PHONE_OTP'], ADMIN: ['PASSWORD'] },
      reason: 'x x x',
    });
    expect(google.statusCode).toBe(400);
    expect(google.json().error.message).toMatch(/not implemented/);
    // BRANCH overrides exist since Phase 2 (D-40): an unknown branch is 404. PRODUCT/CATEGORY/VARIANT
    // scopes belong to pricing rules (Phase 4) and are refused for settings.
    const branch = await put({
      key: 'orders.limits',
      scope: 'BRANCH',
      scopeRefId: '0192d6a0-0000-7000-8000-000000000001',
      value: limits(0),
    });
    expect(branch.statusCode).toBe(404);
    const product = await put({
      key: 'orders.limits',
      scope: 'PRODUCT',
      scopeRefId: '0192d6a0-0000-7000-8000-000000000001',
      value: limits(0),
    });
    expect(product.statusCode).toBe(400);
    expect(product.json().error.message).toMatch(/cannot be overridden at PRODUCT scope/);
    const missing = await put({
      key: 'orders.limits',
      scope: 'CITY',
      scopeRefId: '0192d6a0-0000-7000-8000-000000000001',
      value: limits(0),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('feature flags: update is audited and evaluated per app in remote config', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/flags/tips',
      headers: bearer(token),
      payload: { enabled: true, rules: { apps: ['CUSTOMER'] }, reason: 'customers only' },
    });
    expect(res.statusCode).toBe(200);
    const flag = async (appId) =>
      (await ctx.app.inject({ method: 'GET', url: '/v1/app-config', headers: headers(appId) })).json()
        .featureFlags.tips;
    expect(await flag('CUSTOMER')).toBe(true);
    expect(await flag('RIDER')).toBe(false);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'feature_flag.update', entityId: 'tips' } }),
    ).toBe(1);
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: '/v1/admin/flags/unknown_flag',
          headers: bearer(token),
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('personalised flags: rollout uses the signed-in user', async () => {
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/flags/ratings',
      headers: bearer(token),
      payload: { enabled: true, rules: { rolloutPercent: 0 } },
    });
    const login = await mobileLogin(ctx, 'CUSTOMER', '9876533333');
    const cfg = await ctx.app.inject({
      method: 'GET',
      url: '/v1/app-config',
      headers: bearer(login.accessToken, 'CUSTOMER'),
    });
    expect(cfg.json().featureFlags.ratings).toBe(false);
    expect(cfg.headers['cache-control']).toBe('private, max-age=60');
  });
});
