// Order endpoints (ORDERS.md, API.md): customer checkout and tracking, the Restaurant Partner order screens,
// and Jamzo Admin orders. Every state change goes through @jamzo/order-engine (no "set status" endpoint).
import { z } from 'zod';
import {
  acceptOrderBody,
  adminCancelBody,
  adminOrderListQuery,
  attentionBody,
  checkoutBody,
  customerCancelBody,
  orderNoteBody,
  orderStepBody,
  pageQuery,
  prepTimeBody,
  rejectOrderBody,
  restaurantCancelBody,
  restaurantOrdersQuery,
  uuid,
} from '@jamzo/validation';
import { canCancel, cancel } from '@jamzo/order-engine';
import { restaurantRoleCan } from '@jamzo/auth';
import { CLIENT_HEADERS } from '@jamzo/shared-types';
import { AppError, forbidden, invalid, notFound, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { withIdempotency } from '../../core/idempotency.js';
import { idPage, toPage } from '../../core/pagination.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { createMemberGuard } from '../restaurants/membership.js';
import { placeOrder } from './checkout.js';
import {
  ORDER_DETAIL_INCLUDE,
  applyResult,
  asAppError,
  COD_STRIKE_STAGES,
  cancelDecision,
  cancellationAmounts,
  cancellationRuleFor,
  codStrikes,
  changeOrder,
  eventOn,
  releaseCouponUsage,
} from './service.js';
import {
  adminOrderRow,
  adminOrderView,
  customerOrderSummary,
  customerOrderView,
  restaurantOrderView,
} from './views.js';

const idParam = z.object({ id: uuid });
const CUSTOMER = { apps: ['CUSTOMER'] };
const PARTNER = { apps: ['RESTAURANT'] };
const KITCHEN_VIEWS = {
  NEW: { restaurantStatus: 'NEW' },
  ACTIVE: { restaurantStatus: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } },
  PAST: { restaurantStatus: { in: ['COMPLETED', 'REJECTED', 'CANCELLED'] } },
};
const LIVE = { status: { notIn: ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'] } };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function orderRoutes(app) {
  const prisma = app.prisma;
  const { config } = app.services;
  const requireMember = createMemberGuard(prisma);

  async function customerOf(request) {
    if (!request.auth) throw unauthenticated();
    return prisma.customer.upsert({
      where: { userId: request.auth.userId },
      create: { userId: request.auth.userId },
      update: {},
    });
  }

  // ── Customer ─────────────────────────────────────────────────────────────

  async function customerDetail(customerId, id) {
    const o = await prisma.order.findFirst({ where: { id, customerId }, include: ORDER_DETAIL_INCLUDE });
    if (!o) throw notFound('Order');
    let allowed = false;
    let cancelTerms = null;
    try {
      const now = app.clock.now();
      const rule = await cancellationRuleFor(prisma, o, now);
      allowed = canCancel(o, 'CUSTOMER', rule.params);
      if (allowed) {
        // What cancelling now would mean, shown before the customer confirms (D-70).
        const preview = cancel(o, {
          by: 'CUSTOMER',
          reasonCode: 'PREVIEW',
          now,
          rule: { id: rule.id, params: rule.params },
          amounts: cancellationAmounts(o, o.pricingSnapshot),
        });
        const counts = o.paymentMethod === 'COD' && COD_STRIKE_STAGES.includes(preview.stage);
        const limit = counts
          ? (await config.resolve('cod', await config.contextFor('BRANCH', o.branchId))).value
              .maxRefusedOrders
          : null;
        cancelTerms = {
          stage: preview.stage,
          refundDuePaise: preview.outcome.refundDuePaise,
          keptPaise: preview.outcome.customerFeePaise,
          noRefundAfterAccept: preview.stage !== 'BEFORE_ACCEPT',
          codCancellation: counts
            ? { countsTowardsLimit: true, used: await codStrikes(prisma, customerId), limit }
            : null,
        };
      }
    } catch {
      allowed = false; // no rule configured → the customer cannot cancel in the app
    }
    return { ...customerOrderView(o, { canCancel: allowed }), cancelTerms };
  }

  app.post(
    '/v1/orders',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(checkoutBody, request.body);
      if (!request.headers[CLIENT_HEADERS.idempotencyKey])
        throw invalid('Idempotency-Key header is required to place an order.', {
          [CLIENT_HEADERS.idempotencyKey]: ['Required'],
        });
      const customer = await customerOf(request);
      return withIdempotency(request, reply, { successStatus: 201 }, async () => {
        const { orderId, created } = await placeOrder(app, request, body, customer);
        return { order: await customerDetail(customer.id, orderId), created };
      });
    },
  );

  app.get(
    '/v1/customer/orders',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(pageQuery, request.query);
      const customer = await customerOf(request);
      const page = idPage(q);
      const rows = await prisma.order.findMany({
        where: { ...page.where, customerId: customer.id },
        orderBy: page.orderBy,
        take: page.take,
        include: { restaurant: true },
      });
      const result = toPage(rows, q.limit);
      return { ...result, items: result.items.map(customerOrderSummary) };
    },
  );

  app.get(
    '/v1/customer/orders/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const customer = await customerOf(request);
      return customerDetail(customer.id, id);
    },
  );

  app.post(
    '/v1/customer/orders/:id/cancel',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(customerCancelBody, request.body);
      const customer = await customerOf(request);
      const now = app.clock.now();
      const target = await prisma.order.findFirst({ where: { id, customerId: customer.id } });
      if (!target) throw notFound('Order');
      const codLimit = (await config.resolve('cod', await config.contextFor('BRANCH', target.branchId))).value
        .maxRefusedOrders;
      await changeOrder(app, {
        orderId: id,
        where: { customerId: customer.id },
        decide: (order, tx) =>
          cancelDecision(tx, order, {
            by: /** @type {const} */ ('CUSTOMER'),
            actorId: request.auth.userId,
            reasonCode: body.reasonCode,
            reasonText: body.reasonText ?? undefined,
            now,
            codLimit: order.paymentMethod === 'COD' ? codLimit : undefined,
          }),
      });
      return customerDetail(customer.id, id);
    },
  );

  // ── Restaurant Partner app ──────────────────────────────────────────────

  async function acceptWindow(restaurantId) {
    const s = await config.resolve(
      'orders.restaurantAcceptance',
      await config.contextFor('RESTAURANT', restaurantId),
    );
    return s.value.timeoutSec;
  }

  async function restaurantDetail(membership, id) {
    const o = await prisma.order.findFirst({
      where: { id, restaurantId: membership.restaurantId, ...LIVE },
      include: { ...ORDER_DETAIL_INCLUDE, customer: { include: { user: true } } },
    });
    if (!o) throw notFound('Order');
    const timeoutSec = await acceptWindow(membership.restaurantId);
    return restaurantOrderView(o, {
      finance: restaurantRoleCan(membership.role, 'orders.finance'),
      acceptBy: o.placedAt ? new Date(o.placedAt.getTime() + timeoutSec * 1000) : null,
    });
  }

  /** The partner order the caller may act on (membership + capability checked every time). */
  async function partnerOrder(request, id, capability) {
    const o = await prisma.order.findUnique({ where: { id }, select: { restaurantId: true } });
    if (!o) throw notFound('Order');
    return requireMember(request, o.restaurantId, capability);
  }

  app.get(
    '/v1/restaurant/orders',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(restaurantOrdersQuery, request.query);
      const membership = await requireMember(request, q.restaurantId, 'orders.view');
      const page = idPage(q);
      const rows = await prisma.order.findMany({
        where: { ...page.where, restaurantId: q.restaurantId, ...LIVE, ...KITCHEN_VIEWS[q.view] },
        orderBy: q.view === 'PAST' ? page.orderBy : { id: 'asc' }, // open orders oldest first
        take: q.view === 'PAST' ? page.take : 200,
        include: {
          items: { include: { addons: true } },
          pricingSnapshot: true,
          cancellation: true,
          customer: { include: { user: true } },
        },
      });
      const timeoutSec = await acceptWindow(q.restaurantId);
      const finance = restaurantRoleCan(membership.role, 'orders.finance');
      const view = (o) =>
        restaurantOrderView(o, {
          finance,
          acceptBy: o.placedAt ? new Date(o.placedAt.getTime() + timeoutSec * 1000) : null,
        });
      if (q.view !== 'PAST') return { items: rows.map(view), nextCursor: null };
      const result = toPage(rows, q.limit);
      return { ...result, items: result.items.map(view) };
    },
  );

  app.get(
    '/v1/restaurant/orders/:id',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const membership = await partnerOrder(request, id, 'orders.view');
      return restaurantDetail(membership, id);
    },
  );

  /**
   * One kitchen step by a restaurant user.
   * @param {string} path
   * @param {string} capability
   * @param {import('zod').ZodType<any>} schema
   * @param {string} event
   * @param {(body: any, membership: any) => object | Promise<object>} [inputOf]
   */
  function kitchenStep(path, capability, schema, event, inputOf = () => ({})) {
    app.post(
      `/v1/restaurant/orders/:id/${path}`,
      { config: PARTNER },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const { id } = parse(idParam, request.params);
        const body = parse(schema, request.body);
        const membership = await partnerOrder(request, id, capability);
        const input = await inputOf(body, membership);
        await changeOrder(app, {
          orderId: id,
          version: body.version,
          decide: async (order, tx) =>
            event === 'CANCEL'
              ? cancelDecision(tx, order, {
                  by: /** @type {const} */ ('RESTAURANT'),
                  actorId: request.auth.userId,
                  reasonCode: body.reasonCode,
                  reasonText: body.reasonText ?? undefined,
                  now: app.clock.now(),
                })
              : {
                  result: eventOn(order, event, {
                    actor: { type: 'RESTAURANT_USER', id: request.auth.userId },
                    now: app.clock.now(),
                    ...input,
                  }),
                  extra:
                    event === 'ACCEPT' || event === 'REJECT'
                      ? { needsAttention: false, attentionReason: null }
                      : {},
                  after:
                    event === 'REJECT' ? (tx2) => releaseCouponUsage(tx2, id, app.clock.now()) : undefined,
                },
        });
        return restaurantDetail(membership, id);
      },
    );
  }

  async function prepInput(body, membership) {
    const prep = await config.resolve(
      'orders.preparation',
      await config.contextFor('RESTAURANT', membership.restaurantId),
    );
    if (body.prepTimeMinutes > prep.value.maxPrepMinutes)
      throw invalid(`Preparation time can be at most ${prep.value.maxPrepMinutes} minutes.`, {
        prepTimeMinutes: [`At most ${prep.value.maxPrepMinutes}`],
      });
    return { prepTimeMinutes: body.prepTimeMinutes };
  }
  kitchenStep('accept', 'orders.handle', acceptOrderBody, 'ACCEPT', prepInput);
  kitchenStep('reject', 'orders.handle', rejectOrderBody, 'REJECT', (b) => ({
    reason: [b.reasonCode, b.reasonText].filter(Boolean).join(': '),
  }));
  kitchenStep('preparing', 'orders.handle', orderStepBody, 'START_PREPARING');
  kitchenStep('ready', 'orders.handle', orderStepBody, 'MARK_READY');
  kitchenStep('prep-time', 'orders.handle', prepTimeBody, 'UPDATE_PREP_TIME', prepInput);
  kitchenStep('cancel', 'orders.cancel', restaurantCancelBody, 'CANCEL');

  // The restaurant device has shown the new order (derives RESTAURANT_NOTIFIED). Safe to repeat.
  app.post(
    '/v1/restaurant/orders/:id/seen',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const membership = await partnerOrder(request, id, 'orders.view');
      const now = app.clock.now();
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id } });
        if (
          order.restaurantNotifiedAt ||
          order.restaurantStatus !== 'NEW' ||
          !['PLACED'].includes(order.status)
        )
          return;
        try {
          await applyResult(
            tx,
            order,
            eventOn(order, 'RESTAURANT_NOTIFIED', {
              actor: { type: 'RESTAURANT_USER', id: request.auth.userId },
              now,
            }),
            { now },
          );
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'CONFLICT')) throw asAppError(err);
        }
      });
      return restaurantDetail(membership, id);
    },
  );

  // ── Jamzo Admin ─────────────────────────────────────────────────────────

  app.get(
    '/v1/admin/orders',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(adminOrderListQuery, request.query);
      const cities = allowedCityIds(request, 'orders.view');
      if (q.cityId && cities && !cities.includes(q.cityId)) throw forbidden();
      const page = idPage(q);
      const statuses = q.status
        ? q.status
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
      const search = q.q?.trim();
      const rows = await prisma.order.findMany({
        where: {
          ...page.where,
          ...(cities
            ? { cityId: { in: q.cityId ? [q.cityId] : cities } }
            : q.cityId
              ? { cityId: q.cityId }
              : {}),
          ...(statuses ? { status: { in: /** @type {any} */ (statuses) } } : {}),
          ...(q.restaurantId ? { restaurantId: q.restaurantId } : {}),
          ...(q.paymentMethod ? { paymentMethod: q.paymentMethod } : {}),
          ...(q.needsAttention ? { needsAttention: q.needsAttention === 'true' } : {}),
          ...(q.from || q.to
            ? {
                createdAt: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lt: new Date(q.to) } : {}),
                },
              }
            : {}),
          ...(search
            ? {
                OR: [
                  { orderNumber: { contains: search.toUpperCase() } },
                  { restaurant: { name: { contains: search, mode: 'insensitive' } } },
                  { customer: { user: { name: { contains: search, mode: 'insensitive' } } } },
                ],
              }
            : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { restaurant: { include: { city: true } }, customer: { include: { user: true } } },
      });
      const result = toPage(rows, q.limit);
      return { ...result, items: result.items.map(adminOrderRow) };
    },
  );

  async function adminLoad(request, id, permission) {
    const o = await prisma.order.findUnique({
      where: { id },
      include: {
        ...ORDER_DETAIL_INCLUDE,
        customer: { include: { user: true } },
        notes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!o || !canInCity(request, permission, o.cityId)) throw notFound('Order');
    return o;
  }

  app.get(
    '/v1/admin/orders/:id',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const o = await adminLoad(request, id, 'orders.view');
      let cancelPreview = null;
      try {
        const rule = await cancellationRuleFor(prisma, o, app.clock.now());
        cancelPreview = { ruleId: rule.id, possible: canCancel(o, 'ADMIN', rule.params) };
      } catch {
        cancelPreview = { ruleId: null, possible: false };
      }
      return {
        ...adminOrderView(o, { maskPii: !canInCity(request, 'customers.pii', o.cityId) }),
        cancelPreview,
        permissions: {
          cancel: canInCity(request, 'orders.cancel', o.cityId),
          edit: canInCity(request, 'orders.edit', o.cityId),
        },
      };
    },
  );

  app.post(
    '/v1/admin/orders/:id/cancel',
    { config: { permission: 'orders.cancel' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(adminCancelBody, request.body);
      const before = await adminLoad(request, id, 'orders.cancel');
      const now = app.clock.now();
      await changeOrder(app, {
        orderId: id,
        version: body.version,
        decide: async (order, tx) => {
          const decided = await cancelDecision(tx, order, {
            by: 'ADMIN',
            actorId: request.auth.userId,
            reasonCode: body.reasonCode,
            reasonText: body.reasonText,
            riderIssue: body.riderIssue,
            override: body.override,
            now,
          });
          return {
            ...decided,
            extra: { needsAttention: false, attentionReason: null },
            after: async (tx2, updated) => {
              await decided.after(tx2, updated);
              await audit(tx2, request, {
                action: body.override ? 'order.cancel_override' : 'order.cancel',
                entityType: 'order',
                entityId: id,
                oldValue: { status: before.status },
                newValue: { status: updated.status, outcome: decided.result.outcome },
              });
            },
          };
        },
      });
      return adminDetailAfter(request, id);
    },
  );

  async function adminDetailAfter(request, id) {
    const o = await adminLoad(request, id, 'orders.view');
    return adminOrderView(o, { maskPii: !canInCity(request, 'customers.pii', o.cityId) });
  }

  app.post(
    '/v1/admin/orders/:id/notes',
    { config: { permission: 'orders.edit' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const body = parse(orderNoteBody, request.body);
      await adminLoad(request, id, 'orders.edit');
      const note = await prisma.$transaction(async (tx) => {
        const n = await tx.orderNote.create({
          data: {
            orderId: id,
            authorType: 'ADMIN',
            authorId: request.auth.userId,
            isInternal: true,
            body: body.body,
            createdAt: app.clock.now(),
          },
        });
        await audit(tx, request, {
          action: 'order.note',
          entityType: 'order',
          entityId: id,
          newValue: { noteId: n.id },
        });
        return n;
      });
      reply.code(201);
      return note;
    },
  );

  app.post(
    '/v1/admin/orders/:id/attention',
    { config: { permission: 'orders.edit' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(attentionBody, request.body);
      const o = await adminLoad(request, id, 'orders.edit');
      if (!o.needsAttention) throw new AppError('CONFLICT', 'This order is not flagged.');
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { needsAttention: false, attentionReason: null } });
        await tx.orderNote.create({
          data: {
            orderId: id,
            authorType: 'ADMIN',
            authorId: request.auth.userId,
            body: `Resolved: ${body.note}`,
            createdAt: app.clock.now(),
          },
        });
        await audit(tx, request, {
          action: 'order.attention_resolved',
          entityType: 'order',
          entityId: id,
          oldValue: { attentionReason: o.attentionReason },
          newValue: { note: body.note },
        });
      });
      return adminDetailAfter(request, id);
    },
  );
}
