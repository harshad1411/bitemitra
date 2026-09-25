// Settlement periods (SETTLEMENTS.md §2.3, D-89) in the city's time zone. Pure date arithmetic on local
// calendar days; a period is [start, end) and `end` is the cut-off.

const DAY = 86_400_000;
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** The local calendar date (and weekday) of an instant in a time zone. */
export function localDate(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'long',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: parts.weekday.toUpperCase(),
  };
}

/** Offset of the zone from UTC at an instant, in ms (e.g. +5:30 for India). */
function offsetMs(at, timeZone) {
  const l = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
    .formatToParts(at)
    .reduce((o, p) => ({ ...o, [p.type]: Number(p.value) }), /** @type {any} */ ({}));
  return (
    Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - Math.floor(at.getTime() / 1000) * 1000
  );
}

/** The instant a local calendar day starts (plus `hours`), for a date given as y/m/d (m is 1-based). */
export function localStart({ y, m, d }, timeZone, hours = 0) {
  const guess = new Date(Date.UTC(y, m - 1, d, hours));
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

/** Local calendar date `days` after (or before) the given one. */
const addDays = ({ y, m, d }, days) => {
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/**
 * The period a settlement run at `now` covers, or null when this schedule does not settle today.
 * DAILY / T_PLUS_1: yesterday. T_PLUS_2: the day before yesterday. WEEKLY: the last full Monday–Sunday
 * week, only on the configured run day. MANUAL: never automatically.
 * @param {'DAILY' | 'T_PLUS_1' | 'T_PLUS_2' | 'WEEKLY' | 'MANUAL'} schedule
 * @param {Date} now
 * @param {{ timeZone: string, weeklyRunDay?: string }} o
 * @returns {{ start: Date, end: Date } | null}
 */
export function settlementPeriod(schedule, now, { timeZone, weeklyRunDay = 'MONDAY' }) {
  const today = localDate(now, timeZone);
  const span = (from, to) => ({ start: localStart(from, timeZone), end: localStart(to, timeZone) });
  switch (schedule) {
    case 'DAILY':
    case 'T_PLUS_1':
      return span(addDays(today, -1), today);
    case 'T_PLUS_2':
      return span(addDays(today, -2), addDays(today, -1));
    case 'WEEKLY': {
      if (today.weekday !== weeklyRunDay) return null;
      const sinceMonday = (WEEKDAYS.indexOf(today.weekday) + 6) % 7;
      const monday = addDays(today, -sinceMonday);
      return span(addDays(monday, -7), monday);
    }
    default:
      return null;
  }
}

/** The next time the daily settlement job should run: `hour`:00 local time after `now`. */
export function nextRunAt(now, timeZone, hour = 6) {
  const today = localDate(now, timeZone);
  const at = localStart(today, timeZone, hour);
  return at > now ? at : localStart(addDays(today, 1), timeZone, hour);
}
