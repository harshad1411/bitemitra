// Production operability (Phase 10: D-99, D-100): readiness, metrics behind a token, compression.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, mobileLogin, startTestApp } from './helpers.js';

const TOKEN = 'metrics-token-for-tests-0123456789';
let ctx;
beforeAll(async () => {
  ctx = await startTestApp({ env: { METRICS_TOKEN: TOKEN } });
});
afterAll(() => ctx?.stop());

describe('readiness and metrics', () => {
  it('ready while the database answers and background work flows; degraded when jobs are stuck', async () => {
    let res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready' });
    // A job that should have run 10 minutes ago and was never picked up: the worker is down.
    const stuck = await ctx.prisma.outboxEvent.create({
      data: {
        aggregateType: 'TEST',
        aggregateId: '00000000-0000-7000-8000-0000000000aa',
        eventType: 'test.stuck',
        payload: {},
        availableAt: new Date(ctx.clock.now().getTime() - 10 * 60_000),
      },
    });
    res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', reason: 'OUTBOX_STUCK' });
    await ctx.prisma.outboxEvent.delete({ where: { id: stuck.id } });
    expect((await ctx.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('metrics need the token; they count requests by route pattern (no ids) and report business gauges', async () => {
    await ctx.app.inject({
      method: 'GET',
      url: '/v1/app-config',
      headers: { 'x-app-id': 'CUSTOMER', 'x-platform': 'IOS', 'x-app-version': '1.0.0' },
    });
    expect((await ctx.app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toMatch(
      /jamzo_http_requests_total\{method="GET",route="\/v1\/app-config",status="200"\} \d+/,
    );
    expect(res.body).toMatch(
      /jamzo_http_request_duration_ms_bucket\{route="\/v1\/app-config",le="300"\} \d+/,
    );
    for (const g of [
      'jamzo_outbox_waiting',
      'jamzo_outbox_parked',
      'jamzo_payments_waiting',
      'jamzo_refunds_failed',
      'jamzo_orders_needing_attention',
    ])
      expect(res.body).toMatch(new RegExp(`^${g} \\d+$`, 'm'));
  });

  it('large JSON is compressed for clients that accept it', async () => {
    const admin = (await adminLogin(ctx)).accessToken;
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/settings',
      headers: { ...bearer(admin), 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('rate limits count per signed-in user, so customers sharing one mobile-network IP do not block each other', async () => {
    const a = await mobileLogin(ctx, 'CUSTOMER', '9123450001');
    const b = await mobileLogin(ctx, 'CUSTOMER', '9123450002');
    const addr = (t) =>
      ctx.app.inject({
        method: 'GET',
        url: '/v1/customer/addresses',
        headers: bearer(t.accessToken, 'CUSTOMER'),
      });
    // The global limit in tests is high; the geography check has 60/min — use it to hit a limit quickly.
    const check = (t) =>
      ctx.app.inject({
        method: 'GET',
        url: '/v1/geo/serviceability?lat=23.805&lng=72.39',
        headers: bearer(t.accessToken, 'CUSTOMER'),
      });
    for (let i = 0; i < 60; i++) expect((await check(a)).statusCode).not.toBe(429);
    expect((await check(a)).statusCode).toBe(429); // A used up their minute
    expect((await check(b)).statusCode).not.toBe(429); // B, same IP, is not affected
    expect((await addr(a)).statusCode).toBe(200); // other routes keep their own limits
  });
});
