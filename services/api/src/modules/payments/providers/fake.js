// Fake payment gateway for development and tests only (D-82) — refused in staging/production by the env
// check. It behaves like Razorpay where Jamzo can see it: the same payment/refund states, and webhooks in
// Razorpay's shape signed the same way (with a fixed development secret). State is kept in memory, or in a
// JSON file when the API and the worker run as separate processes in development.
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { bestOf, parseRazorpayWebhook } from './razorpay.js';

export const FAKE_WEBHOOK_SECRET = 'jamzo-fake-gateway-development-secret';

/**
 * @param {{ file?: string | null, feeBps?: number }} [o]
 * @returns {import('./razorpay.js').PaymentProvider & {
 *   simulate: (providerOrderId: string, i: { outcome: 'success' | 'fail' | 'authorize', amountPaise?: number, method?: string }) => { rawBody: string, headers: Record<string, string>, providerPaymentId: string },
 *   settleRefund: (providerRefundId: string, status: 'PROCESSED' | 'FAILED') => { rawBody: string, headers: Record<string, string> },
 *   setRefundMode: (mode: 'PROCESSED' | 'PENDING' | 'FAIL') => void,
 *   setFailures: (n: number) => void,
 * }}
 */
export function createFakeProvider({ file = null, feeBps = 200 } = {}) {
  let memory = { orders: {}, refunds: {}, refundMode: 'PROCESSED', failures: 0 };
  const load = () => {
    if (!file) return memory;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { orders: {}, refunds: {}, refundMode: 'PROCESSED', failures: 0 };
    }
  };
  const save = (s) => {
    if (!file) return void (memory = s);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(s));
  };
  const mutate = (fn) => {
    const s = load();
    const out = fn(s);
    save(s);
    return out;
  };
  /** Simulated outages for tests: the next `n` gateway calls fail. */
  const maybeFail = (s) => {
    if (s.failures > 0) {
      s.failures -= 1;
      save(s);
      throw new Error('fake gateway: temporarily unavailable');
    }
  };
  const webhook = (event, payload) => {
    const rawBody = JSON.stringify({
      entity: 'event',
      event,
      payload,
      created_at: Math.floor(Date.now() / 1000),
    });
    return {
      rawBody,
      headers: {
        'x-razorpay-signature': createHmac('sha256', FAKE_WEBHOOK_SECRET).update(rawBody).digest('hex'),
        'x-razorpay-event-id': `evt_fake_${randomUUID()}`,
      },
    };
  };

  return {
    name: 'fake',
    publicKey: 'fake_key',
    async createOrder({ amountPaise, currency, receipt, paymentId }) {
      return mutate((s) => {
        maybeFail(s);
        const id = `order_fake_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
        s.orders[id] = {
          id,
          amount: amountPaise,
          currency,
          receipt,
          notes: { jamzoPaymentId: paymentId },
          payments: [],
        };
        return { providerOrderId: id };
      });
    },
    async fetchPayment(providerOrderId) {
      const s = load();
      maybeFail(s);
      return bestOf(s.orders[providerOrderId]?.payments ?? []);
    },
    async capture(providerPaymentId, amountPaise) {
      return mutate((s) => {
        maybeFail(s);
        for (const o of Object.values(s.orders)) {
          const p = o.payments.find((x) => x.id === providerPaymentId);
          if (!p) continue;
          if (p.status === 'authorized' && p.amount === amountPaise) p.status = 'captured';
          return bestOf([p]);
        }
        throw new Error('fake gateway: unknown payment');
      });
    },
    verifyWebhook: (rawBody, headers) => parseRazorpayWebhook(rawBody, headers, FAKE_WEBHOOK_SECRET),
    async createRefund({ refundId, providerPaymentId, amountPaise }) {
      return mutate((s) => {
        maybeFail(s);
        const mine = Object.values(s.refunds).find(
          (r) => r.notes.jamzoRefundId === refundId && r.status !== 'FAILED',
        );
        if (mine) return { providerRefundId: mine.id, status: mine.status };
        const status = s.refundMode === 'FAIL' ? 'FAILED' : s.refundMode;
        const id = `rfnd_fake_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
        s.refunds[id] = {
          id,
          payment_id: providerPaymentId,
          amount: amountPaise,
          status,
          notes: { jamzoRefundId: refundId },
        };
        return { providerRefundId: id, status };
      });
    },
    async fetchRefund(providerRefundId) {
      const s = load();
      maybeFail(s);
      return { status: s.refunds[providerRefundId]?.status ?? 'FAILED' };
    },
    simulate(providerOrderId, { outcome, amountPaise, method = 'upi' }) {
      return mutate((s) => {
        const o = s.orders[providerOrderId];
        if (!o) throw new Error('fake gateway: unknown order');
        const amount = amountPaise ?? o.amount;
        const fee = Math.round((amount * feeBps) / 10_000);
        const tax = Math.round((fee * 18) / 118);
        const p = {
          id: `pay_fake_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
          order_id: o.id,
          amount,
          currency: o.currency,
          method,
          status: { success: 'captured', authorize: 'authorized', fail: 'failed' }[outcome],
          fee: outcome === 'success' ? fee : null,
          tax: outcome === 'success' ? tax : null,
          error_code: outcome === 'fail' ? 'BAD_REQUEST_ERROR' : null,
          error_description: outcome === 'fail' ? 'Payment declined by the bank (test)' : null,
        };
        o.payments.push(p);
        const event = {
          success: 'payment.captured',
          authorize: 'payment.authorized',
          fail: 'payment.failed',
        }[outcome];
        return { ...webhook(event, { payment: { entity: p } }), providerPaymentId: p.id };
      });
    },
    settleRefund(providerRefundId, status) {
      return mutate((s) => {
        const r = s.refunds[providerRefundId];
        r.status = status;
        return webhook(status === 'PROCESSED' ? 'refund.processed' : 'refund.failed', {
          refund: { entity: { ...r, status: status === 'PROCESSED' ? 'processed' : 'failed' } },
        });
      });
    },
    setRefundMode(mode) {
      mutate((s) => void (s.refundMode = mode));
    },
    setFailures(n) {
      mutate((s) => void (s.failures = n));
    },
  };
}
