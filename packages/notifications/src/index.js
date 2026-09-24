// Channel provider interfaces (ARCHITECTURE §6, DECISIONS D-21). Phase 1 ships ONLY console providers,
// which write the message to the log. They are refused in staging/production by the env schema.

/**
 * @typedef {object} SmsProvider
 * @property {string} name
 * @property {(msg: { to: string, text: string, templateId?: string, purpose: string }) => Promise<{ providerRef: string }>} send
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
 * @returns {SmsProvider & { sent: { to: string, text: string, purpose: string }[] }}
 */
export function createConsoleSmsProvider({ logger, keep = 50 } = {}) {
  const sent = [];
  return {
    name: 'console',
    sent,
    async send({ to, text, purpose }) {
      sent.push({ to, text, purpose });
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
 * @param {string} name
 * @param {{ logger?: { info: Function } }} deps
 */
export function createSmsProvider(name, deps) {
  if (name === 'console') return createConsoleSmsProvider(deps);
  throw new Error(`SMS provider "${name}" is not implemented (DECISIONS Q-6)`);
}

/**
 * @param {string} name
 * @param {{ logger?: { info: Function } }} deps
 */
export function createEmailProvider(name, deps) {
  if (name === 'console') return createConsoleEmailProvider(deps);
  throw new Error(`Email provider "${name}" is not implemented (DECISIONS Q-6)`);
}
