// Client logging with redaction (no tokens, OTPs or full phone numbers in device logs — SECURITY.md §5).
// Exact key names (case-insensitive) or any key containing token/password/secret. Log error codes as `errorCode`.
const SECRET_KEYS = /^(otp|code|otpcode|authorization)$|token|password|secret/i;
const PHONE = /\+?91?\d{10}/g;

export function redact(value, depth = 0) {
  if (depth > 5) return '[…]';
  if (typeof value === 'string') return value.replace(PHONE, (m) => `${m.slice(0, 4)}••••${m.slice(-2)}`);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

/**
 * @param {{ app: string, level?: 'debug' | 'info' | 'warn' | 'error', sink?: (entry: object) => void }} opts
 */
export function createLogger({ app, level = 'info', sink }) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const out =
    sink ?? ((e) => console[e.level === 'debug' ? 'log' : e.level](`[${e.app}] ${e.msg}`, e.data ?? ''));
  const log = (lvl) => (msg, data) => {
    if (order[lvl] < order[level]) return;
    out({
      app,
      level: lvl,
      msg,
      data: data === undefined ? undefined : redact(data),
      at: new Date().toISOString(),
    });
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
