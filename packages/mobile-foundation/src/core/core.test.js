import { describe, expect, it, vi } from 'vitest';
import { createLogger, decideGate, parseDeepLink, redact, retryAfterSec, userMessage } from './index.js';

describe('decideGate', () => {
  it('maintenance > forced update > app', () => {
    expect(
      decideGate({
        maintenance: { enabled: true, message: 'Back soon' },
        version: { status: 'UPDATE_REQUIRED' },
      }),
    ).toMatchObject({ screen: 'MAINTENANCE', message: 'Back soon' });
    expect(
      decideGate({ maintenance: { enabled: false }, version: { status: 'UPDATE_REQUIRED', storeUrl: 'x' } }),
    ).toMatchObject({ screen: 'FORCE_UPDATE', storeUrl: 'x' });
    expect(
      decideGate({
        maintenance: { enabled: false },
        version: { status: 'UPDATE_RECOMMENDED', storeUrl: null },
      }),
    ).toMatchObject({ screen: 'APP', recommendUpdate: true });
    expect(decideGate({ maintenance: { enabled: false }, version: { status: 'OK' } })).toMatchObject({
      screen: 'APP',
      recommendUpdate: false,
    });
    expect(decideGate(null)).toMatchObject({ screen: 'APP' });
  });
});

describe('errors', () => {
  it('maps client-side codes and keeps server messages', () => {
    expect(userMessage({ code: 'NETWORK_ERROR', status: 0 })).toMatch(/offline/);
    expect(userMessage({ code: 'OTP_INVALID', status: 401, message: 'That code is not valid.' })).toBe(
      'That code is not valid.',
    );
    expect(userMessage(new Error('boom'))).toMatch(/our side/);
    expect(retryAfterSec({ details: { retryAfterSec: 27 } })).toBe(27);
    expect(retryAfterSec({})).toBeNull();
  });
});

describe('parseDeepLink', () => {
  const accepted = { schemes: ['jamzo', 'jamzo-dev'], domains: ['jamzo.in'] };
  it.each([
    ['jamzo://orders/123?ref=push', { path: '/orders/123', params: { ref: 'push' } }],
    ['jamzo-dev://', { path: '/', params: {} }],
    ['https://jamzo.in/r/demo-kitchen', { path: '/r/demo-kitchen', params: {} }],
    ['https://evil.example/r/x', null],
    ['jamzo-rider://orders/1', null],
    ['not a url', null],
  ])('%s', (url, expected) => {
    expect(parseDeepLink(url, accepted)).toEqual(expected);
  });
});

describe('logger', () => {
  it('redacts secrets and masks phone numbers', () => {
    expect(redact({ refreshToken: 'abc', phone: '+919876543210', nested: { otp: '123456' } })).toEqual({
      refreshToken: '[REDACTED]',
      phone: '+919••••10',
      nested: { otp: '[REDACTED]' },
    });
    expect(redact({ errorCode: 'NETWORK_ERROR', code: '123456' })).toEqual({
      errorCode: 'NETWORK_ERROR',
      code: '[REDACTED]',
    });
    const sink = vi.fn();
    const log = createLogger({ app: 'RIDER', level: 'info', sink });
    log.debug('hidden');
    log.warn('shown', { accessToken: 'x' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({
      app: 'RIDER',
      level: 'warn',
      data: { accessToken: '[REDACTED]' },
    });
  });
});
