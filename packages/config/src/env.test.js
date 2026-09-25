import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadEnv } from './env.js';

const good = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
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

  it('payments: the fake provider is for development only; Razorpay test and live keys are never mixed up', () => {
    expect(loadEnv(apiEnvSchema, good).PAYMENT_PROVIDER).toBe('fake');
    expect(() => loadEnv(apiEnvSchema, { ...good, APP_ENV: 'staging' })).toThrow(/fake payment provider/);
    expect(() => loadEnv(apiEnvSchema, { ...good, PAYMENT_PROVIDER: 'razorpay' })).toThrow(
      /RAZORPAY_KEY_ID is required[\s\S]*RAZORPAY_WEBHOOK_SECRET is required/,
    );
    const rzp = (id) => ({
      ...good,
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: id,
      RAZORPAY_KEY_SECRET: 'secret-123456',
      RAZORPAY_WEBHOOK_SECRET: 'whsec-123456',
    });
    expect(loadEnv(apiEnvSchema, rzp('rzp_test_abc123')).RAZORPAY_KEY_ID).toBe('rzp_test_abc123');
    expect(() => loadEnv(apiEnvSchema, rzp('rzp_live_abc123'))).toThrow(/only allowed in production/);
    expect(() => loadEnv(apiEnvSchema, { ...rzp('rzp_test_abc123'), APP_ENV: 'production' })).toThrow(
      /production needs a live Razorpay key/,
    );
  });
});
