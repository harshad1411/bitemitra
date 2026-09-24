// Restaurant Partner app endpoints (RESTAURANTS.md §7, DECISIONS D-42). Every request re-checks the
// membership, its role and the restaurant status — signing in is never enough (OD-13).
import { z } from 'zod';
import { availabilityBody, partnerBranchStatusBody, uuid } from '@jamzo/validation';
import { PARTNER_APP_RESTAURANT_STATUSES, restaurantRoleCan } from '@jamzo/auth';
import { forbidden, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { mediaBase as mediaBaseOf } from '../media/urls.js';
import { applyAvailability, loadMenu, productInclude, productSummary } from '../catalog/service.js';
import { branchDto } from './service.js';

const idParam = z.object({ id: uuid });
const PARTNER = { apps: ['RESTAURANT'] };

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function partnerRoutes(app) {
  const prisma = app.prisma;
  const { config } = app.services;
  const mediaBase = mediaBaseOf(app.services.env);

  /**
   * The caller's active membership of a restaurant allowed to use the partner app, with the capability.
   * Non-members get 404 (a restaurant's existence is not revealed); members without the capability 403.
   */
  async function requireMember(request, restaurantId, capability) {
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
  }

  const capabilitiesOf = (role) =>
    Object.fromEntries(['store.status', 'menu.availability'].map((c) => [c, restaurantRoleCan(role, c)]));

  async function storeView(membership) {
    const r = membership.restaurant;
    const now = app.clock.now();
    const branches = await prisma.restaurantBranch.findMany({
      where: { restaurantId: r.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      include: {
        businessHours: { orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }] },
        deliveryAreas: { where: { isActive: true } },
      },
    });
    const ops = await config.resolve('restaurants.operations', await config.contextFor('RESTAURANT', r.id));
    return {
      restaurant: {
        id: r.id,
        name: r.name,
        onboardingStatus: r.onboardingStatus,
        isPureVeg: r.isPureVeg,
        city: { name: r.city.name, timezone: r.city.timezone },
      },
      role: membership.role,
      capabilities: capabilitiesOf(membership.role),
      limits: { maxPauseMinutes: ops.value.maxPauseMinutes },
      branches: branches.map((b) => {
        const { deliveryArea: _a, ...dto } = branchDto(b, {
          now,
          timeZone: r.city.timezone,
          restaurantStatus: r.onboardingStatus,
        });
        return dto;
      }),
    };
  }

  app.get(
    '/v1/restaurant/restaurants/:id',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      return storeView(await requireMember(request, id, 'store.view'));
    },
  );

  app.patch(
    '/v1/restaurant/branches/:id/status',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(partnerBranchStatusBody, request.body);
      const branch = await prisma.restaurantBranch.findUnique({ where: { id } });
      if (!branch) throw notFound('Branch');
      const membership = await requireMember(request, branch.restaurantId, 'store.status');
      const ctx = await config.contextFor('BRANCH', id);
      const { pauseMinutes, ...rest } = body;
      /** @type {any} */
      const data = rest;
      if (pauseMinutes !== undefined) {
        const { value } = await config.resolve('restaurants.operations', ctx);
        if (pauseMinutes > value.maxPauseMinutes)
          throw invalid(`A pause can last at most ${value.maxPauseMinutes} minutes.`, {
            pauseMinutes: ['Too long'],
          });
        data.pausedUntil =
          pauseMinutes === 0 ? null : new Date(app.clock.now().getTime() + pauseMinutes * 60_000);
      }
      if (body.prepTimeMinutes !== undefined) {
        const { value } = await config.resolve('orders.preparation', ctx);
        if (body.prepTimeMinutes > value.maxPrepMinutes)
          throw invalid(`Preparation time can be at most ${value.maxPrepMinutes} minutes.`, {
            prepTimeMinutes: ['Too long'],
          });
      }
      await prisma.$transaction(async (tx) => {
        const after = await tx.restaurantBranch.update({ where: { id }, data });
        await audit(tx, request, {
          action: 'branch.status_update',
          entityType: 'restaurant_branch',
          entityId: id,
          oldValue: {
            isOpen: branch.isOpen,
            pausedUntil: branch.pausedUntil,
            busyMode: branch.busyMode,
            prepTimeMinutes: branch.prepTimeMinutes,
          },
          newValue: {
            isOpen: after.isOpen,
            pausedUntil: after.pausedUntil,
            busyMode: after.busyMode,
            prepTimeMinutes: after.prepTimeMinutes,
          },
        });
      });
      return storeView(membership);
    },
  );

  app.get(
    '/v1/restaurant/restaurants/:id/menu',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const membership = await requireMember(request, id, 'menu.view');
      const menu = await loadMenu(prisma, id, {
        now: app.clock.now(),
        timeZone: membership.restaurant.city.timezone,
        mediaBase,
      });
      return {
        restaurant: { id, name: membership.restaurant.name },
        capabilities: capabilitiesOf(membership.role),
        ...menu,
      };
    },
  );

  app.post(
    '/v1/restaurant/products/:id/availability',
    { config: PARTNER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(availabilityBody, request.body);
      const product = await prisma.product.findUnique({ where: { id } });
      if (!product || product.status === 'ARCHIVED') throw notFound('Product');
      const membership = await requireMember(request, product.restaurantId, 'menu.availability');
      const timeZone = membership.restaurant.city.timezone;
      const now = app.clock.now();
      await prisma.$transaction(async (tx) => {
        const change = await applyAvailability(tx, product, body, { now, timeZone });
        await audit(tx, request, {
          action: 'product.availability',
          entityType: 'product',
          entityId: id,
          oldValue: { target: change.target, ...change.before },
          newValue: { target: change.target, ...change.after, reason: body.reason ?? null },
        });
      });
      const updated = await prisma.product.findUniqueOrThrow({ where: { id }, include: productInclude(now) });
      return productSummary(updated, { now, timeZone, mediaBase });
    },
  );
}
