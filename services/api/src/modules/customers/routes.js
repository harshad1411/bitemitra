// Customers in Jamzo Admin (spec §28 "Customers", RBAC §2, DECISIONS D-57). Contact details are masked by
// default; seeing them in full needs customers.pii and is audit-logged every time.
import { z } from 'zod';
import { normalizeIndianMobile, pageQuery, uuid } from '@jamzo/validation';
import { maskEmail, maskPhone } from '@jamzo/logger';
import { notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { idPage, toPage } from '../../core/pagination.js';

const maskLine = (s) => (s ? `${s.slice(0, 3)}•••` : null);

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function customersRoutes(app) {
  const prisma = app.prisma;

  app.get(
    '/v1/admin/customers',
    { config: { permission: 'customers.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(pageQuery, request.query);
      const page = idPage(q);
      // Search by exact phone (normalised) or by name — never a partial phone scan.
      const phone = q.q ? normalizeIndianMobile(q.q) : null;
      const rows = await prisma.customer.findMany({
        where: {
          ...page.where,
          ...(q.q ? { user: phone ? { phone } : { name: { contains: q.q, mode: 'insensitive' } } } : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: { user: true, _count: { select: { addresses: { where: { deletedAt: null } } } } },
      });
      return toPage(
        rows.map((c) => ({
          id: c.id,
          name: c.user.name,
          phoneMasked: c.user.phone ? maskPhone(c.user.phone) : null,
          emailMasked: c.user.email ? maskEmail(c.user.email) : null,
          status: c.user.status,
          codDisabled: c.codDisabled,
          addressCount: c._count.addresses,
          createdAt: c.createdAt,
        })),
        q.limit,
      );
    },
  );

  const load = async (id) => {
    const c = await prisma.customer.findUnique({
      where: { id },
      include: {
        user: { include: { consents: { orderBy: { createdAt: 'desc' }, take: 20 } } },
        addresses: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        favorites: { include: { restaurant: true } },
        orders: { orderBy: { createdAt: 'desc' }, take: 10, include: { restaurant: true } },
      },
    });
    if (!c) throw notFound('Customer');
    return c;
  };

  const detail = (c, reveal) => ({
    id: c.id,
    name: c.user.name,
    phone: reveal ? c.user.phone : null,
    phoneMasked: c.user.phone ? maskPhone(c.user.phone) : null,
    email: reveal ? c.user.email : null,
    emailMasked: c.user.email ? maskEmail(c.user.email) : null,
    status: c.user.status,
    codDisabled: c.codDisabled,
    createdAt: c.createdAt,
    revealed: reveal,
    addresses: c.addresses.map((a) => ({
      id: a.id,
      label: a.label,
      line1: reveal ? a.line1 : maskLine(a.line1),
      area: a.area,
      cityName: a.cityName,
      pincode: a.pincode,
      serviceable: Boolean(a.zoneId),
      isDefault: a.id === c.defaultAddressId,
    })),
    favorites: c.favorites.map((f) => ({ id: f.restaurant.id, name: f.restaurant.name })),
    consents: c.user.consents.map((r) => ({
      kind: r.kind,
      version: r.version,
      granted: r.granted,
      createdAt: r.createdAt,
    })),
    orders: {
      available: true,
      recent: c.orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        restaurantName: o.restaurant.name,
        totalPayablePaise: o.totalPayablePaise,
        createdAt: o.createdAt,
      })),
    },
  });

  app.get(
    '/v1/admin/customers/:id',
    { config: { permission: 'customers.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(z.object({ id: uuid }), request.params);
      return detail(await load(id), false);
    },
  );

  app.post(
    '/v1/admin/customers/:id/reveal',
    { config: { permission: ['customers.view', 'customers.pii'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(z.object({ id: uuid }), request.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), request.body);
      const c = await load(id);
      await audit(prisma, request, {
        action: 'customer.reveal_pii',
        entityType: 'customer',
        entityId: id,
        newValue: { reason },
      });
      return detail(c, true);
    },
  );
}
