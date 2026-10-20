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

/**
 * Why this account cannot be deleted yet, in words for the app, or null (D-117, D-120). Customers: an order on
 * its way. Delivery partners: a trip in progress, cash held, or earnings not yet paid. Restaurant owners: being
 * the only active owner of a restaurant that is live or being set up.
 * @returns {Promise<string | null>}
 */
export async function deletionBlocker(prisma, userId, appId) {
  if (appId === 'CUSTOMER') {
    return (await activeOrderCount(prisma, userId))
      ? 'You have an order on its way. Delete your account after it is delivered.'
      : null;
  }
  if (appId === 'RIDER') {
    const rider = await prisma.rider.findUnique({
      where: { userId },
      include: { availability: true, ledger: true },
    });
    if (!rider) return null;
    if ((rider.availability?.activeOrderCount ?? 0) > 0)
      return 'You have a delivery in progress. Finish it first.';
    if (Number(rider.ledger?.codHeldPaise ?? 0) > 0)
      return 'You are holding cash from orders. Deposit it with Jamzo first (Earnings → I deposited cash).';
    if (Number(rider.ledger?.earningsBalancePaise ?? 0) > 0)
      return 'Jamzo still owes you earnings. Delete your account after your final payout.';
    return null;
  }
  if (appId === 'RESTAURANT') {
    const owned = await prisma.restaurantUser.findMany({
      where: { userId, isActive: true, role: 'OWNER' },
      include: { restaurant: { select: { id: true, name: true, onboardingStatus: true } } },
    });
    for (const m of owned) {
      const others = await prisma.restaurantUser.count({
        where: { restaurantId: m.restaurantId, isActive: true, role: 'OWNER', userId: { not: userId } },
      });
      if (!others)
        return `You are the only owner of ${m.restaurant.name}. Ask Jamzo partner support to add another owner or close the restaurant first.`;
    }
    return null;
  }
  return 'Accounts of this app are removed by Jamzo support.';
}

/** An order still on its way blocks the request (the customer must be reachable for it). */
export async function activeOrderCount(prisma, userId) {
  const customer = await prisma.customer.findUnique({ where: { userId }, select: { id: true } });
  if (!customer) return 0;
  return prisma.order.count({ where: { customerId: customer.id, status: { notIn: TERMINAL } } });
}

/**
 * Worker handler for `account.delete` { userId }, queued for the end of the grace period. Does nothing if the
 * user kept the account (or asked again later — a later event handles that).
 * @param {{ prisma: any, storage?: { remove: (key: string) => Promise<any> } | null, clock?: { now: () => Date }, log?: any }} deps
 */
export function createAccountDeletionJobs({
  prisma,
  storage = null,
  clock = { now: () => new Date() },
  log,
}) {
  async function erase(event) {
    const now = clock.now();
    const user = await prisma.user.findUnique({ where: { id: event.payload.userId } });
    if (!user || !user.deletionScheduledFor || user.deletionScheduledFor > now) return;
    const customer = await prisma.customer.findUnique({ where: { userId: user.id }, select: { id: true } });
    const rider = await prisma.rider.findUnique({
      where: { userId: user.id },
      select: { id: true, photoMediaId: true, documents: { select: { mediaId: true } } },
    });
    // Identity documents and the photo are deleted from storage, not only unlinked (D-120).
    const mediaIds = rider
      ? [rider.photoMediaId, ...rider.documents.map((d) => d.mediaId)].filter(Boolean)
      : [];
    const media = mediaIds.length ? await prisma.media.findMany({ where: { id: { in: mediaIds } } }) : [];
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
      if (rider) {
        // Trips, earnings and payouts stay (accounts); the person's details go, and they cannot work again.
        await tx.rider.update({
          where: { id: rider.id },
          data: {
            onboardingStatus: 'SUSPENDED',
            photoMediaId: null,
            addressLine: null,
            upiId: null,
            bankAccountNumberEncrypted: null,
            bankAccountLast4: null,
            bankIfsc: null,
          },
        });
        await tx.riderDocument.updateMany({
          where: { riderId: rider.id },
          data: { number: null, numberLast4: null, mediaId: null, reviewNote: null },
        });
        await tx.riderAvailability.updateMany({ where: { riderId: rider.id }, data: { isOnline: false } });
        if (media.length)
          await tx.media.updateMany({
            where: { id: { in: media.map((m) => m.id) } },
            data: { deletedAt: now },
          });
      }
      // Restaurant staff leave their restaurants; the restaurants themselves are business records.
      await tx.restaurantUser.updateMany({ where: { userId: user.id }, data: { isActive: false } });
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
    for (const m of media)
      for (const key of [m.storageKey, ...Object.values(/** @type {any} */ (m.variants) ?? {})])
        await storage
          ?.remove(String(key))
          .catch((err) => log?.warn?.({ err: String(err) }, 'could not remove a file'));
    log?.info?.({ userId: user.id }, 'account erased after the grace period');
  }
  return { 'account.delete': erase };
}
