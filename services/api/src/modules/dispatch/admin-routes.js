// Dispatch in Jamzo Admin (D-75): orders waiting for or on a delivery, riders online, manual assignment and
// reassignment (audit-logged, orders.assign_rider).
import { z } from 'zod';
import { assignRiderBody, unassignRiderBody, uuid } from '@jamzo/validation';
import { notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allowedCityIds, canInCity } from '../../core/auth.js';
import { codBalances, firstName } from '../riders/service.js';

const idParam = z.object({ id: uuid });
const num = (v) => (v == null ? null : Number(v));
const ACTIVE_DELIVERY = [
  'NOT_STARTED',
  'SEARCHING',
  'ASSIGNED',
  'ACCEPTED',
  'AT_RESTAURANT',
  'PICKED_UP',
  'ON_THE_WAY',
  'ARRIVED',
  'NO_RIDER_FOUND',
];

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function dispatchAdminRoutes(app) {
  const prisma = app.prisma;
  const { dispatch } = app.services;

  app.get(
    '/v1/admin/dispatch',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const cities = allowedCityIds(request, 'orders.view');
      const scope = cities ? { cityId: { in: cities } } : {};
      const [orders, riders] = await Promise.all([
        prisma.order.findMany({
          where: {
            ...scope,
            deliveryStatus: { in: /** @type {any} */ (ACTIVE_DELIVERY) },
            restaurantStatus: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'] },
            status: {
              notIn: [
                'DELIVERED',
                'CUSTOMER_CANCELLED',
                'RESTAURANT_CANCELLED',
                'RESTAURANT_REJECTED',
                'ADMIN_CANCELLED',
                'RIDER_ISSUE',
              ],
            },
          },
          orderBy: { createdAt: 'asc' },
          take: 200,
          include: {
            restaurant: true,
            assignments: {
              where: { status: { in: ['OFFERED', 'ACCEPTED'] } },
              include: { rider: { include: { user: true } } },
            },
          },
        }),
        prisma.rider.findMany({
          where: {
            ...(cities ? { cityId: { in: cities } } : {}),
            onboardingStatus: 'ACTIVE',
            availability: { isOnline: true },
          },
          include: { user: true, availability: true, vehicles: { where: { isActive: true } } },
          take: 500,
        }),
      ]);
      const cod = await codBalances(
        prisma,
        riders.map((r) => r.id),
      );
      return {
        orders: orders.map((o) => {
          const a = o.assignments[0];
          return {
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            restaurantStatus: o.restaurantStatus,
            deliveryStatus: o.deliveryStatus,
            needsAttention: o.needsAttention,
            attentionReason: o.attentionReason,
            restaurant: o.restaurant.name,
            paymentMethod: o.paymentMethod,
            codAmountPaise: o.codAmountPaise,
            placedAt: o.placedAt,
            rider: a
              ? {
                  id: a.riderId,
                  name: a.rider.user.name,
                  assignment: a.status,
                  expiresAt: a.status === 'OFFERED' ? a.expiresAt : null,
                }
              : null,
          };
        }),
        riders: riders.map((r) => ({
          id: r.id,
          name: r.user.name,
          shortName: firstName(r.user.name),
          vehicle: r.vehicles[0]?.type ?? null,
          activeOrderCount: r.availability.activeOrderCount,
          lat: num(r.availability.lastLat),
          lng: num(r.availability.lastLng),
          lastLocationAt: r.availability.lastLocationAt,
          codEnabled: r.codEnabled,
          codBalancePaise: cod.get(r.id) ?? 0,
        })),
        refreshedAt: app.clock.now(),
      };
    },
  );

  async function orderFor(request, id, permission) {
    const o = await prisma.order.findUnique({ where: { id } });
    if (!o || !canInCity(request, permission, o.cityId)) throw notFound('Order');
    return o;
  }

  app.post(
    '/v1/admin/orders/:id/assign',
    { config: { permission: 'orders.assign_rider' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(assignRiderBody, request.body);
      await orderFor(request, id, 'orders.assign_rider');
      const a = await dispatch.assignManually({
        orderId: id,
        riderId: body.riderId,
        adminUserId: request.auth.userId,
      });
      await audit(prisma, request, {
        action: 'order.assign_rider',
        entityType: 'order',
        entityId: id,
        newValue: { riderId: body.riderId, assignmentId: a.id, reason: body.reason },
      });
      return { assignmentId: a.id, expiresAt: a.expiresAt };
    },
  );

  app.post(
    '/v1/admin/orders/:id/unassign',
    { config: { permission: 'orders.assign_rider' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(unassignRiderBody, request.body);
      const before = await orderFor(request, id, 'orders.assign_rider');
      await dispatch.unassign({
        orderId: id,
        actor: { type: 'ADMIN', id: request.auth.userId },
        reason: body.reason,
      });
      await audit(prisma, request, {
        action: 'order.unassign_rider',
        entityType: 'order',
        entityId: id,
        oldValue: { riderId: before.riderId },
        newValue: { reason: body.reason },
      });
      return { unassigned: true };
    },
  );

  app.get(
    '/v1/admin/orders/:id/assignments',
    { config: { permission: 'orders.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      await orderFor(request, id, 'orders.view');
      const rows = await prisma.orderAssignment.findMany({
        where: { orderId: id },
        orderBy: { offeredAt: 'asc' },
        include: { rider: { include: { user: true } } },
      });
      return {
        items: rows.map((a) => ({
          id: a.id,
          rider: { id: a.riderId, name: a.rider.user.name },
          status: a.status,
          manual: a.isManual,
          pickupDistanceM: a.pickupDistanceM,
          offeredAt: a.offeredAt,
          expiresAt: a.expiresAt,
          respondedAt: a.respondedAt,
          rejectReason: a.rejectReason,
        })),
      };
    },
  );
}
