// Notification templates (spec §41: admin-configurable where safe) and the signed-in user's own notifications.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { notificationTemplateBody, offerNotificationBody, pageQuery, uuid } from '@jamzo/validation';
import { enqueueEvent } from '../../core/outbox.js';
import { offerRecipients } from './offers.js';
import { notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { idPage, toPage } from '../../core/pagination.js';
import { unauthenticated } from '../../core/errors.js';

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function notificationRoutes(app) {
  const prisma = app.prisma;

  app.get(
    '/v1/admin/notification-templates',
    { config: { permission: 'notifications.manage' } },
    async () => ({
      items: await prisma.notificationTemplate.findMany({ orderBy: [{ event: 'asc' }, { appId: 'asc' }] }),
      placeholders: ['orderNumber', 'shortNumber', 'restaurantName', 'itemCount', 'prepTimeMinutes', 'total'],
    }),
  );

  // Offer notifications (D-116): count first (`send: false`), then send to the customers who opted in.
  app.post(
    '/v1/admin/offer-notifications',
    { config: { permission: 'notifications.manage', rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(offerNotificationBody, request.body);
      const userIds = await offerRecipients(prisma, { cityId: body.cityId ?? null });
      if (!body.send) return { recipients: userIds.length, sent: false };
      if (!userIds.length) return { recipients: 0, sent: false };
      await prisma.$transaction(async (tx) => {
        const ev = await enqueueEvent(tx, {
          aggregateType: 'offer',
          aggregateId: randomUUID(),
          eventType: 'offer.broadcast',
          payload: { title: body.title, body: body.body, url: body.url ?? null, userIds },
        });
        await audit(tx, request, {
          action: 'offer_notification.send',
          entityType: 'offer_notification',
          entityId: ev.id,
          newValue: {
            title: body.title,
            body: body.body,
            url: body.url ?? null,
            cityId: body.cityId ?? null,
            recipients: userIds.length,
          },
        });
      });
      return { recipients: userIds.length, sent: true };
    },
  );

  app.patch(
    '/v1/admin/notification-templates/:id',
    { config: { permission: 'notifications.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(z.object({ id: uuid }), request.params);
      const body = parse(notificationTemplateBody, request.body);
      return prisma.$transaction(async (tx) => {
        const before = await tx.notificationTemplate.findUnique({ where: { id } });
        if (!before) throw notFound('Template');
        const after = await tx.notificationTemplate.update({ where: { id }, data: body });
        await audit(tx, request, {
          action: 'notification_template.update',
          entityType: 'notification_template',
          entityId: id,
          oldValue: { title: before.title, body: before.body, isActive: before.isActive },
          newValue: body,
        });
        return after;
      });
    },
  );

  app.get(
    '/v1/me/notifications',
    {},
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      if (!request.auth) throw unauthenticated();
      const q = parse(pageQuery, request.query);
      const page = idPage(q);
      const rows = /** @type {any[]} */ (
        await prisma.notification.findMany({
          where: {
            ...page.where,
            userId: request.auth.userId,
            appId: /** @type {any} */ (request.client.appId),
          },
          orderBy: page.orderBy,
          take: page.take,
        })
      );
      const result = toPage(rows, q.limit);
      return {
        ...result,
        items: result.items.map((n) => ({
          id: n.id,
          event: n.event,
          title: n.title,
          body: n.body,
          data: n.data,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
      };
    },
  );
}
