// Is a product orderable now? (RESTAURANTS.md §4, DECISIONS D-38)
import { weeklyState } from './hours.js';

/**
 * @typedef {object} AvailabilityWindow
 * @property {boolean} isAvailable
 * @property {Date | string} startsAt
 * @property {Date | string | null} [endsAt]
 * @property {Date | string} [createdAt]
 */

/**
 * The window in force now: the latest-starting one that has started and not ended.
 * @param {AvailabilityWindow[]} windows
 * @param {Date} now
 */
export function currentWindow(windows, now) {
  const t = now.getTime();
  let best = null;
  for (const w of windows ?? []) {
    const start = new Date(w.startsAt).getTime();
    const end = w.endsAt == null ? Infinity : new Date(w.endsAt).getTime();
    if (start > t || end <= t) continue;
    if (
      !best ||
      start > new Date(best.startsAt).getTime() ||
      (start === new Date(best.startsAt).getTime() &&
        new Date(w.createdAt ?? 0).getTime() > new Date(best.createdAt ?? 0).getTime())
    )
      best = w;
  }
  return best;
}

/**
 * @param {{
 *   status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
 *   isAvailable: boolean,
 *   stockQuantity?: number | null,
 *   windows?: AvailabilityWindow[],
 *   schedules?: { dayOfWeek: number, startsAt: string, endsAt: string }[],
 *   variants?: { isAvailable: boolean }[],
 * }} product
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{ available: boolean, reason: 'AVAILABLE' | 'DRAFT' | 'ARCHIVED' | 'SOLD_OUT' | 'SOLD_OUT_UNTIL' | 'OUT_OF_STOCK' | 'NO_VARIANT_AVAILABLE' | 'OUTSIDE_SCHEDULE', until: Date | null, nextAvailableAt: Date | null }}
 */
export function productAvailability(product, now, timeZone) {
  const result = (available, reason, until = null, nextAvailableAt = null) => ({
    available,
    reason,
    until,
    nextAvailableAt,
  });
  if (product.status === 'DRAFT') return result(false, 'DRAFT');
  if (product.status === 'ARCHIVED') return result(false, 'ARCHIVED');
  if (!product.isAvailable) return result(false, 'SOLD_OUT');
  const window = currentWindow(product.windows ?? [], now);
  if (window && !window.isAvailable) {
    const until = window.endsAt == null ? null : new Date(window.endsAt);
    return result(false, 'SOLD_OUT_UNTIL', until, until);
  }
  if (product.stockQuantity != null && product.stockQuantity <= 0) return result(false, 'OUT_OF_STOCK');
  if (product.variants?.length && !product.variants.some((v) => v.isAvailable))
    return result(false, 'NO_VARIANT_AVAILABLE');
  if (product.schedules?.length) {
    const s = weeklyState(product.schedules, now, timeZone);
    if (!s.open) return result(false, 'OUTSIDE_SCHEDULE', null, s.nextOpenAt);
  }
  return result(true, 'AVAILABLE');
}
