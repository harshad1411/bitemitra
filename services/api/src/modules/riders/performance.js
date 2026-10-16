// Delivery partner performance (D-113): deliveries, pay, tips, cash, delivery charges and Jamzo's delivery
// margin per partner — totals for a range, or day by day for one partner. Computed on request from orders,
// earnings, assignments, shifts and reviews; nothing new is stored.

/** India date (YYYY-MM-DD) of an instant. */
export const indiaDay = (d) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const blank = () => ({
  deliveries: 0,
  cancelledTrips: 0,
  offersRejected: 0,
  offersTimedOut: 0,
  payPaise: 0,
  tipsPaise: 0,
  cashCollectedPaise: 0,
  deliveryChargesPaise: 0,
  marginPaise: 0,
  tripMinutes: /** @type {number[]} */ ([]),
  onlineMinutes: 0,
  ratings: /** @type {number[]} */ ([]),
});

/** Turns an accumulator into the API shape (averages rounded, margin computed). */
function finish(a) {
  const avg = (xs, digits = 0) =>
    xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10 ** digits) / 10 ** digits : null;
  return {
    deliveries: a.deliveries,
    cancelledTrips: a.cancelledTrips,
    offersRejected: a.offersRejected,
    offersTimedOut: a.offersTimedOut,
    payPaise: a.payPaise,
    tipsPaise: a.tipsPaise,
    cashCollectedPaise: a.cashCollectedPaise,
    deliveryChargesPaise: a.deliveryChargesPaise,
    // What customers paid for delivery minus what the partner was paid; tips are the partner's alone.
    marginPaise: a.deliveryChargesPaise - a.payPaise,
    averageTripMinutes: avg(a.tripMinutes),
    onlineMinutes: Math.round(a.onlineMinutes),
    rating: { average: avg(a.ratings, 1), count: a.ratings.length },
  };
}

/**
 * @param {any} prisma
 * @param {{ from: Date, to: Date, riderIds: string[], byDay?: boolean, now: Date }} p
 * @returns {Promise<Map<string, any>>} riderId → figures (or, with byDay, riderId → Map(day → figures))
 */
