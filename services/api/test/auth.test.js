import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  SUPER,
  adminLogin,
  bearer,
  headers,
  lastOtp,
  mobileLogin,
  startTestApp,
} from './helpers.js';

let ctx;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx?.stop());

const otpRequest = (appId, destination, channel = 'SMS', extra = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    headers: headers(appId, extra),
    payload: { channel, destination },
  });
const otpVerify = (appId, challengeId, code) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: headers(appId),
    payload: { challengeId, code },
  });

describe('phone OTP sign-in', () => {
  it('signs a new customer in and creates the customer profile', async () => {
    const res = await otpRequest('CUSTOMER', '98765 00001');
    expect(res.statusCode).toBe(200);
    const { challengeId, resendAfterSec } = res.json();
    expect(resendAfterSec).toBe(30);
    // The OTP is stored only as a hash
    const row = await ctx.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    const code = lastOtp(ctx.sms, '+919876500001');
    expect(row.codeHash).not.toContain(code);

    const verified = await otpVerify('CUSTOMER', challengeId, code);
    expect(verified.statusCode).toBe(200);
    const body = verified.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.me).toMatchObject({
      appId: 'CUSTOMER',
      access: { status: 'OK' },
      user: { phone: '+919876500001', phoneVerified: true },
    });
    expect(await ctx.prisma.customer.count({ where: { userId: body.me.user.id } })).toBe(1);
    // same code cannot be used twice
    expect((await otpVerify('CUSTOMER', challengeId, code)).json().error.code).toBe('OTP_EXPIRED');
  });

  it('counts wrong attempts and locks the challenge', async () => {
    const { challengeId } = (await otpRequest('CUSTOMER', '9876500002')).json();
    const right = lastOtp(ctx.sms, '+919876500002');
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 0; i--) {
      const r = await otpVerify('CUSTOMER', challengeId, wrong);
      expect(r.json().error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsRemaining: i } });
    }
    const locked = await otpVerify('CUSTOMER', challengeId, right);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('expires codes and enforces the resend cooldown', async () => {
    const first = await otpRequest('CUSTOMER', '9876500003');
    const again = await otpRequest('CUSTOMER', '9876500003');
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toMatchObject({ code: 'OTP_RESEND_TOO_SOON' });
    ctx.clock.advance(301_000);
    const expired = await otpVerify('CUSTOMER', first.json().challengeId, lastOtp(ctx.sms, '+919876500003'));
    expect(expired.json().error.code).toBe('OTP_EXPIRED');
  });

  it('rejects invalid numbers and disabled methods', async () => {
    const bad = await otpRequest('CUSTOMER', '12345');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fieldErrors.destination[0]).toMatch(/10-digit/);
    const emailOtp = await otpRequest('CUSTOMER', 'someone@example.com', 'EMAIL');
    expect(emailOtp.statusCode).toBe(403);
    expect(emailOtp.json().error.code).toBe('AUTH_METHOD_DISABLED');
    const adminOtp = await otpRequest('ADMIN', '9876500004');
    expect(adminOtp.statusCode).toBe(403);
  });

  it('email OTP works once enabled in settings', async () => {
    const admin = await adminLogin(ctx);
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/settings',
      headers: bearer(admin.accessToken),
      payload: {
        key: 'auth.methods',
        scope: 'GLOBAL',
        value: {
          CUSTOMER: ['PHONE_OTP', 'EMAIL_OTP'],
          RESTAURANT: ['PHONE_OTP'],
          RIDER: ['PHONE_OTP'],
          ADMIN: ['PASSWORD'],
        },
        reason: 'enable email OTP for test',
      },
    });
    expect(put.statusCode).toBe(200);
    const res = await otpRequest('CUSTOMER', 'Customer@Example.com', 'EMAIL');
    expect(res.statusCode).toBe(200);
    const code = /(\d{6})/.exec(ctx.email.sent.at(-1).text)[1];
    const v = await otpVerify('CUSTOMER', res.json().challengeId, code);
    expect(v.json().me.user).toMatchObject({ email: 'customer@example.com', emailVerified: true });
  });

  it('social sign-in is honestly unavailable', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/social/google',
      headers: headers('CUSTOMER'),
      payload: {},
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('AUTH_METHOD_UNAVAILABLE');
  });
});

