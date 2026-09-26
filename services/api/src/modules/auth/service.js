// Authentication (SECURITY.md §1, DECISIONS D-20..D-22). Provider-based: every login method is an
// auth_identities row. Authentication NEVER implies restaurant/rider approval (OD-13) — see me().
import { randomUUID } from 'node:crypto';
import {
  DUMMY_PASSWORD_HASH,
  PARTNER_APP_RESTAURANT_STATUSES,
  generateOtp,
  generateRefreshToken,
  hashOtp,
  safeEqualHex,
  sha256,
  signAccessToken,
  verifyPassword,
} from '@jamzo/auth';
import { BRAND } from '@jamzo/config';
import { maskEmail, maskPhone } from '@jamzo/logger';
import { AppError, forbidden, unauthenticated } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { ACTOR_TYPE_BY_APP } from '../../core/client.js';
import { allPermissions, loadAdminAccess } from '../../core/auth.js';

const CHANNEL_METHOD = { SMS: 'PHONE_OTP', EMAIL: 'EMAIL_OTP' };

/**
 * @param {{ prisma: import('@jamzo/database').Db, env: any, clock: { now: () => Date }, config: any, sms: any, email: any, log: any }} deps
 */
export function createAuthService({ prisma, env, clock, config, sms, email, log }) {
  const now = () => clock.now();

  async function assertMethodEnabled(appId, method) {
    const { value } = await config.resolve('auth.methods');
    if (!(value[appId] ?? []).includes(method)) {
      throw new AppError('AUTH_METHOD_DISABLED', 'This sign-in method is not enabled for this app.');
    }
  }

  /**
   * Starts an OTP challenge. Same response whether or not an account exists (no enumeration).
   * @param {{ appId: string, channel: 'SMS' | 'EMAIL', destination: string, ip: string }} input
   */
  async function requestOtp({ appId, channel, destination, ip }) {
    if (appId === 'ADMIN')
      throw new AppError('AUTH_METHOD_DISABLED', 'Admin signs in with email and password.');
    await assertMethodEnabled(appId, CHANNEL_METHOD[channel]);
    const minutes = await ttlMinutes();
    return sendChallenge({
      appId,
      channel,
      destination,
      ip,
      purpose: 'LOGIN',
      smsPurpose: 'LOGIN_OTP',
      subject: `Your ${BRAND.name} code`,
      textFor: (code) =>
        `${code} is your ${BRAND.name} verification code. It expires in ${minutes} minutes. Do not share it with anyone.`,
    });
  }

  async function ttlMinutes() {
    return Math.round((await config.resolve('auth.otp')).value.ttlSec / 60);
  }

  /**
   * Creates a challenge (resend wait, hourly limit) and delivers its code. The row is withdrawn if delivery
   * fails, so an undelivered code never counts as sent.
   * @param {{ appId: string, channel: 'SMS' | 'EMAIL', destination: string, ip: string,
   *   purpose: 'LOGIN' | 'ADMIN_2FA', smsPurpose: string, subject: string, textFor: (code: string) => string }} p
   */
  async function sendChallenge({ appId, channel, destination, ip, purpose, smsPurpose, subject, textFor }) {
    const policy = (await config.resolve('auth.otp')).value;
    const t = now();

    const latest = await prisma.otpChallenge.findFirst({
      where: { destination, appId },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      const waitMs = latest.createdAt.getTime() + policy.resendCooldownSec * 1000 - t.getTime();
      if (waitMs > 0) {
        throw new AppError('OTP_RESEND_TOO_SOON', 'Please wait before requesting another code.', {
          details: { retryAfterSec: Math.ceil(waitMs / 1000) },
        });
      }
    }
    const lastHour = await prisma.otpChallenge.count({
      where: { destination, createdAt: { gt: new Date(t.getTime() - 3_600_000) } },
    });
    if (lastHour >= policy.maxPerHour)
      throw new AppError('RATE_LIMITED', 'Too many codes requested. Try again later.');

    const id = randomUUID();
    const code = generateOtp();
    const expiresAt = new Date(t.getTime() + policy.ttlSec * 1000);
    await prisma.otpChallenge.create({
      data: {
        id,
        channel,
        destination,
        appId,
        purpose,
        codeHash: hashOtp(code, id, env.OTP_PEPPER),
        maxAttempts: policy.maxAttempts,
        expiresAt,
        ipAddress: ip,
        createdAt: t,
      },
    });
    const text = textFor(code);
    try {
      if (channel === 'SMS') await sms.send({ to: destination, text, vars: { code }, purpose: smsPurpose });
      else await email.send({ to: destination, subject, text, purpose: smsPurpose });
    } catch (err) {
      await prisma.otpChallenge.delete({ where: { id } }).catch(() => {});
      log.error(
        { err, channel, to: channel === 'SMS' ? maskPhone(destination) : maskEmail(destination) },
        'OTP delivery failed',
      );
      throw new AppError('INTERNAL', 'We could not send the code. Please try again.');
    }
    return { challengeId: id, expiresAt: expiresAt.toISOString(), resendAfterSec: policy.resendCooldownSec };
  }

  /**
   * Checks a code against its challenge and consumes it. Attempts are counted atomically first, so parallel
   * guesses cannot exceed maxAttempts; a code is consumed once.
   * @param {any} challenge @param {string} code @param {Date} t
   */
  async function checkCode(challenge, code, t) {
    if (challenge.consumedAt || challenge.expiresAt <= t)
      throw new AppError('OTP_EXPIRED', 'That code has expired. Request a new one.');
    // Count the attempt first, conditionally, so parallel guesses cannot exceed maxAttempts.
    const counted = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0)
      throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.');

    if (!safeEqualHex(challenge.codeHash, hashOtp(code, challenge.id, env.OTP_PEPPER))) {
      const remaining = Math.max(0, challenge.maxAttempts - challenge.attempts - 1);
      throw new AppError('OTP_INVALID', 'That code is not valid.', {
        details: { attemptsRemaining: remaining },
      });
    }
    const consumed = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: t },
    });
    if (consumed.count === 0)
      throw new AppError('OTP_EXPIRED', 'That code was already used. Request a new one.');
  }

  /**
   * Verifies an OTP and signs the person in to this app. Attempts are counted atomically.
   * @param {{ appId: string, challengeId: string, code: string, platform: string | null, appVersion: string | null, ip: string, userAgent?: string }} input
   */
  async function verifyOtp(input) {
    const t = now();
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
    // Admin codes are only the second step after a password (D-106); they never sign anyone in here.
    if (!challenge || challenge.appId !== input.appId || challenge.purpose !== 'LOGIN')
      throw new AppError('OTP_INVALID', 'That code is not valid.');
    await checkCode(challenge, input.code, t);

    const provider = CHANNEL_METHOD[challenge.channel];
    const user = await prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: { provider_subject: { provider, subject: challenge.destination } },
        include: { user: true },
      });
      let u = identity?.user;
      if (!u) {
        const byContact =
          challenge.channel === 'SMS' ? { phone: challenge.destination } : { email: challenge.destination };
        u = (await tx.user.findUnique({ where: byContact })) ?? (await tx.user.create({ data: byContact }));
        await tx.authIdentity.create({
          data: { userId: u.id, provider, subject: challenge.destination, verifiedAt: t, lastUsedAt: t },
        });
      } else {
        await tx.authIdentity.update({
          where: { id: identity.id },
          data: { verifiedAt: identity.verifiedAt ?? t, lastUsedAt: t },
        });
      }
      const verifiedFlag = challenge.channel === 'SMS' ? { phoneVerified: true } : { emailVerified: true };
      u = await tx.user.update({ where: { id: u.id }, data: verifiedFlag });
      if (input.appId === 'CUSTOMER') {
        await tx.customer.upsert({ where: { userId: u.id }, create: { userId: u.id }, update: {} });
      }
      return u;
    });
    if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'This account is not active.');
    const tokens = await issueSession({
      userId: user.id,
      appId: input.appId,
      platform: input.platform,
      appVersion: input.appVersion,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ...tokens, me: await me({ userId: user.id, appId: input.appId }) };
  }

  /**
   * Creates a session (a new token family unless one is given) and returns tokens.
   * @param {{ userId: string, appId: string, familyId?: string, platform?: string | null, appVersion?: string | null, ip?: string, userAgent?: string }} p
   */
  async function issueSession(p) {
    const refreshToken = generateRefreshToken();
    const t = now();
    const session = await prisma.session.create({
      data: {
        userId: p.userId,
        appId: p.appId,
        familyId: p.familyId ?? randomUUID(),
        refreshTokenHash: sha256(refreshToken),
        platform: p.platform ?? null,
        appVersion: p.appVersion ?? null,
        userAgent: p.userAgent?.slice(0, 300) ?? null,
        ipAddress: p.ip ?? null,
        expiresAt: new Date(t.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        createdAt: t,
        lastUsedAt: t,
      },
    });
    const accessToken = await signAccessToken(
      { sub: p.userId, app: p.appId, sid: session.id },
      env.JWT_ACCESS_SECRET,
      env.ACCESS_TOKEN_TTL_SEC,
    );
    return { accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC, refreshToken, sessionId: session.id };
  }

  /**
   * Rotates a refresh token. Reusing an already-rotated token revokes the whole family (theft detection).
   * @param {{ refreshToken: string, appId: string, ip: string, userAgent?: string }} p
   */
  async function refresh(p) {
    const t = now();
    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: sha256(p.refreshToken) },
      include: { user: true },
    });
    if (!session || session.appId !== p.appId) throw unauthenticated('Please sign in again.');
    if (session.revokedAt || session.expiresAt <= t) throw unauthenticated('Please sign in again.');
    const rotated = await prisma.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: t, lastUsedAt: t },
    });
    if (rotated.count === 0) {
      await revokeFamily(session.familyId, 'REFRESH_TOKEN_REUSE');
      log.warn(
        { userId: session.userId, familyId: session.familyId },
        'refresh token reuse detected — session family revoked',
      );
      throw unauthenticated('Please sign in again.');
    }
    if (session.user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 'This account is not active.');
    if (session.appId === 'ADMIN') {
      const access = await loadAdminAccess(prisma, session.userId);
      if (!access?.isActive) throw new AppError('ACCOUNT_SUSPENDED', 'This admin account is not active.');
    }
    return issueSession({
      userId: session.userId,
      appId: session.appId,
      familyId: session.familyId,
      platform: session.platform,
      appVersion: session.appVersion,
      ip: p.ip,
      userAgent: p.userAgent,
    });
  }

  /** @param {string} familyId @param {string} reason */
  async function revokeFamily(familyId, reason) {
    await prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now(), revokedReason: reason },
    });
  }

  /** @param {string} userId @param {string} reason */
  async function revokeAllForUser(userId, reason) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now(), revokedReason: reason },
    });
  }

  /**
   * Admin email + password login with progressive lockout (SECURITY.md §1).
   * @param {import('../../core/types.js').JamzoRequest} request
   * @param {{ email: string, password: string }} input
   */
  async function adminLogin(request, input) {
    await assertMethodEnabled('ADMIN', 'PASSWORD');
    const lockout = (await config.resolve('auth.adminLockout')).value;
    const t = now();
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { adminUser: true },
    });
    const admin = user?.adminUser;
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);

    if (admin?.lockedUntil && admin.lockedUntil > t) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
        details: { lockedUntil: admin.lockedUntil.toISOString() },
      });
    }
    if (!user || !admin || !ok) {
      if (admin) {
        const failed = admin.failedLoginCount + 1;
        const lock = failed >= lockout.maxFailedLogins;
        await prisma.$transaction(async (tx) => {
          await tx.adminUser.update({
            where: { id: admin.id },
            data: {
              failedLoginCount: lock ? 0 : failed,
              lockedUntil: lock ? new Date(t.getTime() + lockout.lockMinutes * 60_000) : admin.lockedUntil,
            },
          });
          await audit(
            tx,
            request,
            {
              action: lock ? 'admin.locked' : 'admin.login_failed',
              entityType: 'admin_user',
              entityId: admin.id,
            },
            { actorType: 'ADMIN', userId: user.id },
          );
        });
      }
      throw unauthenticated('Email or password is incorrect.');
    }
    if (!admin.isActive || user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 'This admin account is not active.');
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    if (env.ADMIN_2FA !== 'required') return completeAdminLogin(request, user, admin);

    // Step two (D-106): a code by SMS when the admin has a phone number, otherwise by email.
    const channel = user.phone ? 'SMS' : 'EMAIL';
    const destination = user.phone ?? user.email;
    const minutes = await ttlMinutes();
    const challenge = await sendChallenge({
      appId: 'ADMIN',
      channel,
      destination,
      ip: request.ip,
      purpose: 'ADMIN_2FA',
      smsPurpose: 'ADMIN_LOGIN_OTP',
      subject: `Your ${BRAND.name} Admin sign-in code`,
      textFor: (code) =>
        `${code} is your ${BRAND.name} verification code. It expires in ${minutes} minutes. Do not share it with anyone.`,
    });
    await audit(
      prisma,
      request,
      {
        action: 'admin.login_code_sent',
        entityType: 'admin_user',
        entityId: admin.id,
        newValue: { channel },
      },
      { actorType: 'ADMIN', userId: user.id },
    );
    return {
      twoFactor: {
        challengeId: challenge.challengeId,
        channel,
        sentTo: channel === 'SMS' ? maskPhone(destination) : maskEmail(destination),
        expiresAt: challenge.expiresAt,
      },
    };
  }

  /**
   * Second step of admin sign-in (D-106): the code from SMS or email. Wrong codes count toward the
   * challenge's attempt limit; a new password sign-in sends a new code.
   * @param {import('../../core/types.js').JamzoRequest} request
   * @param {{ challengeId: string, code: string }} input
   */
  async function adminVerifyCode(request, input) {
    const t = now();
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.appId !== 'ADMIN' || challenge.purpose !== 'ADMIN_2FA')
      throw new AppError('OTP_INVALID', 'That code is not valid.');
    const user = await prisma.user.findFirst({
      where:
        challenge.channel === 'SMS' ? { phone: challenge.destination } : { email: challenge.destination },
      include: { adminUser: true },
    });
    const admin = user?.adminUser;
    if (!user || !admin) throw new AppError('OTP_INVALID', 'That code is not valid.');
    try {
      await checkCode(challenge, input.code, t);
    } catch (err) {
      await audit(
        prisma,
        request,
        { action: 'admin.login_code_failed', entityType: 'admin_user', entityId: admin.id },
        { actorType: 'ADMIN', userId: user.id },
      );
      throw err;
    }
    if (!admin.isActive || user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 'This admin account is not active.');
    return completeAdminLogin(request, user, admin);
  }

  /** @param {import('../../core/types.js').JamzoRequest} request @param {any} user @param {any} admin */
  async function completeAdminLogin(request, user, admin) {
    const t = now();
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: t },
      });
      await tx.authIdentity.updateMany({
        where: { userId: user.id, provider: 'PASSWORD' },
        data: { lastUsedAt: t },
      });
      await audit(
        tx,
        request,
        { action: 'admin.login', entityType: 'admin_user', entityId: admin.id },
        { actorType: 'ADMIN', userId: user.id },
      );
    });
    const tokens = await issueSession({
      userId: user.id,
      appId: 'ADMIN',
      platform: 'WEB',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { ...tokens, me: await me({ userId: user.id, appId: 'ADMIN' }) };
  }

  /**
   * Who am I in this app — including approval status for partner apps (OD-13).
   * @param {{ userId: string, appId: string }} p
   */
  async function me({ userId, appId }) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const base = {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        phoneVerified: user.phoneVerified,
        emailVerified: user.emailVerified,
      },
      appId,
    };
    if (appId === 'CUSTOMER') {
      const customer = await prisma.customer.findUnique({ where: { userId } });
      return {
        ...base,
        access: { status: customer ? 'OK' : 'NOT_REGISTERED' },
        customer: customer ? { id: customer.id } : null,
      };
    }
    if (appId === 'RESTAURANT') {
      const memberships = await prisma.restaurantUser.findMany({
        where: { userId },
        include: { restaurant: true },
        orderBy: { createdAt: 'asc' },
      });
      // approved = may use the partner app (APPROVED or ACTIVE, D-34); live = accepting orders (ACTIVE).
      const restaurants = memberships.map((m) => ({
        id: m.restaurant.id,
        name: m.restaurant.name,
        role: m.role,
        onboardingStatus: m.restaurant.onboardingStatus,
        memberActive: m.isActive,
        approved: m.isActive && PARTNER_APP_RESTAURANT_STATUSES.includes(m.restaurant.onboardingStatus),
        live: m.isActive && m.restaurant.onboardingStatus === 'ACTIVE',
      }));
      const blocked = (r) => !r.memberActive || r.onboardingStatus === 'SUSPENDED';
      const status = !restaurants.length
        ? 'NOT_REGISTERED'
        : restaurants.some((r) => r.approved)
          ? 'OK'
          : restaurants.every(blocked)
            ? 'BLOCKED'
            : 'PENDING_APPROVAL';
      return { ...base, access: { status }, restaurants };
    }
    if (appId === 'RIDER') {
      const rider = await prisma.rider.findUnique({ where: { userId } });
      const status = !rider
        ? 'NOT_REGISTERED'
        : rider.onboardingStatus === 'ACTIVE'
          ? 'OK'
          : ['SUSPENDED', 'REJECTED'].includes(rider.onboardingStatus)
            ? 'BLOCKED'
            : 'PENDING_APPROVAL';
      return {
        ...base,
        access: { status },
        rider: rider ? { id: rider.id, onboardingStatus: rider.onboardingStatus } : null,
      };
    }
    const access = await loadAdminAccess(prisma, userId);
    if (!access) throw forbidden();
    return {
      ...base,
      access: { status: access.isActive ? 'OK' : 'BLOCKED' },
      admin: {
        id: access.id,
        roles: access.roles,
        permissions: [...allPermissions(access)].sort(),
        cityPermissions: Object.fromEntries([...access.byCity].map(([c, s]) => [c, [...s].sort()])),
      },
    };
  }

  return {
    requestOtp,
    verifyOtp,
    issueSession,
    refresh,
    revokeFamily,
    revokeAllForUser,
    adminLogin,
    adminVerifyCode,
    me,
    actorTypeFor: (appId) => ACTOR_TYPE_BY_APP[appId],
  };
}
