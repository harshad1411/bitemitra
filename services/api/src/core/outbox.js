// Transactional outbox (DECISIONS D-9): side effects are recorded in the same transaction as the change
// and executed later by the worker. Never "write, then hope the network call succeeds".

/**
 * @param {import('@jamzo/database').Db} tx
 * @param {{ aggregateType: string, aggregateId: string, eventType: string, payload?: object, availableAt?: Date }} event
 */
export function enqueueEvent(tx, event) {
  return tx.outboxEvent.create({
    data: {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload ?? {},
      availableAt: event.availableAt ?? new Date(),
    },
  });
}
