import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, newIdempotencyKey } from './index.js';

function json(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function memoryTokens(access = 'a1', refresh = 'r1') {
  const state = { access, refresh, cleared: false };
  return {
    state,
    getAccessToken: () => state.access,
    getRefreshToken: () => state.refresh,
    setTokens: (t) => {
      state.access = t.accessToken;
      if (t.refreshToken) state.refresh = t.refreshToken;
    },
    clear: () => {
      state.access = state.refresh = null;
      state.cleared = true;
    },
  };
}
const base = {
  baseUrl: 'http://api',
  appId: 'CUSTOMER',
  appVersion: '1.2.3',
  platform: 'IOS',
  retryBaseMs: 1,
};

describe('api-client', () => {
  it('sends version headers and bearer token', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true }));
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch });
    await api.get('/v1/me', { a: 1, b: undefined });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api/v1/me?a=1');
    expect(init.headers).toMatchObject({
      'x-app-id': 'CUSTOMER',
      'x-app-version': '1.2.3',
      'x-platform': 'IOS',
      authorization: 'Bearer a1',
    });
  });

  it('uploads FormData without a JSON content type (fetch sets the multipart boundary)', async () => {
    const fetch = vi.fn(async () => json(201, { id: 'doc' }));
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch });
    const form = new FormData();
    form.append('kind', 'PAN');
    expect(await api.postForm('/v1/rider/documents', form)).toEqual({ id: 'doc' });
    const [, init] = fetch.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers['content-type']).toBeUndefined();
    expect(init.headers.authorization).toBe('Bearer a1');
    expect(init.method).toBe('POST');
  });

  it('adds one Idempotency-Key per POST and reuses it on retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { code: 'MAINTENANCE', message: 'x', requestId: 'r' } }))
      .mockResolvedValueOnce(json(201, { id: 1 }));
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch });
    expect(await api.post('/v1/things', { a: 1 })).toEqual({ id: 1 });
    const k1 = fetch.mock.calls[0][1].headers['idempotency-key'];
    expect(k1).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetch.mock.calls[1][1].headers['idempotency-key']).toBe(k1);
  });

  it('refreshes once on TOKEN_EXPIRED, shared by concurrent requests', async () => {
    const tokens = memoryTokens('old', 'r1');
    let refreshCalls = 0;
    const fetch = vi.fn(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls++;
        expect(JSON.parse(init.body)).toEqual({ refreshToken: 'r1' });
        return json(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 });
      }
      return init.headers.authorization === 'Bearer new'
        ? json(200, { ok: 1 })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'x' } });
    });
    const api = createApiClient({ ...base, tokens, fetch });
    const results = await Promise.all([api.get('/v1/a'), api.get('/v1/b'), api.get('/v1/c')]);
    expect(results).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
    expect(refreshCalls).toBe(1);
    expect(tokens.state).toMatchObject({ access: 'new', refresh: 'r2' });
  });

  it('clears the session when refresh is rejected', async () => {
    const tokens = memoryTokens();
    const onSessionExpired = vi.fn();
    const fetch = vi.fn(async (url) =>
      url.endsWith('/refresh')
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'x' } })
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'e', requestId: 'x' } }),
    );
    const api = createApiClient({ ...base, tokens, fetch, onSessionExpired });
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(tokens.state.cleared).toBe(true);
    expect(onSessionExpired).toHaveBeenCalled();
  });

  it('maps network failures, retries GETs, and surfaces standard errors', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        json(422, {
          error: { code: 'NOT_SERVICEABLE', message: 'Outside', fieldErrors: {}, requestId: 'req-1' },
        }),
      );
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch });
    const err = await api.get('/v1/geo/serviceability').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'NOT_SERVICEABLE', requestId: 'req-1' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent requests after a network failure', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch });
    await expect(api.patch('/v1/x', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('notifies upgrade-required', async () => {
    const onUpgradeRequired = vi.fn();
    const fetch = vi.fn(async () =>
      json(426, {
        error: {
          code: 'UPGRADE_REQUIRED',
          message: 'Update',
          requestId: 'x',
          details: { minVersion: '2.0.0' },
        },
      }),
    );
    const api = createApiClient({ ...base, tokens: memoryTokens(), fetch, onUpgradeRequired });
    await expect(api.get('/v1/me')).rejects.toMatchObject({
      code: 'UPGRADE_REQUIRED',
      details: { minVersion: '2.0.0' },
    });
    expect(onUpgradeRequired).toHaveBeenCalledOnce();
  });

  it('generates v4 ids', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
