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

  it('SMS, email and admin sign-in codes (D-104..D-106)', () => {
    expect(loadEnv(apiEnvSchema, good).ADMIN_2FA).toBe('off');
    expect(loadEnv(apiEnvSchema, { ...good, ADMIN_2FA: 'required' }).ADMIN_2FA).toBe('required');
    expect(() => loadEnv(apiEnvSchema, { ...good, SMS_PROVIDER: 'msg91' })).toThrow(
      /MSG91_AUTH_KEY is required[\s\S]*MSG91_OTP_TEMPLATE_ID is required/,
    );
    expect(() => loadEnv(apiEnvSchema, { ...good, EMAIL_PROVIDER: 'smtp' })).toThrow(
      /SMTP_HOST is required[\s\S]*EMAIL_FROM is required/,
    );
    const live = {
      ...good,
      APP_ENV: 'production',
      SMS_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'msg91-key-123',
      MSG91_OTP_TEMPLATE_ID: 'tmpl-123',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      EMAIL_FROM: 'Jamzo <no-reply@jamzo.in>',
    };
    // Production defaults to required and refuses "off", whatever the other problems are.
    expect(() => loadEnv(apiEnvSchema, { ...live, ADMIN_2FA: 'off' })).toThrow(
      /ADMIN_2FA: admin sign-in codes/,
    );
    expect(() => loadEnv(apiEnvSchema, live)).not.toThrow(/ADMIN_2FA|SMS_PROVIDER|EMAIL_PROVIDER|MSG91|SMTP/);
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

  it('storage: Spaces needs its endpoint, bucket and keys; local disk is refused in production', () => {
    expect(() => loadEnv(apiEnvSchema, { ...good, MEDIA_STORAGE_DRIVER: 'spaces' })).toThrow(
      /SPACES_ENDPOINT is required[\s\S]*SPACES_SECRET is required/,
    );
    const env = loadEnv(apiEnvSchema, {
      ...good,
      MEDIA_STORAGE_DRIVER: 'spaces',
      SPACES_ENDPOINT: 'https://blr1.digitaloceanspaces.com',
      SPACES_BUCKET: 'jamzo-media',
      SPACES_KEY: 'DO00EXAMPLEKEY',
      SPACES_SECRET: 'example-secret-value',
    });
    expect(env.MEDIA_STORAGE_DRIVER).toBe('spaces');
  });
});
