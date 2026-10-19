// Offer notifications (D-116): only to customers whose latest MARKETING_PUSH consent says yes and who have the
// customer app with notifications on. The API counts and queues; the worker sends (and checks consent again,
// in case someone switched it off in between).

/** User ids whose latest MARKETING_PUSH record is a yes. */
async function optedIn(prisma, userIds) {
  const latest = await prisma.consentRecord.findMany({
    where: { kind: 'MARKETING_PUSH', ...(userIds ? { userId: { in: userIds } } : {}) },
    orderBy: { createdAt: 'desc' },
    distinct: ['userId'],
    select: { userId: true, granted: true },
  });
  return latest.filter((c) => c.granted).map((c) => c.userId);
}

/**
 * Customers who said yes, have a working customer-app device, and (with a city) have a saved address or an
 * order there.
 * @param {any} prisma
 * @param {{ cityId?: string | null }} [o]
 * @returns {Promise<string[]>} user ids
 */
export async function offerRecipients(prisma, { cityId = null } = {}) {
  let ids = await optedIn(prisma);
  if (!ids.length) return [];
  const devices = await prisma.device.findMany({
    where: { userId: { in: ids }, appId: 'CUSTOMER', disabledAt: null },
    distinct: ['userId'],
    select: { userId: true },
  });
  ids = devices.map((d) => d.userId);
  if (cityId && ids.length) {
    const zones = (await prisma.zone.findMany({ where: { cityId }, select: { id: true } })).map((z) => z.id);
    const customers = await prisma.customer.findMany({
      where: {
        userId: { in: ids },
        OR: [
          { addresses: { some: { deletedAt: null, zoneId: { in: zones } } } },
          { orders: { some: { cityId } } },
        ],
      },
      select: { userId: true },
    });
    ids = customers.map((c) => c.userId);
  }
  return ids;
}

/**
 * Worker handler for `offer.broadcast` { title, body, url, userIds }.
 * @param {{ prisma: any, push: import('@jamzo/notifications').PushProvider, clock?: { now: () => Date }, log?: any }} deps
 */
export function createOfferHandler({ prisma, push, clock = { now: () => new Date() }, log }) {
  return async function offerBroadcast(event) {
    const { title, body, url, userIds } = event.payload;
    const stillYes = new Set(await optedIn(prisma, userIds));
    const data = { event: 'offer', url: url ?? '/' };
    for (const userId of userIds) {
      if (!stillYes.has(userId)) continue;
      const dedupeKey = `${event.id}:${userId}:offer`;
      if (await prisma.notification.findUnique({ where: { dedupeKey } })) continue; // a retried event
      const row = await prisma.notification.create({
        data: {
          userId,
          appId: 'CUSTOMER',
          channel: 'PUSH',
          event: 'offer',
          title,
          body,
          data,
          dedupeKey,
          createdAt: clock.now(),
        },
      });
      const devices = await prisma.device.findMany({
        where: { userId, appId: 'CUSTOMER', disabledAt: null },
      });
      if (!devices.length) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: 'SKIPPED', error: 'No registered device' },
        });
        continue;
      }
      const results = await push.send(
        devices.map((d) => ({
          to: d.pushToken,
          title,
          body,
          data,
          sound: 'default',
          channelId: 'offers',
          priority: 'default',
        })),
      );
      for (const [i, r] of results.entries())
        if (r.deviceGone)
          await prisma.device.update({ where: { id: devices[i].id }, data: { disabledAt: clock.now() } });
      const ok = results.find((r) => r.ok);
      await prisma.notification.update({
        where: { id: row.id },
        data: ok
          ? { status: 'SENT', sentAt: clock.now(), providerRef: ok.providerRef ?? null }
          : {
              status: 'FAILED',
              error: results
                .map((r) => r.error)
                .filter(Boolean)
                .join('; ')
                .slice(0, 500),
            },
      });
    }
    log?.info?.({ eventId: event.id, recipients: userIds.length }, 'offer notification sent');
  };
}
