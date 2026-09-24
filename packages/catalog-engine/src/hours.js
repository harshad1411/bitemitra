// Weekly opening intervals (RESTAURANTS.md §3, DECISIONS D-38). Used for branch business hours
// ({ dayOfWeek, opensAt, closesAt }) and product schedules ({ dayOfWeek, startsAt, endsAt }).
import {
  MINUTES_PER_DAY,
  MINUTES_PER_WEEK,
  addLocalMinutes,
  formatHHmm,
  localTime,
  parseHHmm,
} from './time.js';

/**
 * @typedef {{ dayOfWeek: number, opensAt?: string, closesAt?: string, startsAt?: string, endsAt?: string }} WeeklyRow
 */

const startOf = (/** @type {WeeklyRow} */ r) => r.opensAt ?? r.startsAt;
const endOf = (/** @type {WeeklyRow} */ r) => r.closesAt ?? r.endsAt;

/**
 * Converts rows to week-minute intervals [start, end). An interval whose end is not after its start runs
 * past midnight and belongs to its opening day; "24:00" means end of day. Intervals crossing Saturday →
 * Sunday are split at the week boundary.
 * @param {WeeklyRow[]} rows
 * @returns {{ start: number, end: number, index: number }[]}
 */
export function weeklyIntervals(rows) {
  const out = [];
  rows.forEach((row, index) => {
    const open = parseHHmm(startOf(row));
    const close = parseHHmm(endOf(row), { allowEndOfDay: true });
    if (open == null || close == null || close === open) return;
    const start = row.dayOfWeek * MINUTES_PER_DAY + open;
    const end = row.dayOfWeek * MINUTES_PER_DAY + (close > open ? close : close + MINUTES_PER_DAY);
    if (end <= MINUTES_PER_WEEK) out.push({ start, end, index });
    else {
      out.push({ start, end: MINUTES_PER_WEEK, index });
      out.push({ start: 0, end: end - MINUTES_PER_WEEK, index });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Validates weekly rows: day 0–6, HH:mm times (closing may be 24:00), opening ≠ closing, no overlaps.
 * @param {WeeklyRow[]} rows
 * @returns {Record<string, string[]>} field errors keyed by row index (empty when valid)
 */
export function validateWeeklyRows(rows) {
  /** @type {Record<string, string[]>} */
  const errors = {};
  const add = (key, msg) => (errors[key] ??= []).push(msg);
  rows.forEach((row, i) => {
    if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6)
      add(`${i}.dayOfWeek`, 'Day must be 0 (Sunday) to 6 (Saturday)');
    const open = parseHHmm(startOf(row));
    const close = parseHHmm(endOf(row), { allowEndOfDay: true });
    if (open == null) add(`${i}.start`, 'Use HH:mm (24-hour)');
    if (close == null) add(`${i}.end`, 'Use HH:mm (24-hour) or 24:00');
    if (open != null && close != null && open === close)
      add(`${i}.end`, 'Opening and closing times cannot be equal');
  });
  if (Object.keys(errors).length) return errors;
  const intervals = weeklyIntervals(rows);
  for (let a = 0; a < intervals.length; a++) {
    for (let b = a + 1; b < intervals.length; b++) {
      const x = intervals[a];
      const y = intervals[b];
      if (x.index !== y.index && x.start < y.end && y.start < x.end) {
        add(
          `${Math.max(x.index, y.index)}.start`,
          `Overlaps another interval (row ${Math.min(x.index, y.index) + 1})`,
        );
      }
    }
  }
  return errors;
}

/**
 * Merges touching/overlapping intervals, treating the week as a circle (Saturday 22:00–24:00 followed by
 * Sunday 00:00–02:00 is one continuous opening).
 * @param {{ start: number, end: number }[]} intervals sorted by start
 */
function mergeCircular(intervals) {
  /** @type {{ start: number, end: number }[]} */
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ start: iv.start, end: iv.end });
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first.start === 0 && last.end === MINUTES_PER_WEEK) {
      merged.pop();
      first.start = last.start - MINUTES_PER_WEEK; // negative start = continues from the previous week
    }
  }
  if (merged.length === 1 && merged[0].start === 0 && merged[0].end === MINUTES_PER_WEEK) {
    return [{ start: 0, end: MINUTES_PER_WEEK, always: true }];
  }
  return merged;
}

