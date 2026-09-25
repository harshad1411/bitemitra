import { auditQuery } from '@jamzo/validation';
import { audit } from '../../core/audit.js';
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

  // CSV of the filtered audit log (D-97), at most 10 000 rows; the export itself is audited.
  app.get(
    '/v1/admin/audit-logs/export.csv',
    { config: { permission: 'audit.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const q = parse(auditQuery, request.query);
      const rows = await app.prisma.auditLog.findMany({
        where: {
          ...(q.entityType ? { entityType: q.entityType } : {}),
          ...(q.entityId ? { entityId: q.entityId } : {}),
          ...(q.actorId ? { actorId: q.actorId } : {}),
          ...(q.action ? { action: { startsWith: q.action } } : {}),
          ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      });
      const actors = await actorsById(
        app.prisma,
        rows.map((r) => r.actorId),
      );
      const cell = (v) => {
        const t = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
        return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
      };
      const lines = [
        ['When (UTC)', 'Actor', 'Action', 'Entity', 'Entity id', 'Old value', 'New value', 'IP'],
        ...rows.map((r) => [
          r.createdAt.toISOString(),
          actors.get(r.actorId)?.name ?? actors.get(r.actorId)?.email ?? r.actorType,
          r.action,
          r.entityType,
          r.entityId,
          r.oldValue,
          r.newValue,
          r.ipAddress,
        ]),
      ];
      await audit(app.prisma, request, {
        action: 'audit.export',
        entityType: 'audit_log',
        entityId: '00000000-0000-0000-0000-000000000000',
        newValue: { rows: rows.length, filters: q },
      });
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="jamzo-audit-log.csv"');
      return lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
    },
  );
}
