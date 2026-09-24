// Admin home (Phase 1): platform setup counts only. Operational alerts (spec §66) need orders and arrive
// in Phase 5 — the response says so explicitly rather than showing empty charts.
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
        operations: { available: false, message: 'Order and delivery alerts become available in Phase 5.' },
        recentActivity: recentAudit,
      };
    },
  );
}