/**
 * Whether now falls inside the weekly rows, and when that changes.
 * @param {WeeklyRow[]} rows
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{ open: boolean, hasHours: boolean, closesAt: Date | null, nextOpenAt: Date | null, nextOpenLocal: { dayOfWeek: number, time: string } | null }}
 */
export function weeklyState(rows, now, timeZone) {
  const intervals = mergeCircular(weeklyIntervals(rows));
  if (!intervals.length)
    return { open: false, hasHours: false, closesAt: null, nextOpenAt: null, nextOpenLocal: null };
  const t = localTime(now, timeZone).weekMinute;
  const forward = (target) => (((target - t) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  for (const iv of intervals) {
    if (/** @type {any} */ (iv).always)
      return { open: true, hasHours: true, closesAt: null, nextOpenAt: null, nextOpenLocal: null };
    const inside = (t >= iv.start && t < iv.end) || (iv.start < 0 && t >= iv.start + MINUTES_PER_WEEK);
    if (inside) {
      return {
        open: true,
        hasHours: true,
        closesAt: addLocalMinutes(now, forward(iv.end % MINUTES_PER_WEEK) || MINUTES_PER_WEEK),
        nextOpenAt: null,
        nextOpenLocal: null,
      };
    }
  }
  const next = intervals
    .map((iv) => ({
      iv,
      delta: forward(((iv.start % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK),
    }))
    .sort((a, b) => a.delta - b.delta)[0];
  const startMinute = ((next.iv.start % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  return {
    open: false,
    hasHours: true,
    closesAt: null,
    nextOpenAt: addLocalMinutes(now, next.delta),
    nextOpenLocal: {
      dayOfWeek: Math.floor(startMinute / MINUTES_PER_DAY),
      time: formatHHmm(startMinute % MINUTES_PER_DAY),
    },
  };
}

/**
 * Is a branch accepting orders now? (RESTAURANTS.md §3)
 * @param {{ restaurantStatus?: string, isOpen: boolean, pausedUntil?: Date | string | null, hours: WeeklyRow[] }} branch
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{ open: boolean, reason: 'OPEN' | 'RESTAURANT_NOT_ACTIVE' | 'CLOSED_MANUALLY' | 'PAUSED' | 'NO_HOURS' | 'OUTSIDE_HOURS', pausedUntil: Date | null, closesAt: Date | null, nextOpenAt: Date | null, nextOpenLocal: { dayOfWeek: number, time: string } | null }}
 */
export function branchOpenState(branch, now, timeZone) {
  const schedule = weeklyState(branch.hours ?? [], now, timeZone);
  const base = {
    pausedUntil: null,
    closesAt: null,
    nextOpenAt: schedule.nextOpenAt,
    nextOpenLocal: schedule.nextOpenLocal,
  };
  if (branch.restaurantStatus && branch.restaurantStatus !== 'ACTIVE')
    return { ...base, open: false, reason: 'RESTAURANT_NOT_ACTIVE', nextOpenAt: null, nextOpenLocal: null };
  if (!branch.isOpen)
    return { ...base, open: false, reason: 'CLOSED_MANUALLY', nextOpenAt: null, nextOpenLocal: null };
  const paused = branch.pausedUntil ? new Date(branch.pausedUntil) : null;
  if (paused && paused > now) return { ...base, open: false, reason: 'PAUSED', pausedUntil: paused };
  if (!schedule.hasHours) return { ...base, open: false, reason: 'NO_HOURS' };
  if (!schedule.open) return { ...base, open: false, reason: 'OUTSIDE_HOURS' };
  return {
    ...base,
    open: true,
    reason: 'OPEN',
    closesAt: schedule.closesAt,
    nextOpenAt: null,
    nextOpenLocal: null,
  };
}
