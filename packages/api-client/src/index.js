// fetch-based API client for every Jamzo frontend (API.md §2–§4). No business logic; displays only.
import { CLIENT_HEADERS } from '@jamzo/shared-types';

/** Error thrown for every non-2xx response and for network failures (client-side codes NETWORK_ERROR, TIMEOUT). */
export class ApiError extends Error {
  /**
   * @param {{ status: number, code: string, message: string, fieldErrors?: Record<string, string[]>, requestId?: string | null, details?: Record<string, unknown> }} p
   */
  constructor({ status, code, message, fieldErrors, requestId, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors ?? {};
    this.requestId = requestId ?? null;
    this.details = details ?? {};
  }
}

/** RFC 4122 v4 id for Idempotency-Key headers (uses crypto.randomUUID when available). */
export function newIdempotencyKey() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * @typedef {object} TokenStore
 * @property {() => Promise<string | null> | string | null} getAccessToken
 * @property {() => Promise<string | null> | string | null} [getRefreshToken] omitted in cookie mode
 * @property {(tokens: { accessToken: string, refreshToken?: string }) => Promise<void> | void} setTokens
 * @property {() => Promise<void> | void} clear
 */

/**
 * @param {object} options
 * @param {string} options.baseUrl e.g. http://localhost:4000 or /api (admin proxy)
 * @param {'CUSTOMER' | 'RESTAURANT' | 'RIDER' | 'ADMIN'} options.appId
 * @param {string} options.appVersion
 * @param {'IOS' | 'ANDROID' | 'WEB'} options.platform
 * @param {TokenStore} options.tokens
 * @param {'body' | 'cookie'} [options.refreshMode] mobile sends the refresh token; admin relies on an httpOnly cookie
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @param {number} [options.retryBaseMs]
 * @param {(e: ApiError) => void} [options.onSessionExpired]
 * @param {(e: ApiError) => void} [options.onUpgradeRequired]
 * @param {(e: ApiError) => void} [options.onMaintenance]
 */
export function createApiClient(options) {
  const {
    baseUrl,
    appId,
    appVersion,
    platform,
    tokens,
    refreshMode = 'body',
    timeoutMs = 15_000,
    maxRetries = 2,
    retryBaseMs = 300,
    onSessionExpired,
    onUpgradeRequired,
    onMaintenance,
  } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  /** @type {Promise<boolean> | null} */
  let refreshing = null;

  const headersFor = (extra = {}) => ({
    accept: 'application/json',
    [CLIENT_HEADERS.appId]: appId,
    [CLIENT_HEADERS.appVersion]: appVersion,
    [CLIENT_HEADERS.platform]: platform,
    ...extra,
  });

  async function rawFetch(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, {
        ...init,
        signal: controller.signal,
        credentials: refreshMode === 'cookie' ? 'include' : 'omit',
      });
    } catch (err) {
      const timedOut = /** @type {any} */ (err)?.name === 'AbortError';
      throw new ApiError({
        status: 0,
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: timedOut ? 'The request timed out.' : 'Could not reach the server. Check your connection.',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse(res) {
    if (res.status === 204) return null;
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.ok) return body;
    const e = body?.error;
    throw new ApiError({
      status: res.status,
      code: e?.code ?? 'INTERNAL',
      message: e?.message ?? `Request failed (${res.status})`,
      fieldErrors: e?.fieldErrors,
      requestId: e?.requestId ?? res.headers.get(CLIENT_HEADERS.requestId),
      details: e?.details,
    });
  }

  /** Single-flight refresh: concurrent 401s share one refresh call. */
  function refreshSession() {
    refreshing ??= (async () => {
      try {
        const refreshToken = refreshMode === 'body' ? await tokens.getRefreshToken?.() : undefined;
        if (refreshMode === 'body' && !refreshToken) return false;
        const res = await rawFetch(`${baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: headersFor({ 'content-type': 'application/json' }),
          body: JSON.stringify(refreshMode === 'body' ? { refreshToken } : {}),
        });
        const data = await parse(res);
        await tokens.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status > 0) {
          await tokens.clear();
          onSessionExpired?.(err);
        }
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /**
   * @param {string} path  e.g. /v1/me
   * @param {{ method?: string, query?: Record<string, unknown>, body?: unknown, auth?: boolean, idempotencyKey?: string | boolean }} [req]
   */
  async function request(path, req = {}) {
    const method = (req.method ?? 'GET').toUpperCase();
    const auth = req.auth ?? true;
    const key =
      req.idempotencyKey === true || (req.idempotencyKey === undefined && method === 'POST')
        ? newIdempotencyKey()
        : req.idempotencyKey || null;
    const qs = req.query
      ? '?' +
        new URLSearchParams(
          /** @type {[string, string][]} */ (
            Object.entries(req.query)
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([k, v]) => [k, String(v)])
          ),
        ).toString()
      : '';
    const url = `${baseUrl}${path}${qs === '?' ? '' : qs}`;
    const canRetry = method === 'GET' || Boolean(key);

    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const extra = {};
      if (req.body !== undefined) extra['content-type'] = 'application/json';
      if (key) extra[CLIENT_HEADERS.idempotencyKey] = key;
      if (auth) {
        const token = await tokens.getAccessToken();
        if (token) extra.authorization = `Bearer ${token}`;
      }
      try {
        const res = await rawFetch(url, {
          method,
          headers: headersFor(extra),
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
        });
        if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        return await parse(res);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.code === 'TOKEN_EXPIRED' && auth && !refreshed) {
          refreshed = true;
          if (await refreshSession()) continue;
        }
        if (err.status === 0 && canRetry && attempt < maxRetries) {
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        if (err.code === 'UPGRADE_REQUIRED') onUpgradeRequired?.(err);
        if (err.code === 'MAINTENANCE') onMaintenance?.(err);
        if (err.code === 'UNAUTHENTICATED' && auth) {
          await tokens.clear();
          onSessionExpired?.(err);
        }
        throw err;
      }
    }
  }

  return {
    request,
    refreshSession,
    get: (path, query) => request(path, { query }),
    post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
    patch: (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body }),
    put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
    delete: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' }),
  };
}

/**
 * Human-readable message for an error shown in UI.
 * @param {unknown} err
 */
export function errorMessage(err) {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
