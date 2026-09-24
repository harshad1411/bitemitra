'use client';

// The admin's API client. The access token is kept in memory only; the refresh token is an httpOnly cookie
// the browser never exposes to JavaScript (DECISIONS D-22).
import { ApiError, createApiClient, errorMessage } from '@jamzo/api-client';

export const API_BASE = '/api';
let accessToken = null;
const listeners = new Set();

export const api = createApiClient({
  baseUrl: API_BASE,
  appId: 'ADMIN',
  appVersion: process.env.NEXT_PUBLIC_ADMIN_VERSION ?? '0.1.0',
  platform: 'WEB',
  refreshMode: 'cookie',
  tokens: {
    getAccessToken: () => accessToken,
    setTokens: ({ accessToken: t }) => {
      accessToken = t;
    },
    clear: () => {
      accessToken = null;
    },
  },
  onSessionExpired: () => listeners.forEach((fn) => fn()),
});

export const setAccessToken = (t) => {
  accessToken = t;
};
/** Subscribe to "session expired" (e.g. refresh token revoked); returns an unsubscribe function. */
export const onSessionExpired = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** API-relative URL (e.g. /v1/media/files/…) → browser URL through the proxy. */
export const apiUrl = (path) => `${API_BASE}${path}`;

export { ApiError, errorMessage };

/** Access token for the one non-JSON request (multipart upload). Never stored outside memory. */
export const getAccessTokenForUpload = () => accessToken;
