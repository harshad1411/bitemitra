// Ratings and reviews (D-110, OD-45): customers rate the items and the delivery partner of a delivered
// order; customers only ever see averages. Restaurants see their reviews with comments (no customer
// details), delivery partners their own average, Jamzo Admin everything and can hide abusive reviews.
import { z } from 'zod';
import { reviewBody, reviewListQuery, reviewModerateBody, uuid } from '@jamzo/validation';
import { isUniqueViolation } from '@jamzo/database';
import { maskPhone } from '@jamzo/logger';
import { AppError, notFound, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { idPage, toPage } from '../../core/pagination.js';
import { allowedCityIds } from '../../core/auth.js';
import { createMemberGuard } from '../restaurants/membership.js';
import { riderOf } from '../riders/service.js';
import { lockRated, recomputeRatings, reviewSettings, spread } from './service.js';

const idParam = z.object({ id: uuid });
const LOW = 2;
const isLow = (r) =>
  Number(r.foodRating) <= LOW ||
  (r.deliveryRating != null && r.deliveryRating <= LOW) ||
  (r.items ?? []).some((i) => i.rating <= LOW);

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function reviewRoutes(app) {
  const prisma = app.prisma;
  const { config } = app.services;
  const requireMember = createMemberGuard(prisma);

  // ── Customer app ─────────────────────────────────────────────────────────
  app.post(
    '/v1/customer/orders/:id/review',
    { config: { apps: ['CUSTOMER'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      if (!request.auth) throw unauthenticated();
      const { id } = parse(idParam, request.params);
      const body = parse(reviewBody, request.body);
      const settings = await reviewSettings(config);
      if (!settings.enabled) throw new AppError('FORBIDDEN', 'Ratings are switched off for now.');
      const order = await prisma.order.findFirst({
        where: { id, customer: { userId: request.auth.userId } },
        include: { items: true, review: true },
      });
      if (!order) throw notFound('Order');
      const now = app.clock.now();
      if (order.status !== 'DELIVERED' || !order.deliveredAt)
        throw new AppError('INVALID_STATE_TRANSITION', 'You can rate an order once it has been delivered.');
      if (now.getTime() > order.deliveredAt.getTime() + settings.windowDays * 86_400_000)
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `Orders can be rated within ${settings.windowDays} days of delivery.`,
        );
      if (order.review) throw new AppError('CONFLICT', 'You have already rated this order.');
      const byId = new Map(order.items.map((i) => [i.id, i]));
      const seen = new Set();
      for (const it of body.items) {
        if (!byId.has(it.orderItemId) || seen.has(it.orderItemId))
          throw new AppError('VALIDATION_FAILED', 'Rate the items of this order, once each.', {
            fieldErrors: { items: ['Unknown or repeated item'] },
          });
        seen.add(it.orderItemId);
      }
      if (body.deliveryRating && !order.riderId)
        throw new AppError('VALIDATION_FAILED', 'This order had no Jamzo delivery partner to rate.', {
          fieldErrors: { deliveryRating: ['No delivery partner on this order'] },
        });
      const foodRating =
        Math.round((body.items.reduce((n, i) => n + i.rating, 0) / body.items.length) * 100) / 100;
      const riderId = body.deliveryRating ? order.riderId : null;
      const productIds = [...new Set(body.items.map((i) => byId.get(i.orderItemId).productId))];
      try {
        const review = await prisma.$transaction(async (tx) => {
          await lockRated(tx, { restaurantId: order.restaurantId, riderId });
          const r = await tx.review.create({
            data: {
              orderId: order.id,
              customerId: order.customerId,
              restaurantId: order.restaurantId,
              riderId,
              foodRating,
              deliveryRating: body.deliveryRating ?? null,
              comment: body.comment || null,
              createdAt: now,
              items: {
                create: body.items.map((i) => ({
                  orderItemId: i.orderItemId,
                  productId: byId.get(i.orderItemId).productId,
                  rating: i.rating,
                })),
              },
            },
            include: { items: true },
          });
          await recomputeRatings(tx, { restaurantId: order.restaurantId, productIds, riderId });
          return r;
        });
        reply.code(201);
        return {
          foodRating: Number(review.foodRating),
          deliveryRating: review.deliveryRating,
          comment: review.comment,
          items: review.items.map((i) => ({ orderItemId: i.orderItemId, rating: i.rating })),
          createdAt: review.createdAt,
        };
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'You have already rated this order.');
        throw err;
      }
    },
  );

  // ── Restaurant Partner app ───────────────────────────────────────────────
  app.get(
    '/v1/restaurant/reviews',
    { config: { apps: ['RESTAURANT'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { restaurantId } = parse(z.object({ restaurantId: uuid }), request.query);
      await requireMember(request, restaurantId, 'orders.view');
      const where = { restaurantId, isHidden: false };
      const [restaurant, groups, rows] = await Promise.all([
        prisma.restaurant.findUnique({ where: { id: restaurantId } }),
        prisma.review.groupBy({ by: ['foodRating'], where, _count: { _all: true } }),
        prisma.review.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { order: true, items: { include: { orderItem: true } } },
        }),
      ]);
      return {
        rating: { average: Number(restaurant.ratingAvg), count: restaurant.ratingCount },
        spread: spread(groups, 'foodRating'),
        // No customer names or phone numbers, and not the delivery partner's stars (D-110).
        items: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          orderNumber: r.order.orderNumber,
          foodRating: Number(r.foodRating),
          comment: r.comment,
          items: r.items.map((i) => ({ name: i.orderItem.productName, rating: i.rating })),
        })),
      };
    },
  );

  // ── Delivery Partner app ─────────────────────────────────────────────────
  app.get(
    '/v1/rider/ratings',
    { config: { apps: ['RIDER'] } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const rider = await riderOf(prisma, request);
      const groups = await prisma.review.groupBy({
        by: ['deliveryRating'],
        where: { riderId: rider.id, isHidden: false, deliveryRating: { not: null } },
        _count: { _all: true },
      });
      // Their own average only: no comments, no customer details (D-110).
      return {
        rating: { average: Number(rider.ratingAvg), count: rider.ratingCount },
        spread: spread(groups, 'deliveryRating'),
      };
    },
  );

  // ── Jamzo Admin ──────────────────────────────────────────────────────────
  const cityScope = (request, permission) => {
    const cities = allowedCityIds(request, permission);
    return cities ? { restaurant: { cityId: { in: cities } } } : {};
  };
  const adminView = (r) => ({
    id: r.id,
    createdAt: r.createdAt,
    order: { id: r.order.id, orderNumber: r.order.orderNumber },
    restaurant: { id: r.restaurant.id, name: r.restaurant.name },
    rider: r.rider ? { id: r.rider.id, name: r.rider.user?.name ?? null } : null,
    customer: {
      name: r.customer.user?.name ?? null,
      phone: r.customer.user?.phone ? maskPhone(r.customer.user.phone) : null,
    },
    foodRating: Number(r.foodRating),
    deliveryRating: r.deliveryRating,
    comment: r.comment,
    items: r.items.map((i) => ({ name: i.orderItem.productName, rating: i.rating })),
    low: isLow(r),
    isHidden: r.isHidden,
    hiddenReason: r.hiddenReason,
    hiddenAt: r.hiddenAt,
  });
  const adminInclude = {
    order: true,
    restaurant: true,
    rider: { include: { user: true } },
    customer: { include: { user: true } },
    items: { include: { orderItem: true } },
  };

  app.get(
    '/v1/admin/reviews',
    { config: { permission: 'reviews.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(reviewListQuery, request.query);
      const page = idPage(q);
      const rows = await prisma.review.findMany({
        where: {
          ...page.where,
          ...cityScope(request, 'reviews.view'),
          ...(q.restaurantId ? { restaurantId: q.restaurantId } : {}),
          ...(q.riderId ? { riderId: q.riderId } : {}),
          ...(q.hidden ? { isHidden: q.hidden === 'true' } : {}),
          ...(q.low === 'true'
            ? {
                OR: [
                  { foodRating: { lte: LOW } },
                  { deliveryRating: { lte: LOW } },
                  { items: { some: { rating: { lte: LOW } } } },
                ],
              }
            : {}),
        },
        orderBy: page.orderBy,
        take: page.take,
        include: adminInclude,
      });
      const result = toPage(rows, q.limit);
      return { ...result, items: result.items.map(adminView) };
    },
  );

  app.patch(
    '/v1/admin/reviews/:id',
    { config: { permission: 'reviews.moderate' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(reviewModerateBody, request.body);
      const found = await prisma.review.findFirst({
        where: { id, ...cityScope(request, 'reviews.moderate') },
        include: { items: true },
      });
      if (!found) throw notFound('Review');
      if (found.isHidden === body.hidden) return adminView(await load(id));
      const now = app.clock.now();
      await prisma.$transaction(async (tx) => {
        await lockRated(tx, { restaurantId: found.restaurantId, riderId: found.riderId });
        await tx.review.update({
          where: { id },
          data: body.hidden
            ? { isHidden: true, hiddenReason: body.reason, hiddenById: request.auth.userId, hiddenAt: now }
            : { isHidden: false, hiddenReason: null, hiddenById: null, hiddenAt: null },
        });
        await recomputeRatings(tx, {
          restaurantId: found.restaurantId,
          productIds: [...new Set(found.items.map((i) => i.productId))],
          riderId: found.riderId,
        });
        await audit(tx, request, {
          action: body.hidden ? 'review.hidden' : 'review.shown',
          entityType: 'review',
          entityId: id,
          oldValue: { isHidden: found.isHidden, hiddenReason: found.hiddenReason },
          newValue: { isHidden: body.hidden, reason: body.reason ?? null },
        });
      });
      return adminView(await load(id));
    },
  );

  async function load(id) {
    return prisma.review.findUniqueOrThrow({ where: { id }, include: adminInclude });
  }
}
