// Saved table views (spec §29, D-94): a named set of filters, private to its admin or shared with every admin
// who can see that table. Only filters are stored — what each admin sees is still limited by their permissions.
import { z } from 'zod';
import { savedViewBody, uuid } from '@jamzo/validation';
import { forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';

const RESOURCE_PERMISSION = { orders: 'orders.view' };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function savedViewRoutes(app) {
  const prisma = app.prisma;
  const adminId = async (request) =>
    (await prisma.adminUser.findUniqueOrThrow({ where: { userId: request.auth.userId } })).id;
  const view = (v, me) => ({
    id: v.id,
    resource: v.resource,
    name: v.name,
    query: v.query,
    isShared: v.isShared,
    mine: v.adminUserId === me,
    updatedAt: v.updatedAt,
  });

  app.get(
    '/v1/admin/saved-views',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { resource } = parse(z.object({ resource: z.enum(['orders']) }), request.query);
      const me = await adminId(request);
      const rows = await prisma.adminSavedView.findMany({
        where: { resource, OR: [{ adminUserId: me }, { isShared: true }] },
        orderBy: { name: 'asc' },
      });
      return { items: rows.map((v) => view(v, me)) };
    },
  );

  app.post(
    '/v1/admin/saved-views',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(savedViewBody, request.body);
      if (
        !request.auth.admin.global.has(RESOURCE_PERMISSION[body.resource]) &&
        ![...request.auth.admin.byCity.values()].some((p) => p.has(RESOURCE_PERMISSION[body.resource]))
      )
        throw forbidden();
      const me = await adminId(request);
      const v = await prisma.adminSavedView.create({ data: { ...body, adminUserId: me } });
      reply.code(201);
      return view(v, me);
    },
  );

  app.delete(
    '/v1/admin/saved-views/:id',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(z.object({ id: uuid }), request.params);
      const me = await adminId(request);
      const v = await prisma.adminSavedView.findUnique({ where: { id } });
      if (!v || (v.adminUserId !== me && !v.isShared)) throw notFound('View');
      if (v.adminUserId !== me) throw forbidden('Only the admin who saved a view can delete it.');
      await prisma.adminSavedView.delete({ where: { id } });
      reply.code(204);
      return null;
    },
  );
}
