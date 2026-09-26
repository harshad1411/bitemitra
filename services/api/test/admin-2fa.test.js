// Admin two-step sign-in (OD-43, D-106): password, then a code by SMS (admin has a phone) or email.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@jamzo/auth';
import { SUPER, headers, lastOtp, startTestApp } from './helpers.js';

let ctx;
beforeAll(async () => {
  ctx = await startTestApp({ env: { ADMIN_2FA: 'required' } });
});
afterAll(() => ctx?.stop());

const login = (email, password) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    headers: headers('ADMIN'),
    payload: { email, password },
  });
const verify = (challengeId, code, appId = 'ADMIN') =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/verify',
    headers: headers(appId),
    payload: { challengeId, code },
  });
const otherCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('admin two-step sign-in', () => {
  it('a correct password alone gives no tokens; the emailed code completes sign-in', async () => {
    const first = await login(SUPER.email, SUPER.password);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.accessToken).toBeUndefined();
    expect(first.cookies.find((c) => c.name === 'jz_admin_rt')).toBeUndefined();
    expect(body.twoFactor).toMatchObject({ channel: 'EMAIL' });
    expect(body.twoFactor.sentTo).not.toBe(SUPER.email); // masked
    const mail = ctx.email.sent.at(-1);
    expect(mail).toMatchObject({ to: SUPER.email, purpose: 'ADMIN_LOGIN_OTP' });

    const done = await verify(body.twoFactor.challengeId, lastOtp(ctx.email, SUPER.email));
    expect(done.statusCode).toBe(200);
    expect(done.json().me.admin.permissions).toContain('rbac.super');
    expect(done.cookies.find((c) => c.name === 'jz_admin_rt')).toMatchObject({ httpOnly: true });
    // A code works once.
    expect(
      (await verify(body.twoFactor.challengeId, lastOtp(ctx.email, SUPER.email))).json().error.code,
    ).toBe('OTP_EXPIRED');

    const actions = (
      await ctx.prisma.auditLog.findMany({ where: { action: { startsWith: 'admin.login' } } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.login_code_sent', 'admin.login']));
  });

  it('sends the code by SMS when the admin has a phone number', async () => {
    const email = 'ops-phone@jamzo.test';
    const phone = '+919812300001';
    await ctx.prisma.user.create({
      data: {
        email,
        phone,
        name: 'Ops',
        passwordHash: await hashPassword('Ops-Admin-Pass-1'),
        identities: { create: { provider: 'PASSWORD', subject: email } },
        adminUser: { create: {} },
      },
    });
    const first = (await login(email, 'Ops-Admin-Pass-1')).json();
    expect(first.twoFactor).toMatchObject({ channel: 'SMS' });
    expect(first.twoFactor.sentTo).not.toContain('12300001');
    const sms = ctx.sms.sent.at(-1);
    expect(sms).toMatchObject({ to: phone, purpose: 'ADMIN_LOGIN_OTP' });
    expect(sms.vars.code).toMatch(/^\d{6}$/);
    expect((await verify(first.twoFactor.challengeId, lastOtp(ctx.sms, phone))).statusCode).toBe(200);
  });

  it('wrong codes count toward the limit and are audited; a wrong password sends nothing', async () => {
    const before = ctx.email.sent.length;
    expect((await login(SUPER.email, 'wrong-password')).statusCode).toBe(401);
    expect(ctx.email.sent.length).toBe(before);

    ctx.clock.advance(60_000); // past the resend wait
    const { twoFactor } = (await login(SUPER.email, SUPER.password)).json();
    const wrong = otherCode(lastOtp(ctx.email, SUPER.email));
    const failedBefore = await ctx.prisma.auditLog.count({ where: { action: 'admin.login_code_failed' } });
    for (let i = 0; i < 5; i++) expect((await verify(twoFactor.challengeId, wrong)).statusCode).toBe(401);
    // Even the right code is refused once the attempts are used up.
    const right = await verify(twoFactor.challengeId, lastOtp(ctx.email, SUPER.email));
    expect(right.json().error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.login_code_failed' } })).toBe(
      failedBefore + 6,
    );
  });

  it('admin codes cannot sign in through the mobile endpoint, and mobile codes not here', async () => {
    ctx.clock.advance(60_000);
    const { twoFactor } = (await login(SUPER.email, SUPER.password)).json();
    const code = lastOtp(ctx.email, SUPER.email);
    const viaMobile = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      headers: headers('CUSTOMER'),
      payload: { challengeId: twoFactor.challengeId, code },
    });
    expect(viaMobile.statusCode).toBe(401);

    const req = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: headers('CUSTOMER'),
      payload: { channel: 'SMS', destination: '+919812300099' },
    });
    const mobileCode = lastOtp(ctx.sms, '+919812300099');
    expect((await verify(req.json().challengeId, mobileCode)).statusCode).toBe(401);
    // The admin code itself is still usable after those refusals.
    expect((await verify(twoFactor.challengeId, code)).statusCode).toBe(200);
  });

  it('expired codes are refused, and a deactivated admin cannot finish signing in', async () => {
    ctx.clock.advance(60_000);
    const a = (await login(SUPER.email, SUPER.password)).json().twoFactor;
    const codeA = lastOtp(ctx.email, SUPER.email);
    ctx.clock.advance(6 * 60_000);
    expect((await verify(a.challengeId, codeA)).json().error.code).toBe('OTP_EXPIRED');

    const b = (await login(SUPER.email, SUPER.password)).json().twoFactor;
    await ctx.prisma.adminUser.updateMany({
      where: { user: { email: SUPER.email } },
      data: { isActive: false },
    });
    const res = await verify(b.challengeId, lastOtp(ctx.email, SUPER.email));
    expect(res.json().error.code).toBe('ACCOUNT_SUSPENDED');
    await ctx.prisma.adminUser.updateMany({
      where: { user: { email: SUPER.email } },
      data: { isActive: true },
    });
  });
});
