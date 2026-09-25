// The Razorpay adapter (D-82) against a fake Razorpay HTTP API: request shapes, auth, state mapping, webhook
// signatures and refund safety. Not verified with Razorpay itself until the owner creates test keys.
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRazorpayProvider, parseRazorpayWebhook } from '../src/modules/payments/providers/razorpay.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (handler) => {
  const fetch = vi.fn(async (url, init) => handler(new URL(url).pathname, init));
  const rp = createRazorpayProvider({
    keyId: 'rzp_test_key123',
    keySecret: 'secret-abc',
    webhookSecret: 'whsec-xyz',
    fetch,
  });
  return { rp, fetch };
};

describe('razorpay adapter', () => {
  it('creates an order in paise with basic auth and our payment id in the notes', async () => {
    const { rp, fetch } = make(() => json(200, { id: 'order_R1', amount: 47_900, status: 'created' }));
    expect(
      await rp.createOrder({
        paymentId: 'p-1',
        amountPaise: 47_900,
        currency: 'INR',
        receipt: 'UNJ-260928-00001',
      }),
    ).toEqual({
      providerOrderId: 'order_R1',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('rzp_test_key123:secret-abc').toString('base64')}`,
    );
    expect(JSON.parse(init.body)).toEqual({
      amount: 47_900,
      currency: 'INR',
      receipt: 'UNJ-260928-00001',
      notes: { jamzoPaymentId: 'p-1' },
    });
    expect(rp.publicKey).toBe('rzp_test_key123'); // only the public key id ever reaches the payment page
  });

  it("reads an order's payments: captured wins over failed tries; fee and tax in paise", async () => {
    const { rp } = make(() =>
      json(200, {
        items: [
          {
            id: 'pay_1',
            status: 'failed',
            amount: 47_900,
            currency: 'INR',
            method: 'card',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Declined',
          },
          {
            id: 'pay_2',
            status: 'captured',
            amount: 47_900,
            currency: 'INR',
            method: 'upi',
            fee: 1_130,
            tax: 172,
          },
        ],
      }),
    );
    expect(await rp.fetchPayment('order_R1')).toEqual({
      state: 'CAPTURED',
      providerPaymentId: 'pay_2',
      amountPaise: 47_900,
      currency: 'INR',
      method: 'UPI',
      feePaise: 1_130,
      taxPaise: 172,
      errorCode: null,
      errorMessage: null,
    });
    const none = make(() => json(200, { items: [] }));
    expect((await none.rp.fetchPayment('order_R2')).state).toBe('PENDING');
  });

  it('surfaces gateway errors with their status', async () => {
    const { rp } = make(() => json(401, { error: { description: 'Authentication failed' } }));
    await expect(rp.fetchPayment('order_R1')).rejects.toMatchObject({
      status: 401,
      message: /Authentication failed/,
    });
  });

  it('refunds: a retry after a lost answer adopts the live refund instead of refunding twice', async () => {
    const calls = [];
    const { rp } = make((path, init) => {
      calls.push(`${init.method} ${path}`);
      if (init.method === 'GET')
        return json(200, {
          items: [
            { id: 'rfnd_old', status: 'failed', notes: { jamzoRefundId: 'r-1' } },
            { id: 'rfnd_live', status: 'processed', notes: { jamzoRefundId: 'r-1' } },
          ],
        });
      return json(200, { id: 'rfnd_new', status: 'pending' });
    });
    expect(await rp.createRefund({ refundId: 'r-1', providerPaymentId: 'pay_2', amountPaise: 500 })).toEqual({
      providerRefundId: 'rfnd_live',
      status: 'PROCESSED',
    });
    expect(calls).toEqual(['GET /v1/payments/pay_2/refunds']);
    // No live refund yet → a new one, tagged with our id.
    const fresh = make((path, init) =>
      init.method === 'GET'
        ? json(200, { items: [] })
        : json(200, { id: 'rfnd_new', status: 'pending', notes: JSON.parse(init.body).notes }),
    );
    expect(
      await fresh.rp.createRefund({ refundId: 'r-2', providerPaymentId: 'pay_2', amountPaise: 500 }),
    ).toEqual({
      providerRefundId: 'rfnd_new',
      status: 'PENDING',
    });
    expect(JSON.parse(fresh.fetch.mock.calls[1][1].body)).toMatchObject({
      amount: 500,
      notes: { jamzoRefundId: 'r-2' },
    });
  });

  it('webhooks: HMAC-SHA256 of the raw body; any change to the body breaks it', () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_2', order_id: 'order_R1', amount: 47_900 } } },
    });
    const sig = createHmac('sha256', 'whsec-xyz').update(body).digest('hex');
    expect(
      parseRazorpayWebhook(
        body,
        { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' },
        'whsec-xyz',
      ),
    ).toEqual({
      valid: true,
      eventId: 'evt_1',
      type: 'payment.captured',
      providerOrderId: 'order_R1',
      providerPaymentId: 'pay_2',
      providerRefundId: null,
      refundStatus: null,
    });
    expect(
      parseRazorpayWebhook(body.replace('47900', '100'), { 'x-razorpay-signature': sig }, 'whsec-xyz').valid,
    ).toBe(false);
    expect(parseRazorpayWebhook(body, { 'x-razorpay-signature': sig }, 'other-secret').valid).toBe(false);
    expect(parseRazorpayWebhook('not json', { 'x-razorpay-signature': 'x' }, 'whsec-xyz').valid).toBe(false);
    const refund = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_2', status: 'processed' } } },
    });
    const r = parseRazorpayWebhook(
      refund,
      { 'x-razorpay-signature': createHmac('sha256', 'whsec-xyz').update(refund).digest('hex') },
      'whsec-xyz',
    );
    expect(r).toMatchObject({ valid: true, providerRefundId: 'rfnd_1', refundStatus: 'PROCESSED' });
  });
});
