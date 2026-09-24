// API-level idempotency (API.md §4). Same key + same request → the stored response is replayed.
// Same key + different request → 409 IDEMPOTENCY_CONFLICT. In-flight duplicate → 409 IDEMPOTENCY_IN_PROGRESS.
import { createHash } from 'node:crypto';
import { CLIENT_HEADERS } from '@jamzo/shared-types';
import { isUniqueViolation } from '@jamzo/database';
import { AppError } from './errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Wraps a mutating handler. Without an Idempotency-Key header the handler simply runs.
 * @template T
 * @param {import('./types.js').JamzoRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {{ fingerprint?: unknown, successStatus?: number }} opts fingerprint defaults to method + url + body
 * @param {() => Promise<T>} handler
 */
export async function withIdempotency(request, reply, opts, handler) {
  const key = request.headers[CLIENT_HEADERS.idempotencyKey];
  const status = opts.successStatus ?? 200;
  if (!key || typeof key !== 'string') {
    const result = await handler();
    reply.code(status);
    return result;
  }
  if (key.length > 100) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is too long.');
  const prisma = /** @type {import('./types.js').JamzoApp} */ (request.server).prisma;
  const scope = `${request.auth?.userId ?? `anon:${request.ip}`}:${request.routeOptions.url}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify([request.method, request.url, opts.fingerprint ?? request.body ?? null]))
    .digest('hex');

  try {
    await prisma.idempotencyRecord.create({ data: { scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!existing) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed. Retry shortly.');
    if (existing.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
    }
    if (!existing.completedAt) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed. Retry shortly.');
    reply.header('idempotent-replayed', 'true');
    reply.code(existing.statusCode ?? 200);
    const body = /** @type {any} */ (existing.responseBody);
    return body?.error ? { error: { ...body.error, requestId: request.id } } : body;
  }

  try {
    const result = await handler();
    await prisma.idempotencyRecord.update({
      where: { scope_key: { scope, key } },
      data: { statusCode: status, responseBody: JSON.parse(JSON.stringify(result ?? null)), completedAt: new Date() },
    });
    reply.code(status);
    return result;
  } catch (err) {
    // Deterministic client errors are remembered (a retry gets the same answer); anything else is
    // released so the client can safely retry.
    if (err instanceof AppError && err.status < 500) {
      await prisma.idempotencyRecord.update({
        where: { scope_key: { scope, key } },
        data: { statusCode: err.status, responseBody: { error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors, details: err.details } }, completedAt: new Date() },
      });
    } else {
      await prisma.idempotencyRecord.delete({ where: { scope_key: { scope, key } } }).catch(() => {});
    }
    throw err;
  }
}
