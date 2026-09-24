// Audit log writer (spec §43). Always called inside the same transaction as the change it records.

/**
 * @param {import('@jamzo/database').Db} tx
 * @param {import('./types.js').JamzoRequest} request
 * @param {{ action: string, entityType: string, entityId?: string | null, oldValue?: unknown, newValue?: unknown }} entry
 * @param {{ actorType: string, userId: string | null }} [actorOverride] when request.auth is not set yet (e.g. login)
 */
export function audit(tx, request, entry, actorOverride) {
  const actor = actorOverride ?? request.auth;
  return tx.auditLog.create({
    data: {
      actorType: actor?.actorType ?? 'SYSTEM',
      actorId: actor?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValue: toJson(entry.oldValue),
      newValue: toJson(entry.newValue),
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    },
  });
}

/** JSON-safe copy (Decimal/BigInt/Date → strings); secrets must never be passed in. */
function toJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
