// Customer support (D-93, spec §47): customers raise tickets from an order ("Get help") or without one and
// talk to Jamzo support; agents reply, add internal notes, assign and resolve with the full order at hand.
import { z } from 'zod';
import {
  SUPPORT_ISSUE_TYPES,
  createTicketBody,
  ticketListQuery,
  ticketMessageBody,
  ticketUpdateBody,
  uuid,
} from '@jamzo/validation';
import { isUniqueViolation } from '@jamzo/database';
import { maskPhone } from '@jamzo/logger';
import { AppError, notFound, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { enqueueEvent } from '../../core/outbox.js';
import { idPage, toPage } from '../../core/pagination.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';

const idParam = z.object({ id: uuid });
const CUSTOMER = { apps: ['CUSTOMER'] };
const ISSUE_LABEL = {
  MISSING_ITEM: 'Missing item',
  WRONG_ITEM: 'Wrong item',
  FOOD_QUALITY: 'Food quality',
  LATE_DELIVERY: 'Late delivery',
  RIDER_ISSUE: 'Delivery partner',
  RESTAURANT_ISSUE: 'Restaurant',
  PAYMENT_ISSUE: 'Payment',
  REFUND_ISSUE: 'Refund',
  OTHER: 'Something else',
};
const DONE = ['RESOLVED', 'CLOSED'];

/** Messages as the customer sees them: never internal notes, never who the agent is. */
const customerTicketView = (t) => ({
  id: t.id,
  ticketNumber: t.ticketNumber,
  orderId: t.orderId,
  orderNumber: t.order?.orderNumber ?? null,
  issueType: t.issueType,
  subject: t.subject,
  status: t.status,
  resolution: t.resolution,
  createdAt: t.createdAt,
  lastMessageAt: t.lastMessageAt,
  messages: (t.messages ?? [])
    .filter((m) => !m.isInternal)
    .map((m) => ({
      id: m.id,
      from: m.authorType === 'CUSTOMER' ? 'YOU' : 'JAMZO',
      body: m.body,
      createdAt: m.createdAt,
    })),
});

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function supportRoutes(app) {
  const prisma = app.prisma;

  async function customerOf(request) {
    if (!request.auth) throw unauthenticated();
    return prisma.customer.upsert({
      where: { userId: request.auth.userId },
      create: { userId: request.auth.userId },
      update: {},
    });
  }

  /** SUP-YYMMDD-NNNNN: the day's next number (India date); a clash retries with the next one. */
  async function nextNumber(tx, now) {
    const ist = new Date(now.getTime() + 5.5 * 3_600_000);
    const day = ist.toISOString().slice(2, 10).replaceAll('-', '');
    const count = await tx.supportTicket.count({ where: { ticketNumber: { startsWith: `SUP-${day}-` } } });
    return `SUP-${day}-${String(count + 1).padStart(5, '0')}`;
  }

  // ── Customer app ─────────────────────────────────────────────────────────
  app.post(
    '/v1/customer/support/tickets',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(createTicketBody, request.body);
      const customer = await customerOf(request);
      const order = body.orderId
        ? await prisma.order.findFirst({ where: { id: body.orderId, customerId: customer.id } })
        : null;
      if (body.orderId && !order) throw notFound('Order');
      const now = app.clock.now();
      // A repeated "Get help" for the same order and issue continues the open ticket.
      const open = order
        ? await prisma.supportTicket.findFirst({
            where: { orderId: order.id, issueType: body.issueType, status: { notIn: DONE } },
          })
        : null;
      if (open) {
        await prisma.$transaction([
          prisma.supportTicketMessage.create({
            data: {
              ticketId: open.id,
              authorType: 'CUSTOMER',
              authorId: request.auth.userId,
              body: body.message,
              createdAt: now,
            },
          }),
          prisma.supportTicket.update({ where: { id: open.id }, data: { lastMessageAt: now } }),
        ]);
        reply.code(200);
        return customerTicket(customer.id, open.id);
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const t = await prisma.$transaction(async (tx) =>
            tx.supportTicket.create({
              data: {
                ticketNumber: await nextNumber(tx, now),
                customerId: customer.id,
                orderId: order?.id ?? null,
                cityId: order?.cityId ?? null,
                raisedByType: 'CUSTOMER',
                raisedById: request.auth.userId,
                issueType: body.issueType,
                subject: `${ISSUE_LABEL[body.issueType]}${order ? ` · ${order.orderNumber}` : ''}`,
                description: body.message,
                lastMessageAt: now,
                createdAt: now,
                messages: {
                  create: {
                    authorType: 'CUSTOMER',
                    authorId: request.auth.userId,
                    body: body.message,
                    createdAt: now,
                  },
                },
              },
            }),
          );
          reply.code(201);
          return customerTicket(customer.id, t.id);
        } catch (err) {
          if (!isUniqueViolation(err) || attempt === 2) throw err;
        }
      }
    },
  );

  async function customerTicket(customerId, id) {
    const t = await prisma.supportTicket.findFirst({
      where: { id, customerId },
      include: { order: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw notFound('Ticket');
    return customerTicketView(t);
  }

  app.get(
    '/v1/customer/support/tickets',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const customer = await customerOf(request);
      const rows = await prisma.supportTicket.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { order: true },
      });
      return { items: rows.map((t) => ({ ...customerTicketView(t), messages: undefined })) };
    },
  );

  app.get(
    '/v1/customer/support/tickets/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      return customerTicket((await customerOf(request)).id, id);
    },
  );

  app.post(
    '/v1/customer/support/tickets/:id/messages',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(z.object({ body: z.string().trim().min(1).max(2000) }), request.body);
      const customer = await customerOf(request);
      const t = await prisma.supportTicket.findFirst({ where: { id, customerId: customer.id } });
      if (!t) throw notFound('Ticket');
      if (t.status === 'CLOSED')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'This conversation is closed. Start a new one from the order.',
        );
      const now = app.clock.now();
      await prisma.$transaction([
        prisma.supportTicketMessage.create({
          data: {
            ticketId: t.id,
            authorType: 'CUSTOMER',
            authorId: request.auth.userId,
            body: body.body,
            createdAt: now,
          },
        }),
        // A customer writing again reopens a resolved ticket (D-93).
        prisma.supportTicket.update({
          where: { id: t.id },
          data: {
            lastMessageAt: now,
            ...(t.status === 'RESOLVED' || t.status === 'WAITING_ON_CUSTOMER'
              ? { status: 'OPEN', resolvedAt: null, resolution: null }
              : {}),
          },
        }),
      ]);
      return customerTicket(customer.id, t.id);
    },
  );

  // ── Jamzo Admin ──────────────────────────────────────────────────────────
  const scope = (request) => {
    const cities = allowedCityIds(request, 'support.manage');
    return cities ? { cityId: { in: cities } } : {};
  };

  app.get(
    '/v1/admin/support/tickets',
    { config: { permission: 'support.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(ticketListQuery, request.query);
      const page = idPage(q);
      const statuses = q.status?.split(',').filter(Boolean);
      const rows = await prisma.supportTicket.findMany({
        where: {
          ...page.where,
          ...scope(request),
          ...(statuses?.length ? { status: { in: /** @type {any} */ (statuses) } } : {}),
          ...(q.issueType ? { issueType: q.issueType } : {}),
          ...(q.mine === 'true' ? { assignedToId: request.auth.userId } : {}),
          ...(q.q
            ? {
                OR: [
                  { ticketNumber: { contains: q.q.toUpperCase() } },
                  { order: { orderNumber: { contains: q.q.toUpperCase() } } },
                  { customer: { user: { name: { contains: q.q, mode: 'insensitive' } } } },
                ],
              }
            : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { order: true, customer: { include: { user: true } } },
      });
      const r = toPage(rows, q.limit);
      return {
        ...r,
        items: r.items.map((/** @type {any} */ t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          issueType: t.issueType,
          subject: t.subject,
          status: t.status,
          orderId: t.orderId,
          orderNumber: t.order?.orderNumber ?? null,
          customerName: t.customer?.user?.name ?? null,
          assignedToId: t.assignedToId,
          assignedToMe: t.assignedToId === request.auth.userId,
          createdAt: t.createdAt,
          lastMessageAt: t.lastMessageAt,
          firstResponseAt: t.firstResponseAt,
        })),
      };
    },
  );

  async function adminTicket(request, id) {
    const t = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        order: true,
        customer: { include: { user: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t || !canInCity(request, 'support.manage', t.cityId)) throw notFound('Ticket');
    return t;
  }

  app.get(
    '/v1/admin/support/tickets/:id',
    { config: { permission: 'support.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const t = await adminTicket(request, id);
      const pii = canInCity(request, 'customers.pii', t.cityId);
      const authors = await prisma.user.findMany({
        where: {
          id: { in: [...new Set([t.assignedToId, ...t.messages.map((m) => m.authorId)].filter(Boolean))] },
        },
        select: { id: true, name: true, email: true },
      });
      const who = new Map(authors.map((u) => [u.id, u.name ?? u.email]));
      const admins = await prisma.adminUser.findMany({ include: { user: true }, take: 100 });
      return {
        id: t.id,
        ticketNumber: t.ticketNumber,
        issueType: t.issueType,
        subject: t.subject,
        description: t.description,
        status: t.status,
        resolution: t.resolution,
        orderId: t.orderId,
        orderNumber: t.order?.orderNumber ?? null,
        customer: t.customer && {
          id: t.customer.id,
          name: t.customer.user.name,
          phone: pii ? t.customer.user.phone : maskPhone(t.customer.user.phone),
        },
        assignedToId: t.assignedToId,
        assignedToName: t.assignedToId ? who.get(t.assignedToId) : null,
        agents: admins.map((a) => ({ id: a.userId, name: a.user.name ?? a.user.email })),
        createdAt: t.createdAt,
        firstResponseAt: t.firstResponseAt,
        resolvedAt: t.resolvedAt,
        messages: t.messages.map((m) => ({
          id: m.id,
          authorType: m.authorType,
          authorName:
            m.authorType === 'CUSTOMER'
              ? (t.customer?.user.name ?? 'Customer')
              : (who.get(m.authorId) ?? 'Jamzo'),
          body: m.body,
          internal: m.isInternal,
          createdAt: m.createdAt,
        })),
      };
    },
  );

  app.post(
    '/v1/admin/support/tickets/:id/messages',
    { config: { permission: 'support.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(ticketMessageBody, request.body);
      const t = await adminTicket(request, id);
      if (t.status === 'CLOSED') throw new AppError('INVALID_STATE_TRANSITION', 'This ticket is closed.');
      const now = app.clock.now();
      await prisma.$transaction(async (tx) => {
        await tx.supportTicketMessage.create({
          data: {
            ticketId: t.id,
            authorType: 'ADMIN',
            authorId: request.auth.userId,
            body: body.body,
            isInternal: body.internal,
            createdAt: now,
          },
        });
        if (body.internal) return;
        await tx.supportTicket.update({
          where: { id: t.id },
          data: {
            lastMessageAt: now,
            firstResponseAt: t.firstResponseAt ?? now,
            assignedToId: t.assignedToId ?? request.auth.userId,
            ...(DONE.includes(t.status) ? {} : { status: 'WAITING_ON_CUSTOMER' }),
          },
        });
        await enqueueEvent(tx, {
          aggregateType: 'SUPPORT_TICKET',
          aggregateId: t.id,
          eventType: 'support.replied',
          payload: {
            ticketId: t.id,
            ticketNumber: t.ticketNumber,
            orderId: t.orderId,
            customerId: t.customerId,
          },
        });
      });
      return { ok: true };
    },
  );

  app.patch(
    '/v1/admin/support/tickets/:id',
    { config: { permission: 'support.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(ticketUpdateBody, request.body);
      const t = await adminTicket(request, id);
      if (body.assignedToId) {
        const a = await prisma.adminUser.findUnique({ where: { userId: body.assignedToId } });
        if (!a) throw new AppError('VALIDATION_FAILED', 'Choose a Jamzo admin.');
      }
      const now = app.clock.now();
      const resolving = body.status && DONE.includes(body.status);
      const updated = await prisma.supportTicket.update({
        where: { id: t.id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
          ...(resolving
            ? { resolution: body.resolution ?? t.resolution, resolvedAt: t.resolvedAt ?? now }
            : {}),
          ...(body.status && !DONE.includes(body.status) ? { resolvedAt: null } : {}),
        },
      });
      await audit(prisma, request, {
        action: 'support.update',
        entityType: 'support_ticket',
        entityId: t.id,
        oldValue: { status: t.status, assignedToId: t.assignedToId },
        newValue: {
          status: updated.status,
          assignedToId: updated.assignedToId,
          resolution: updated.resolution,
        },
      });
      return {
        id: updated.id,
        status: updated.status,
        assignedToId: updated.assignedToId,
        resolution: updated.resolution,
      };
    },
  );

  // Known issue types, for the apps' pickers.
  app.get('/v1/support/issue-types', { config: { auth: 'none' } }, async () => ({
    items: SUPPORT_ISSUE_TYPES.map((code) => ({ code, label: ISSUE_LABEL[code] })),
  }));
}
