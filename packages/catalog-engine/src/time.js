// Local-time helpers for weekly schedules (RESTAURANTS.md §3). Times are "HH:mm" in the city's timezone.

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * "HH:mm" → minutes after midnight. "24:00" is accepted only when `allowEndOfDay` (closing times).
 * @param {string} value
 * @param {{ allowEndOfDay?: boolean }} [opts]
 * @returns {number | null}
 */
export function parseHHmm(value, { allowEndOfDay = false } = {}) {
  if (allowEndOfDay && value === '24:00') return MINUTES_PER_DAY;
  const m = HHMM.exec(String(value));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** @param {number} minutes */
export function formatHHmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();
function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Local weekday (0 = Sunday) and minute of day for an instant.
 * @param {Date} date
 * @param {string} timeZone IANA name, e.g. Asia/Kolkata
 */
export function localTime(date, timeZone) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const dayOfWeek = WEEKDAYS[parts.weekday];
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { dayOfWeek, minute, weekMinute: dayOfWeek * MINUTES_PER_DAY + minute };
}

/**
 * The instant `deltaMinutes` local minutes after the start of the current local minute. Assumes no
 * daylight-saving change inside the window (true for India — assumption A-1).
 * @param {Date} now
 * @param {number} deltaMinutes
 */
export function addLocalMinutes(now, deltaMinutes) {
  const startOfMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(startOfMinute + deltaMinutes * 60_000);
}

/**
 * Next local midnight ("sold out for today" ends then).
 * @param {Date} now
 * @param {string} timeZone
 */
export function endOfLocalDay(now, timeZone) {
  return addLocalMinutes(now, MINUTES_PER_DAY - localTime(now, timeZone).minute);
}
