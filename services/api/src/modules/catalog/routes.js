// Catalog administration (RESTAURANTS.md, spec §31): platform food categories, restaurant menu sections,
// products with variants / add-ons / images / schedules, sold-out handling and bulk actions.
import { z } from 'zod';
import {
  availabilityBody,
  categoryCreateBody,
  categoryUpdateBody,
  idOrderBody,
  menuCategoryCreateBody,
  menuCategoryUpdateBody,
  productBulkBody,
  productCreateBody,
  productListQuery,
  productUpdateBody,
  uuid,
} from '@jamzo/validation';
import { isUniqueViolation } from '@jamzo/database';
import { conflict, forbidden, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { namePage, toPage } from '../../core/pagination.js';
import { withIdempotency } from '../../core/idempotency.js';
import { mediaBase as mediaBaseOf } from '../media/urls.js';
import { loadRestaurantForAdmin } from '../restaurants/service.js';
import {
  applyAvailability,
  checkProductWrite,
  currentWindowsWhere,
  loadMenu,
  productDto,
  productInclude,
  productSummary,
  writeProduct,
} from './service.js';

const idParam = z.object({ id: uuid });

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function catalogRoutes(app) {
  const prisma = app.prisma;
  const mediaBase = mediaBaseOf(app.services.env);

  const unique = async (promise, message) => {
    try {
      return await promise;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(message);
      throw err;
    }
  };

  /** Product with its restaurant and city, after the city-scope check. */
  async function loadProduct(request, db, id, permission) {
    const product = await db.product.findUnique({
      where: { id },
      include: { restaurant: { include: { city: true } } },
    });
    if (!product) throw notFound('Product');
    if (!canInCity(request, permission, product.restaurant.cityId))
      throw forbidden('You do not have access to restaurants in this city.');
    return product;
  }

  const fullProduct = async (id) => {
    const now = app.clock.now();
    const p = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { ...productInclude(now), restaurant: { include: { city: true } } },
    });
    return {
      ...productDto(p, { now, timeZone: p.restaurant.city.timezone, mediaBase }),
      restaurant: {
        id: p.restaurant.id,
        name: p.restaurant.name,
        isPureVeg: p.restaurant.isPureVeg,
        onboardingStatus: p.restaurant.onboardingStatus,
      },
    };
  };

  const productAuditSummary = (p) =>
    p && {
      name: p.name,
      basePricePaise: p.basePricePaise,
      status: p.status,
      isAvailable: p.isAvailable,
      foodType: p.foodType,
      menuCategoryId: p.menuCategoryId,
      version: p.version,
      variants: p.variants?.map((v) => `${v.name}:${v.basePricePaise}`),
      addonGroups: p.addonGroups?.map((g) => `${g.name}(${g.addons?.length ?? 0})`),
    };

  // ── Platform food categories ──
  app.get('/v1/admin/categories', { config: { permission: 'restaurants.view' } }, async () => {
    const rows = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return { items: rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products })) };
  });

  app.post(
    '/v1/admin/categories',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(categoryCreateBody, request.body);
      if (
        body.iconMediaId &&
        !(await prisma.media.findFirst({ where: { id: body.iconMediaId, kind: 'IMAGE', deletedAt: null } }))
      )
        throw invalid('Choose an image from the media library.', { iconMediaId: ['Unknown image'] });
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const c = await unique(
            tx.category.create({ data: body }),
            'A category with this slug already exists.',
          );
          await audit(tx, request, {
            action: 'category.create',
            entityType: 'category',
            entityId: c.id,
            newValue: c,
          });
          return c;
        }),
      );
    },
  );

  app.patch(
    '/v1/admin/categories/:id',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(categoryUpdateBody, request.body);
      if (
        body.iconMediaId &&
        !(await prisma.media.findFirst({ where: { id: body.iconMediaId, kind: 'IMAGE', deletedAt: null } }))
      )
        throw invalid('Choose an image from the media library.', { iconMediaId: ['Unknown image'] });
      return prisma.$transaction(async (tx) => {
        const before = await tx.category.findUnique({ where: { id } });
        if (!before) throw notFound('Category');
        const after = await unique(
          tx.category.update({ where: { id }, data: body }),
          'A category with this slug already exists.',
        );
        await audit(tx, request, {
          action: 'category.update',
          entityType: 'category',
          entityId: id,
          oldValue: before,
          newValue: after,
        });
        return after;
      });
    },
  );

  // ── Menu of a restaurant ──
  app.get(
    '/v1/admin/restaurants/:id/menu',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const q = parse(z.object({ includeArchived: z.enum(['true', 'false']).optional() }), request.query);
      const r = await loadRestaurantForAdmin(request, prisma, id, 'restaurants.view', { city: true });
      const menu = await loadMenu(prisma, id, {
        now: app.clock.now(),
        timeZone: r.city.timezone,
        mediaBase,
        includeArchived: q.includeArchived === 'true',
      });
      return {
        restaurant: { id: r.id, name: r.name, isPureVeg: r.isPureVeg, onboardingStatus: r.onboardingStatus },
        ...menu,
      };
    },
  );

  app.post(
    '/v1/admin/restaurants/:id/menu-categories',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const body = parse(menuCategoryCreateBody, request.body);
      await loadRestaurantForAdmin(request, prisma, id, 'products.manage');
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const last = await tx.menuCategory.findFirst({
            where: { restaurantId: id },
            orderBy: { sortOrder: 'desc' },
          });
          const section = await unique(
            tx.menuCategory.create({
              data: { ...body, restaurantId: id, sortOrder: (last?.sortOrder ?? -1) + 1 },
            }),
            'This menu already has a section with that name.',
          );
          await audit(tx, request, {
            action: 'menu_category.create',
            entityType: 'restaurant',
            entityId: id,
            newValue: section,
          });
          return section;
        }),
      );
    },
  );

  async function loadSection(request, db, id) {
    const section = await db.menuCategory.findUnique({ where: { id }, include: { restaurant: true } });
    if (!section) throw notFound('Menu section');
    if (!canInCity(request, 'products.manage', section.restaurant.cityId)) throw forbidden();
    return section;
  }

  app.patch(
    '/v1/admin/menu-categories/:id',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(menuCategoryUpdateBody, request.body);
      return prisma.$transaction(async (tx) => {
        const { restaurant: _r, ...before } = await loadSection(request, tx, id);
        const after = await unique(
          tx.menuCategory.update({ where: { id }, data: body }),
          'This menu already has a section with that name.',
        );
        await audit(tx, request, {
          action: 'menu_category.update',
          entityType: 'restaurant',
          entityId: before.restaurantId,
          oldValue: before,
          newValue: after,
        });
        return after;
      });
    },
  );

  app.delete(
    '/v1/admin/menu-categories/:id',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      await prisma.$transaction(async (tx) => {
        const section = await loadSection(request, tx, id);
        const live = await tx.product.count({ where: { menuCategoryId: id, status: { not: 'ARCHIVED' } } });
        if (live) throw conflict(`Move or archive the ${live} product(s) in this section first.`);
        await tx.product.updateMany({ where: { menuCategoryId: id }, data: { menuCategoryId: null } });
        await tx.menuCategory.delete({ where: { id } });
        await audit(tx, request, {
          action: 'menu_category.delete',
          entityType: 'restaurant',
          entityId: section.restaurantId,
          oldValue: { id, name: section.name },
        });
      });
      reply.code(204);
      return null;
    },
  );

  app.put(
    '/v1/admin/restaurants/:id/menu-categories/order',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const { ids } = parse(idOrderBody, request.body);
      await loadRestaurantForAdmin(request, prisma, id, 'products.manage');
      await prisma.$transaction(async (tx) => {
        const sections = await tx.menuCategory.findMany({
          where: { restaurantId: id },
          select: { id: true },
        });
        const own = new Set(sections.map((s) => s.id));
        if (ids.length !== own.size || !ids.every((s) => own.has(s)))
          throw invalid('Send every section of this menu exactly once.', { ids: ['Must list all sections'] });
        for (const [sortOrder, sectionId] of ids.entries())
          await tx.menuCategory.update({ where: { id: sectionId }, data: { sortOrder } });
        await audit(tx, request, {
          action: 'menu_category.reorder',
          entityType: 'restaurant',
          entityId: id,
          newValue: ids,
        });
      });
      return { ok: true };
    },
  );

  // ── Products ──
  app.get(
    '/v1/admin/products',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(productListQuery, request.query);
      const allowed = allowedCityIds(request, 'restaurants.view');
      const now = app.clock.now();
      const soldOutNow = { isAvailable: false, startsAt: { lte: now }, ...currentWindowsWhere(now) };
      const page = namePage(q);
      const rows = await prisma.product.findMany({
        where: {
          AND: [
            page.where,
            allowed ? { restaurant: { cityId: { in: allowed } } } : {},
            q.cityId ? { restaurant: { cityId: q.cityId } } : {},
            q.restaurantId ? { restaurantId: q.restaurantId } : {},
            q.menuCategoryId ? { menuCategoryId: q.menuCategoryId } : {},
            q.categoryId ? { categoryId: q.categoryId } : {},
            q.foodType ? { foodType: q.foodType } : {},
            q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } },
            // Filter covers the sold-out switch and dated sold-out windows; schedules are shown per row.
            q.available === 'true' ? { isAvailable: true, availability: { none: soldOutNow } } : {},
            q.available === 'false'
              ? { OR: [{ isAvailable: false }, { availability: { some: soldOutNow } }] }
              : {},
            q.q
              ? {
                  OR: [
                    { name: { contains: q.q, mode: 'insensitive' } },
                    { searchText: { contains: q.q.toLowerCase() } },
                    { restaurant: { name: { contains: q.q, mode: 'insensitive' } } },
                  ],
                }
              : {},
          ],
        },
        orderBy: page.orderBy,
        take: page.take,
        include: {
          restaurant: { include: { city: { select: { id: true, name: true, timezone: true } } } },
          menuCategory: { select: { id: true, name: true } },
          variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          images: { orderBy: { sortOrder: 'asc' }, take: 1, include: { media: true } },
          availability: { where: currentWindowsWhere(now) },
          schedules: true,
        },
      });
      return toPage(
        rows.map((p) => ({
          ...productSummary(
            { ...p, addonGroups: [] },
            { now, timeZone: p.restaurant.city.timezone, mediaBase },
          ),
          restaurant: {
            id: p.restaurant.id,
            name: p.restaurant.name,
            city: { id: p.restaurant.city.id, name: p.restaurant.city.name },
          },
          menuCategory: p.menuCategory,
        })),
        q.limit,
        'name',
      );
    },
  );

  app.post(
    '/v1/admin/products',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(productCreateBody, request.body);
      const restaurant = await loadRestaurantForAdmin(request, prisma, body.restaurantId, 'products.manage');
      return withIdempotency(request, reply, { successStatus: 201 }, async () => {
        const id = await prisma.$transaction(async (tx) => {
          const data = await checkProductWrite(tx, body, restaurant, null);
          const productId = await writeProduct(tx, { restaurantId: restaurant.id, data });
          const created = await tx.product.findUnique({
            where: { id: productId },
            include: { variants: true, addonGroups: { include: { addons: true } } },
          });
          await audit(tx, request, {
            action: 'product.create',
            entityType: 'product',
            entityId: productId,
            newValue: productAuditSummary(created),
          });
          return productId;
        });
        return fullProduct(id);
      });
    },
  );

  app.get(
    '/v1/admin/products/:id',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      await loadProduct(request, prisma, id, 'restaurants.view');
      return fullProduct(id);
    },
  );

  app.put(
    '/v1/admin/products/:id',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(productUpdateBody, request.body);
      await prisma.$transaction(async (tx) => {
        const product = await loadProduct(request, tx, id, 'products.manage');
        const existing = await tx.product.findUnique({
          where: { id },
          include: { variants: true, addonGroups: { include: { addons: true } } },
        });
        const data = await checkProductWrite(tx, body, product.restaurant, existing);
        await writeProduct(tx, {
          restaurantId: product.restaurantId,
          productId: id,
          expectedVersion: body.version,
          data,
        });
        const after = await tx.product.findUnique({
          where: { id },
          include: { variants: true, addonGroups: { include: { addons: true } } },
        });
        await audit(tx, request, {
          action: 'product.update',
          entityType: 'product',
          entityId: id,
          oldValue: productAuditSummary(existing),
          newValue: productAuditSummary(after),
        });
      });
      return fullProduct(id);
    },
  );

  app.post(
    '/v1/admin/products/:id/availability',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(availabilityBody, request.body);
      await prisma.$transaction(async (tx) => {
        const product = await loadProduct(request, tx, id, 'products.manage');
        const change = await applyAvailability(tx, product, body, {
          now: app.clock.now(),
          timeZone: product.restaurant.city.timezone,
        });
        await audit(tx, request, {
          action: 'product.availability',
          entityType: 'product',
          entityId: id,
          oldValue: { target: change.target, ...change.before },
          newValue: { target: change.target, ...change.after, reason: body.reason ?? null },
        });
      });
      return fullProduct(id);
    },
  );

  // All-or-nothing bulk actions (D-43).
  app.post(
    '/v1/admin/products/bulk',
    { config: { permission: 'products.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(productBulkBody, request.body);
      const ids = [...new Set(body.ids)];
      const now = app.clock.now();
      return prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: { id: { in: ids } },
          include: { restaurant: true },
        });
        if (products.length !== ids.length) throw notFound('One or more products');
        if (products.some((p) => !canInCity(request, 'products.manage', p.restaurant.cityId)))
          throw forbidden('Some products belong to restaurants outside your cities.');
        if (body.action === 'MOVE_SECTION' && body.menuCategoryId) {
          const section = await tx.menuCategory.findUnique({ where: { id: body.menuCategoryId } });
          if (!section || products.some((p) => p.restaurantId !== section.restaurantId))
            throw invalid('All products must belong to the section’s restaurant.', {
              menuCategoryId: ['Different restaurant'],
            });
        }
        if (body.action === 'ACTIVATE') {
          const pure = products.filter(
            (p) => p.restaurant.isPureVeg && !['VEG', 'VEGAN'].includes(p.foodType),
          );
          if (pure.length)
            throw invalid('Some products are not veg but belong to a pure-veg restaurant.', {
              ids: pure.map((p) => p.id),
            });
        }
        /** @type {any} */
        const data = {
          SOLD_OUT: { isAvailable: false },
          AVAILABLE: { isAvailable: true },
          ACTIVATE: { status: 'ACTIVE' },
          DRAFT: { status: 'DRAFT' },
          ARCHIVE: { status: 'ARCHIVED' },
          MOVE_SECTION: { menuCategoryId: body.menuCategoryId ?? null },
        }[body.action];
        if (body.action === 'AVAILABLE') {
          await tx.productAvailability.updateMany({
            where: {
              productId: { in: ids },
              isAvailable: false,
              startsAt: { lte: now },
              ...currentWindowsWhere(now),
            },
            data: { endsAt: now },
          });
        }
        await tx.product.updateMany({
          where: { id: { in: ids } },
          data: { ...data, version: { increment: 1 } },
        });
        await tx.auditLog.createMany({
          data: products.map((p) => ({
            actorType: request.auth.actorType,
            actorId: request.auth.userId,
            action: 'product.bulk',
            entityType: 'product',
            entityId: p.id,
            oldValue: { status: p.status, isAvailable: p.isAvailable, menuCategoryId: p.menuCategoryId },
            newValue: { action: body.action, ...data },
            requestId: request.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
          })),
        });
        return { updated: products.length, action: body.action };
      });
    },
  );
}
