// Razorpay adapter (D-82, PAYMENTS.md §2). Orders API + Checkout; webhooks are signed with HMAC-SHA256 over
// the raw body. Tested against a fake Razorpay endpoint only — not verified with Razorpay until test keys
// exist. Amounts are paise, currency INR.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.razorpay.com/v1';

/**
 * @typedef {'CAPTURED' | 'AUTHORIZED' | 'FAILED' | 'PENDING'} GatewayPaymentState
 * @typedef {{ state: GatewayPaymentState, providerPaymentId: string | null, amountPaise: number, currency: string,
 *   method: string | null, feePaise: number | null, taxPaise: number | null, errorCode: string | null,
 *   errorMessage: string | null }} GatewayPayment
 * @typedef {{ valid: boolean, eventId: string | null, type: string | null, providerOrderId: string | null,
 *   providerPaymentId: string | null, providerRefundId: string | null, refundStatus: string | null }} GatewayWebhook
 * @typedef {{
 *   name: string,
 *   publicKey: string | null,
 *   createOrder: (i: { paymentId: string, amountPaise: number, currency: string, receipt: string }) => Promise<{ providerOrderId: string }>,
 *   fetchPayment: (providerOrderId: string) => Promise<GatewayPayment>,
 *   capture: (providerPaymentId: string, amountPaise: number, currency: string) => Promise<GatewayPayment>,
 *   verifyWebhook: (rawBody: string, headers: Record<string, any>) => GatewayWebhook,
 *   createRefund: (i: { refundId: string, providerPaymentId: string, amountPaise: number }) => Promise<{ providerRefundId: string, status: 'PROCESSED' | 'PENDING' | 'FAILED' }>,
 *   fetchRefund: (providerRefundId: string) => Promise<{ status: 'PROCESSED' | 'PENDING' | 'FAILED' }>,
 * }} PaymentProvider
 */

const METHOD = { upi: 'UPI', card: 'CARD', netbanking: 'NETBANKING', wallet: 'WALLET' };
const REFUND = { processed: 'PROCESSED', pending: 'PENDING', created: 'PENDING', failed: 'FAILED' };

/** Razorpay payment entity → the gateway-neutral shape. */
export function toGatewayPayment(p) {
  const state = { captured: 'CAPTURED', refunded: 'CAPTURED', authorized: 'AUTHORIZED', failed: 'FAILED' }[
    p?.status
  ];
  return {
    state: /** @type {GatewayPaymentState} */ (state ?? 'PENDING'),
    providerPaymentId: p?.id ?? null,
    amountPaise: p?.amount ?? 0,
    currency: p?.currency ?? 'INR',
    method: METHOD[p?.method] ?? null,
    feePaise: Number.isInteger(p?.fee) ? p.fee : null,
    taxPaise: Number.isInteger(p?.tax) ? p.tax : null,
    errorCode: p?.error_code ?? null,
    errorMessage: p?.error_description ?? null,
  };
}

/** The best attempt of an order: captured, then authorised, then the latest failure, else still pending. */
export function bestOf(payments) {
  const rank = { CAPTURED: 3, AUTHORIZED: 2, FAILED: 1, PENDING: 0 };
  const all = payments.map(toGatewayPayment);
  if (!all.length) return toGatewayPayment(null);
  return all.reduce((a, b) => (rank[b.state] > rank[a.state] ? b : a));
}

/**
 * Checks `x-razorpay-signature` (hex HMAC-SHA256 of the raw body) and reads the ids we act on.
 * @returns {GatewayWebhook}
 */
export function parseRazorpayWebhook(rawBody, headers, secret) {
  const given = String(headers['x-razorpay-signature'] ?? '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const valid =
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  let body = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  const payment = body?.payload?.payment?.entity;
  const refund = body?.payload?.refund?.entity;
  const order = body?.payload?.order?.entity;
  return {
    valid: valid && body != null,
    eventId: headers['x-razorpay-event-id'] ? String(headers['x-razorpay-event-id']) : null,
    type: body?.event ?? null,
    providerOrderId: payment?.order_id ?? order?.id ?? null,
    providerPaymentId: payment?.id ?? refund?.payment_id ?? null,
    providerRefundId: refund?.id ?? null,
    refundStatus: refund ? (REFUND[refund.status] ?? null) : null,
  };
}

/**
 * @param {{ keyId: string, keySecret: string, webhookSecret: string, fetch?: typeof fetch, baseUrl?: string, timeoutMs?: number }} o
 * @returns {PaymentProvider}
 */
export function createRazorpayProvider({
  keyId,
  keySecret,
  webhookSecret,
  fetch: doFetch = globalThis.fetch,
  baseUrl = BASE,
  timeoutMs = 10_000,
}) {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  async function call(method, path, body) {
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = /** @type {any} */ (await res.json().catch(() => ({})));
    if (!res.ok) {
      const err = new Error(
        `razorpay ${method} ${path} → ${res.status}: ${json?.error?.description ?? 'error'}`,
      );
      /** @type {any} */ (err).status = res.status;
      throw err;
    }
    return json;
  }
  return {
    name: 'razorpay',
    publicKey: keyId,
    async createOrder({ paymentId, amountPaise, currency, receipt }) {
      const o = await call('POST', '/orders', {
        amount: amountPaise,
        currency,
        receipt: receipt.slice(0, 40),
        notes: { jamzoPaymentId: paymentId },
      });
      return { providerOrderId: o.id };
    },
    async fetchPayment(providerOrderId) {
      const r = await call('GET', `/orders/${encodeURIComponent(providerOrderId)}/payments`);
      return bestOf(r.items ?? []);
    },
    async capture(providerPaymentId, amountPaise, currency) {
      return toGatewayPayment(
        await call('POST', `/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
          amount: amountPaise,
          currency,
        }),
      );
    },
    verifyWebhook: (rawBody, headers) => parseRazorpayWebhook(rawBody, headers, webhookSecret),
    async createRefund({ refundId, providerPaymentId, amountPaise }) {
      // A retry after a lost response must not refund twice: adopt a live refund we already created.
      const existing = await call('GET', `/payments/${encodeURIComponent(providerPaymentId)}/refunds`);
      const mine = (existing.items ?? []).find(
        (r) => r.notes?.jamzoRefundId === refundId && r.status !== 'failed',
      );
      const r =
        mine ??
        (await call('POST', `/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
          amount: amountPaise,
          speed: 'normal',
          receipt: refundId.slice(0, 40),
          notes: { jamzoRefundId: refundId },
        }));
      return { providerRefundId: r.id, status: /** @type {any} */ (REFUND[r.status] ?? 'PENDING') };
    },
    async fetchRefund(providerRefundId) {
      const r = await call('GET', `/refunds/${encodeURIComponent(providerRefundId)}`);
      return { status: /** @type {any} */ (REFUND[r.status] ?? 'PENDING') };
    },
  };
}
