// Admin home: platform setup counts and live order counts (Phase 5). Delivery alerts need riders and arrive
// in Phase 6 — the response says so explicitly rather than showing empty charts.
import { allowedCityIds } from '../../core/auth.js';

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function dashboardRoutes(app) {
  app.get(
    '/v1/admin/dashboard',
    { config: { permission: 'dashboard.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const p = app.prisma;
      const cities = allowedCityIds(request, 'dashboard.view');
      const cityFilter = cities ? { id: { in: cities } } : {};
      const [
        citiesTotal,
        citiesLive,
        zones,
        admins,
        restaurantsByStatus,
        ridersByStatus,
        customers,
        media,
        recentAudit,
      ] = await Promise.all([
        p.city.count({ where: cityFilter }),
        p.city.count({ where: { ...cityFilter, isActive: true } }),
        p.zone.count({ where: cities ? { cityId: { in: cities } } : {} }),
        p.adminUser.count({ where: { isActive: true } }),
        p.restaurant.groupBy({
          by: ['onboardingStatus'],
          _count: true,
          where: cities ? { cityId: { in: cities } } : {},
        }),
        p.rider.groupBy({ by: ['onboardingStatus'], _count: true }),
        p.customer.count(),
        p.media.count({ where: { deletedAt: null } }),
        request.auth.admin.global.has('audit.view')
          ? p.auditLog.findMany({ orderBy: { id: 'desc' }, take: 8 })
          : Promise.resolve(null),
      ]);
      const orderCities = allowedCityIds(request, 'orders.view');
      const canOrders = orderCities === null || orderCities.length > 0;
      let operations = { available: false, message: 'You do not have access to orders.' };
      if (canOrders) {
        const scope = orderCities ? { cityId: { in: orderCities } } : {};
        const now = app.clock.now();
        const istDay = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
        const since = new Date(`${istDay}T00:00:00+05:30`);
        const TERMINAL = [
          'DELIVERED',
          'CUSTOMER_CANCELLED',
          'RESTAURANT_CANCELLED',
          'RESTAURANT_REJECTED',
          'RIDER_ISSUE',
          'ADMIN_CANCELLED',
          'PAYMENT_FAILED',
        ];
        const [today, open, waiting, attention, ready] = await Promise.all([
          p.order.count({ where: { ...scope, placedAt: { gte: since } } }),
          p.order.count({
            where: { ...scope, placedAt: { not: null }, status: { notIn: /** @type {any} */ (TERMINAL) } },
          }),
          p.order.count({
            where: { ...scope, restaurantStatus: 'NEW', status: { in: ['PLACED', 'RESTAURANT_NOTIFIED'] } },
          }),
          p.order.count({ where: { ...scope, needsAttention: true } }),
          p.order.count({ where: { ...scope, status: 'READY_FOR_PICKUP' } }),
        ]);
        operations = {
          available: true,
          ordersToday: today,
          openOrders: open,
          waitingForRestaurant: waiting,
          needsAttention: attention,
          readyForPickup: ready,
          message:
            'Delivery partners and dispatch arrive in Phase 6: ready orders wait for pickup until then.',
        };
      }
      return {
        setup: {
          cities: { total: citiesTotal, live: citiesLive },
          zones,
          activeAdmins: admins,
          restaurants: Object.fromEntries(restaurantsByStatus.map((r) => [r.onboardingStatus, r._count])),
          deliveryPartners: Object.fromEntries(ridersByStatus.map((r) => [r.onboardingStatus, r._count])),
          customers,
          media,
        },
        operations,
        recentActivity: recentAudit,
      };
    },
  );
}
