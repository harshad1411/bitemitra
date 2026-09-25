// Online payments (D-82..D-86, PAYMENTS.md §3). The server decides what is paid: every path — webhook, the
// app's "verify", the reconcile and expiry jobs — asks the gateway and runs the same idempotent code.
// Used by the API and by the worker (the jobs in `handlers`).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUniqueViolation } from '@jamzo/database';
import { AppError } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';
import { createConfigService } from '../configuration/service.js';
import { afterPlaced, applyResult, eventOn, releaseCouponUsage } from '../orders/service.js';
import { completeRefund, queueRefund, requestRefund, settleFinancialStatus } from './refunds.js';

const RECONCILE_EVERY_MS = 2 * 60_000;
/** After expiry the gateway is still checked for a while, so money captured late is refunded (D-85). */
const LATE_WATCH_MS = 30 * 60_000;
const REFUND_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];
const REFUND_CHECK_MS = 10 * 60_000;
const WAITING = ['INITIATED', 'PENDING'];

/**
 * @param {{ prisma: any, provider: import('./providers/razorpay.js').PaymentProvider, clock?: { now: () => Date },
 *   log?: any, linkSecret?: string }} deps
 */
export function createPayments({
  prisma,
  provider,
  clock = { now: () => new Date() },
  log,
  linkSecret = '',
}) {
  const config = createConfigService(prisma, clock);
  const system = { type: 'SYSTEM', id: null };

  // ── Pay links (D-84) ─────────────────────────────────────────────────────
  const sign = (paymentId, exp) =>
    createHmac('sha256', `pay-link:${linkSecret}`).update(`${paymentId}.${exp}`).digest('base64url');
  /** A short-lived link to the payment page; it only shows the amount and the order number. */
  function payLink(paymentId, ttlSec = 30 * 60) {
    const exp = Math.floor(clock.now().getTime() / 1000) + ttlSec;
    return { path: `/v1/pay/${paymentId}`, token: `${exp}.${sign(paymentId, exp)}` };
  }
  function checkPayToken(paymentId, token) {
    const [expText, sig] = String(token ?? '').split('.');
    const exp = Number(expText);
    if (!exp || !sig || exp * 1000 < clock.now().getTime()) return false;
    const want = Buffer.from(sign(paymentId, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  // ── Opening the gateway order (D-83) ─────────────────────────────────────
  /** Creates the gateway order if it does not exist yet (→ PENDING). Safe to call again. */
  async function open(paymentId) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!p) throw new AppError('NOT_FOUND', 'Payment not found.');
    if (p.providerOrderId || !WAITING.includes(p.status)) return p;
    const { providerOrderId } = await provider.createOrder({
      paymentId: p.id,
      amountPaise: p.amountPaise,
      currency: 'INR',
      receipt: p.order.orderNumber,
    });
    await prisma.payment.updateMany({
      where: { id: p.id, providerOrderId: null },
      data: { providerOrderId, status: 'PENDING' },
    });
    return prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  }

  // ── Confirming (D-85) ────────────────────────────────────────────────────
  /**
   * Asks the gateway and applies what it says. Returns what happened: CONFIRMED | ALREADY | LATE_REFUND |
   * ATTEMPT_FAILED | MISMATCH | WAITING | NO_GATEWAY_ORDER.
   */
  async function confirm(paymentId, source) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new AppError('NOT_FOUND', 'Payment not found.');
    if (!p.providerOrderId) return 'NO_GATEWAY_ORDER';
    let gp = await provider.fetchPayment(p.providerOrderId);
    // An authorised payment for the right amount is captured (Razorpay can be set to capture manually).
    if (gp.state === 'AUTHORIZED' && gp.amountPaise === p.amountPaise && gp.providerPaymentId)
      gp = await provider.capture(gp.providerPaymentId, p.amountPaise, 'INR');
    return apply(paymentId, gp, source);
  }

  async function apply(paymentId, gp, source) {
    const now = clock.now();
    try {
      return await prisma.$transaction(async (tx) => {
        const p = await tx.payment.findUnique({ where: { id: paymentId } });
        await recordAttempt(tx, p, gp);
        if (gp.state === 'PENDING' || gp.state === 'AUTHORIZED') return 'WAITING';
        if (gp.state === 'FAILED') {
          // One declined try does not end the order: the customer may pay again until the payment expires.
          await tx.payment.updateMany({
            where: { id: p.id, status: { in: WAITING } },
            data: { failureReason: gp.errorMessage ?? 'Payment failed' },
          });
          return 'ATTEMPT_FAILED';
        }
        // CAPTURED
        if (gp.amountPaise !== p.amountPaise || gp.currency !== 'INR') {
          await flag(tx, p.orderId, 'PAYMENT_AMOUNT_MISMATCH');
          log?.warn(
            { paymentId, got: gp.amountPaise, want: p.amountPaise, source },
            'payment amount mismatch',
          );
          return 'MISMATCH';
        }
        const done = await tx.payment.updateMany({
          where: { id: p.id, status: { not: 'SUCCEEDED' } },
          data: {
            status: 'SUCCEEDED',
            capturedPaise: gp.amountPaise,
            providerPaymentId: gp.providerPaymentId,
            ...(gp.method ? { method: /** @type {any} */ (gp.method) } : {}),
            gatewayFeePaise: gp.feePaise,
            gatewayTaxPaise: gp.taxPaise,
            succeededAt: now,
            failureReason: null,
          },
        });
        if (done.count !== 1) {
          // Already confirmed: only fill in the gateway fee if it arrived later.
          if (gp.feePaise != null)
            await tx.payment.updateMany({
              where: { id: p.id, gatewayFeePaise: null },
              data: { gatewayFeePaise: gp.feePaise, gatewayTaxPaise: gp.taxPaise },
            });
          return 'ALREADY';
        }
        const order = await tx.order.findUnique({ where: { id: p.orderId } });
        if (order.status === 'PAYMENT_PENDING') {
          const placed = await applyResult(
            tx,
            order,
            eventOn(order, 'PAYMENT_CONFIRMED', { actor: system, now }),
            {
              now,
              payload: { paymentId: p.id, source },
            },
          );
          await afterPlaced(tx, placed, { config, now });
          return 'CONFIRMED';
        }
        // Money arrived after the order had ended (failed, expired or cancelled): give it back.
        await requestRefund(tx, {
          orderId: order.id,
          type: 'FULL',
          amountPaise: gp.amountPaise,
          reason: 'Payment received after the order had ended',
          idempotencyKey: `late:${p.id}`,
          actor: system,
          bearer: 'PLATFORM',
          breakdown: { source: 'LATE_PAYMENT', orderStatus: order.status },
          now,
        });
        await flag(tx, order.id, 'LATE_PAYMENT_REFUNDED');
        return 'LATE_REFUND';
      });
    } catch (err) {
      // Two confirmations at the same moment: the unique "one success per order" rule lets one win.
      if (isUniqueViolation(err)) return 'ALREADY';
      throw err;
    }
  }

  async function recordAttempt(tx, p, gp) {
    if (!gp.providerPaymentId) return;
    const status = { CAPTURED: 'SUCCEEDED', FAILED: 'FAILED', AUTHORIZED: 'PENDING', PENDING: 'PENDING' }[
      gp.state
    ];
    const seen = await tx.paymentAttempt.findFirst({
      where: { paymentId: p.id, providerPaymentId: gp.providerPaymentId, status },
    });
    if (seen) return;
    await tx.paymentAttempt.create({
      data: {
        paymentId: p.id,
        status,
        providerPaymentId: gp.providerPaymentId,
        errorCode: gp.errorCode,
        errorMessage: gp.errorMessage,
      },
    });
  }

  async function flag(tx, orderId, reason) {
    await tx.order.update({
      where: { id: orderId },
      data: { needsAttention: true, attentionReason: reason, version: { increment: 1 } },
    });
  }

  // ── Expiry and reconciliation (D-83, D-85) ────────────────────────────────
  /** The payment window is over: one last look at the gateway, then the order fails. */
  async function expire(paymentId) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || !WAITING.includes(p.status)) return 'SKIPPED';
    if (p.providerOrderId) {
      const outcome = await confirm(paymentId, 'EXPIRY');
      if (['CONFIRMED', 'ALREADY', 'MISMATCH'].includes(outcome)) return outcome;
    }
    const now = clock.now();
    return prisma.$transaction(async (tx) => {
      const gone = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: WAITING } },
        data: { status: 'EXPIRED', failedAt: now, failureReason: p.failureReason ?? 'Not paid in time' },
      });
      if (gone.count !== 1) return 'SKIPPED';
      const order = await tx.order.findUnique({ where: { id: p.orderId } });
      if (order.status === 'PAYMENT_PENDING') {
        await applyResult(tx, order, eventOn(order, 'PAYMENT_FAILED', { actor: system, now }), {
          now,
          payload: { paymentId, reason: 'EXPIRED' },
        });
        await releaseCouponUsage(tx, order.id, now);
      }
      return 'EXPIRED';
    });
  }

  /** Repairs missed webhooks; keeps watching a little after expiry for late captures. */
  async function reconcile(paymentId) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.provider === 'cod') return 'SKIPPED';
    const now = clock.now();
    const watchUntil = (p.expiresAt?.getTime() ?? now.getTime()) + LATE_WATCH_MS;
    let outcome = 'SKIPPED';
    if (p.providerOrderId && (p.status !== 'SUCCEEDED' || p.gatewayFeePaise == null))
      outcome = await confirm(paymentId, 'RECONCILE');
    const after = await prisma.payment.findUnique({ where: { id: paymentId } });
    const again = after.status !== 'SUCCEEDED' && now.getTime() < watchUntil;
    if (again)
      await enqueueEvent(prisma, {
        aggregateType: 'PAYMENT',
        aggregateId: paymentId,
        eventType: 'payment.reconcile',
        payload: { paymentId },
        availableAt: new Date(now.getTime() + RECONCILE_EVERY_MS),
      });
    return outcome;
  }

  // ── Webhooks (D-85) ──────────────────────────────────────────────────────
  /**
   * Stores the event first (so a gateway retry is safe), then processes it. A duplicate is a no-op.
   * @returns {Promise<{ status: number, body: object }>}
   */
  async function webhook(providerName, rawBody, headers) {
    if (providerName !== provider.name) return { status: 404, body: { ok: false } };
    const w = provider.verifyWebhook(rawBody, headers);
    if (!w.valid || !w.eventId) {
      log?.warn({ provider: providerName, eventId: w.eventId }, 'payment webhook with a bad signature');
      return { status: 400, body: { ok: false } };
    }
    const payment = w.providerOrderId
      ? await prisma.payment.findFirst({
          where: { provider: providerName, providerOrderId: w.providerOrderId },
        })
      : null;
    let event;
    try {
      event = await prisma.paymentEvent.create({
        data: {
          provider: providerName,
          providerEventId: w.eventId,
          paymentId: payment?.id ?? null,
          eventType: w.type ?? 'unknown',
          payload: JSON.parse(rawBody),
          signatureValid: true,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { status: 200, body: { ok: true, duplicate: true } };
      throw err;
    }
    try {
      if (w.providerRefundId) await refundWebhook(w);
      else if (payment) await confirm(payment.id, 'WEBHOOK');
      await prisma.paymentEvent.update({ where: { id: event.id }, data: { processedAt: clock.now() } });
    } catch (err) {
      // Stored but not processed: the reconcile job (payments) or the refund check (refunds) repairs it.
      await prisma.paymentEvent.update({
        where: { id: event.id },
        data: { processingError: String(err?.message ?? err).slice(0, 500) },
      });
      log?.error({ err, eventId: w.eventId }, 'payment webhook processing failed');
    }
    return { status: 200, body: { ok: true } };
  }

  async function refundWebhook(w) {
    const refund = await prisma.refund.findFirst({ where: { providerRefundId: w.providerRefundId } });
    if (!refund) return;
    if (w.refundStatus === 'PROCESSED')
      await prisma.$transaction((tx) => completeRefund(tx, refund.id, { now: clock.now() }));
    else if (w.refundStatus === 'FAILED')
      await refundFailed(refund.id, 'The gateway could not process the refund');
  }

  // ── Refunds (D-86) ───────────────────────────────────────────────────────
  async function processRefund(refundId) {
    const r = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!r || r.status !== 'REQUESTED' || !r.payment?.providerPaymentId) return 'SKIPPED';
    const now = clock.now();
    await prisma.refund.update({ where: { id: r.id }, data: { attempts: { increment: 1 } } });
    let res;
    try {
      res = await provider.createRefund({
        refundId: r.id,
        providerPaymentId: r.payment.providerPaymentId,
        amountPaise: r.amountPaise,
      });
    } catch (err) {
      const attempt = r.attempts + 1;
      log?.warn({ err: String(err?.message ?? err), refundId, attempt }, 'refund call failed');
      if (attempt >= REFUND_RETRY_MS.length) return refundFailed(r.id, String(err?.message ?? err));
      await prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: r.id },
          data: { failureReason: String(err?.message ?? err).slice(0, 300) },
        });
        await queueRefund(tx, r.id, REFUND_RETRY_MS[attempt - 1], now);
      });
      return 'RETRY';
    }
    if (res.status === 'FAILED') {
      await prisma.refund.update({ where: { id: r.id }, data: { providerRefundId: res.providerRefundId } });
      return refundFailed(r.id, 'The gateway refused the refund');
    }
    return prisma.$transaction(async (tx) => {
      await tx.refund.updateMany({
        where: { id: r.id, status: 'REQUESTED' },
        data: { status: 'PROCESSING', providerRefundId: res.providerRefundId },
      });
      if (res.status === 'PROCESSED') {
        await completeRefund(tx, r.id, { now });
        return 'SUCCEEDED';
      }
      await checkLater(tx, r.id, now);
      return 'PROCESSING';
    });
  }

  const checkLater = (tx, refundId, now) =>
    enqueueEvent(tx, {
      aggregateType: 'REFUND',
      aggregateId: refundId,
      eventType: 'refund.check',
      payload: { refundId },
      availableAt: new Date(now.getTime() + REFUND_CHECK_MS),
    });

  async function checkRefund(refundId) {
    const r = await prisma.refund.findUnique({ where: { id: refundId } });
    if (!r || r.status !== 'PROCESSING' || !r.providerRefundId) return 'SKIPPED';
    const { status } = await provider.fetchRefund(r.providerRefundId);
    const now = clock.now();
    if (status === 'PROCESSED') {
      await prisma.$transaction((tx) => completeRefund(tx, r.id, { now }));
      return 'SUCCEEDED';
    }
    if (status === 'FAILED') return refundFailed(r.id, 'The gateway could not process the refund');
    await checkLater(prisma, r.id, now);
    return 'PROCESSING';
  }

  async function refundFailed(refundId, reason) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId } });
      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: { in: ['REQUESTED', 'PROCESSING'] } },
        data: { status: 'FAILED', failureReason: reason.slice(0, 300) },
      });
      if (moved.count !== 1) return;
      await flag(tx, r.orderId, 'REFUND_FAILED');
      await settleFinancialStatus(tx, r.orderId);
    });
    return 'FAILED';
  }

  /** Worker jobs; the outcome is only logged. @type {Record<string, (event: any) => Promise<void>>} */
  const handlers = {
    'payment.reconcile': async (e) => void (await reconcile(e.payload.paymentId)),
    'payment.expire': async (e) => void (await expire(e.payload.paymentId)),
    'refund.process': async (e) => void (await processRefund(e.payload.refundId)),
    'refund.check': async (e) => void (await checkRefund(e.payload.refundId)),
  };

  return {
    provider,
    payLink,
    checkPayToken,
    open,
    confirm,
    expire,
    reconcile,
    webhook,
    processRefund,
    checkRefund,
    handlers,
  };
}
