// Geography (DELIVERY.md §1, OD-6): countries → states → cities → zones → service areas, plus the
// public serviceability check. City Managers only see and change their own city.
import { z } from 'zod';
import {
  cityCreateBody,
  cityUpdateBody,
  countryCreateBody,
  pageQuery,
  serviceAreaCreateBody,
  serviceAreaUpdateBody,
  serviceabilityQuery,
  stateCreateBody,
  uuid,
  zoneCreateBody,
  zoneUpdateBody,
} from '@jamzo/validation';
import { bboxOf, resolveServiceability } from '@jamzo/delivery-engine';
import { isUniqueViolation } from '@jamzo/database';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allowedCityIds, canInCity, requireGlobal } from '../../core/auth.js';
import { namePage, toPage } from '../../core/pagination.js';
import { withIdempotency } from '../../core/idempotency.js';

const idParam = z.object({ id: uuid });
const num = (d) => (d == null ? null : Number(d));
const cityDto = (c) => ({ ...c, centerLat: num(c.centerLat), centerLng: num(c.centerLng) });
const zoneDto = (z) => ({ ...z, minLat: num(z.minLat), minLng: num(z.minLng), maxLat: num(z.maxLat), maxLng: num(z.maxLng) });
const areaDto = (a) => ({ ...a, centerLat: num(a.centerLat), centerLng: num(a.centerLng) });

