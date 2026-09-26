// Channel provider interfaces (ARCHITECTURE §6, DECISIONS D-21). Console providers write the message to the
// log and are refused in staging/production by the env schema. Real providers: MSG91 SMS (D-104), SMTP email
// (D-105), Expo push (D-69).
import nodemailer from 'nodemailer';

/**
 * @typedef {object} SmsProvider
 * @property {string} name
 * @property {(msg: { to: string, text: string, vars?: Record<string, string>, purpose: string }) => Promise<{ providerRef: string }>} send
 *   `text` is the full message (console provider); DLT providers send a registered template filled with `vars`.
 */

/**
 * @typedef {object} EmailProvider
 * @property {string} name
 * @property {(msg: { to: string, subject: string, text: string, purpose: string }) => Promise<{ providerRef: string }>} send
 */

let counter = 0;
const ref = (prefix) => `${prefix}-${Date.now()}-${++counter}`;

/**
 * Development/test SMS provider. Keeps the last messages in memory so tests and local developers can
 * read OTPs; logs them at info level. NOT a real delivery channel.
 * @param {{ logger?: { info: Function }, keep?: number }} [opts]
 * @returns {SmsProvider & { sent: { to: string, text: string, vars?: Record<string, string>, purpose: string }[] }}
 */
export function createConsoleSmsProvider({ logger, keep = 50 } = {}) {
  const sent = [];
  return {
    name: 'console',
    sent,
    async send({ to, text, vars, purpose }) {
      sent.push({ to, text, vars, purpose });
      if (sent.length > keep) sent.shift();
      // Intentionally includes the text: this provider exists so developers can read OTPs locally.
      logger?.info(
        { channel: 'SMS', to, purpose, devOnlyText: text },
        'console SMS provider (development only)',
      );
      return { providerRef: ref('console-sms') };
    },
  };
}

/**
 * @param {{ logger?: { info: Function }, keep?: number }} [opts]
 * @returns {EmailProvider & { sent: { to: string, subject: string, text: string, purpose: string }[] }}
 */
export function createConsoleEmailProvider({ logger, keep = 50 } = {}) {
  const sent = [];
  return {
    name: 'console',
    sent,
    async send({ to, subject, text, purpose }) {
      sent.push({ to, subject, text, purpose });
      if (sent.length > keep) sent.shift();
      logger?.info(
        { channel: 'EMAIL', to, subject, purpose, devOnlyText: text },
        'console email provider (development only)',
      );
      return { providerRef: ref('console-email') };
    },
  };
}

/**
 * MSG91 Flow API (https://docs.msg91.com — "Send SMS" flow, POST /api/v5/flow). India's DLT rules only allow
 * registered templates, so this sends a template id per purpose plus its variables, never free text.
 * **Tested only against a fake MSG91 server — not verified with MSG91 until the owner's account, DLT sender
 * id and template exist (DECISIONS D-104, Q-6b).**
 * @param {{ authKey: string, templates: Record<string, string>, otpVar?: string, endpoint?: string,
 *   fetch?: typeof fetch, timeoutMs?: number }} opts templates: purpose → MSG91 template id
 * @returns {SmsProvider}
 */
export function createMsg91SmsProvider({
  authKey,
  templates,
  otpVar = 'otp',
  endpoint = 'https://control.msg91.com/api/v5/flow',
  fetch: doFetch = globalThis.fetch,
  timeoutMs = 10_000,
}) {
  if (!authKey) throw new Error('MSG91 needs an auth key');
  return {
    name: 'msg91',
    async send({ to, vars, purpose }) {
      const templateId = templates[purpose];
      if (!templateId) throw new Error(`No MSG91 template for SMS purpose ${purpose}`);
      if (!/^\+\d{8,15}$/.test(to)) throw new Error('SMS destination must be an E.164 number');
      const recipient = { mobiles: to.slice(1) };
      if (vars?.code) recipient[otpVar] = vars.code;
      for (const [k, v] of Object.entries(vars ?? {})) if (k !== 'code') recipient[k] = v;
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [recipient] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = /** @type {{ type?: string, message?: unknown, request_id?: string } | null} */ (
        await res.json().catch(() => null)
      );
      if (!res.ok || body?.type !== 'success') {
        // MSG91's message can echo the request; keep only the status and its error text.
        throw new Error(
          `MSG91 refused the SMS (HTTP ${res.status}): ${String(body?.message ?? '').slice(0, 200)}`,
        );
      }
      return { providerRef: String(body.message ?? body.request_id ?? '') };
    },
  };
}

/**
 * Plain-text email over SMTP with nodemailer (DECISIONS D-105). Port 465 uses TLS from the start; other ports
 * upgrade with STARTTLS, which is required unless `requireTls` is false (local test servers only).
 * @param {{ host: string, port: number, user?: string, pass?: string, from: string, requireTls?: boolean,
 *   timeoutMs?: number }} opts
 * @returns {EmailProvider & { close: () => void }}
 */
