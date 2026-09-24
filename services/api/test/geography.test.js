import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, headers, startTestApp } from './helpers.js';

let ctx;
let token;
beforeAll(async () => {
  ctx = await startTestApp();
  token = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const serviceability = (lat, lng) => ctx.app.inject({ method: 'GET', url: `/v1/geo/serviceability?lat=${lat}&lng=${lng}`, headers: headers('CUSTOMER') });

describe('serviceability (seeded Unjha + Mehsana)', () => {
  it.each([
    [23.805, 72.39, true, 'OK', 'unjha-central'],
    [23.825, 72.3925, true, 'OK', 'unjha-north'], // inside the north radius area
    [23.834, 72.381, false, 'OUTSIDE_SERVICE_AREA', 'unjha-north'], // north zone, outside its radius area
    [23.59, 72.37, false, 'CITY_NOT_LIVE', 'mehsana-central'],
    [21.17, 72.83, false, 'NO_CITY', null], // Surat — no city configured
  ])('(%s, %s) → serviceable=%s %s', async (lat, lng, ok, reason, zone) => {
    const res = await serviceability(lat, lng);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ serviceable: ok, reason });
    expect(res.json().zone?.slug ?? null).toBe(zone);
  });

  it('validates coordinates and works without signing in', async () => {
    expect((await serviceability(123, 72)).statusCode).toBe(400);
    expect((await serviceability(23.805, 72.39)).json().city.slug).toBe('unjha');
  });
});

describe('admin geography', () => {
  it('adds a new city with zones without code changes (multi-city, OD-6)', async () => {
    const state = await ctx.prisma.state.findFirstOrThrow({ where: { code: 'GJ' } });
    const city = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/geo/cities',
      headers: bearer(token),
      payload: { stateId: state.id, slug: 'ahmedabad', name: 'Ahmedabad', centerLat: 23.0225, centerLng: 72.5714 },
    });
    expect(city.statusCode).toBe(201);
    expect(city.json()).toMatchObject({ isActive: false, timezone: 'Asia/Kolkata', centerLat: 23.0225 });
    const cityId = city.json().id;

    const zone = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/zones', headers: bearer(token), payload: { cityId, slug: 'navrangpura', name: 'Navrangpura', geometry: square(72.54, 23.03, 72.57, 23.05) } });
    expect(zone.statusCode).toBe(201);
    expect(zone.json()).toMatchObject({ minLat: 23.03, maxLat: 23.05, minLng: 72.54, maxLng: 72.57 });

    // Not live yet → not serviceable; launching requires a reason
    expect((await serviceability(23.04, 72.555)).json().reason).toBe('CITY_NOT_LIVE');
    const noReason = await ctx.app.inject({ method: 'PATCH', url: `/v1/admin/geo/cities/${cityId}`, headers: bearer(token), payload: { isActive: true } });
    expect(noReason.statusCode).toBe(400);
    const launch = await ctx.app.inject({ method: 'PATCH', url: `/v1/admin/geo/cities/${cityId}`, headers: bearer(token), payload: { isActive: true, reason: 'launch' } });
    expect(launch.statusCode).toBe(200);
    expect((await serviceability(23.04, 72.555)).json()).toMatchObject({ serviceable: true, city: { slug: 'ahmedabad' } });

    const audit = await ctx.prisma.auditLog.findFirst({ where: { entityId: cityId, action: 'city.update' } });
    expect(audit.oldValue.isActive).toBe(false);
    expect(audit.newValue).toMatchObject({ isActive: true, reason: 'launch' });
  });

  it('rejects invalid polygons and duplicate slugs', async () => {
    const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
    const open = { type: 'Polygon', coordinates: [[[72.3, 23.7], [72.31, 23.7], [72.31, 23.71], [72.3, 23.71]]] };
    const bad = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/zones', headers: bearer(token), payload: { cityId: unjha.id, slug: 'open', name: 'Open', geometry: open } });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fieldErrors)[0]).toMatch(/^geometry/);
    const dup = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/zones', headers: bearer(token), payload: { cityId: unjha.id, slug: 'unjha-central', name: 'Dup', geometry: square(72.3, 23.7, 72.31, 23.71) } });
    expect(dup.statusCode).toBe(409);
  });

  it('service areas restrict a zone; deactivating one takes effect immediately', async () => {
    const central = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'unjha-central' } });
    const area = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/service-areas', headers: bearer(token), payload: { zoneId: central.id, name: 'Market radius', kind: 'RADIUS', centerLat: 23.8, centerLng: 72.39, radiusM: 500 } });
    expect(area.statusCode).toBe(201);
    expect((await serviceability(23.8, 72.391)).json().serviceable).toBe(true);
    expect((await serviceability(23.812, 72.402)).json().reason).toBe('OUTSIDE_SERVICE_AREA');
    await ctx.app.inject({ method: 'PATCH', url: `/v1/admin/geo/service-areas/${area.json().id}`, headers: bearer(token), payload: { isActive: false } });
    expect((await serviceability(23.812, 72.402)).json().serviceable).toBe(true);
  });

  it('paginates cities with a cursor', async () => {
    const page1 = (await ctx.app.inject({ method: 'GET', url: '/v1/admin/geo/cities?limit=2', headers: bearer(token) })).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await ctx.app.inject({ method: 'GET', url: `/v1/admin/geo/cities?limit=2&cursor=${page1.nextCursor}`, headers: bearer(token) })).json();
    const names = [...page1.items, ...page2.items].map((c) => c.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('idempotent create: same key replays, different body conflicts', async () => {
    const state = await ctx.prisma.state.findFirstOrThrow({ where: { code: 'GJ' } });
    const body = { stateId: state.id, slug: 'surat', name: 'Surat', centerLat: 21.17, centerLng: 72.83 };
    const h = bearer(token, 'ADMIN', { 'idempotency-key': 'city-surat-1' });
    const first = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/cities', headers: h, payload: body });
    const second = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/cities', headers: h, payload: body });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
    expect(await ctx.prisma.city.count({ where: { slug: 'surat' } })).toBe(1);
    const changed = await ctx.app.inject({ method: 'POST', url: '/v1/admin/geo/cities', headers: h, payload: { ...body, name: 'Surat City' } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
