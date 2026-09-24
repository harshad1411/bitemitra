import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadEnv } from './env.js';

const good = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
};

describe('env', () => {
  it('parses defaults for development', () => {
    const env = loadEnv(apiEnvSchema, good);
    expect(env.APP_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('fails fast with every problem listed', () => {
    expect(() => loadEnv(apiEnvSchema, {})).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*OTP_PEPPER/);
  });

  it('refuses development-only providers in production', () => {
    expect(() => loadEnv(apiEnvSchema, { ...good, APP_ENV: 'production' })).toThrow(/console SMS provider/);
  });
});
