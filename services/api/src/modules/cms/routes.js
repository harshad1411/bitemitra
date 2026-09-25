// CMS administration (spec §6 "home page must be CMS driven", §62; DECISIONS D-56): home sections, banners
// and static pages. Sections are resolved per location on the server (customer/routes.js).
import { z } from 'zod';
import { bannerBody, cmsPageBody, homeSectionBody, idOrderBody, uuid } from '@jamzo/validation';
import { isUniqueViolation } from '@jamzo/database';
import { conflict, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { withIdempotency } from '../../core/idempotency.js';
import { mediaUrls } from '../media/urls.js';

const idParam = z.object({ id: uuid });
const PERM = { permission: 'cms.manage' };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function cmsRoutes(app) {
  const prisma = app.prisma;
  const base = app.services.mediaBase;

  const assertImage = async (mediaId, field) => {
    if (
      mediaId &&
      !(await prisma.media.findFirst({ where: { id: mediaId, kind: 'IMAGE', deletedAt: null } }))
    )
      throw invalid('Choose an image from the media library.', { [field]: ['Unknown image'] });
  };
  const dates = (b) => ({
    startsAt: b.startsAt ? new Date(b.startsAt) : null,
    endsAt: b.endsAt ? new Date(b.endsAt) : null,
  });
  const withImages = async (rows, key = 'mediaId') => {
    const media = new Map(
      (await prisma.media.findMany({ where: { id: { in: rows.map((r) => r[key]).filter(Boolean) } } })).map(
        (m) => [m.id, m],
      ),
    );
    return rows.map((r) => ({
      ...r,
      image: r[key] && media.get(r[key]) ? mediaUrls(media.get(r[key]), base) : null,
    }));
  };

  // ── Home sections ──
  app.get('/v1/admin/cms/home-sections', { config: PERM }, async () => {
    const rows = await prisma.homeSection.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { banners: true } } },
    });
    return {
      items: await withImages(rows.map(({ _count, ...r }) => ({ ...r, bannerCount: _count.banners }))),
    };
  });

  app.post(
    '/v1/admin/cms/home-sections',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const b = parse(homeSectionBody, request.body);
      await assertImage(b.mediaId, 'mediaId');
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const last = await tx.homeSection.findFirst({ orderBy: { position: 'desc' } });
          const row = await tx.homeSection.create({
            data: { ...b, ...dates(b), position: (last?.position ?? -1) + 1 },
          });
          await audit(tx, request, {
            action: 'home_section.create',
            entityType: 'home_section',
            entityId: row.id,
            newValue: row,
          });
          return row;
        }),
      );
    },
  );

  app.put(
    '/v1/admin/cms/home-sections/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const b = parse(homeSectionBody, request.body);
      await assertImage(b.mediaId, 'mediaId');
      return prisma.$transaction(async (tx) => {
        const before = await tx.homeSection.findUnique({ where: { id } });
        if (!before) throw notFound('Home section');
        const after = await tx.homeSection.update({ where: { id }, data: { ...b, ...dates(b) } });
        await audit(tx, request, {
          action: 'home_section.update',
          entityType: 'home_section',
          entityId: id,
          oldValue: before,
          newValue: after,
        });
        return after;
      });
    },
  );

  app.delete(
    '/v1/admin/cms/home-sections/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      await prisma.$transaction(async (tx) => {
        const before = await tx.homeSection.findUnique({ where: { id } });
        if (!before) throw notFound('Home section');
        await tx.banner.updateMany({ where: { homeSectionId: id }, data: { homeSectionId: null } });
        await tx.homeSection.delete({ where: { id } });
        await audit(tx, request, {
          action: 'home_section.delete',
          entityType: 'home_section',
          entityId: id,
          oldValue: before,
        });
      });
      reply.code(204);
      return null;
    },
  );

  app.put(
    '/v1/admin/cms/home-sections/order',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { ids } = parse(idOrderBody, request.body);
      await prisma.$transaction(async (tx) => {
        const all = await tx.homeSection.findMany({ select: { id: true } });
        if (ids.length !== all.length || !all.every((s) => ids.includes(s.id)))
          throw invalid('Send every section exactly once.', { ids: ['Must list all sections'] });
        for (const [position, sectionId] of ids.entries())
          await tx.homeSection.update({ where: { id: sectionId }, data: { position } });
        await audit(tx, request, {
          action: 'home_section.reorder',
          entityType: 'home_section',
          newValue: ids,
        });
      });
      return { ok: true };
    },
  );

  // ── Banners ──
  app.get('/v1/admin/cms/banners', { config: PERM }, async () => {
    const rows = await prisma.banner.findMany({ orderBy: [{ homeSectionId: 'asc' }, { position: 'asc' }] });
    return { items: await withImages(rows) };
  });

  app.post(
    '/v1/admin/cms/banners',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const b = parse(bannerBody, request.body);
      await assertImage(b.mediaId, 'mediaId');
      if (b.homeSectionId && !(await prisma.homeSection.findUnique({ where: { id: b.homeSectionId } })))
        throw invalid('Unknown home section.', { homeSectionId: ['Unknown'] });
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const last = await tx.banner.findFirst({
            where: { homeSectionId: b.homeSectionId ?? null },
            orderBy: { position: 'desc' },
          });
          const row = await tx.banner.create({
            data: { ...b, ...dates(b), position: (last?.position ?? -1) + 1 },
          });
          await audit(tx, request, {
            action: 'banner.create',
            entityType: 'banner',
            entityId: row.id,
            newValue: row,
          });
          return row;
        }),
      );
    },
  );

  app.put(
    '/v1/admin/cms/banners/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const b = parse(bannerBody, request.body);
      await assertImage(b.mediaId, 'mediaId');
      return prisma.$transaction(async (tx) => {
        const before = await tx.banner.findUnique({ where: { id } });
        if (!before) throw notFound('Banner');
        const after = await tx.banner.update({ where: { id }, data: { ...b, ...dates(b) } });
        await audit(tx, request, {
          action: 'banner.update',
          entityType: 'banner',
          entityId: id,
          oldValue: before,
          newValue: after,
        });
        return after;
      });
    },
  );

  app.delete(
    '/v1/admin/cms/banners/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      await prisma.$transaction(async (tx) => {
        const before = await tx.banner.findUnique({ where: { id } });
        if (!before) throw notFound('Banner');
        await tx.banner.delete({ where: { id } });
        await audit(tx, request, {
          action: 'banner.delete',
          entityType: 'banner',
          entityId: id,
          oldValue: before,
        });
      });
      reply.code(204);
      return null;
    },
  );

  // ── Static pages (terms, privacy, FAQ — the legal texts themselves need counsel, Q-12) ──
  app.get('/v1/admin/cms/pages', { config: PERM }, async () => ({
    items: await prisma.cmsPage.findMany({
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, title: true, isPublished: true, updatedAt: true },
    }),
  }));

  app.get(
    '/v1/admin/cms/pages/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const page = await prisma.cmsPage.findUnique({ where: { id } });
      if (!page) throw notFound('Page');
      return page;
    },
  );

  app.post(
    '/v1/admin/cms/pages',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const b = parse(cmsPageBody, request.body);
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          let row;
          try {
            row = await tx.cmsPage.create({ data: { ...b, updatedById: request.auth.userId } });
          } catch (err) {
            if (isUniqueViolation(err)) throw conflict('A page with this slug already exists.');
            throw err;
          }
          await audit(tx, request, {
            action: 'cms_page.create',
            entityType: 'cms_page',
            entityId: row.id,
            newValue: { slug: row.slug, title: row.title },
          });
          return row;
        }),
      );
    },
  );

  app.put(
    '/v1/admin/cms/pages/:id',
    { config: PERM },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const b = parse(cmsPageBody, request.body);
      return prisma.$transaction(async (tx) => {
        const before = await tx.cmsPage.findUnique({ where: { id } });
        if (!before) throw notFound('Page');
        let after;
        try {
          after = await tx.cmsPage.update({
            where: { id },
            data: { ...b, updatedById: request.auth.userId },
          });
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict('A page with this slug already exists.');
          throw err;
        }
        await audit(tx, request, {
          action: 'cms_page.update',
          entityType: 'cms_page',
          entityId: id,
          oldValue: {
            slug: before.slug,
            title: before.title,
            isPublished: before.isPublished,
            length: before.body.length,
          },
          newValue: {
            slug: after.slug,
            title: after.title,
            isPublished: after.isPublished,
            length: after.body.length,
          },
        });
        return after;
      });
    },
  );
}
