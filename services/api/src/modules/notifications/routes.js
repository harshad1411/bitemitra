// Notification templates (spec §41: admin-configurable where safe) and the signed-in user's own notifications.
import { z } from 'zod';
import { notificationTemplateBody, pageQuery, uuid } from '@jamzo/validation';
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
