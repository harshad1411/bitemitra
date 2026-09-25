// Picks the payment adapter from the environment (D-82). The env schema already refuses the fake provider
// in staging/production and mixed-up Razorpay keys.
import path from 'node:path';
import { createFakeProvider } from './fake.js';
import { createRazorpayProvider } from './razorpay.js';

/**
 * @param {{ PAYMENT_PROVIDER: 'fake' | 'razorpay', RAZORPAY_KEY_ID?: string, RAZORPAY_KEY_SECRET?: string,
 *   RAZORPAY_WEBHOOK_SECRET?: string, APP_ENV: string }} env
 * @param {{ fakeFile?: string | null }} [o] a shared file lets the API and the worker see the same fake gateway
 */
export function createPaymentProvider(env, o = {}) {
  if (env.PAYMENT_PROVIDER === 'razorpay')
    return createRazorpayProvider({
      keyId: /** @type {string} */ (env.RAZORPAY_KEY_ID),
      keySecret: /** @type {string} */ (env.RAZORPAY_KEY_SECRET),
      webhookSecret: /** @type {string} */ (env.RAZORPAY_WEBHOOK_SECRET),
    });
  const file =
    o.fakeFile !== undefined
      ? o.fakeFile
      : env.APP_ENV === 'test'
        ? null
        : path.resolve(process.cwd(), '../../var/fake-gateway.json');
  return createFakeProvider({ file });
}
