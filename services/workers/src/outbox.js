// Outbox relay (DECISIONS D-9). Claims due events with FOR UPDATE SKIP LOCKED (safe with many workers),
// leases them, runs the handler, then marks them published. Failures retry with exponential backoff and
// are parked (failedAt) after maxAttempts — parked events need an operator; they are never silently dropped.

/**
 * @param {{ prisma: import('@jamzo/database').Db, handlers: Record<string, (event: any) => Promise<void>>,
 *           log: any, workerId: string, clock?: { now: () => Date }, batchSize?: number, maxAttempts?: number, leaseSec?: number }} opts
 */
export function createOutboxRelay({ prisma, handlers, log, workerId, clock = { now: () => new Date() }, batchSize = 10, maxAttempts = 8, leaseSec = 60 }) {
  /** Claim a batch atomically; expired leases are reclaimable (a crashed worker's events are not lost). */
  async function claim() {
    const now = clock.now();
    const staleBefore = new Date(now.getTime() - leaseSec * 1000);
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id FROM outbox_events
        WHERE "publishedAt" IS NULL AND "failedAt" IS NULL AND "availableAt" <= ${now}
          AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
        ORDER BY "availableAt", id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      const ids = /** @type {{ id: string }[]} */ (rows).map((r) => r.id);
      if (!ids.length) return [];
      await tx.outboxEvent.updateMany({ where: { id: { in: ids } }, data: { lockedAt: now, lockedBy: workerId } });
      return tx.outboxEvent.findMany({ where: { id: { in: ids } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] });
    });
  }

  /** Backoff: 5s, 10s, 20s … capped at 1 hour. */
  const backoffMs = (attempt) => Math.min(3_600_000, 5000 * 2 ** (attempt - 1));

  async function handle(event) {
    const handler = handlers[event.eventType];
    const attempts = event.attempts + 1;
    try {
      if (!handler) throw new Error(`No handler registered for ${event.eventType}`);
      await handler(event);
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: clock.now(), attempts, lockedAt: null, lockedBy: null, lastError: null } });
      return 'done';
    } catch (err) {
      const message = String(/** @type {any} */ (err)?.message ?? err).slice(0, 1000);
      const park = attempts >= maxAttempts;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts,
          lastError: message,
          lockedAt: null,
          lockedBy: null,
          ...(park ? { failedAt: clock.now() } : { availableAt: new Date(clock.now().getTime() + backoffMs(attempts)) }),
        },
      });
      log[park ? 'error' : 'warn']({ eventId: event.id, eventType: event.eventType, attempts, err: message }, park ? 'outbox event parked' : 'outbox event failed, will retry');
      return park ? 'parked' : 'retry';
    }
  }

  /** Process one batch; returns counts. */
  async function tick() {
    const events = await claim();
    const result = { done: 0, retry: 0, parked: 0 };
    for (const e of events) result[await handle(e)]++;
    return result;
  }

  return { tick, claim, backoffMs };
}
