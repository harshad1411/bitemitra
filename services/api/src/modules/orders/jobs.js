// Delayed order jobs run by the worker (D-68). Each job re-reads the order and acts only if it is still in
// the state the job was scheduled for, so a late or repeated job is harmless. Races with a restaurant's own
// accept/reject are decided by the order version: the loser's update matches no row and is retried, sees the
// new state and does nothing.
import { enqueueEvent } from '../../core/outbox.js';
import { createConfigService } from '../configuration/service.js';
import { applyResult, eventOn, publishOrder, releaseCouponUsage } from './service.js';

const WAITING = ['PLACED', 'RESTAURANT_NOTIFIED'];

/**
 * @param {{ prisma: import('@jamzo/database').Db, clock?: { now: () => Date }, log?: any }} deps
 * @returns {Record<string, (event: any) => Promise<void>>}
 */
export function createOrderJobs({ prisma, clock = { now: () => new Date() }, log }) {
  const config = createConfigService(prisma, clock);
  const system = { type: 'SYSTEM', id: null };

  async function acceptanceTimeout(event) {
    const { orderId, stage } = event.payload;
    const now = clock.now();
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.restaurantStatus !== 'NEW' || !WAITING.includes(order.status)) return;
      const setting = (
        await config.resolve('orders.restaurantAcceptance', await config.contextFor('BRANCH', order.branchId))
      ).value;
      const reject = async (reason) => {
        await applyResult(tx, order, eventOn(order, 'REJECT', { actor: system, now, reason }), {
          now,
          extra: { needsAttention: false, attentionReason: null },
        });
        await releaseCouponUsage(tx, order.id, now);
      };
      if (stage === 'ESCALATED')
        return reject('NO_RESPONSE: the restaurant did not respond after escalation');
      if (setting.fallback === 'AUTO_REJECT')
        return reject('NO_RESPONSE: the restaurant did not respond in time');
      if (setting.fallback === 'AUTO_ACCEPT') {
        const branch = await tx.restaurantBranch.findUnique({ where: { id: order.branchId } });
        return void (await applyResult(
          tx,
          order,
          eventOn(order, 'ACCEPT', {
            actor: system,
            now,
            prepTimeMinutes: branch.prepTimeMinutes,
            reason: 'AUTO_ACCEPT',
          }),
          { now },
        ));
      }
      // ESCALATE_TO_OPS: flag for operations, then auto-reject after the grace period.
      const res = await tx.order.updateMany({
        where: { id: order.id, version: order.version },
        data: {
          needsAttention: true,
          attentionReason: 'RESTAURANT_NOT_RESPONDING',
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw new Error('order changed while escalating; will retry');
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: order.status,
          actorType: 'SYSTEM',
          reason: 'Restaurant did not respond in time — escalated to operations',
          metadata: { event: 'ESCALATED' },
          createdAt: now,
        },
      });
      await enqueueEvent(tx, {
        aggregateType: 'ORDER',
        aggregateId: order.id,
        eventType: 'order.acceptance_timeout',
        payload: { orderId: order.id, stage: 'ESCALATED' },
        availableAt: new Date(now.getTime() + setting.escalationGraceSec * 1000),
      });
      await publishOrder(tx, order, { needsAttention: true }, 'order.escalated');
      log?.warn?.({ orderId: order.id }, 'restaurant did not respond: escalated to operations');
    });
  }

  return { 'order.acceptance_timeout': acceptanceTimeout };
}
