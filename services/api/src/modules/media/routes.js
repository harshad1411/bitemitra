// Media library (spec §62). Upload → original stored → outbox event → worker makes renditions.
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { mediaUpdateBody, pageQuery, uuid } from '@jamzo/validation';
import { AppError, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { enqueueEvent } from '../../core/outbox.js';
import { idPage, toPage } from '../../core/pagination.js';
import { withIdempotency } from '../../core/idempotency.js';
import { originalKey, sniffImage } from './storage.js';

const idParam = z.object({ id: uuid });

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function mediaRoutes(app) {
  const prisma = app.prisma;
  const { storage, env } = app.services;
  const base = env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '');

  const dto = (m) => ({
    id: m.id,
    kind: m.kind,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    width: m.width,
    height: m.height,
    altText: m.altText,
    title: m.title,
    tags: m.tags,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    urls: {
      original: `${base}/${m.storageKey}`,
      ...Object.fromEntries(Object.entries(/** @type {Record<string,string>} */ (m.variants ?? {})).map(([k, v]) => [k, `${base}/${v}`])),
    },
  });

  app.post('/v1/admin/media', { config: { permission: 'media.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const part = await request.file({ limits: { fileSize: env.MEDIA_MAX_BYTES, files: 1, fields: 10 } }).catch((err) => {
      throw new AppError('VALIDATION_FAILED', 'Upload a single image as multipart/form-data.', { details: { cause: err.code } });
    });
    if (!part) throw new AppError('VALIDATION_FAILED', 'No file uploaded.', { fieldErrors: { file: ['Required'] } });
    let buffer;
    try {
      buffer = await part.toBuffer();
    } catch (err) {
      if (/** @type {any} */ (err).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError('PAYLOAD_TOO_LARGE', `Images must be at most ${Math.floor(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`);
      }
      throw err;
    }
    const type = sniffImage(buffer);
    if (!type) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG and WebP images are supported.');
    const field = (name) => {
      const f = part.fields[name];
      return f && !Array.isArray(f) && 'value' in f ? String(f.value) : undefined;
    };
    const meta = parse(mediaUpdateBody, {
      altText: field('altText') || null,
      title: field('title') || part.filename?.slice(0, 120) || null,
      tags: field('tags') ? field('tags').split(',').map((t) => t.trim()).filter(Boolean) : [],
    });
    const fingerprint = { sha256: createHash('sha256').update(buffer).digest('hex'), meta };

    return withIdempotency(request, reply, { successStatus: 201, fingerprint }, async () => {
      const id = randomUUID();
      const key = originalKey(id, type.ext);
      await storage.put(key, buffer, type.mime);
      const media = await prisma.$transaction(async (tx) => {
        const m = await tx.media.create({
          data: { id, kind: 'IMAGE', storageKey: key, mimeType: type.mime, sizeBytes: buffer.length, altText: meta.altText, title: meta.title, tags: meta.tags ?? [], uploadedById: request.auth.userId },
        });
        await enqueueEvent(tx, { aggregateType: 'MEDIA', aggregateId: m.id, eventType: 'media.uploaded', payload: { mediaId: m.id } });
        await audit(tx, request, { action: 'media.upload', entityType: 'media', entityId: m.id, newValue: { title: m.title, mimeType: m.mimeType, sizeBytes: m.sizeBytes } });
        return m;
      }).catch(async (err) => {
        await storage.remove(key).catch(() => {});
        throw err;
      });
      return dto(media);
    });
  });

  app.get('/v1/admin/media', { config: { permission: 'media.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const q = parse(pageQuery.extend({ status: z.enum(['PENDING', 'READY', 'FAILED']).optional() }), request.query);
    const page = idPage(q);
    const rows = await prisma.media.findMany({
      where: {
        ...page.where,
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { altText: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q } }] } : {}),
      },
      orderBy: page.orderBy,
      take: page.take,
    });
    return toPage(rows.map(dto), q.limit);
  });

  app.get('/v1/admin/media/:id', { config: { permission: 'media.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const m = await prisma.media.findFirst({ where: { id, deletedAt: null } });
    if (!m) throw notFound('Media');
    return dto(m);
  });

  app.patch('/v1/admin/media/:id', { config: { permission: 'media.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(mediaUpdateBody, request.body);
    return prisma.$transaction(async (tx) => {
      const before = await tx.media.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Media');
      const after = await tx.media.update({ where: { id }, data: body });
      await audit(tx, request, { action: 'media.update', entityType: 'media', entityId: id, oldValue: { altText: before.altText, title: before.title, tags: before.tags }, newValue: body });
      return dto(after);
    });
  });

  // Soft delete: the record and files are kept for audit/restore, but the image is no longer listed or served.
  // (Reference checks before deletion arrive with the CMS in Phase 3.)
  app.delete('/v1/admin/media/:id', { config: { permission: 'media.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const { id } = parse(idParam, request.params);
    await prisma.$transaction(async (tx) => {
      const before = await tx.media.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Media');
      await tx.media.update({ where: { id }, data: { deletedAt: app.clock.now() } });
      await audit(tx, request, { action: 'media.delete', entityType: 'media', entityId: id, oldValue: { title: before.title } });
    });
    reply.code(204);
    return null;
  });

  // Public file delivery for library images (not documents — those need private storage, Phase 2).
  app.get('/v1/media/files/*', { config: { auth: 'none', public: true } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const key = String(/** @type {any} */ (request.params)['*'] ?? '');
    const m = /^media\/([0-9a-f-]{36})\/(original\.(?:jpg|png|webp)|thumb\.webp|small\.webp|medium\.webp)$/.exec(key);
    if (!m) throw notFound('File');
    const media = await prisma.media.findFirst({ where: { id: m[1], deletedAt: null, kind: 'IMAGE' } });
    if (!media) throw notFound('File');
    const body = await storage.get(key);
    if (!body) throw notFound('File');
    reply.header('content-type', m[2].startsWith('original') ? media.mimeType : 'image/webp');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(body);
  });
}
