import { auditQuery } from '@jamzo/validation';
import { parse } from '../../core/validate.js';
import { idPage, toPage } from '../../core/pagination.js';
import { actorsById } from '../configuration/routes.js';

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function auditRoutes(app) {
  app.get(
    '/v1/admin/audit-logs',
    { config: { permission: 'audit.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(auditQuery, request.query);
      const page = idPage(q);
      const rows = await app.prisma.auditLog.findMany({
        where: {
          ...page.where,
          ...(q.entityType ? { entityType: q.entityType } : {}),
          ...(q.entityId ? { entityId: q.entityId } : {}),
          ...(q.actorId ? { actorId: q.actorId } : {}),
          ...(q.action ? { action: { startsWith: q.action } } : {}),
          ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
      });
      const actors = await actorsById(
        app.prisma,
        rows.map((r) => r.actorId),
      );
      return toPage(
        rows.map((r) => ({ ...r, actor: actors.get(r.actorId) ?? null })),
        q.limit,
      );
    },
  );
}
