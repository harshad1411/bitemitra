// Environment-variable schemas. Services call loadEnv() once at startup and fail fast (SECURITY.md §6).
import { z } from 'zod';

const APP_ENVS = ['development', 'test', 'staging', 'production'];
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const base = {
  APP_ENV: z.enum(APP_ENVS).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MEDIA_STORAGE_DRIVER: z.enum(['local']).default('local'),
  // Relative to the service directory (services/api or services/workers), so both resolve to <repo>/var/media.
  MEDIA_LOCAL_DIR: z.string().default('../../var/media'),
};

export const apiEnvSchema = z
  .object({
    ...base,
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    TRUST_PROXY: bool.default(false),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    // AES-256-GCM key for sensitive fields such as bank account numbers (DECISIONS D-35).
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'FIELD_ENCRYPTION_KEY must be 32 random bytes, base64-encoded',
      ),
    // Road distances from Google (D-81); only used when Jamzo Admin sets maps.provider to GOOGLE. Server-side only.
    GOOGLE_MAPS_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20).optional()),
    SMS_PROVIDER: z.enum(['console']).default('console'),
    EMAIL_PROVIDER: z.enum(['console']).default('console'),
    COOKIE_SECURE: bool.default(true),
    ADMIN_COOKIE_PATH: z.string().startsWith('/').default('/api/v1'),
    MEDIA_PUBLIC_BASE_URL: z.string().default('/v1/media/files'),
    MEDIA_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(10 * 1024 * 1024),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    // Per-IP limit for sign-in endpoints (OTP request, admin login); OTP verify allows twice this.
    AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((env, ctx) => {
    const live = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    if (!live) return;
    // Development-only providers must never run where real users exist (DECISIONS D-21, D-23).
    if (env.SMS_PROVIDER === 'console')
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'console SMS provider is not allowed in staging/production',
      });
    if (env.EMAIL_PROVIDER === 'console')
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'console email provider is not allowed in staging/production',
      });
    if (env.MEDIA_STORAGE_DRIVER === 'local')
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_STORAGE_DRIVER'],
        message: 'local media storage is not allowed in staging/production',
      });
    if (!env.COOKIE_SECURE)
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'cookies must be Secure in staging/production',
      });
  });

export const workerEnvSchema = z
  .object({
    ...base,
    WORKER_POLL_MS: z.coerce.number().int().min(50).default(1000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    WORKER_LEASE_SEC: z.coerce.number().int().min(5).default(60),
    // Push delivery for order notifications (D-69). `expo` is not verified against Expo's service yet (Q-18).
    PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if ((env.APP_ENV === 'staging' || env.APP_ENV === 'production') && env.PUSH_PROVIDER === 'console')
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_PROVIDER'],
        message: 'console push provider is not allowed in staging/production',
      });
  });

/**
 * Parse an env source against a schema; throws one readable error listing every problem.
 * @template {import('zod').ZodType} S
 * @param {S} schema
 * @param {Record<string, string | undefined>} [source]
 * @returns {import('zod').output<S>}
 */
export function loadEnv(schema, source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