export function createSmtpEmailProvider({
  host,
  port,
  user,
  pass,
  from,
  requireTls = true,
  timeoutMs = 15_000,
}) {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: requireTls && port !== 465,
    ignoreTLS: !requireTls,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  return {
    name: 'smtp',
    async send({ to, subject, text }) {
      const info = await transport.sendMail({ from, to, subject, text });
      if (info.rejected?.length) throw new Error('The mail server refused the recipient');
      return { providerRef: info.messageId };
    },
    close: () => transport.close(),
  };
}

/**
 * @param {string} name
 * @param {{ logger?: { info: Function }, env?: Record<string, any>, fetch?: typeof fetch }} deps
 */
export function createSmsProvider(name, deps) {
  if (name === 'console') return createConsoleSmsProvider(deps);
  if (name === 'msg91') {
    const env = deps.env ?? {};
    return createMsg91SmsProvider({
      authKey: env.MSG91_AUTH_KEY,
      // One DLT template serves both sign-in codes; the purposes stay separate so they can diverge later.
      templates: { LOGIN_OTP: env.MSG91_OTP_TEMPLATE_ID, ADMIN_LOGIN_OTP: env.MSG91_OTP_TEMPLATE_ID },
      otpVar: env.MSG91_OTP_VAR,
      fetch: deps.fetch,
    });
  }
  throw new Error(`SMS provider "${name}" is not implemented`);
}

/**
 * @param {string} name
 * @param {{ logger?: { info: Function }, env?: Record<string, any> }} deps
 */
export function createEmailProvider(name, deps) {
  if (name === 'console') return createConsoleEmailProvider(deps);
  if (name === 'smtp') {
    const env = deps.env ?? {};
    return createSmtpEmailProvider({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.EMAIL_FROM,
      requireTls: env.SMTP_REQUIRE_TLS ?? true,
    });
  }
  throw new Error(`Email provider "${name}" is not implemented`);
}

/**
 * @typedef {object} PushMessage
 * @property {string} to device push token
 * @property {string} title
 * @property {string} body
 * @property {Record<string, unknown>} [data]
 * @property {string} [sound] 'default' or a bundled sound file name
 * @property {string} [channelId] Android notification channel
 * @property {'default'|'high'} [priority]
 */
/**
 * @typedef {object} PushResult
 * @property {boolean} ok
 * @property {string} [providerRef]
 * @property {string} [error]
 * @property {boolean} [deviceGone] the token is no longer valid; stop sending to it
 */
/**
 * @typedef {object} PushProvider
 * @property {string} name
 * @property {(messages: PushMessage[]) => Promise<PushResult[]>} send one result per message, same order
 */

/**
 * Development/test push provider: records messages, delivers nothing. NOT a real delivery channel.
 * @param {{ logger?: { info: Function }, keep?: number }} [opts]
 * @returns {PushProvider & { sent: PushMessage[] }}
 */
export function createConsolePushProvider({ logger, keep = 200 } = {}) {
  const sent = [];
  return {
    name: 'console',
    sent,
    async send(messages) {
      for (const m of messages) {
        sent.push(m);
        if (sent.length > keep) sent.shift();
        logger?.info(
          { channel: 'PUSH', title: m.title, data: m.data },
          'console push provider (development only)',
        );
      }
      return messages.map(() => ({ ok: true, providerRef: ref('console-push') }));
    },
  };
}

/**
 * Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/). Sends in batches of
 * 100 and maps each ticket back to its message. **Tested only against a fake endpoint — not verified with
 * Expo's service until the EAS projects exist (DECISIONS D-69, Q-18).** Receipts (delivery confirmation)
 * are not fetched yet.
 * @param {{ accessToken?: string, endpoint?: string, fetch?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {PushProvider}
 */
export function createExpoPushProvider({
  accessToken,
  endpoint = 'https://exp.host/--/api/v2/push/send',
  fetch: doFetch = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  return {
    name: 'expo',
    async send(messages) {
      const results = [];
      for (let i = 0; i < messages.length; i += 100) {
        const batch = messages.slice(i, i + 100);
        try {
          const res = await doFetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(batch),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const json = /** @type {any} */ (await res.json().catch(() => null));
          if (!res.ok || !Array.isArray(json?.data)) {
            const error = `Expo push HTTP ${res.status}`;
            results.push(...batch.map(() => ({ ok: false, error })));
            continue;
          }
          for (const t of json.data)
            results.push(
              t.status === 'ok'
                ? { ok: true, providerRef: t.id }
                : {
                    ok: false,
                    error: t.details?.error ?? t.message ?? 'Expo push error',
                    deviceGone: t.details?.error === 'DeviceNotRegistered',
                  },
            );
        } catch (err) {
          const error = String(/** @type {any} */ (err)?.message ?? err).slice(0, 200);
          results.push(...batch.map(() => ({ ok: false, error })));
        }
      }
      return results;
    },
  };
}

/**
 * @param {string} name 'console' | 'expo'
 * @param {{ logger?: { info: Function }, accessToken?: string }} deps
 * @returns {PushProvider}
 */
export function createPushProvider(name, deps) {
  if (name === 'console') return createConsolePushProvider(deps);
  if (name === 'expo') return createExpoPushProvider({ accessToken: deps.accessToken });
  throw new Error(`Push provider "${name}" is not implemented`);
}
