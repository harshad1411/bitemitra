// Which restaurants a customer at a location can order from, and how they are presented (D-47, D-48).
// One pass per request with a constant number of queries; city-sized candidate sets are ranked in memory.
import { branchOpenState, productAvailability } from '@jamzo/catalog-engine';
import { haversineM, pointInGeometry } from '@jamzo/delivery-engine';
import { resolveScoped } from '@jamzo/config';
import { deliveryFee, parseRuleParams } from '@jamzo/pricing-engine';
import { AppError, notFound } from '../../core/errors.js';
import { resolvePoint } from '../geography/service.js';
import { deliveryDistance } from '../delivery/distance.js';
import { mediaUrls } from '../media/urls.js';
import { loadRuleSet, ruleTargets } from '../pricing/service.js';
import { publicRating } from '../reviews/service.js';

/**
 * Resolves the customer's location from query/body: an owned saved address or lat/lng.
 * @returns {Promise<{ point: { lat: number, lng: number }, addressId: string | null }>}
 */
export async function locationFrom(prisma, request, input) {
  if (input.addressId) {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Sign in to use a saved address.');
    const address = await prisma.customerAddress.findFirst({
      where: { id: input.addressId, deletedAt: null, customer: { userId: request.auth.userId } },
    });
    if (!address) throw notFound('Address');
    return { point: { lat: Number(address.lat), lng: Number(address.lng) }, addressId: address.id };
  }
  if (input.lat === undefined || input.lng === undefined)
    throw new AppError('VALIDATION_FAILED', 'Choose a delivery location.', {
      fieldErrors: { lat: ['Required'], lng: ['Required'] },
    });
  return { point: { lat: input.lat, lng: input.lng }, addressId: null };
}

/** Promotion summary text for listing cards ("10% off up to ₹100"). */
export function offerText(p) {
  const rupees = (v) => `₹${Math.floor(v / 100)}`;
  if (p.discountType === 'FREE_DELIVERY')
    return `Free delivery${p.minOrderPaise ? ` above ${rupees(p.minOrderPaise)}` : ''}`;
  const what = p.discountType === 'PERCENTAGE' ? `${p.valueBps / 100}% off` : `${rupees(p.valuePaise)} off`;
  const cap =
    p.discountType === 'PERCENTAGE' && p.maxDiscountPaise ? ` up to ${rupees(p.maxDiscountPaise)}` : '';
  const min = p.minOrderPaise ? ` above ${rupees(p.minOrderPaise)}` : '';
  return `${what}${cap}${min}`;
}

/** Active promotions that can apply at a restaurant in a city/zone (targeting beyond that is checked in the quote). */
export function promotionsFor(promotions, { cityId, zoneId, restaurantId }, now) {
  return promotions.filter((p) => {
    const t = /** @type {any} */ (p.targeting ?? {});
    if (!p.isActive || p.startsAt > now || (p.endsAt && p.endsAt <= now)) return false;
    if (t.cityIds?.length && !t.cityIds.includes(cityId)) return false;
    if (t.zoneIds?.length && !t.zoneIds.includes(zoneId)) return false;
    if (t.restaurantIds?.length && !t.restaurantIds.includes(restaurantId)) return false;
    return true;
  });
}

/**
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {{ point: { lat: number, lng: number }, restaurantIds?: string[], now: Date }} opts
 *
 * Everything needed to list restaurants for a point. `restaurantIds` narrows the candidates (detail, cart).
 * Returns { place, candidates } where place.serviceable=false means nothing is deliverable here.
 */