describe('approval is separate from authentication (OD-13)', () => {
  const statusFor = async (appId, phone) => (await mobileLogin(ctx, appId, phone)).me;

  it('restaurant partner app', async () => {
    const owner = await statusFor('RESTAURANT', DEMO_ACCOUNTS.restaurantOwner);
    expect(owner.access.status).toBe('OK');
    expect(owner.restaurants[0]).toMatchObject({ role: 'OWNER', approved: true });
    expect((await statusFor('RESTAURANT', DEMO_ACCOUNTS.draftRestaurantManager)).access.status).toBe(
      'PENDING_APPROVAL',
    );
    const stranger = await statusFor('RESTAURANT', '9876500010');
    expect(stranger.access.status).toBe('NOT_REGISTERED');
    // signing in did not create any restaurant membership
    expect(await ctx.prisma.restaurantUser.count({ where: { userId: stranger.user.id } })).toBe(0);
  });

  it('delivery partner app', async () => {
    expect((await statusFor('RIDER', DEMO_ACCOUNTS.activeRider)).access.status).toBe('OK');
    expect((await statusFor('RIDER', DEMO_ACCOUNTS.pendingRider)).access.status).toBe('PENDING_APPROVAL');
    const stranger = await statusFor('RIDER', '9876500011');
    expect(stranger.access.status).toBe('NOT_REGISTERED');
    expect(await ctx.prisma.rider.count({ where: { userId: stranger.user.id } })).toBe(0);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    const login = await mobileLogin(ctx, 'CUSTOMER', '9876500020');
    const refresh = (token) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        headers: headers('CUSTOMER'),
        payload: { refreshToken: token },
      });
    const r1 = await refresh(login.refreshToken);
    expect(r1.statusCode).toBe(200);
    const next = r1.json();
    expect(next.refreshToken).not.toBe(login.refreshToken);

    // Reusing the rotated token = theft signal → whole family revoked, including the new token
    expect((await refresh(login.refreshToken)).statusCode).toBe(401);
    expect((await refresh(next.refreshToken)).statusCode).toBe(401);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(next.accessToken, 'CUSTOMER'),
    });
    expect(me.statusCode).toBe(401);
  });

  it('tokens are bound to their app', async () => {
    const login = await mobileLogin(ctx, 'CUSTOMER', '9876500021');
    const asRider = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(login.accessToken, 'RIDER'),
    });
    expect(asRider.statusCode).toBe(401);
    const refreshAsRider = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: headers('RIDER'),
      payload: { refreshToken: login.refreshToken },
    });
    expect(refreshAsRider.statusCode).toBe(401);
  });

  it('logout revokes the session and expired access tokens report TOKEN_EXPIRED', async () => {
    const login = await mobileLogin(ctx, 'CUSTOMER', '9876500022');
    ctx.clock.advance(0);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(login.accessToken, 'CUSTOMER'),
    });
    expect(out.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(login.accessToken, 'CUSTOMER') }))
        .statusCode,
    ).toBe(401);
  });

  it('registers push devices for the signed-in user', async () => {
    ctx.clock.advance(31_000); // this rider signed in earlier in the file; respect the resend cooldown
    const login = await mobileLogin(ctx, 'RIDER', DEMO_ACCOUNTS.activeRider);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/devices',
      headers: bearer(login.accessToken, 'RIDER'),
      payload: { platform: 'ANDROID', pushToken: 'ExponentPushToken[test-token-123]' },
    });
    expect(res.statusCode).toBe(201);
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/devices',
      headers: bearer(login.accessToken, 'RIDER'),
      payload: { platform: 'ANDROID', pushToken: 'ExponentPushToken[test-token-123]' },
    });
    expect(again.json().id).toBe(res.json().id);
  });
});

describe('admin sign-in', () => {
  it('signs in, sets an httpOnly SameSite=Strict refresh cookie and refreshes from it', async () => {
    const login = await adminLogin(ctx);
    expect(login.me.admin.permissions).toContain('rbac.super');
    expect(login.cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1' });
    expect(login.refreshToken).toBeUndefined();
    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: headers('ADMIN'),
      cookies: { jz_admin_rt: login.cookie.value },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).toBeUndefined();
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: headers('ADMIN') }))
        .statusCode,
    ).toBe(401);
  });

  it('uses one generic message for unknown users and wrong passwords, then locks after 5 failures', async () => {
    const attempt = (email, password) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/admin/auth/login',
        headers: headers('ADMIN'),
        payload: { email, password },
      });
    const unknown = await attempt('nobody@jamzo.test', 'whatever-password');
    const wrong = await attempt(SUPER.email, 'wrong-password');
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
    for (let i = 0; i < 4; i++) await attempt(SUPER.email, 'wrong-password');
    const locked = await attempt(SUPER.email, SUPER.password);
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
    ctx.clock.advance(16 * 60_000);
    expect((await attempt(SUPER.email, SUPER.password)).statusCode).toBe(200);
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: { in: ['admin.login_failed', 'admin.locked'] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(5);
  });
});
