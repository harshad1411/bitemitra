// In-app account deletion (D-117, SECURITY.md §7, Privacy Policy §4): the customer asks in the app, is signed
// out everywhere, and has 30 days to change their mind ("Keep my account"). Then the worker erases the
// personal data in place: name, phone, email, sign-in methods, devices, saved addresses, favourites and the
// address and contact on their orders. Orders, payments and invoices stay (tax law) without the identity.

export const GRACE_DAYS = 30;
const TERMINAL = [
  'DELIVERED',
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'RESTAURANT_REJECTED',
  'RIDER_ISSUE',
  'ADMIN_CANCELLED',
  'PAYMENT_FAILED',
];

/** An order still on its way blocks the request (the customer must be reachable for it). */
export async function activeOrderCount(prisma, userId) {
  const customer = await prisma.customer.findUnique({ where: { userId }, select: { id: true } });
  if (!customer) return 0;
  return prisma.order.count({ where: { customerId: customer.id, status: { notIn: TERMINAL } } });
}

/**
 * Worker handler for `account.delete` { userId }, queued for the end of the grace period. Does nothing if the
 * user kept the account (or asked again later — a later event handles that).
 * @param {{ prisma: any, clock?: { now: () => Date }, log?: any }} deps
 */
export function createAccountDeletionJobs({ prisma, clock = { now: () => new Date() }, log }) {
  async function erase(event) {
    const now = clock.now();
    const user = await prisma.user.findUnique({ where: { id: event.payload.userId } });
    if (!user || !user.deletionScheduledFor || user.deletionScheduledFor > now) return;
    const customer = await prisma.customer.findUnique({ where: { userId: user.id }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          phone: null,
          email: null,
          name: null,
          phoneVerified: false,
          emailVerified: false,
          passwordHash: null,
          status: 'DELETED',
          deletedAt: now,
          deletionScheduledFor: null,
        },
      });
      // The phone number is free again: signing in with it later starts a brand-new account.
      await tx.authIdentity.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.device.deleteMany({ where: { userId: user.id } });
      if (customer) {
        await tx.customer.update({ where: { id: customer.id }, data: { defaultAddressId: null } });
        await tx.customerAddress.updateMany({
          where: { customerId: customer.id },
          data: {
            label: 'Deleted',
            line1: 'Deleted',
            line2: null,
            landmark: null,
            area: null,
            pincode: null,
            lat: 0,
            lng: 0,
            contactName: null,
            contactPhone: null,
            deletedAt: now,
          },
        });
        await tx.favoriteRestaurant.deleteMany({ where: { customerId: customer.id } });
        await tx.orderAddress.updateMany({
          where: { order: { customerId: customer.id } },
          data: {
            label: null,
            line1: 'Removed (account deleted)',
            line2: null,
            landmark: null,
            contactName: null,
            contactPhone: null,
            lat: 0,
            lng: 0,
          },
        });
        // Stars stay in the averages; the customer's own words go.
        await tx.review.updateMany({ where: { customerId: customer.id }, data: { comment: null } });
      }
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'account.erase',
          entityType: 'user',
          entityId: user.id,
          newValue: { erasedAt: now.toISOString() },
        },
      });
    });
    log?.info?.({ userId: user.id }, 'account erased after the grace period');
  }
  return { 'account.delete': erase };
}