/** Translate a unique violation into a friendly 409. */
async function unique(promise, message) {
  try {
    return await promise;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(message);
    throw err;
  }
}

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function geographyRoutes(app) {
  const prisma = app.prisma;

  const assertCity = (request, permission, cityId) => {
    if (!canInCity(request, permission, cityId)) throw forbidden('You do not have access to this city.');
  };

  // ── Public serviceability ──
  app.get('/v1/geo/serviceability', { config: { auth: 'optional', rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { lat, lng } = parse(serviceabilityQuery, request.query);
    // Indexed bbox pre-filter, then exact point-in-polygon in the pure engine.
    const zones = await prisma.zone.findMany({
      where: { isActive: true, minLat: { lte: lat }, maxLat: { gte: lat }, minLng: { lte: lng }, maxLng: { gte: lng } },
      include: { city: true, serviceAreas: { where: { isActive: true } } },
    });
    // More specific (smaller) zones first when zones overlap.
    zones.sort((a, b) => area(a) - area(b));
    const result = resolveServiceability(
      { lat, lng },
      {
        cities: zones.map((z) => z.city),
        zones: zones.map((z) => ({ id: z.id, name: z.name, slug: z.slug, cityId: z.cityId, isActive: z.isActive, geometry: z.geometry })),
        serviceAreas: zones.flatMap((z) => z.serviceAreas.map(areaDto)),
      },
    );
    return {
      serviceable: result.serviceable,
      reason: result.reason,
      city: result.city ? { id: result.city.id, name: result.city.name, slug: result.city.slug } : null,
      zone: result.zone ? { id: result.zone.id, name: result.zone.name, slug: result.zone.slug } : null,
    };
  });

  // ── Countries & states (platform-wide: global permission only) ──
  app.get('/v1/admin/geo/countries', { config: { permission: 'geo.view' } }, async () => ({
    items: await prisma.country.findMany({ orderBy: { name: 'asc' }, include: { states: { orderBy: { name: 'asc' } } } }),
  }));

  app.post('/v1/admin/geo/countries', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    requireGlobal(request, 'geo.manage');
    const body = parse(countryCreateBody, request.body);
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        const country = await unique(tx.country.create({ data: body }), 'A country with this code already exists.');
        await audit(tx, request, { action: 'country.create', entityType: 'country', entityId: country.id, newValue: country });
        return country;
      }),
    );
  });

  app.post('/v1/admin/geo/states', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    requireGlobal(request, 'geo.manage');
    const body = parse(stateCreateBody, request.body);
    if (!(await prisma.country.findUnique({ where: { id: body.countryId } }))) throw notFound('Country');
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        const state = await unique(tx.state.create({ data: body }), 'This state code already exists in the country.');
        await audit(tx, request, { action: 'state.create', entityType: 'state', entityId: state.id, newValue: state });
        return state;
      }),
    );
  });

  // ── Cities ──
  app.get('/v1/admin/geo/cities', { config: { permission: 'geo.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const q = parse(pageQuery.extend({ isActive: z.enum(['true', 'false']).optional() }), request.query);
    const allowed = allowedCityIds(request, 'geo.view');
    const page = namePage(q);
    const where = {
      AND: [
        page.where,
        allowed ? { id: { in: allowed } } : {},
        q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] } : {},
        q.isActive ? { isActive: q.isActive === 'true' } : {},
      ],
    };
    const rows = await prisma.city.findMany({
      where,
      orderBy: page.orderBy,
      take: page.take,
      include: { state: { include: { country: true } }, _count: { select: { zones: true } } },
    });
    return toPage(rows.map(cityDto), q.limit, 'name');
  });

  app.post('/v1/admin/geo/cities', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    requireGlobal(request, 'geo.manage');
    const body = parse(cityCreateBody, request.body);
    if (!(await prisma.state.findUnique({ where: { id: body.stateId } }))) throw notFound('State');
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        const city = await unique(tx.city.create({ data: body }), 'A city with this slug already exists.');
        await audit(tx, request, { action: 'city.create', entityType: 'city', entityId: city.id, newValue: cityDto(city) });
        return cityDto(city);
      }),
    );
  });

  app.get('/v1/admin/geo/cities/:id', { config: { permission: 'geo.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    assertCity(request, 'geo.view', id);
    const city = await prisma.city.findUnique({
      where: { id },
      include: { state: { include: { country: true } }, zones: { orderBy: { name: 'asc' }, include: { serviceAreas: { orderBy: { name: 'asc' } } } } },
    });
    if (!city) throw notFound('City');
    return { ...cityDto(city), zones: city.zones.map((z) => ({ ...zoneDto(z), serviceAreas: z.serviceAreas.map(areaDto) })) };
  });

  app.patch('/v1/admin/geo/cities/:id', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    assertCity(request, 'geo.manage', id);
    const body = parse(cityUpdateBody.extend({ reason: z.string().trim().min(3).max(500).optional() }), request.body);
    const { reason, ...data } = body;
    if (data.isActive !== undefined && !request.auth.admin.global.has('geo.manage')) {
      throw forbidden('Launching or pausing a city needs platform-wide geography permission.');
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.city.findUnique({ where: { id } });
      if (!before) throw notFound('City');
      if (data.isActive !== undefined && data.isActive !== before.isActive && !reason) {
        throw new AppError('VALIDATION_FAILED', 'A reason is required to launch or pause a city.', { fieldErrors: { reason: ['Required'] } });
      }
      const after = await unique(tx.city.update({ where: { id }, data }), 'A city with this slug already exists.');
      await audit(tx, request, { action: 'city.update', entityType: 'city', entityId: id, oldValue: cityDto(before), newValue: { ...cityDto(after), reason: reason ?? null } });
      return cityDto(after);
    });
  });

  // ── Zones ──
  app.post('/v1/admin/geo/zones', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(zoneCreateBody, request.body);
    assertCity(request, 'geo.manage', body.cityId);
    if (!(await prisma.city.findUnique({ where: { id: body.cityId } }))) throw notFound('City');
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        const zone = await unique(tx.zone.create({ data: { ...body, ...bboxOf(body.geometry) } }), 'A zone with this slug already exists in the city.');
        await audit(tx, request, { action: 'zone.create', entityType: 'zone', entityId: zone.id, newValue: zoneDto(zone) });
        return zoneDto(zone);
      }),
    );
  });

  app.get('/v1/admin/geo/zones/:id', { config: { permission: 'geo.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const zone = await prisma.zone.findUnique({ where: { id }, include: { city: true, serviceAreas: { orderBy: { name: 'asc' } } } });
    if (!zone) throw notFound('Zone');
    assertCity(request, 'geo.view', zone.cityId);
    return { ...zoneDto(zone), city: cityDto(zone.city), serviceAreas: zone.serviceAreas.map(areaDto) };
  });

  app.patch('/v1/admin/geo/zones/:id', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(zoneUpdateBody, request.body);
    return prisma.$transaction(async (tx) => {
      const before = await tx.zone.findUnique({ where: { id } });
      if (!before) throw notFound('Zone');
      assertCity(request, 'geo.manage', before.cityId);
      const data = body.geometry ? { ...body, ...bboxOf(body.geometry) } : body;
      const after = await unique(tx.zone.update({ where: { id }, data }), 'A zone with this slug already exists in the city.');
      await audit(tx, request, { action: 'zone.update', entityType: 'zone', entityId: id, oldValue: zoneDto(before), newValue: zoneDto(after) });
      return zoneDto(after);
    });
  });

  // ── Service areas ──
  app.post('/v1/admin/geo/service-areas', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(serviceAreaCreateBody, request.body);
    const zone = await prisma.zone.findUnique({ where: { id: body.zoneId } });
    if (!zone) throw notFound('Zone');
    assertCity(request, 'geo.manage', zone.cityId);
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        const created = await tx.serviceArea.create({ data: body });
        await audit(tx, request, { action: 'service_area.create', entityType: 'service_area', entityId: created.id, newValue: areaDto(created) });
        return areaDto(created);
      }),
    );
  });

  app.patch('/v1/admin/geo/service-areas/:id', { config: { permission: 'geo.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(serviceAreaUpdateBody, request.body);
    return prisma.$transaction(async (tx) => {
      const before = await tx.serviceArea.findUnique({ where: { id }, include: { zone: true } });
      if (!before) throw notFound('Service area');
      assertCity(request, 'geo.manage', before.zone.cityId);
      const after = await tx.serviceArea.update({ where: { id }, data: body });
      const { zone: _zone, ...old } = before;
      await audit(tx, request, { action: 'service_area.update', entityType: 'service_area', entityId: id, oldValue: areaDto(old), newValue: areaDto(after) });
      return areaDto(after);
    });
  });
}

function area(z) {
  return (Number(z.maxLat) - Number(z.minLat)) * (Number(z.maxLng) - Number(z.minLng));
}
