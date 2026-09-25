// A small fake of the Jamzo API behind global.fetch, so screens are tested against realistic responses.
// Customer responses (fixtures.json) were captured from the real API on the seeded development database;
// the restaurant is marked open so the tests do not depend on the time of day.
import fixtures from './fixtures.json';

export { fixtures };

export function installFakeApi({ appConfig = {}, me = {}, onRequest } = {}) {
  const calls = [];
  const baseConfig = {
    appId: 'CUSTOMER',
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
    calls.push({ path, method: init.method ?? 'GET', body, headers: init.headers });
    const custom = onRequest?.(path, body);
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
          appId: 'CUSTOMER',
          user: { id: 'u1', phone: body && '+919876543210' },
          access: { status: 'OK' },
          ...me,
        },
      });
    }
    if (path === '/v1/customer/home') return json(200, fixtures.home);
    if (path === `/v1/customer/restaurants/${fixtures.restaurant.restaurant.id}`)
      return json(200, fixtures.restaurant);
    if (path === '/v1/customer/cart/quote') {
      const q = fixtures.quotes[body.couponCode ?? 'none'] ?? fixtures.quotes.NOPE;
      // The fixture was captured for one line (Margherita, Medium, Cheese burst); echo the app's line key.
      return json(200, { ...q, lines: q.lines.map((l) => ({ ...l, key: body.lines[0].key })) });
    }
    if (path === '/v1/customer/favorites' || path === '/v1/customer/addresses')
      return json(200, { items: [] });
    if (path.startsWith('/v1/cms/pages/'))
      return json(404, { error: { code: 'NOT_FOUND', message: 'Page not found.', requestId: 'r' } });
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
