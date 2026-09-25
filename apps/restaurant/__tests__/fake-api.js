// A small fake of the Jamzo API behind global.fetch, so screens are tested against realistic responses.
export function installFakeApi({ appConfig = {}, me = {}, onRequest } = {}) {
  const calls = [];
  const baseConfig = {
    appId: 'RESTAURANT',
    platform: 'IOS',
    maintenance: { enabled: false, message: null },
    version: {
      status: 'OK',
      minSupportedVersion: '1.0.0',
      recommendedVersion: '1.0.0',
      forceUpdate: false,
      storeUrl: null,
    },
    auth: { methods: ['PHONE_OTP'] },
    featureFlags: {},
    support: { phone: null, email: null, whatsapp: null },
    serverTime: new Date().toISOString(),
  };
  global.fetch = jest.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, url: String(url), method: init.method ?? 'GET', body, headers: init.headers });
    const custom = onRequest?.(path, body, new URL(url));
    if (custom) return json(custom.status ?? 200, custom.body);
    if (path === '/v1/app-config') return json(200, { ...baseConfig, ...appConfig });
    if (path === '/v1/auth/otp/request')
      return json(200, {
        challengeId: 'c-1',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        resendAfterSec: 30,
      });
    if (path === '/v1/auth/otp/verify') {
      if (body.code !== '123456')
        return json(401, {
          error: {
            code: 'OTP_INVALID',
            message: 'That code is not valid.',
            requestId: 'r',
            details: { attemptsRemaining: 4 },
          },
        });
      return json(200, {
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        me: {
          appId: 'RESTAURANT',
          user: { id: 'u1', phone: body && '+919876543210' },
          access: { status: 'OK' },
          ...me,
        },
      });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: 'r' } });
  });
  return calls;
}

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  };
}
