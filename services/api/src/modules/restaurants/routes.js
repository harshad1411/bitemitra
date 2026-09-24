// Restaurant management for Jamzo Admin (RESTAURANTS.md, spec §32, §74): profile, onboarding workflow,
// team, branches (hours, delivery area, open/pause/busy), documents (private), bank accounts (encrypted,
// four-eyes), settings and zones. City Managers only see and change restaurants of their city.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  bankAccountCreateBody,
  branchCreateBody,
  branchUpdateBody,
  businessHoursBody,
  deliveryAreaBody,
  fssaiNumber,
  gstin,
  pan,
  restaurantCreateBody,
  restaurantDocumentFields,
  restaurantDocumentReviewBody,
  restaurantListQuery,
  restaurantMemberCreateBody,
  restaurantMemberUpdateBody,
  restaurantSettingsBody,
  restaurantTransitionBody,
  restaurantUpdateBody,
  restaurantZonesBody,
  uuid,
} from '@jamzo/validation';
import { validateWeeklyRows } from '@jamzo/catalog-engine';
import { isUniqueViolation } from '@jamzo/database';
import { AppError, conflict, forbidden, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { namePage, toPage } from '../../core/pagination.js';
import { withIdempotency } from '../../core/idempotency.js';
import { documentKey, sniffDocument } from '../media/storage.js';
import {
  RESTAURANT_DETAIL_INCLUDE,
  assertTransition,
  availableTransitions,
  bankAccountDto,
  branchDto,
  documentDto,
  evaluateReadiness,
  loadRestaurantForAdmin,
  localDateString,
  memberDto,
  moveStatus,
  syncBranchZones,
  zoneForPoint,
} from './service.js';

const idParam = z.object({ id: uuid });
const DOCUMENT_NUMBER_RULES = { FSSAI: fssaiNumber, PAN: pan, GST: gstin };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function restaurantRoutes(app) {
  const prisma = app.prisma;
  const { config, storage, env, fieldCipher } = app.services;

  const unique = async (promise, message) => {
    try {
      return await promise;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(message);
      throw err;
    }
  };

  /** Full admin view of a restaurant, including the readiness checklist the workflow enforces. */
  async function detail(request, id) {
    const r = await prisma.restaurant.findUniqueOrThrow({
      where: { id },
      include: RESTAURANT_DETAIL_INCLUDE,
    });
    const now = app.clock.now();
    const ctx = await config.contextFor('RESTAURANT', id);
    const [required, liveProducts, counts] = await Promise.all([
      config.resolve('restaurants.requiredDocuments', ctx),
      prisma.product.count({ where: { restaurantId: id, status: 'ACTIVE', isAvailable: true } }),
      prisma.product.groupBy({ by: ['status'], where: { restaurantId: id }, _count: { _all: true } }),
    ]);
    const tz = r.city.timezone;
    const readiness = evaluateReadiness(r, {
      requiredKinds: required.value.kinds,
      liveProducts,
      today: localDateString(now, tz),
    });
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      legalName: r.legalName,
      description: r.description,
      cuisines: r.cuisines,
      isPureVeg: r.isPureVeg,
      logoMediaId: r.logoMediaId,
      coverMediaId: r.coverMediaId,
      phone: r.phone,
      email: r.email,
      gstin: r.gstin,
      pan: r.pan,
      fssaiNumber: r.fssaiNumber,
      fssaiExpiresOn: r.fssaiExpiresOn ? r.fssaiExpiresOn.toISOString().slice(0, 10) : null,
      onboardingStatus: r.onboardingStatus,
      isPromoted: r.isPromoted,
      sortWeight: r.sortWeight,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      city: {
        id: r.city.id,
        name: r.city.name,
        slug: r.city.slug,
        timezone: tz,
        stateName: r.city.state.name,
      },
      settings: {
        autoAccept: r.settings?.autoAccept ?? false,
        selfEditMenu: r.settings?.selfEditMenu ?? false,
      },
      zones: r.zones.map((z) => ({ id: z.zone.id, name: z.zone.name, slug: z.zone.slug })),
      branches: r.branches.map((b) =>
        branchDto(b, { now, timeZone: tz, restaurantStatus: r.onboardingStatus }),
      ),
      documents: r.documents.map(documentDto),
      requiredDocumentKinds: required.value.kinds,
      bankAccounts: r.bankAccounts.map(bankAccountDto),
      members: r.users.map(memberDto),
      productCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      readiness,
      transitions: availableTransitions(request, r),
    };
  }

  // ── List & create ──
  app.get(
    '/v1/admin/restaurants',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(restaurantListQuery, request.query);
      const allowed = allowedCityIds(request, 'restaurants.view');
      const page = namePage(q);
      const rows = await prisma.restaurant.findMany({
        where: {
          AND: [
            page.where,
            allowed ? { cityId: { in: allowed } } : {},
            q.cityId ? { cityId: q.cityId } : {},
            q.status ? { onboardingStatus: q.status } : {},
            q.q
              ? {
                  OR: [
                    { name: { contains: q.q, mode: 'insensitive' } },
                    { slug: { contains: q.q.toLowerCase() } },
                    { cuisines: { has: q.q } },
                  ],
                }
              : {},
          ],
        },
        orderBy: page.orderBy,
        take: page.take,
        include: {
          city: { select: { id: true, name: true } },
          branches: { where: { isPrimary: true }, select: { area: true, isOpen: true, pausedUntil: true } },
          _count: { select: { products: { where: { status: 'ACTIVE' } } } },
        },
      });
      return toPage(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          cuisines: r.cuisines,
          isPureVeg: r.isPureVeg,
          onboardingStatus: r.onboardingStatus,
          city: r.city,
          area: r.branches[0]?.area ?? null,
          activeProducts: r._count.products,
          createdAt: r.createdAt,
        })),
        q.limit,
        'name',
      );
    },
  );

  app.post(
    '/v1/admin/restaurants',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(restaurantCreateBody, request.body);
      if (!canInCity(request, 'restaurants.manage', body.cityId))
        throw forbidden('You cannot add restaurants in this city.');
      if (!(await prisma.city.findUnique({ where: { id: body.cityId } }))) throw notFound('City');
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const r = await unique(
            tx.restaurant.create({ data: { ...body, onboardingStatus: 'DRAFT', settings: { create: {} } } }),
            'A restaurant with this slug already exists.',
          );
          await audit(tx, request, {
            action: 'restaurant.create',
            entityType: 'restaurant',
            entityId: r.id,
            newValue: r,
          });
          return { id: r.id, name: r.name, slug: r.slug, onboardingStatus: r.onboardingStatus };
        }),
      );
    },
  );

  app.get(
    '/v1/admin/restaurants/:id',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      await loadRestaurantForAdmin(request, prisma, id, 'restaurants.view');
      return detail(request, id);
    },
  );

  app.patch(
    '/v1/admin/restaurants/:id',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantUpdateBody, request.body);
      await prisma.$transaction(async (tx) => {
        const before = await loadRestaurantForAdmin(request, tx, id, 'restaurants.manage');
        for (const key of /** @type {const} */ (['logoMediaId', 'coverMediaId'])) {
          if (
            body[key] &&
            !(await tx.media.findFirst({ where: { id: body[key], kind: 'IMAGE', deletedAt: null } }))
          )
            throw invalid('Choose an image from the media library.', { [key]: ['Unknown image'] });
        }
        if (body.isPureVeg === true && !before.isPureVeg) {
          const nonVeg = await tx.product.count({
            where: {
              restaurantId: id,
              status: { not: 'ARCHIVED' },
              OR: [
                { foodType: { in: ['EGG', 'NON_VEG'] } },
                { addonGroups: { some: { addons: { some: { foodType: { in: ['EGG', 'NON_VEG'] } } } } } },
              ],
            },
          });
          if (nonVeg)
            throw invalid(
              `${nonVeg} product(s) are egg or non-veg (or have such add-ons). Change or archive them first.`,
              {
                isPureVeg: ['Menu is not pure veg'],
              },
            );
        }
        const data = {
          ...body,
          ...(body.fssaiExpiresOn !== undefined
            ? { fssaiExpiresOn: body.fssaiExpiresOn ? new Date(`${body.fssaiExpiresOn}T00:00:00Z`) : null }
            : {}),
        };
        const after = await unique(
          tx.restaurant.update({ where: { id }, data }),
          'A restaurant with this slug already exists.',
        );
        await audit(tx, request, {
          action: 'restaurant.update',
          entityType: 'restaurant',
          entityId: id,
          oldValue: before,
          newValue: after,
        });
      });
      return detail(request, id);
    },
  );

  // ── Onboarding workflow (D-34) ──
  app.post(
    '/v1/admin/restaurants/:id/transitions',
    { config: { permission: 'restaurants.view' } }, // the transition's own permission is checked below
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantTransitionBody, request.body);
      const r = await loadRestaurantForAdmin(request, prisma, id, 'restaurants.view');
      const current = await detail(request, id);
      assertTransition(request, r.cityId, r.onboardingStatus, body.to, body, current.readiness);
      await prisma.$transaction(async (tx) => {
        await moveStatus(tx, id, r.onboardingStatus, body.to);
        await audit(tx, request, {
          action: 'restaurant.status_change',
          entityType: 'restaurant',
          entityId: id,
          oldValue: { onboardingStatus: r.onboardingStatus },
          newValue: { onboardingStatus: body.to, reason: body.reason ?? null },
        });
      });
      return detail(request, id);
    },
  );

  app.put(
    '/v1/admin/restaurants/:id/zones',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const { zoneIds } = parse(restaurantZonesBody, request.body);
      await prisma.$transaction(async (tx) => {
        const r = await loadRestaurantForAdmin(request, tx, id, 'restaurants.manage');
        const zones = await tx.zone.findMany({ where: { id: { in: zoneIds } } });
        if (zones.length !== new Set(zoneIds).size || zones.some((z) => z.cityId !== r.cityId))
          throw invalid('Choose zones of the restaurant’s city.', {
            zoneIds: ['Unknown zone or another city'],
          });
        const before = await tx.restaurantZone.findMany({ where: { restaurantId: id } });
        await tx.restaurantZone.deleteMany({ where: { restaurantId: id } });
        await tx.restaurantZone.createMany({
          data: zoneIds.map((zoneId) => ({ restaurantId: id, zoneId })),
          skipDuplicates: true,
        });
        await syncBranchZones(tx, id); // branch zones are always included (D-41)
        await audit(tx, request, {
          action: 'restaurant.zones_update',
          entityType: 'restaurant',
          entityId: id,
          oldValue: before.map((z) => z.zoneId),
          newValue: zoneIds,
        });
      });
      return detail(request, id);
    },
  );

  app.patch(
    '/v1/admin/restaurants/:id/settings',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantSettingsBody, request.body);
      await prisma.$transaction(async (tx) => {
        await loadRestaurantForAdmin(request, tx, id, 'restaurants.manage');
        const before = await tx.restaurantSettings.findUnique({ where: { restaurantId: id } });
        const after = await tx.restaurantSettings.upsert({
          where: { restaurantId: id },
          create: { restaurantId: id, ...body },
          update: body,
        });
        await audit(tx, request, {
          action: 'restaurant.settings_update',
          entityType: 'restaurant',
          entityId: id,
          oldValue: before,
          newValue: after,
        });
      });
      return detail(request, id);
    },
  );

  // ── Team (restaurant members) ──
  app.post(
    '/v1/admin/restaurants/:id/members',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantMemberCreateBody, request.body);
      await loadRestaurantForAdmin(request, prisma, id, 'restaurants.manage');
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          // Adding a member never creates approval by itself: the restaurant's status still gates access (OD-13).
          let user = await tx.user.findUnique({ where: { phone: body.phone } });
          if (!user) {
            user = await tx.user.create({
              data: {
                phone: body.phone,
                name: body.name ?? null,
                identities: { create: { provider: 'PHONE_OTP', subject: body.phone } },
              },
            });
          }
          const member = await unique(
            tx.restaurantUser.create({
              data: { restaurantId: id, userId: user.id, role: body.role },
              include: { user: true },
            }),
            'This person is already on the team.',
          );
          await audit(tx, request, {
            action: 'restaurant_member.add',
            entityType: 'restaurant',
            entityId: id,
            newValue: { memberId: member.id, userId: user.id, role: member.role },
          });
          return memberDto(member);
        }),
      );
    },
  );

  app.patch(
    '/v1/admin/restaurant-members/:id',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantMemberUpdateBody, request.body);
      return prisma.$transaction(async (tx) => {
        const before = await tx.restaurantUser.findUnique({
          where: { id },
          include: { restaurant: true, user: true },
        });
        if (!before) throw notFound('Team member');
        if (!canInCity(request, 'restaurants.manage', before.restaurant.cityId)) throw forbidden();
        const losesOwner =
          before.role === 'OWNER' &&
          before.isActive &&
          (body.isActive === false || (body.role && body.role !== 'OWNER'));
        if (losesOwner && before.restaurant.onboardingStatus !== 'DRAFT') {
          const owners = await tx.restaurantUser.count({
            where: { restaurantId: before.restaurantId, role: 'OWNER', isActive: true },
          });
          if (owners <= 1)
            throw conflict('A restaurant must keep at least one active owner. Add another owner first.');
        }
        if (body.isActive === false && !body.reason)
          throw invalid('Say why this person is removed.', { reason: ['Required'] });
        const { reason, ...data } = body;
        const after = await tx.restaurantUser.update({ where: { id }, data, include: { user: true } });
        await audit(tx, request, {
          action: 'restaurant_member.update',
          entityType: 'restaurant',
          entityId: before.restaurantId,
          oldValue: { memberId: id, role: before.role, isActive: before.isActive },
          newValue: { memberId: id, role: after.role, isActive: after.isActive, reason: reason ?? null },
        });
        return memberDto(after);
      });
    },
  );

  // ── Branches ──
  async function checkPrepTime(ctx, minutes) {
    if (minutes === undefined) return;
    const { value } = await config.resolve('orders.preparation', ctx);
    if (minutes > value.maxPrepMinutes)
      throw invalid(`Preparation time can be at most ${value.maxPrepMinutes} minutes.`, {
        prepTimeMinutes: ['Too long'],
      });
  }

  app.post(
    '/v1/admin/restaurants/:id/branches',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const body = parse(branchCreateBody, request.body);
      const r = await loadRestaurantForAdmin(request, prisma, id, 'restaurants.manage');
      await checkPrepTime(await config.contextFor('RESTAURANT', id), body.prepTimeMinutes);
      const zone = await zoneForPoint(prisma, r.cityId, body);
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const existing = await tx.restaurantBranch.count({ where: { restaurantId: id } });
          const branch = await tx.restaurantBranch.create({
            data: { ...body, restaurantId: id, zoneId: zone?.id ?? null, isPrimary: existing === 0 },
          });
          await syncBranchZones(tx, id);
          await audit(tx, request, {
            action: 'branch.create',
            entityType: 'restaurant_branch',
            entityId: branch.id,
            newValue: branch,
          });
          return { id: branch.id, zone: zone ? { id: zone.id, name: zone.name } : null };
        }),
      );
    },
  );

  async function loadBranch(request, db, id) {
    const branch = await db.restaurantBranch.findUnique({ where: { id }, include: { restaurant: true } });
    if (!branch) throw notFound('Branch');
    if (!canInCity(request, 'restaurants.manage', branch.restaurant.cityId)) throw forbidden();
    return branch;
  }

  app.patch(
    '/v1/admin/branches/:id',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(branchUpdateBody, request.body);
      const branch = await loadBranch(request, prisma, id);
      const ctx = await config.contextFor('BRANCH', id);
      await checkPrepTime(ctx, body.prepTimeMinutes);
      const { pauseMinutes, ...rest } = body;
      /** @type {any} */
      const data = rest;
      if (pauseMinutes !== undefined) {
        const { value } = await config.resolve('restaurants.operations', ctx);
        if (pauseMinutes > value.maxPauseMinutes)
          throw invalid(`A pause can last at most ${value.maxPauseMinutes} minutes.`, {
            pauseMinutes: ['Too long'],
          });
        data.pausedUntil =
          pauseMinutes === 0 ? null : new Date(app.clock.now().getTime() + pauseMinutes * 60_000);
      }
      if (body.lat !== undefined || body.lng !== undefined) {
        const point = { lat: body.lat ?? Number(branch.lat), lng: body.lng ?? Number(branch.lng) };
        data.zoneId = (await zoneForPoint(prisma, branch.restaurant.cityId, point))?.id ?? null;
      }
      await prisma.$transaction(async (tx) => {
        const after = await tx.restaurantBranch.update({ where: { id }, data });
        await syncBranchZones(tx, branch.restaurantId);
        const { restaurant: _r, ...old } = branch;
        await audit(tx, request, {
          action: 'branch.update',
          entityType: 'restaurant_branch',
          entityId: id,
          oldValue: old,
          newValue: after,
        });
      });
      return detail(request, branch.restaurantId);
    },
  );

  app.put(
    '/v1/admin/branches/:id/hours',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const { hours } = parse(businessHoursBody, request.body);
      const errors = validateWeeklyRows(hours);
      if (Object.keys(errors).length)
        throw invalid(
          'Some opening hours are invalid.',
          Object.fromEntries(Object.entries(errors).map(([k, v]) => [`hours.${k}`, v])),
        );
      const branch = await loadBranch(request, prisma, id);
      await prisma.$transaction(async (tx) => {
        const before = await tx.restaurantBusinessHours.findMany({ where: { branchId: id } });
        await tx.restaurantBusinessHours.deleteMany({ where: { branchId: id } });
        await tx.restaurantBusinessHours.createMany({ data: hours.map((h) => ({ ...h, branchId: id })) });
        await audit(tx, request, {
          action: 'branch.hours_update',
          entityType: 'restaurant_branch',
          entityId: id,
          oldValue: before.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })),
          newValue: hours,
        });
      });
      return detail(request, branch.restaurantId);
    },
  );

  app.put(
    '/v1/admin/branches/:id/delivery-area',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(deliveryAreaBody, request.body);
      const branch = await loadBranch(request, prisma, id);
      await prisma.$transaction(async (tx) => {
        const before = await tx.branchDeliveryArea.findFirst({ where: { branchId: id, isActive: true } });
        if (before)
          await tx.branchDeliveryArea.update({ where: { id: before.id }, data: { isActive: false } });
        const after = await tx.branchDeliveryArea.create({
          data: {
            branchId: id,
            kind: body.kind,
            radiusM: body.kind === 'RADIUS' ? body.radiusM : null,
            geometry: body.kind === 'POLYGON' ? body.geometry : undefined,
          },
        });
        await audit(tx, request, {
          action: 'branch.delivery_area_update',
          entityType: 'restaurant_branch',
          entityId: id,
          oldValue: before ? { kind: before.kind, radiusM: before.radiusM } : null,
          newValue: { kind: after.kind, radiusM: after.radiusM, polygon: body.kind === 'POLYGON' },
        });
      });
      return detail(request, branch.restaurantId);
    },
  );

  // ── Documents (private files — D-36) ──
  app.post(
    '/v1/admin/restaurants/:id/documents',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      await loadRestaurantForAdmin(request, prisma, id, 'restaurants.manage');
      /** @type {Record<string, string>} */
      const fields = {};
      let file = null;
      if (!request.isMultipart())
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the document as multipart/form-data.');
      for await (const part of request.parts({
        limits: { fileSize: env.MEDIA_MAX_BYTES, files: 1, fields: 10 },
      })) {
        if (part.type === 'file') {
          try {
            file = { buffer: await part.toBuffer(), filename: part.filename };
          } catch (err) {
            if (/** @type {any} */ (err).code === 'FST_REQ_FILE_TOO_LARGE')
              throw new AppError(
                'PAYLOAD_TOO_LARGE',
                `Documents must be at most ${Math.floor(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`,
              );
            throw err;
          }
        } else fields[part.fieldname] = String(part.value);
      }
      const meta = parse(restaurantDocumentFields, {
        kind: fields.kind,
        number: fields.number || null,
        expiresOn: fields.expiresOn || null,
      });
      const numberRule = DOCUMENT_NUMBER_RULES[meta.kind];
      if (meta.number && numberRule) {
        const checked = numberRule.safeParse(meta.number);
        if (!checked.success)
          throw invalid('The document number is not valid.', { number: [checked.error.issues[0].message] });
        meta.number = checked.data;
      }
      if (!meta.number && !file)
        throw invalid('Upload the document or enter its number.', { file: ['Required'] });
      const type = file ? sniffDocument(file.buffer) : null;
      if (file && !type)
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Documents must be PDF, JPEG or PNG files.');

      return withIdempotency(
        request,
        reply,
        { successStatus: 201, fingerprint: { ...meta, size: file?.buffer.length ?? 0 } },
        async () => {
          const mediaId = file ? randomUUID() : null;
          const key = file ? documentKey(mediaId, type.ext) : null;
          if (file) await storage.put(key, file.buffer, type.mime);
          try {
            return await prisma.$transaction(async (tx) => {
              if (file) {
                await tx.media.create({
                  data: {
                    id: mediaId,
                    kind: 'DOCUMENT',
                    storageKey: key,
                    mimeType: type.mime,
                    sizeBytes: file.buffer.length,
                    title: file.filename?.slice(0, 120) ?? null,
                    status: 'READY',
                    uploadedById: request.auth.userId,
                  },
                });
              }
              const doc = await tx.restaurantDocument.create({
                data: {
                  restaurantId: id,
                  kind: meta.kind,
                  number: meta.number ?? null,
                  mediaId,
                  expiresOn: meta.expiresOn ? new Date(`${meta.expiresOn}T00:00:00Z`) : null,
                },
              });
              await audit(tx, request, {
                action: 'restaurant_document.add',
                entityType: 'restaurant',
                entityId: id,
                newValue: { documentId: doc.id, kind: doc.kind, hasFile: Boolean(file) },
              });
              return documentDto(doc);
            });
          } catch (err) {
            if (key) await storage.remove(key).catch(() => {});
            throw err;
          }
        },
      );
    },
  );

  app.get(
    '/v1/admin/restaurant-documents/:id/file',
    { config: { permission: 'restaurants.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const doc = await prisma.restaurantDocument.findUnique({
        where: { id },
        include: { restaurant: true },
      });
      if (!doc) throw notFound('Document');
      if (!canInCity(request, 'restaurants.view', doc.restaurant.cityId)) throw forbidden();
      const media = doc.mediaId ? await prisma.media.findUnique({ where: { id: doc.mediaId } }) : null;
      if (!media || media.kind !== 'DOCUMENT') throw notFound('Document file');
      const body = await storage.get(media.storageKey);
      if (!body) throw notFound('Document file');
      await audit(prisma, request, {
        action: 'restaurant_document.view',
        entityType: 'restaurant',
        entityId: doc.restaurantId,
        newValue: { documentId: id, kind: doc.kind },
      });
      reply.header('content-type', media.mimeType);
      reply.header(
        'content-disposition',
        `inline; filename="${doc.kind.toLowerCase()}.${media.storageKey.split('.').pop()}"`,
      );
      reply.header('cache-control', 'private, no-store');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(body);
    },
  );

  app.post(
    '/v1/admin/restaurant-documents/:id/review',
    { config: { permission: 'restaurants.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(restaurantDocumentReviewBody, request.body);
      return prisma.$transaction(async (tx) => {
        const before = await tx.restaurantDocument.findUnique({
          where: { id },
          include: { restaurant: true },
        });
        if (!before) throw notFound('Document');
        if (!canInCity(request, 'restaurants.approve', before.restaurant.cityId)) throw forbidden();
        const after = await tx.restaurantDocument.update({
          where: { id },
          data: {
            status: body.status,
            reviewNote: body.note ?? null,
            reviewedById: request.auth.userId,
            reviewedAt: app.clock.now(),
          },
        });
        await audit(tx, request, {
          action: 'restaurant_document.review',
          entityType: 'restaurant',
          entityId: before.restaurantId,
          oldValue: { documentId: id, status: before.status },
          newValue: { documentId: id, status: after.status, note: after.reviewNote },
        });
        return documentDto(after);
      });
    },
  );

  // ── Bank accounts (encrypted, four-eyes — D-35) ──
  app.post(
    '/v1/admin/restaurants/:id/bank-accounts',
    { config: { permission: 'restaurants.manage' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const body = parse(bankAccountCreateBody, request.body);
      await loadRestaurantForAdmin(request, prisma, id, 'restaurants.manage');
      // The account number is never part of the idempotency fingerprint in clear text.
      const fingerprint = {
        ...body,
        accountNumber: body.accountNumber.slice(-4),
        confirmAccountNumber: undefined,
      };
      return withIdempotency(request, reply, { successStatus: 201, fingerprint }, () =>
        prisma.$transaction(async (tx) => {
          const account = await tx.restaurantBankAccount.create({
            data: {
              restaurantId: id,
              accountHolderName: body.accountHolderName,
              accountNumberEncrypted: fieldCipher.encrypt(body.accountNumber),
              accountNumberLast4: body.accountNumber.slice(-4),
              ifsc: body.ifsc,
              bankName: body.bankName ?? null,
              upiId: body.upiId ?? null,
              isPrimary: false,
              createdById: request.auth.userId,
            },
          });
          await audit(tx, request, {
            action: 'restaurant_bank_account.add',
            entityType: 'restaurant',
            entityId: id,
            newValue: bankAccountDto(account),
          });
          return bankAccountDto(account);
        }),
      );
    },
  );

  app.post(
    '/v1/admin/restaurant-bank-accounts/:id/verify',
    { config: { permission: 'restaurants.approve' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      return prisma.$transaction(async (tx) => {
        const account = await tx.restaurantBankAccount.findUnique({
          where: { id },
          include: { restaurant: true },
        });
        if (!account) throw notFound('Bank account');
        if (!canInCity(request, 'restaurants.approve', account.restaurant.cityId)) throw forbidden();
        if (account.verifiedAt) throw conflict('This bank account is already verified.');
        if (account.createdById === request.auth.userId)
          throw forbidden('A different admin must verify bank details you entered (four-eyes check).');
        const previous = await tx.restaurantBankAccount.findFirst({
          where: { restaurantId: account.restaurantId, isPrimary: true },
        });
        if (previous)
          await tx.restaurantBankAccount.update({ where: { id: previous.id }, data: { isPrimary: false } });
        const after = await tx.restaurantBankAccount.update({
          where: { id },
          data: { verifiedAt: app.clock.now(), verifiedById: request.auth.userId, isPrimary: true },
        });
        await audit(tx, request, {
          action: 'restaurant_bank_account.verify',
          entityType: 'restaurant',
          entityId: account.restaurantId,
          oldValue: previous ? { primaryAccountId: previous.id, last4: previous.accountNumberLast4 } : null,
          newValue: { primaryAccountId: after.id, last4: after.accountNumberLast4 },
        });
        return bankAccountDto(after);
      });
    },
  );
}
