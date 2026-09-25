// Delivery Partner app endpoints (spec §21, D-73 … D-78). Every request re-checks the rider's status —
// signing in never makes someone an active rider (OD-13). Riders see their own pay and the cash to collect,
// never food prices, commission or restaurant money.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deliverBody,
  offerRejectBody,
  pickupBody,
  riderDocumentFields,
  riderEarningsQuery,
  riderIssueBody,
  riderLocationsBody,
  riderProfileBody,
  riderStatusBody,
  riderUnassignBody,
  riderVehicleBody,
  pan,
  uuid,
} from '@jamzo/validation';
import { AppError, conflict, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { documentKey, sniffDocument } from '../media/storage.js';
import { resolvePoint } from '../geography/service.js';
import { publishNotice } from '../orders/service.js';
import { assertActive, codBalances, firstName, missingDocuments, riderOf } from './service.js';

const RIDER = { apps: ['RIDER'] };
const idParam = z.object({ id: uuid });
const ON_TRIP = ['ACCEPTED', 'AT_RESTAURANT', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'];
const num = (v) => (v == null ? null : Number(v));

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function riderAppRoutes(app) {
  const prisma = app.prisma;
  const { config, storage, env, dispatch, trips } = app.services;

  const riderInclude = {
    user: true,
    vehicles: { where: { isActive: true } },
    documents: { orderBy: { createdAt: /** @type {const} */ ('desc') } },
    availability: true,
  };

  async function required(rider) {
    const ctx = rider.cityId ? await config.contextFor('CITY', rider.cityId) : {};
    return (await config.resolve('riders.requiredDocuments', ctx)).value;
  }

  async function profile(rider) {
    const docs = missingDocuments(rider, await required(rider));
    const cod = (await codBalances(prisma, [rider.id])).get(rider.id) ?? 0;
    const codCfg = rider.cityId
      ? (await config.resolve('cod', await config.contextFor('CITY', rider.cityId))).value
      : null;
    return {
      id: rider.id,
      name: rider.user.name,
      phone: rider.user.phone,
      cityId: rider.cityId,
      addressLine: rider.addressLine,
      onboardingStatus: rider.onboardingStatus,
      vehicle: docs.vehicle && {
        type: docs.vehicle.type,
        registrationNumber: docs.vehicle.registrationNumber,
      },
      documents: {
        required: docs.required,
        missing: docs.missing,
        verified: docs.verified,
        items: [...docs.latest.values()].map((d) => ({
          id: d.id,
          kind: d.kind,
          status: d.status,
          numberLast4: d.numberLast4,
          reviewNote: d.status === 'REJECTED' ? d.reviewNote : null,
          uploadedAt: d.createdAt,
        })),
      },
      canSubmit:
        ['APPLIED', 'DOCUMENT_PENDING'].includes(rider.onboardingStatus) &&
        Boolean(rider.user.name) &&
        Boolean(rider.cityId) &&
        Boolean(docs.vehicle) &&
        docs.missing.length === 0,
      online: rider.availability?.isOnline ?? false,
      activeOrderCount: rider.availability?.activeOrderCount ?? 0,
      cod: {
        enabled: rider.codEnabled,
        balancePaise: cod,
        limitPaise: rider.codLimitPaise ?? codCfg?.riderLimitPaise ?? null,
      },
    };
  }

  // ── Application (D-73) ──
  app.get(
    '/v1/rider/me',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const rider = await prisma.rider.findUnique({
        where: { userId: request.auth.userId },
        include: riderInclude,
      });
      if (!rider) return { applied: false, cities: await liveCities() };
      return { applied: true, rider: await profile(rider), cities: await liveCities() };
    },
  );
  const liveCities = () =>
    prisma.city.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

  app.put(
    '/v1/rider/me',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(riderProfileBody, request.body);
      const city = await prisma.city.findFirst({ where: { id: body.cityId, isActive: true } });
      if (!city) throw invalid('Jamzo does not operate in this city yet.', { cityId: ['Not available'] });
      await prisma.$transaction(async (tx) => {
        const existing = await tx.rider.findUnique({ where: { userId: request.auth.userId } });
        if (
          existing &&
          !['APPLIED', 'DOCUMENT_PENDING', 'ACTIVE', 'UNDER_REVIEW'].includes(existing.onboardingStatus)
        )
          throw new AppError(
            'FORBIDDEN',
            'Your application cannot be changed now. Please contact partner support.',
          );
        if (existing?.onboardingStatus === 'ACTIVE' && existing.cityId !== body.cityId)
          throw new AppError('FORBIDDEN', 'Ask partner support to move you to another city.');
        await tx.user.update({ where: { id: request.auth.userId }, data: { name: body.name } });
        await tx.rider.upsert({
          where: { userId: request.auth.userId },
          create: {
            userId: request.auth.userId,
            cityId: body.cityId,
            addressLine: body.addressLine ?? null,
            onboardingStatus: 'APPLIED',
          },
          update: { cityId: body.cityId, addressLine: body.addressLine ?? null },
        });
      });
      return profile(await riderOf(prisma, request, riderInclude));
    },
  );

  app.put(
    '/v1/rider/vehicle',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(riderVehicleBody, request.body);
      const rider = await riderOf(prisma, request);
      if (body.type !== 'BICYCLE' && !body.registrationNumber)
        throw invalid('Enter the vehicle registration number.', { registrationNumber: ['Required'] });
      if (rider.onboardingStatus === 'ACTIVE')
        throw new AppError(
          'FORBIDDEN',
          'Ask partner support to change your vehicle — its documents must be checked again.',
        );
      await prisma.$transaction(async (tx) => {
        await tx.riderVehicle.updateMany({
          where: { riderId: rider.id, isActive: true },
          data: { isActive: false },
        });
        await tx.riderVehicle.create({
          data: { riderId: rider.id, type: body.type, registrationNumber: body.registrationNumber ?? null },
        });
      });
      return profile(await riderOf(prisma, request, riderInclude));
    },
  );

  // Documents: photos stored privately (D-36); numbers encrypted, only the last 4 shown (D-73).
  app.post(
    '/v1/rider/documents',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const rider = await riderOf(prisma, request);
      if (!['APPLIED', 'DOCUMENT_PENDING'].includes(rider.onboardingStatus))
        throw new AppError('FORBIDDEN', 'Documents can be changed only while your application is open.');
      if (!request.isMultipart())
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the document as multipart/form-data.');
      /** @type {Record<string, string>} */
      const fields = {};
      let file = null;
      for await (const part of request.parts({
        limits: { fileSize: env.MEDIA_MAX_BYTES, files: 1, fields: 5 },
      })) {
        if (part.type === 'file') {
          try {
            file = { buffer: await part.toBuffer(), filename: part.filename };
          } catch (err) {
            if (/** @type {any} */ (err).code === 'FST_REQ_FILE_TOO_LARGE')
              throw new AppError(
                'PAYLOAD_TOO_LARGE',
                `Photos must be at most ${Math.floor(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`,
              );
            throw err;
          }
        } else fields[part.fieldname] = String(part.value);
      }
      const meta = parse(riderDocumentFields, { kind: fields.kind, number: fields.number || null });
      if (meta.kind === 'PAN' && meta.number) {
        const checked = pan.safeParse(meta.number);
        if (!checked.success)
          throw invalid('The PAN is not valid.', { number: [checked.error.issues[0].message] });
        meta.number = checked.data;
      }
      if (!file) throw invalid('Take a photo of the document.', { file: ['Required'] });
      const type = sniffDocument(file.buffer);
      if (!type) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Documents must be JPEG, PNG or PDF files.');
      const mediaId = randomUUID();
      const key = documentKey(mediaId, type.ext);
      await storage.put(key, file.buffer, type.mime);
      try {
        const doc = await prisma.$transaction(async (tx) => {
          await tx.media.create({
            data: {
              id: mediaId,
              kind: 'DOCUMENT',
              storageKey: key,
              mimeType: type.mime,
              sizeBytes: file.buffer.length,
              status: 'READY',
              uploadedById: request.auth.userId,
            },
          });
          const d = await tx.riderDocument.create({
            data: {
              riderId: rider.id,
              kind: meta.kind,
              number: meta.number ? app.services.fieldCipher.encrypt(meta.number) : null,
              numberLast4: meta.number ? meta.number.slice(-4) : null,
              mediaId,
            },
          });
          await audit(tx, request, {
            action: 'rider_document.add',
            entityType: 'rider',
            entityId: rider.id,
            newValue: { documentId: d.id, kind: d.kind },
          });
          return d;
        });
        reply.code(201);
        return { id: doc.id, kind: doc.kind, status: doc.status, numberLast4: doc.numberLast4 };
      } catch (err) {
        await storage.remove(key).catch(() => {});
        throw err;
      }
    },
  );

  app.post(
    '/v1/rider/application/submit',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const rider = await riderOf(prisma, request, riderInclude);
      const p = await profile(rider);
      if (!p.canSubmit)
        throw invalid('Complete your details, vehicle and documents first.', {
          ...(p.documents.missing.length
            ? { documents: [`Missing: ${p.documents.missing.join(', ')}`] }
            : {}),
          ...(!p.vehicle ? { vehicle: ['Required'] } : {}),
        });
      await prisma.$transaction(async (tx) => {
        await tx.rider.update({ where: { id: rider.id }, data: { onboardingStatus: 'UNDER_REVIEW' } });
        await audit(tx, request, {
          action: 'rider.submit',
          entityType: 'rider',
          entityId: rider.id,
          oldValue: { status: rider.onboardingStatus },
          newValue: { status: 'UNDER_REVIEW' },
        });
      });
      return profile(await riderOf(prisma, request, riderInclude));
    },
  );

  // ── Online / offline and location (D-74) ──
  app.post(
    '/v1/rider/status',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { online } = parse(riderStatusBody, request.body);
      const rider = await riderOf(prisma, request);
      assertActive(rider);
      const now = app.clock.now();
      await prisma.$transaction(async (tx) => {
        const av = await tx.riderAvailability.upsert({
          where: { riderId: rider.id },
          create: { riderId: rider.id },
          update: {},
        });
        if (!online && av.activeOrderCount > 0)
          throw conflict('Finish or hand back your current delivery before going offline.');
        if (online === av.isOnline) return;
        await tx.riderAvailability.update({ where: { riderId: rider.id }, data: { isOnline: online } });
        if (online)
          await tx.riderShift.create({ data: { riderId: rider.id, startedAt: now, zoneId: av.zoneId } });
        else
          await tx.riderShift.updateMany({
            where: { riderId: rider.id, endedAt: null },
            data: { endedAt: now },
          });
      });
      return profile(await riderOf(prisma, request, riderInclude));
    },
  );

  app.post(
    '/v1/rider/locations',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { points } = parse(riderLocationsBody, request.body);
      const rider = await riderOf(prisma, request, { availability: true });
      assertActive(rider);
      if (!rider.availability?.isOnline) return { accepted: 0, online: false };
      const now = app.clock.now();
      const valid = points
        .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
        .filter((p) => p.at.getTime() <= now.getTime() + 60_000 && p.at.getTime() > now.getTime() - 3_600_000)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      if (!valid.length) return { accepted: 0, online: true };
      const latest = valid[valid.length - 1];
      const trip = await prisma.order.findFirst({
        where: { riderId: rider.id, deliveryStatus: { in: ON_TRIP } },
        select: { id: true, customerId: true },
      });
      const place = await resolvePoint(prisma, { lat: latest.lat, lng: latest.lng });
      await prisma.$transaction(async (tx) => {
        await tx.riderLocation.createMany({
          data: valid.map((p) => ({
            riderId: rider.id,
            lat: p.lat,
            lng: p.lng,
            accuracyM: p.accuracyM ?? null,
            speedMps: p.speedMps ?? null,
            headingDeg: p.headingDeg ?? null,
            orderId: trip?.id ?? null,
            recordedAt: p.at,
            receivedAt: now,
          })),
        });
        const newer = !rider.availability.lastLocationAt || latest.at > rider.availability.lastLocationAt;
        if (newer)
          await tx.riderAvailability.update({
            where: { riderId: rider.id },
            data: {
              lastLat: latest.lat,
              lastLng: latest.lng,
              lastLocationAt: latest.at,
              zoneId: place.zone?.id ?? null,
            },
          });
        // Customers following a trip see a rounded position (about 100 m — D-79).
        if (newer && trip)
          await publishNotice(tx, {
            kind: 'rider_location',
            orderId: trip.id,
            customerId: trip.customerId,
            lat: Math.round(latest.lat * 1000) / 1000,
            lng: Math.round(latest.lng * 1000) / 1000,
            at: latest.at.toISOString(),
          });
      });
      return { accepted: valid.length, online: true, zoneId: place.zone?.id ?? null };
    },
  );

  // ── Work: the current offer or trip ──
  async function flagsFor(order) {
    return config.flagMap({ cityId: order.cityId, zoneId: order.zoneId, appId: 'RIDER' });
  }

  function tripView(o, flags) {
    const branch = o.branch;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      shortNumber: o.orderNumber.slice(-4),
      status: o.status,
      deliveryStatus: o.deliveryStatus,
      restaurantStatus: o.restaurantStatus,
      version: o.version,
      restaurant: {
        name: o.restaurant.name,
        address: branch.addressLine,
        lat: num(branch.lat),
        lng: num(branch.lng),
        foodReady: o.restaurantStatus === 'READY_FOR_PICKUP' || o.restaurantStatus === 'COMPLETED',
        estimatedReadyAt:
          o.acceptedAt && o.prepTimeMinutes
            ? new Date(o.acceptedAt.getTime() + o.prepTimeMinutes * 60_000)
            : null,
      },
      // Item names and quantities help check the bag; no prices (§21).
      items: o.items.map((i) => ({ name: i.productName, variantName: i.variantName, quantity: i.quantity })),
      customer: {
        firstName: firstName(o.customer.user.name),
        address:
          o.address &&
          [o.address.line1, o.address.line2, o.address.landmark, o.address.area].filter(Boolean).join(', '),
        lat: o.address && num(o.address.lat),
        lng: o.address && num(o.address.lng),
        instructions: o.deliveryInstructions,
        contactless: o.contactless,
      },
      // Calls go through Jamzo support until a masked-calling provider exists (D-80).
      contact: { via: 'SUPPORT' },
      cashToCollectPaise: o.paymentMethod === 'COD' ? o.codAmountPaise : 0,
      requires: { deliveryCode: Boolean(flags.delivery_otp), proofPhoto: Boolean(flags.proof_of_delivery) },
      estimatedEarningPaise:
        (o.pricingSnapshot?.riderEarningEstimatePaise ?? 0) + (o.pricingSnapshot?.tipPaise ?? 0),
    };
  }
  const tripInclude = {
    restaurant: true,
    items: true,
    address: true,
    pricingSnapshot: true,
    customer: { include: { user: true } },
  };
  async function withBranch(o) {
    return { ...o, branch: await prisma.restaurantBranch.findUnique({ where: { id: o.branchId } }) };
  }

  app.get(
    '/v1/rider/work',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const rider = await riderOf(prisma, request, { availability: true });
      assertActive(rider);
      const now = app.clock.now();
      const support = (await config.resolve('support.contact')).value;
      const tripOrder = await prisma.order.findFirst({
        where: { riderId: rider.id, deliveryStatus: { in: ON_TRIP } },
        include: tripInclude,
      });
      const offer = await prisma.orderAssignment.findFirst({
        where: { riderId: rider.id, status: 'OFFERED', expiresAt: { gt: now } },
        include: { order: { include: tripInclude } },
        orderBy: { offeredAt: 'desc' },
      });
      let offerView = null;
      if (offer) {
        const o = await withBranch(offer.order);
        const t = tripView(o, await flagsFor(o));
        offerView = {
          assignmentId: offer.id,
          expiresAt: offer.expiresAt,
          pickupDistanceM: offer.pickupDistanceM,
          deliveryDistanceM: o.pricingSnapshot?.distanceM ?? null,
          restaurant: { name: t.restaurant.name, address: t.restaurant.address },
          dropArea: o.address?.area ?? o.address?.cityName ?? null,
          itemCount: o.itemCount,
          cashToCollectPaise: t.cashToCollectPaise,
          estimatedEarningPaise: t.estimatedEarningPaise,
          manual: offer.isManual,
        };
      }
      return {
        online: rider.availability?.isOnline ?? false,
        offer: offerView,
        trip: tripOrder ? tripView(await withBranch(tripOrder), await flagsFor(tripOrder)) : null,
        support: { phone: support.phone },
        intervals: (
          await config.resolve(
            'riders.location',
            rider.cityId ? await config.contextFor('CITY', rider.cityId) : {},
          )
        ).value,
      };
    },
  );

  const riderActive = async (request) => {
    const rider = await riderOf(prisma, request);
    assertActive(rider);
    return rider;
  };

  app.post(
    '/v1/rider/offers/:id/accept',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const rider = await riderActive(request);
      const r = await dispatch.respond({ riderId: rider.id, assignmentId: id, accept: true });
      return { accepted: true, orderId: r.order.id };
    },
  );
  app.post(
    '/v1/rider/offers/:id/reject',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const { reason } = parse(offerRejectBody, request.body);
      const rider = await riderActive(request);
      await dispatch.respond({ riderId: rider.id, assignmentId: id, accept: false, reason });
      return { rejected: true };
    },
  );

  // ── Trip steps (D-76) ──
  const tripRoute = (path, schema, run) =>
    app.post(
      `/v1/rider/trips/:id/${path}`,
      { config: RIDER },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const { id } = parse(idParam, request.params);
        const body = schema ? parse(schema, request.body) : {};
        const rider = await riderActive(request);
        await run(rider, id, body, request);
        const o = await prisma.order.findUnique({ where: { id }, include: tripInclude });
        return tripView(await withBranch(o), await flagsFor(o));
      },
    );
  tripRoute('at-restaurant', null, (rider, id) => trips.atRestaurant(rider.id, id));
  tripRoute('picked-up', pickupBody, (rider, id, body) => trips.pickedUp(rider.id, id, body.orderDigits));
  tripRoute('arrived', null, (rider, id) => trips.arrived(rider.id, id));
  tripRoute('delivered', deliverBody, async (rider, id, body) => {
    const o = await prisma.order.findUnique({ where: { id } });
    if (!o || o.riderId !== rider.id) throw notFound('Trip');
    await trips.delivered(rider.id, id, body, await flagsFor(o));
  });
  tripRoute('unassign', riderUnassignBody, (rider, id, body) =>
    dispatch.unassign({
      orderId: id,
      riderId: rider.id,
      actor: { type: 'RIDER', id: rider.id },
      reason: body.reason,
    }),
  );

  app.post(
    '/v1/rider/trips/:id/issue',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(riderIssueBody, request.body);
      const rider = await riderActive(request);
      await prisma.$transaction(async (tx) => {
        const o = await tx.order.findUnique({ where: { id } });
        if (!o || o.riderId !== rider.id) throw notFound('Trip');
        await tx.order.update({
          where: { id },
          data: { needsAttention: true, attentionReason: `RIDER_${body.kind}` },
        });
        await tx.orderNote.create({
          data: {
            orderId: id,
            authorType: 'RIDER',
            authorId: rider.id,
            isInternal: true,
            body: `Rider reported ${body.kind}${body.note ? `: ${body.note}` : ''}`,
            createdAt: app.clock.now(),
          },
        });
        await publishNotice(tx, {
          kind: 'order',
          event: 'order.issue_reported',
          orderId: id,
          restaurantId: o.restaurantId,
          customerId: o.customerId,
          status: o.status,
          restaurantStatus: o.restaurantStatus,
          deliveryStatus: o.deliveryStatus,
          needsAttention: true,
          riderId: rider.id,
        });
      });
      return { reported: true };
    },
  );

  // Proof-of-delivery photo (private, like documents).
  app.post(
    '/v1/rider/proof',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      await riderActive(request);
      const part = await request.file({ limits: { fileSize: env.MEDIA_MAX_BYTES } });
      if (!part) throw invalid('Take a photo first.', { file: ['Required'] });
      const buffer = await part.toBuffer();
      const type = sniffDocument(buffer);
      if (!type || type.ext === 'pdf')
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Upload a JPEG or PNG photo.');
      const mediaId = randomUUID();
      const key = documentKey(mediaId, type.ext);
      await storage.put(key, buffer, type.mime);
      await prisma.media.create({
        data: {
          id: mediaId,
          kind: 'DOCUMENT',
          storageKey: key,
          mimeType: type.mime,
          sizeBytes: buffer.length,
          status: 'READY',
          uploadedById: request.auth.userId,
        },
      });
      reply.code(201);
      return { mediaId };
    },
  );

  // ── Earnings and cash (D-77, D-78) ──
  app.get(
    '/v1/rider/earnings',
    { config: RIDER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { range } = parse(riderEarningsQuery, request.query);
      const rider = await riderOf(prisma, request);
      const tz = rider.cityId
        ? (await prisma.city.findUnique({ where: { id: rider.cityId } })).timezone
        : 'Asia/Kolkata';
      const since = startOf(range, app.clock.now(), tz);
      const rows = await prisma.riderEarning.findMany({
        where: { riderId: rider.id, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const orders = await prisma.order.findMany({
        where: { id: { in: rows.map((r) => r.orderId) } },
        select: { id: true, orderNumber: true },
      });
      const numbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
      const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
      return {
        range,
        since,
        totalPaise: sum((r) => r.totalPaise),
        tripsPaise: sum(
          (r) =>
            /** @type {any} */ (r.breakdown).tripPaise ?? (r.kind === 'CANCELLED_TRIP' ? r.totalPaise : 0),
        ),
        tipsPaise: sum((r) => /** @type {any} */ (r.breakdown).tipPaise ?? 0),
        deliveries: rows.filter((r) => r.kind === 'DELIVERY').length,
        items: rows.map((r) => ({
          orderNumber: numbers.get(r.orderId),
          kind: r.kind,
          totalPaise: r.totalPaise,
          breakdown: r.breakdown,
          at: r.createdAt,
        })),
        note: 'Payouts arrive with settlements (Phase 8).',
      };
    },
  );
}

/** Start of today / of this week (Monday) in the city's timezone. */
export function startOf(range, now, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  // The zone's offset right now: local wall-clock time read as UTC, minus the real instant.
  const localAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offsetMs = Math.round((localAsUtc - now.getTime()) / 60_000) * 60_000;
  const midnight = Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs;
  const back = range === 'WEEK' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) : 0;
  return new Date(midnight - back * 86_400_000);
}
