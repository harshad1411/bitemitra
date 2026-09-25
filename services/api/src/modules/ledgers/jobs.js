// Ledger posting jobs (D-88): the worker turns order events into ledger entries. Each job re-reads the facts
// from the database and posts with deterministic keys, so a retried or repeated event posts nothing twice.
import { cancelledPostings, deliveredPostings, refundPostings } from '@jamzo/settlement-engine';
import { postEntries } from './post.js';

/**
 * @param {{ prisma: any, clock?: { now: () => Date }, log?: any }} deps
 * @returns {Record<string, (event: any) => Promise<void>>}
 */
export function createLedgerJobs({ prisma, clock = { now: () => new Date() }, log }) {
  const onlinePayment = (tx, orderId) =>
    tx.payment.findFirst({ where: { orderId, status: 'SUCCEEDED', provider: { not: 'cod' } } });

  /** Delivered: restaurant sale, the partner's final pay and cash held, and Jamzo's side (actual amounts). */
  async function delivered(event) {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: event.payload.orderId },
        include: { pricingSnapshot: true },
      });
      if (!order || order.status !== 'DELIVERED' || !order.pricingSnapshot) return;
      const [earning, online, cod] = await Promise.all([
        tx.riderEarning.findUnique({ where: { orderId: order.id } }),
        onlinePayment(tx, order.id),
        tx.payment.findFirst({ where: { orderId: order.id, provider: 'cod', status: 'SUCCEEDED' } }),
      ]);
      const postings = deliveredPostings({
        orderId: order.id,
        q: order.pricingSnapshot.engineOutput,
        earning: earning?.kind === 'DELIVERY' ? earning.breakdown : null,
        codCollectedPaise: cod?.capturedPaise ?? 0,
        gatewayFeePaise: order.paymentMethod === 'COD' ? 0 : (online?.gatewayFeePaise ?? null),
      });
      if (!order.riderId) postings.rider = [];
      await postEntries(
        tx,
        { restaurantId: order.restaurantId, riderId: order.riderId, cityId: order.cityId, orderId: order.id },
        postings,
        { now: clock.now() },
      );
    });
  }

  /** Cancelled: compensation owed to the restaurant and the partner; the fee kept and the gateway fee. */
  async function cancelled(event) {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: event.payload.orderId },
        include: { cancellation: true },
      });
      if (!order?.cancellation) return;
      const [trip, online] = await Promise.all([
        tx.riderEarning.findUnique({ where: { orderId: order.id } }),
        onlinePayment(tx, order.id),
      ]);
      const riderPaidPaise = trip?.kind === 'CANCELLED_TRIP' ? trip.totalPaise : 0;
      await postEntries(
        tx,
        {
          restaurantId: order.restaurantId,
          riderId: trip?.riderId ?? order.riderId,
          cityId: order.cityId,
          orderId: order.id,
        },
        cancelledPostings({
          orderId: order.id,
          outcome: order.cancellation,
          riderPaidPaise,
          gatewayFeePaise: online?.gatewayFeePaise ?? null,
        }),
        { now: clock.now() },
      );
    });
  }

  /** A completed refund of a delivered order is paid by its bearer. */
  async function refunded(event) {
    if (!event.payload.refundId) return;
    await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: event.payload.refundId },
        include: { order: true },
      });
      if (!refund || refund.status !== 'SUCCEEDED') return;
      await postEntries(
        tx,
        {
          restaurantId: refund.order.restaurantId,
          cityId: refund.order.cityId,
          orderId: refund.orderId,
          refundId: refund.id,
        },
        refundPostings({
          refundId: refund.id,
          amountPaise: refund.amountPaise,
          bearer: refund.bearer,
          delivered: refund.order.status === 'DELIVERED',
        }),
        { now: clock.now() },
      );
    });
    log?.debug?.({ refundId: event.payload.refundId }, 'refund posted');
  }

  return { 'order.delivered': delivered, 'order.cancelled': cancelled, 'order.refunded': refunded };
}
