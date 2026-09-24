// Keyset pagination (API.md §3). UUIDv7 ids are time-ordered, so "newest first" lists page on id alone.
import { AppError } from './errors.js';

/**
 * Cursor on id (newest first).
 * @param {{ cursor?: string, limit: number }} q
 */
export function idPage(q) {
  if (q.cursor && !/^[0-9a-f-]{36}$/i.test(q.cursor))
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor.', {
      fieldErrors: { cursor: ['Invalid cursor'] },
    });
  return {
    where: q.cursor ? { id: { lt: q.cursor } } : {},
    orderBy: { id: /** @type {const} */ ('desc') },
    take: q.limit + 1,
  };
}

/**
 * Cursor on (name, id) ascending — for alphabetical lists.
 * @param {{ cursor?: string, limit: number }} q
 */
export function namePage(q) {
  let where = {};
  if (q.cursor) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'));
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Invalid cursor.', {
        fieldErrors: { cursor: ['Invalid cursor'] },
      });
    }
    const [name, id] = parsed;
    where = { OR: [{ name: { gt: name } }, { name, id: { gt: id } }] };
  }
  return {
    where,
    orderBy: [{ name: /** @type {const} */ ('asc') }, { id: /** @type {const} */ ('asc') }],
    take: q.limit + 1,
  };
}

/**
 * @template {{ id: string, name?: string }} T
 * @param {T[]} rows fetched with take = limit + 1
 * @param {number} limit
 * @param {'id' | 'name'} [kind]
 */
export function toPage(rows, limit, kind = 'id') {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? kind === 'id'
        ? last.id
        : Buffer.from(JSON.stringify([last.name, last.id])).toString('base64url')
      : null;
  return { items, nextCursor };
}
