import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers, startTestApp } from './helpers.js';

let ctx;
beforeAll(async () => {
  ctx = await startTestApp({ env: { AUTH_RATE_LIMIT_PER_MIN: '3' } });
});
afterAll(() => ctx?.stop());

describe('standard error format (spec §71)', () => {
  it('unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/nope', headers: headers('CUSTOMER') });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.headers['x-request-id'] },
    });
  });

  it('malformed JSON, missing client headers', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: { ...headers('CUSTOMER'), 'content-type': 'application/json' },
      payload: '{"channel":',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    const noApp = await ctx.app.inject({ method: 'GET', url: '/v1/app-config' });
    expect(noApp.statusCode).toBe(400);
    expect(noApp.json().error.fieldErrors['x-app-id']).toEqual(['Required']);
    const unknownApp = await ctx.app.inject({
      method: 'GET',
      url: '/v1/app-config',
      headers: { 'x-app-id': 'POS', 'x-platform': 'IOS' },
    });
    expect(unknownApp.statusCode).toBe(400);
  });

  it('echoes a safe client request id and never leaks stack traces', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: headers('CUSTOMER', { 'x-request-id': 'client-req-12345' }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-request-id']).toBe('client-req-12345');
    expect(res.json().error.requestId).toBe('client-req-12345');
    expect(res.body).not.toMatch(/at .*\.js:\d+/);
  });

  it('security headers are set', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
  });

  it('rate-limits sign-in endpoints per IP with the standard body', async () => {
    const hit = (i) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        headers: headers('CUSTOMER'),
        payload: { channel: 'SMS', destination: `98765440${10 + i}` },
      });
    // The limit is 3/min per IP for this app instance; earlier requests in this file also count.
    let limited = null;
    for (let i = 0; i < 5 && !limited; i++) {
      const res = await hit(i);
      if (res.statusCode === 429) limited = res;
      else expect(res.statusCode).toBe(200);
    }
    expect(limited).not.toBeNull();
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.json().error.requestId).toBeTruthy();
  });

  it('health and readiness', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    expect((await ctx.app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({ status: 'ready' });
  });
});
