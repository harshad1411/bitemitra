// Payment and refund endpoints (D-83..D-87): the customer's pay / verify, the payment page, gateway webhooks
// and Jamzo Admin's payments and refunds.
import { z } from 'zod';
import {
  adminRefundBody,
  paymentListQuery,
  refundListQuery,
  refundPaidBody,
  refundRejectBody,
  uuid,
} from '@jamzo/validation';
import { AppError, forbidden, notFound, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { idPage, toPage } from '../../core/pagination.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { renderPayPage, safeReturnTo } from './page.js';
import { completeRefund, queueRefund, refundable, requestRefund, settleFinancialStatus } from './refunds.js';
import { adminPaymentView, adminRefundView, customerPaymentView } from './views.js';

const idParam = z.object({ id: uuid });
const providerParam = z.object({ provider: z.string().max(20) });
const CUSTOMER = { apps: ['CUSTOMER'] };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function paymentRoutes(app) {
  const prisma = app.prisma;
  const { payments, config } = app.services;

  // ── Customer app ─────────────────────────────────────────────────────────
  async function customerOrder(request, id) {
    if (!request.auth) throw unauthenticated();
    const customer = await prisma.customer.findUnique({ where: { userId: request.auth.userId } });
    const order = customer && (await prisma.order.findFirst({ where: { id, customerId: customer.id } }));
    if (!order) throw notFound('Order');
    return order;
  }
  const waitingPayment = (orderId) =>
    prisma.payment.findFirst({
      where: { orderId, provider: { not: 'cod' } },
      orderBy: { createdAt: 'desc' },
    });

  /** Open (or re-open) the payment: creates the gateway order if needed, returns a fresh payment link. */
  app.post(
    '/v1/customer/orders/:id/payment',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const order = await customerOrder(request, id);
      const p = await waitingPayment(order.id);
      if (!p || order.status !== 'PAYMENT_PENDING' || !['INITIATED', 'PENDING'].includes(p.status))
        throw new AppError('INVALID_STATE_TRANSITION', 'This order is not waiting for a payment.');
      try {
        await payments.open(p.id);
      } catch (err) {
        request.log.warn({ err: String(err?.message ?? err) }, 'gateway order not created');
        throw new AppError(
          'PAYMENT_UNAVAILABLE',
          'Online payment is not reachable right now. Please try again.',
        );
      }
      return customerPaymentView(await prisma.payment.findUnique({ where: { id: p.id } }), payments);
    },
  );

  /** The app came back from the payment page: the server asks the gateway (the app never decides). */
  app.post(
    '/v1/customer/orders/:id/payment/verify',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const order = await customerOrder(request, id);
      const p = await waitingPayment(order.id);
      if (!p) throw notFound('Payment');
      let outcome = 'SKIPPED';
      try {
        outcome = await payments.confirm(p.id, 'APP_VERIFY');
      } catch (err) {
        request.log.warn({ err: String(err?.message ?? err) }, 'verify: gateway not reachable');
        outcome = 'GATEWAY_UNREACHABLE';
      }
      const fresh = await prisma.order.findUnique({ where: { id: order.id } });
      return {
        outcome,
        orderStatus: fresh.status,
        payment: customerPaymentView(await prisma.payment.findUnique({ where: { id: p.id } }), payments),
      };
    },
  );

  // ── Payment page (D-84) — opened in the in-app browser, no app headers ──
  async function pagePayment(paymentId, token) {
    if (!payments.checkPayToken(paymentId, token))
      throw new AppError('FORBIDDEN', 'This payment link has expired. Go back to the app and try again.');
    const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!p) throw notFound('Payment');
    return p;
  }

  app.get('/v1/pay/:id', { config: { auth: 'none' } }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const q = /** @type {any} */ (request.query);
    const p = await pagePayment(id, q.t);
    const { html, csp } = renderPayPage({
      provider: payments.provider,
      payment: p,
      orderNumber: p.order.orderNumber,
      token: q.t,
      returnTo: safeReturnTo(q.returnTo),
    });
    reply.header('content-security-policy', csp).header('cache-control', 'no-store').type('text/html');
    return html;
  });

  // Test buttons of the fake gateway: they go through the real, signed webhook path.
  app.post('/v1/pay/:id/fake', { config: { auth: 'none' } }, async (request) => {
    if (payments.provider.name !== 'fake') throw notFound('Route');
    const { id } = parse(idParam, request.params);
    const body = parse(z.object({ t: z.string(), outcome: z.enum(['success', 'fail']) }), request.body);
    const p = await pagePayment(id, body.t);
    if (!p.providerOrderId) throw new AppError('INVALID_STATE_TRANSITION', 'Nothing to pay yet.');
    const hook = /** @type {any} */ (payments.provider).simulate(p.providerOrderId, {
      outcome: body.outcome,
    });
    const res = await payments.webhook('fake', hook.rawBody, hook.headers);
    return { ok: res.status === 200 };
  });

  // ── Gateway webhooks (D-85): raw body kept for the signature check ──
  await app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );
    hooks.post(
      '/v1/webhooks/payments/:provider',
      { config: { auth: 'none', rateLimit: false } },
      async (request, reply) => {
        const { provider } = parse(providerParam, request.params);
        const res = await payments.webhook(provider, String(request.body ?? ''), request.headers);
        return reply.code(res.status).send(res.body);
      },
    );
  });

  // ── Jamzo Admin ──────────────────────────────────────────────────────────
  const inCities = (request, permission) => {
    const ids = allowedCityIds(request, permission);
    return ids ? { order: { cityId: { in: ids } } } : {};
  };

  app.get(
    '/v1/admin/payments',
    { config: { permission: 'payments.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(paymentListQuery, request.query);
      const page = idPage(q);
      const rows = await prisma.payment.findMany({
        where: {
          ...page.where,
          ...inCities(request, 'payments.view'),
          ...(q.status ? { status: q.status } : {}),
          ...(q.provider ? { provider: q.provider } : {}),
          ...(q.q
            ? {
                OR: [
                  { order: { orderNumber: { contains: q.q, mode: 'insensitive' } } },
                  { providerOrderId: q.q },
                  { providerPaymentId: q.q },
                ],
              }
            : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { order: { include: { restaurant: true } } },
      });
      const result = toPage(rows, q.limit);
      return { ...result, items: result.items.map((p) => adminPaymentView(p)) };
    },
  );

  async function adminPayment(request, id, permission) {
    const p = await prisma.payment.findUnique({
      where: { id },
      include: {
        order: { include: { restaurant: true } },
        attempts: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { receivedAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p || !canInCity(request, permission, p.order.cityId)) throw notFound('Payment');
    return p;
  }

  app.get(
    '/v1/admin/payments/:id',
    { config: { permission: 'payments.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const p = await adminPayment(request, id, 'payments.view');
      return {
        ...adminPaymentView(p, { detail: true }),
        permissions: { reconcile: canInCity(request, 'payments.reconcile', p.order.cityId) },
      };
    },
  );

  app.post(
    '/v1/admin/payments/:id/reconcile',
    { config: { permission: 'payments.reconcile' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const p = await adminPayment(request, id, 'payments.reconcile');
      let outcome;
      try {
        outcome = p.provider === 'cod' ? 'SKIPPED' : await payments.confirm(p.id, 'ADMIN');
      } catch (err) {
        throw new AppError(
          'PAYMENT_UNAVAILABLE',
          `The gateway did not answer: ${String(err?.message ?? err)}`,
        );
      }
      await audit(prisma, request, {
        action: 'payment.reconcile',
        entityType: 'payment',
        entityId: p.id,
        newValue: { outcome },
      });
      const fresh = await adminPayment(request, id, 'payments.view');
      return { outcome, payment: adminPaymentView(fresh, { detail: true }) };
    },
  );

  app.get(
    '/v1/admin/refunds',
    { config: { permission: 'payments.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(refundListQuery, request.query);
      const page = idPage(q);
      const rows = await prisma.refund.findMany({
        where: {
          ...page.where,
          ...inCities(request, 'payments.view'),
          ...(q.status ? { status: q.status } : {}),
          ...(q.q ? { order: { orderNumber: { contains: q.q, mode: 'insensitive' } } } : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { order: { include: { restaurant: true } } },
      });
      const result = toPage(rows, q.limit);
      return {
        ...result,
        items: result.items.map((/** @type {any} */ r) => ({
          ...adminRefundView(r),
          canApprove:
            canInCity(request, 'refunds.approve', r.order.cityId) && r.actorId !== request.auth.userId,
        })),
      };
    },
  );

  /** What an admin refund type is worth (D-86). ITEM lines carry their share of the food discount. */
  async function amountFor(order, body) {
    const snap = await prisma.orderPricingSnapshot.findUnique({ where: { orderId: order.id } });
    const totals = /** @type {any} */ (snap?.engineOutput)?.totals ?? {};
    const left = await refundable(prisma, order.id);
    switch (body.type) {
      case 'FULL':
        return left.refundablePaise;
      case 'PARTIAL':
      case 'MANUAL':
        return body.amountPaise;
      case 'DELIVERY':
        return Math.max(0, (totals.deliveryFeePaise ?? 0) - (totals.deliveryDiscountPaise ?? 0));
      case 'PLATFORM_FEE':
        return snap?.platformFeePaise ?? 0;
      case 'ITEM': {
        const items = await prisma.orderItem.findMany({
          where: { orderId: order.id, id: { in: body.itemIds } },
        });
        if (items.length !== body.itemIds.length) throw new AppError('VALIDATION_FAILED', 'Unknown item.');
        const lines = items.reduce((n, i) => n + i.lineTotalPaise, 0);
        const food = totals.foodDisplayPaise ?? 0;
        const discount = totals.foodDiscountPaise ?? 0;
        return food > 0 ? Math.round((lines * (food - discount)) / food) : lines;
      }
      default:
        return 0;
    }
  }

  app.post(
    '/v1/admin/orders/:id/refunds',
    { config: { permission: 'refunds.create' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(adminRefundBody, request.body);
      const order = await prisma.order.findUnique({ where: { id } });
      if (!order || !canInCity(request, 'refunds.create', order.cityId)) throw notFound('Order');
      const amountPaise = await amountFor(order, body);
      if (!amountPaise)
        throw new AppError('VALIDATION_FAILED', 'There is nothing to refund for this choice.');
      const threshold = (await config.resolve('refunds.approval')).value.thresholdPaise;
      const refund = await prisma.$transaction(async (tx) => {
        const r = await requestRefund(tx, {
          orderId: order.id,
          type: body.type,
          amountPaise,
          reason: body.reason,
          idempotencyKey: `admin:${body.idempotencyKey}`,
          actor: { type: 'ADMIN', id: request.auth.userId },
          bearer: body.bearer,
          breakdown: { source: 'ADMIN', type: body.type, itemIds: body.itemIds ?? null },
          needsApproval: amountPaise > threshold,
          now: app.clock.now(),
        });
        await audit(tx, request, {
          action: 'refund.create',
          entityType: 'refund',
          entityId: r.id,
          newValue: {
            orderId: order.id,
            type: body.type,
            amountPaise,
            status: r.status,
            bearer: body.bearer,
          },
        });
        return r;
      });
      return adminRefundView(refund);
    },
  );

  async function adminRefund(request, id, permission) {
    const r = await prisma.refund.findUnique({ where: { id }, include: { order: true } });
    if (!r || !canInCity(request, permission, r.order.cityId)) throw notFound('Refund');
    return r;
  }

  app.post(
    '/v1/admin/refunds/:id/approve',
    { config: { permission: 'refunds.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const r = await adminRefund(request, id, 'refunds.approve');
      if (r.actorId === request.auth.userId)
        throw forbidden('A refund above the approval limit must be approved by a different admin.');
      const now = app.clock.now();
      const done = await prisma.$transaction(async (tx) => {
        const moved = await tx.refund.updateMany({
          where: { id: r.id, status: 'PENDING_APPROVAL' },
          data: { status: 'REQUESTED', approvedById: request.auth.userId, approvedAt: now },
        });
        if (moved.count !== 1)
          throw new AppError('INVALID_STATE_TRANSITION', 'This refund is not waiting for approval.');
        if (r.paymentId) await queueRefund(tx, r.id);
        await audit(tx, request, { action: 'refund.approve', entityType: 'refund', entityId: r.id });
        return tx.refund.findUnique({ where: { id: r.id } });
      });
      return adminRefundView(done);
    },
  );

  app.post(
    '/v1/admin/refunds/:id/reject',
    { config: { permission: 'refunds.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(refundRejectBody, request.body);
      const r = await adminRefund(request, id, 'refunds.approve');
      if (r.actorId === request.auth.userId)
        throw forbidden('A refund above the approval limit must be reviewed by a different admin.');
      const done = await prisma.$transaction(async (tx) => {
        const moved = await tx.refund.updateMany({
          where: { id: r.id, status: 'PENDING_APPROVAL' },
          data: {
            status: 'REJECTED',
            approvedById: request.auth.userId,
            approvedAt: app.clock.now(),
            rejectionReason: body.reason,
          },
        });
        if (moved.count !== 1)
          throw new AppError('INVALID_STATE_TRANSITION', 'This refund is not waiting for approval.');
        await settleFinancialStatus(tx, r.orderId);
        await audit(tx, request, {
          action: 'refund.reject',
          entityType: 'refund',
          entityId: r.id,
          newValue: { reason: body.reason },
        });
        return tx.refund.findUnique({ where: { id: r.id } });
      });
      return adminRefundView(done);
    },
  );

  /** A failed gateway refund is tried again (it still owes the customer that money). */
  app.post(
    '/v1/admin/refunds/:id/retry',
    { config: { permission: 'refunds.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const r = await adminRefund(request, id, 'refunds.approve');
      const done = await prisma.$transaction(async (tx) => {
        const moved = await tx.refund.updateMany({
          where: { id: r.id, status: 'FAILED', paymentId: { not: null } },
          data: { status: 'REQUESTED', attempts: 0, failureReason: null, providerRefundId: null },
        });
        if (moved.count !== 1)
          throw new AppError('INVALID_STATE_TRANSITION', 'Only a failed gateway refund can be retried.');
        await queueRefund(tx, r.id);
        await settleFinancialStatus(tx, r.orderId);
        await audit(tx, request, { action: 'refund.retry', entityType: 'refund', entityId: r.id });
        return tx.refund.findUnique({ where: { id: r.id } });
      });
      return adminRefundView(done);
    },
  );

  /** Cash-on-delivery refund paid back by UPI / bank transfer: the reference completes it. */
  app.post(
    '/v1/admin/refunds/:id/paid',
    { config: { permission: 'refunds.create' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(refundPaidBody, request.body);
      const r = await adminRefund(request, id, 'refunds.create');
      if (r.paymentId)
        throw new AppError('INVALID_STATE_TRANSITION', 'This refund goes through the payment gateway.');
      const done = await prisma.$transaction(async (tx) => {
        const ok = await completeRefund(tx, r.id, { now: app.clock.now(), manualReference: body.reference });
        if (!ok) throw new AppError('INVALID_STATE_TRANSITION', 'This refund cannot be marked paid now.');
        await audit(tx, request, {
          action: 'refund.paid_manually',
          entityType: 'refund',
          entityId: r.id,
          newValue: { reference: body.reference },
        });
        return tx.refund.findUnique({ where: { id: r.id } });
      });
      return adminRefundView(done);
    },
  );
}