export async function partnerPerformance(prisma, { from, to, riderIds, byDay = false, now }) {
  const out = new Map();
  if (!riderIds.length) return out;
  const bucket = (riderId, at) => {
    if (!out.has(riderId)) out.set(riderId, byDay ? new Map() : blank());
    const r = out.get(riderId);
    if (!byDay) return r;
    const k = indiaDay(at);
    if (!r.has(k)) r.set(k, blank());
    return r.get(k);
  };
  const inRange = { gte: from, lt: to };
  const [orders, earnings, offers, shifts, reviews] = await Promise.all([
    prisma.order.findMany({
      where: { riderId: { in: riderIds }, status: 'DELIVERED', deliveredAt: inRange },
      select: {
        riderId: true,
        deliveredAt: true,
        pickedUpAt: true,
        paymentMethod: true,
        codAmountPaise: true,
        pricingSnapshot: {
          select: {
            deliveryFeePaise: true,
            nightSurchargePaise: true,
            surgePaise: true,
            tipAllocation: true,
          },
        },
      },
    }),
    prisma.riderEarning.findMany({
      where: {
        riderId: { in: riderIds },
        OR: [
          { kind: 'DELIVERY', order: { deliveredAt: inRange } },
          { kind: { not: 'DELIVERY' }, createdAt: inRange },
        ],
      },
      select: {
        riderId: true,
        kind: true,
        totalPaise: true,
        createdAt: true,
        order: { select: { deliveredAt: true } },
      },
    }),
    prisma.orderAssignment.findMany({
      where: { riderId: { in: riderIds }, status: { in: ['REJECTED', 'TIMED_OUT'] }, offeredAt: inRange },
      select: { riderId: true, status: true, offeredAt: true },
    }),
    prisma.riderShift.findMany({
      where: {
        riderId: { in: riderIds },
        startedAt: { lt: to },
        OR: [{ endedAt: null }, { endedAt: { gt: from } }],
      },
      select: { riderId: true, startedAt: true, endedAt: true },
    }),
    prisma.review.findMany({
      where: {
        riderId: { in: riderIds },
        isHidden: false,
        deliveryRating: { not: null },
        createdAt: inRange,
      },
      select: { riderId: true, deliveryRating: true, createdAt: true },
    }),
  ]);

  for (const o of orders) {
    const a = bucket(o.riderId, o.deliveredAt);
    const s = o.pricingSnapshot;
    a.deliveries += 1;
    a.tipsPaise += /** @type {any} */ (s?.tipAllocation)?.riderPaise ?? 0;
    a.deliveryChargesPaise +=
      (s?.deliveryFeePaise ?? 0) + (s?.nightSurchargePaise ?? 0) + (s?.surgePaise ?? 0);
    if (o.paymentMethod === 'COD') a.cashCollectedPaise += o.codAmountPaise;
    if (o.pickedUpAt) a.tripMinutes.push((o.deliveredAt.getTime() - o.pickedUpAt.getTime()) / 60_000);
  }
  for (const e of earnings) {
    const a = bucket(
      e.riderId,
      e.kind === 'DELIVERY' && e.order?.deliveredAt ? e.order.deliveredAt : e.createdAt,
    );
    a.payPaise += e.totalPaise;
    if (e.kind !== 'DELIVERY') a.cancelledTrips += 1;
  }
  for (const o of offers) {
    const a = bucket(o.riderId, o.offeredAt);
    if (o.status === 'REJECTED') a.offersRejected += 1;
    else a.offersTimedOut += 1;
  }
  for (const s of shifts) {
    // Split each shift at India midnights so day-by-day hours add up to the range total.
    let start = new Date(Math.max(s.startedAt.getTime(), from.getTime()));
    const end = new Date(Math.min((s.endedAt ?? now).getTime(), to.getTime()));
    while (start < end) {
      const nextMidnight = new Date(Date.parse(`${indiaDay(start)}T00:00:00+05:30`) + 86_400_000);
      const stop = byDay && nextMidnight < end ? nextMidnight : end;
      bucket(s.riderId, start).onlineMinutes += (stop.getTime() - start.getTime()) / 60_000;
      start = stop;
    }
  }
  for (const r of reviews) bucket(r.riderId, r.createdAt).ratings.push(r.deliveryRating);

  for (const [id, v] of out) {
    if (byDay) out.set(id, new Map([...v].map(([k, a]) => [k, finish(a)])));
    else out.set(id, finish(v));
  }
  return out;
}

export const emptyPerformance = () => finish(blank());

/** Sums finished rows (the totals line): counts and money add up; averages are weighted. */
export function sumPerformance(rows) {
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  const weighted = (value, weight) => {
    const w = rows.reduce((n, r) => n + (value(r) == null ? 0 : weight(r)), 0);
    return w ? rows.reduce((n, r) => n + (value(r) == null ? 0 : value(r) * weight(r)), 0) / w : null;
  };
  const trip = weighted(
    (r) => r.averageTripMinutes,
    (r) => r.deliveries,
  );
  const rating = weighted(
    (r) => r.rating.average,
    (r) => r.rating.count,
  );
  return {
    deliveries: sum('deliveries'),
    cancelledTrips: sum('cancelledTrips'),
    offersRejected: sum('offersRejected'),
    offersTimedOut: sum('offersTimedOut'),
    payPaise: sum('payPaise'),
    tipsPaise: sum('tipsPaise'),
    cashCollectedPaise: sum('cashCollectedPaise'),
    deliveryChargesPaise: sum('deliveryChargesPaise'),
    marginPaise: sum('marginPaise'),
    averageTripMinutes: trip == null ? null : Math.round(trip),
    onlineMinutes: sum('onlineMinutes'),
    rating: {
      average: rating == null ? null : Math.round(rating * 10) / 10,
      count: rows.reduce((n, r) => n + r.rating.count, 0),
    },
  };
}
