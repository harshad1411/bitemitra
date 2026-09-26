// Ratings and reviews (D-110). Averages are recomputed from visible reviews inside the same transaction as
// the change, with the restaurant (and delivery partner) row locked so concurrent reviews cannot leave a
// stale average.

/** Settings with safe defaults. */
export async function reviewSettings(config) {
  return (await config.resolve('reviews')).value;
}

/**
 * What customers see of an average: nothing until there are enough ratings (D-110).
 * @param {unknown} avg Decimal from the database
 * @param {number} count
 * @param {number} min
 * @returns {{ average: number | null, count: number | null }}
 */
export function publicRating(avg, count, min) {
  return count >= min
    ? { average: Math.round(Number(avg) * 10) / 10, count }
    : { average: null, count: null };
}

/**
 * Locks the rows whose averages will change. Always restaurant first, then the partner (no lock cycles).
 * @param {any} tx
 * @param {{ restaurantId: string, riderId?: string | null }} p
 */
export async function lockRated(tx, { restaurantId, riderId }) {
  await tx.$queryRaw`SELECT id FROM restaurants WHERE id = ${restaurantId}::uuid FOR UPDATE`;
  if (riderId) await tx.$queryRaw`SELECT id FROM riders WHERE id = ${riderId}::uuid FOR UPDATE`;
}

const avg2 = (v) => (v == null ? 0 : Math.round(Number(v) * 100) / 100);

/**
 * Recomputes the averages touched by a review (visible reviews only).
 * @param {any} tx
 * @param {{ restaurantId: string, productIds: string[], riderId?: string | null }} p
 */
export async function recomputeRatings(tx, { restaurantId, productIds, riderId }) {
  const r = await tx.review.aggregate({
    where: { restaurantId, isHidden: false },
    _avg: { foodRating: true },
    _count: { _all: true },
  });
  await tx.restaurant.update({
    where: { id: restaurantId },
    data: { ratingAvg: avg2(r._avg.foodRating), ratingCount: r._count._all },
  });
  if (productIds.length) {
    const rows = await tx.reviewItem.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, review: { isHidden: false } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const byId = new Map(rows.map((x) => [x.productId, x]));
    for (const id of productIds) {
      const x = byId.get(id);
      await tx.product.update({
        where: { id },
        data: { ratingAvg: avg2(x?._avg.rating), ratingCount: x?._count._all ?? 0 },
      });
    }
  }
  if (riderId) {
    const d = await tx.review.aggregate({
      where: { riderId, isHidden: false, deliveryRating: { not: null } },
      _avg: { deliveryRating: true },
      _count: { deliveryRating: true },
    });
    await tx.rider.update({
      where: { id: riderId },
      data: { ratingAvg: avg2(d._avg.deliveryRating), ratingCount: d._count.deliveryRating },
    });
  }
}

/**
 * Whether the customer can still rate this order, and what they gave if they did.
 * @param {any} order with `review` (and its items) included
 * @param {{ enabled: boolean, windowDays: number }} settings
 * @param {Date} now
 */
export function customerReviewState(order, settings, now) {
  const r = order.review;
  const deadline =
    order.deliveredAt && new Date(order.deliveredAt.getTime() + settings.windowDays * 86_400_000);
  return {
    canReview: settings.enabled && !r && order.status === 'DELIVERED' && Boolean(deadline) && now < deadline,
    deadline: r ? null : deadline,
    ratesDelivery: Boolean(order.riderId),
    given: r
      ? {
          foodRating: Number(r.foodRating),
          deliveryRating: r.deliveryRating,
          comment: r.comment,
          items: (r.items ?? []).map((i) => ({ orderItemId: i.orderItemId, rating: i.rating })),
          createdAt: r.createdAt,
        }
      : null,
  };
}

/** Star spread 1–5 from a groupBy over a rating column. */
export function spread(rows, field) {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    const k = Math.round(Number(row[field]));
    if (k >= 1 && k <= 5) out[k] += row._count._all;
  }
  return out;
}
