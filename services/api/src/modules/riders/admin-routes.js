// Delivery partners in Jamzo Admin (D-73, D-77): review applications and documents, change status, set cash
// limits. Document files are private and every view is audit-logged; numbers are shown masked.
import { z } from 'zod';
import {
  riderCodBody,
  riderDocumentReviewBody,
  riderListQuery,
  riderTransitionBody,
  uuid,
} from '@jamzo/validation';
import { AppError, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { idPage, toPage } from '../../core/pagination.js';
import { maskPhone } from '@jamzo/logger';
import { codBalances, missingDocuments } from './service.js';

const idParam = z.object({ id: uuid });
const num = (v) => (v == null ? null : Number(v));
/** Allowed status changes (D-73). ACTIVE needs every required document verified. */
const TRANSITIONS = {
  APPLIED: ['DOCUMENT_PENDING', 'REJECTED'],
  DOCUMENT_PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['ACTIVE', 'DOCUMENT_PENDING', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  REJECTED: ['UNDER_REVIEW'],
};

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function riderAdminRoutes(app) {
  const prisma = app.prisma;
  const { config, storage } = app.services;
  const include = {
    user: true,
    vehicles: { where: { isActive: true } },
    documents: { orderBy: { createdAt: /** @type {const} */ ('desc') } },
    availability: true,
  };

  async function load(request, id, permission) {
    const r = await prisma.rider.findUnique({ where: { id }, include });
    if (!r || !canInCity(request, permission, r.cityId)) throw notFound('Delivery partner');
    return r;
  }
  async function requiredFor(r) {
    return (
      await config.resolve(
        'riders.requiredDocuments',
        r.cityId ? await config.contextFor('CITY', r.cityId) : {},
      )
    ).value;
  }

  const row = (r, cod) => ({
    id: r.id,
    name: r.user.name,
    phoneMasked: r.user.phone ? maskPhone(r.user.phone) : null,
    onboardingStatus: r.onboardingStatus,
    cityId: r.cityId,
    vehicle: r.vehicles[0]?.type ?? null,
    online: r.availability?.isOnline ?? false,
    activeOrderCount: r.availability?.activeOrderCount ?? 0,
    lastLocationAt: r.availability?.lastLocationAt ?? null,
    codBalancePaise: cod ?? 0,
    createdAt: r.createdAt,
  });

  app.get(
    '/v1/admin/riders',
    { config: { permission: 'riders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(riderListQuery, request.query);
      const cities = allowedCityIds(request, 'riders.view');
      const page = idPage(q);
      const rows = await prisma.rider.findMany({
        where: {
          ...page.where,
          ...(cities
            ? { cityId: { in: q.cityId ? [q.cityId] : cities } }
            : q.cityId
              ? { cityId: q.cityId }
              : {}),
          ...(q.status ? { onboardingStatus: q.status } : {}),
          ...(q.online ? { availability: { isOnline: q.online === 'true' } } : {}),
          ...(q.q ? { user: { name: { contains: q.q, mode: 'insensitive' } } } : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include,
      });
      const result = toPage(rows, q.limit);
      const cod = await codBalances(
        prisma,
        result.items.map((r) => r.id),
      );
      return { ...result, items: result.items.map((r) => row(r, cod.get(r.id))) };
    },
  );

  async function detail(request, r) {
    const docs = missingDocuments(r, await requiredFor(r));
    const cod = (await codBalances(prisma, [r.id])).get(r.id) ?? 0;
    const codCfg = r.cityId
      ? (await config.resolve('cod', await config.contextFor('CITY', r.cityId))).value
      : null;
    const [recent, earnings] = await Promise.all([
      prisma.order.findMany({
        where: { riderId: r.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { restaurant: true },
      }),
      prisma.riderEarning.aggregate({ where: { riderId: r.id }, _sum: { totalPaise: true }, _count: true }),
    ]);
    const showPhone = canInCity(request, 'riders.manage', r.cityId);
    return {
      ...row(r, cod),
      phone: showPhone ? r.user.phone : null,
      addressLine: r.addressLine,
      vehicle: docs.vehicle && {
        type: docs.vehicle.type,
        registrationNumber: docs.vehicle.registrationNumber,
      },
      documents: {
        required: docs.required,
        missing: docs.missing,
        items: r.documents.map((d) => ({
          id: d.id,
          kind: d.kind,
          status: d.status,
          numberLast4: d.numberLast4,
          hasFile: Boolean(d.mediaId),
          reviewNote: d.reviewNote,
          reviewedAt: d.reviewedAt,
          uploadedAt: d.createdAt,
        })),
      },
      nextStatuses: TRANSITIONS[r.onboardingStatus] ?? [],
      cod: {
        enabled: r.codEnabled,
        limitPaise: r.codLimitPaise,
        inheritedLimitPaise: codCfg?.riderLimitPaise ?? null,
        balancePaise: cod,
        depositsNote: 'Cash deposits and their verification arrive with settlements (Phase 8).',
      },
      position:
        r.availability?.lastLat != null
          ? {
              lat: num(r.availability.lastLat),
              lng: num(r.availability.lastLng),
              at: r.availability.lastLocationAt,
            }
          : null,
      recentOrders: recent.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        restaurantName: o.restaurant.name,
        createdAt: o.createdAt,
      })),
      earnings: { totalPaise: earnings._sum.totalPaise ?? 0, count: earnings._count },
    };
  }

  app.get(
    '/v1/admin/riders/:id',
    { config: { permission: 'riders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      return detail(request, await load(request, id, 'riders.view'));
    },
  );

  app.post(
    '/v1/admin/riders/:id/status',
    { config: { permission: 'riders.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(riderTransitionBody, request.body);
      const r = await load(request, id, 'riders.approve');
      if (!(TRANSITIONS[r.onboardingStatus] ?? []).includes(body.to))
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `A ${r.onboardingStatus} delivery partner cannot move to ${body.to}.`,
        );
      if (body.to === 'ACTIVE') {
        const docs = missingDocuments(r, await requiredFor(r));
        const unverified = docs.required.filter((k) => !docs.verified.includes(k));
        if (!docs.vehicle || unverified.length)
          throw new AppError(
            'INVALID_STATE_TRANSITION',
            `Verify every required document first: ${unverified.join(', ') || 'vehicle'}.`,
            { details: { unverified } },
          );
      }
      await prisma.$transaction(async (tx) => {
        await tx.rider.update({ where: { id }, data: { onboardingStatus: body.to } });
        if (body.to === 'SUSPENDED' || body.to === 'REJECTED') {
          if ((r.availability?.activeOrderCount ?? 0) > 0)
            throw new AppError('CONFLICT', 'This delivery partner is on a delivery. Reassign it first.');
          await tx.riderAvailability.updateMany({ where: { riderId: id }, data: { isOnline: false } });
          await tx.riderShift.updateMany({
            where: { riderId: id, endedAt: null },
            data: { endedAt: app.clock.now() },
          });
        }
        await audit(tx, request, {
          action: 'rider.status',
          entityType: 'rider',
          entityId: id,
          oldValue: { status: r.onboardingStatus },
          newValue: { status: body.to, reason: body.reason },
        });
      });
      return detail(request, await load(request, id, 'riders.view'));
    },
  );

  app.patch(
    '/v1/admin/riders/:id/cod',
    { config: { permission: 'riders.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(riderCodBody, request.body);
      const r = await load(request, id, 'riders.manage');
      await prisma.$transaction(async (tx) => {
        await tx.rider.update({
          where: { id },
          data: { codEnabled: body.codEnabled, codLimitPaise: body.codLimitPaise },
        });
        await audit(tx, request, {
          action: 'rider.cod',
          entityType: 'rider',
          entityId: id,
          oldValue: { codEnabled: r.codEnabled, codLimitPaise: r.codLimitPaise },
          newValue: { codEnabled: body.codEnabled, codLimitPaise: body.codLimitPaise, reason: body.reason },
        });
      });
      return detail(request, await load(request, id, 'riders.view'));
    },
  );

  app.get(
    '/v1/admin/rider-documents/:id/file',
    { config: { permission: 'riders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const doc = await prisma.riderDocument.findUnique({ where: { id }, include: { rider: true } });
      if (!doc || !canInCity(request, 'riders.view', doc.rider.cityId)) throw notFound('Document');
      const media = doc.mediaId ? await prisma.media.findUnique({ where: { id: doc.mediaId } }) : null;
      if (!media || media.kind !== 'DOCUMENT') throw notFound('Document file');
      const body = await storage.get(media.storageKey);
      if (!body) throw notFound('Document file');
      await audit(prisma, request, {
        action: 'rider_document.view',
        entityType: 'rider',
        entityId: doc.riderId,
        newValue: { documentId: id, kind: doc.kind },
      });
      reply.header('content-type', media.mimeType);
      reply.header('cache-control', 'private, no-store');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(body);
    },
  );

  app.post(
    '/v1/admin/rider-documents/:id/review',
    { config: { permission: 'riders.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(riderDocumentReviewBody, request.body);
      const doc = await prisma.riderDocument.findUnique({ where: { id }, include: { rider: true } });
      if (!doc) throw notFound('Document');
      if (!canInCity(request, 'riders.approve', doc.rider.cityId)) throw forbidden();
      if (body.status === 'REJECTED' && !body.note)
        throw new AppError('VALIDATION_FAILED', 'Tell the delivery partner what is wrong.', {
          fieldErrors: { note: ['Required when rejecting'] },
        });
      await prisma.$transaction(async (tx) => {
        await tx.riderDocument.update({
          where: { id },
          data: {
            status: body.status,
            reviewNote: body.note ?? null,
            reviewedById: request.auth.userId,
            reviewedAt: app.clock.now(),
          },
        });
        await audit(tx, request, {
          action: 'rider_document.review',
          entityType: 'rider',
          entityId: doc.riderId,
          oldValue: { documentId: id, status: doc.status },
          newValue: { documentId: id, status: body.status, note: body.note ?? null },
        });
      });
      return detail(request, await load(request, doc.riderId, 'riders.view'));
    },
  );
}
