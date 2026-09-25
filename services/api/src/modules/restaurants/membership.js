// Restaurant membership guard shared by the partner endpoints (D-42): every request re-checks membership,
// role capability and restaurant status — signing in is never enough (OD-13).
import { PARTNER_APP_RESTAURANT_STATUSES, restaurantRoleCan } from '@jamzo/auth';
import { forbidden, notFound } from '../../core/errors.js';

/** @param {import('@jamzo/database').Db} prisma */
export function createMemberGuard(prisma) {
  /**
   * The caller's active membership of a restaurant allowed to use the partner app, with the capability.
   * Non-members get 404 (a restaurant's existence is not revealed); members without the capability 403.
   * @param {import('../../core/types.js').JamzoRequest} request
   * @param {string} restaurantId
   * @param {string} capability
   */
  return async function requireMember(request, restaurantId, capability) {
    const membership = await prisma.restaurantUser.findFirst({
      where: { restaurantId, userId: request.auth.userId, isActive: true },
      include: { restaurant: { include: { city: true } } },
    });
    if (!membership) throw notFound('Restaurant');
    if (!PARTNER_APP_RESTAURANT_STATUSES.includes(membership.restaurant.onboardingStatus))
      throw forbidden('This restaurant is not approved to use the partner app.');
    if (!restaurantRoleCan(membership.role, capability))
      throw forbidden('Your role in this restaurant does not allow this.');
    return membership;
  };
}
