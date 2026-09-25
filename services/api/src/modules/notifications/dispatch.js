// Order notifications (D-69, spec §41): an order event becomes notification rows from the active templates
// (so every message is recorded and visible in the apps), then each row is pushed to the recipient's
// devices for that app. Runs in the worker from the outbox; the dedupe key makes a retried event harmless.
import { isUniqueViolation } from '@jamzo/database';

/** Events that notify someone. Other order events are recorded only. */
export const NOTIFYING_EVENTS = [
  'order.placed',
  'order.accepted',
  'order.preparing',
  'order.ready',
  'order.rejected',
  'order.cancelled',
];
/** Every order event the worker must accept (the outbox parks unknown events). */
export const ORDER_EVENTS = [
  ...NOTIFYING_EVENTS,
  'order.created',
  'order.restaurant_notified',
  'order.prep_time_changed',
  'order.payment_failed',
];

/** `{{name}}` placeholders; unknown names render empty. */
export const render = (text, vars) =>
  text
    ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) =>
        vars[k] === undefined || vars[k] === null ? '' : String(vars[k]),
      )
    : text;

/**
 * @param {{ prisma: import('@jamzo/database').Db, push: import('@jamzo/notifications').PushProvider, clock?: { now: () => Date }, log?: any }} deps
 */
export function createNotificationDispatcher({ prisma, push, clock = { now: () => new Date() }, log }) {
  async function recipients(appId, order) {
    if (appId === 'CUSTOMER') {
      const c = await prisma.customer.findUnique({ where: { id: order.customerId } });
      return c ? [c.userId] : [];
    }
    if (appId === 'RESTAURANT') {
      const members = await prisma.restaurantUser.findMany({
        where: { restaurantId: order.restaurantId, isActive: true },
      });
      return members.map((m) => m.userId);
    }
    return [];
  }

  /** @param {{ id: string, eventType: string, payload: any }} event */
  async function handle(event) {
    if (!NOTIFYING_EVENTS.includes(event.eventType)) return;
    const order = await prisma.order.findUnique({
      where: { id: event.payload.orderId },
      include: { restaurant: true, cancellation: true },
    });
    if (!order) return;
    const templates = await prisma.notificationTemplate.findMany({
      where: { event: event.eventType, isActive: true, channel: 'PUSH', locale: 'en' },
    });
    const vars = {
      orderNumber: order.orderNumber,
      shortNumber: order.orderNumber.slice(-4),
      restaurantName: order.restaurant.name,
      itemCount: order.itemCount,
      prepTimeMinutes: order.prepTimeMinutes,
      total: `₹${(order.totalPayablePaise / 100).toFixed(2)}`,
    };
    for (const t of templates) {
      const users = await recipients(t.appId, order);
      for (const userId of users) {
        const data = {
          orderId: order.id,
          event: event.eventType,
          url: t.appId === 'CUSTOMER' ? `/orders/${order.id}` : `/orders/${order.id}`,
        };
        let row;
        try {
          row = await prisma.notification.create({
            data: {
              userId,
              appId: t.appId,
              channel: 'PUSH',
              event: event.eventType,
              title: render(t.title, vars),
              body: render(t.body, vars),
              data,
              dedupeKey: `${event.id}:${userId}:${t.appId}:PUSH`,
              createdAt: clock.now(),
            },
          });
        } catch (err) {
          if (isUniqueViolation(err)) continue; // this event was already handled for this person
          throw err;
        }
        const devices = await prisma.device.findMany({ where: { userId, appId: t.appId, disabledAt: null } });
        if (!devices.length) {
          await prisma.notification.update({
            where: { id: row.id },
            data: { status: 'SKIPPED', error: 'No registered device' },
          });
          continue;
        }
        const newOrder = t.appId === 'RESTAURANT' && event.eventType === 'order.placed';
        const results = await push.send(
          devices.map((d) => ({
            to: d.pushToken,
            title: row.title ?? '',
            body: row.body,
            data,
            sound: newOrder ? 'new_order.wav' : 'default',
            // Android channels created by the apps (registerForPush): restaurant 'new-orders', customer 'order-updates'.
            channelId: t.appId === 'RESTAURANT' ? 'new-orders' : 'order-updates',
            priority: 'high',
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
        if (!ok) log?.warn?.({ notificationId: row.id }, 'push failed for every device');
      }
    }
  }

  return Object.fromEntries(ORDER_EVENTS.map((e) => [e, handle]));
}