export async function discover(app, { point, restaurantIds, now }) {
  const { prisma } = app;
  const { config, distance } = app.services;
  const place = await resolvePoint(prisma, point);
  if (!place.serviceable) return { place, candidates: [] };
  const city = place.city;
  const zone = place.zone;
  const ctx = { countryId: city.state.countryId, stateId: city.stateId, cityId: city.id, zoneId: zone.id };
  const [distanceSetting, eta, ops, reviews] = await Promise.all([
    config.resolve('delivery.distance', ctx),
    config.resolve('delivery.eta', ctx),
    config.resolve('restaurants.operations', ctx),
    config.resolve('reviews'),
  ]);

  const restaurants = await prisma.restaurant.findMany({
    where: {
      cityId: city.id,
      onboardingStatus: 'ACTIVE',
      zones: { some: { zoneId: zone.id } },
      ...(restaurantIds ? { id: { in: restaurantIds } } : {}),
    },
    include: {
      branches: {
        include: { businessHours: true, deliveryAreas: { where: { isActive: true } } },
      },
    },
  });
  const [rules, promotions, media] = await Promise.all([
    loadRuleSet(
      prisma,
      ruleTargets({
        ...ctx,
        zoneIds: [zone.id],
      })
        .concat(restaurants.map((r) => ({ scope: 'RESTAURANT', scopeRefId: r.id })))
        .concat(restaurants.flatMap((r) => r.branches.map((b) => ({ scope: 'BRANCH', scopeRefId: b.id })))),
      now,
      ['DELIVERY'],
    ),
    prisma.promotion.findMany({ where: { isActive: true, startsAt: { lte: now } } }),
    prisma.media.findMany({
      where: {
        id: { in: restaurants.flatMap((r) => [r.logoMediaId, r.coverMediaId]).filter(Boolean) },
        deletedAt: null,
        kind: 'IMAGE',
      },
    }),
  ]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const base = app.services.mediaBase;

  const candidates = [];
  for (const r of restaurants) {
    // The nearest branch whose own delivery area contains the customer (one branch per restaurant today — A-2).
    let best = null;
    for (const b of r.branches) {
      const area = b.deliveryAreas[0];
      if (!area) continue;
      const from = { lat: Number(b.lat), lng: Number(b.lng) };
      const straight = haversineM(from, point);
      const inside =
        area.kind === 'RADIUS'
          ? straight <= area.radiusM
          : pointInGeometry(point, /** @type {any} */ (area.geometry));
      if (!inside) continue;
      if (!best || straight < best.straight) best = { branch: b, from, straight };
    }
    if (!best) continue;
    const dist = await deliveryDistance(distance, distanceSetting.value, best.from, point);
    if ('unavailable' in dist || dist.distanceM > distanceSetting.value.maxDistanceM) continue;
    const deliveryCtx = { ...ctx, restaurantId: r.id, branchId: best.branch.id };
    const hit = resolveScoped(rules.delivery, deliveryCtx, now);
    if (!hit) continue; // no delivery price → not orderable (and not listed)
    const dp = /** @type {any} */ (parseRuleParams('DELIVERY', hit.winner));
    const fee = deliveryFee(dp, dist.distanceM);
    if (!fee.serviceable) continue;
    const b = best.branch;
    const open = branchOpenState(
      {
        restaurantStatus: r.onboardingStatus,
        isOpen: b.isOpen,
        pausedUntil: b.pausedUntil,
        hours: b.businessHours,
      },
      now,
      city.timezone,
    );
    const prep = b.prepTimeMinutes + (b.busyMode ? ops.value.busyExtraPrepMinutes : 0);
    const travel = Math.ceil((dist.distanceM / 1000 / eta.value.avgSpeedKmph) * 60);
    const etaMin = prep + travel + eta.value.bufferMinutes;
    const offers = promotionsFor(promotions, { cityId: city.id, zoneId: zone.id, restaurantId: r.id }, now);
    const logo = r.logoMediaId ? mediaById.get(r.logoMediaId) : null;
    const cover = r.coverMediaId ? mediaById.get(r.coverMediaId) : null;
    candidates.push({
      restaurant: r,
      branch: b,
      deliveryCtx,
      card: {
        id: r.id,
        slug: r.slug,
        name: r.name,
        cuisines: r.cuisines,
        isPureVeg: r.isPureVeg,
        isPromoted: r.isPromoted,
        rating: publicRating(r.ratingAvg, r.ratingCount, reviews.value.minCountToShow),
        area: b.area,
        logo: logo ? mediaUrls(logo, base) : null,
        cover: cover ? mediaUrls(cover, base) : null,
        distanceM: dist.distanceM,
        distanceSource: dist.source,
        eta: { minMinutes: etaMin, maxMinutes: etaMin + eta.value.rangeMinutes, estimate: true },
        delivery: { feePaise: fee.feePaise, freeAboveSubtotalPaise: dp.freeAboveSubtotalPaise ?? null },
        open: {
          isOpen: open.open,
          reason: open.reason,
          closesAt: open.closesAt,
          pausedUntil: open.pausedUntil,
          nextOpenAt: open.nextOpenAt,
          nextOpenLocal: open.nextOpenLocal,
        },
        offers: offers.map((o) => ({ id: o.id, text: offerText(o), discountType: o.discountType })),
        sortWeight: r.sortWeight,
        createdAt: r.createdAt,
      },
    });
  }
  return { place, candidates, city, zone };
}

/** Sorting for listing (open restaurants always first — D-47). */
export function sortCards(cards, sort) {
  const by = {
    RELEVANCE: (a, b) =>
      Number(b.isPromoted) - Number(a.isPromoted) || b.sortWeight - a.sortWeight || a.distanceM - b.distanceM,
    DISTANCE: (a, b) => a.distanceM - b.distanceM,
    DELIVERY_TIME: (a, b) => a.eta.minMinutes - b.eta.minMinutes,
    RATING: (a, b) =>
      (b.rating.average ?? 0) - (a.rating.average ?? 0) || (b.rating.count ?? 0) - (a.rating.count ?? 0),
    DELIVERY_FEE: (a, b) => a.delivery.feePaise - b.delivery.feePaise,
  }[sort];
  return [...cards].sort(
    (a, b) => Number(b.open.isOpen) - Number(a.open.isOpen) || by(a, b) || a.name.localeCompare(b.name),
  );
}

/** Customer-facing availability of a menu product (hides internal reasons). */
export function customerAvailability(p, now, timeZone) {
  const a = productAvailability(
    {
      status: p.status,
      isAvailable: p.isAvailable,
      stockQuantity: p.stockQuantity,
      windows: p.availability ?? [],
      schedules: p.schedules ?? [],
      variants: p.variants ?? [],
    },
    now,
    timeZone,
  );
  return { available: a.available, reason: a.reason, until: a.until, nextAvailableAt: a.nextAvailableAt };
}
