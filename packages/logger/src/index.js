// Structured logging with redaction (SECURITY.md §5, spec §50). Never log secrets, tokens or OTPs.
import pino from 'pino';

/** Paths redacted everywhere (pino path syntax; `*` matches one level). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.otp',
  '*.code',
  '*.codeHash',
  '*.accessToken',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.token',
  '*.pushToken',
  '*.secret',
  '*.accountNumber',
  '*.pan',
  '*.aadhaar',
  'password',
  'otp',
  'accessToken',
  'refreshToken',
];

/**
 * Mask a phone number for logs: +91987•••••10.
 * @param {string | null | undefined} phone
 */
export function maskPhone(phone) {
  if (!phone) return phone ?? null;
  return phone.length <= 6
    ? '•••'
    : `${phone.slice(0, 6)}${'•'.repeat(Math.max(0, phone.length - 8))}${phone.slice(-2)}`;
}

/**
 * Mask an email for logs: o•••@example.com.
 * @param {string | null | undefined} email
 */
export function maskEmail(email) {
  if (!email) return email ?? null;
  const [user, domain] = email.split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : '•••';
}

/**
 * @param {{ name: string, level?: string, pretty?: boolean, destination?: import('pino').DestinationStream }} options
 */
export function createLogger({ name, level = 'info', pretty = false, destination }) {
  /** @type {import('pino').LoggerOptions} */
  const opts = {
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (pretty && !destination) opts.transport = { target: 'pino-pretty', options: { singleLine: true } };
  return destination ? pino(opts, destination) : pino(opts);
}
