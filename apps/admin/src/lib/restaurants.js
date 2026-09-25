// Labels and formatting for restaurant screens. Business rules live on the API; this only presents them.

export const STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  DOCUMENTS_PENDING: { label: 'Documents pending', tone: 'warning' },
  REVIEW: { label: 'In review', tone: 'info' },
  APPROVED: { label: 'Approved · not live', tone: 'accent' },
  ACTIVE: { label: 'Live', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'critical' },
};
export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DOCUMENT_KINDS = [
  { value: 'FSSAI', label: 'FSSAI licence / registration' },
  { value: 'PAN', label: 'PAN' },
  { value: 'GST', label: 'GST certificate' },
  { value: 'SHOP_ACT', label: 'Shop & establishment' },
  { value: 'TRADE_LICENSE', label: 'Trade licence' },
  { value: 'CANCELLED_CHEQUE', label: 'Cancelled cheque' },
  { value: 'OTHER', label: 'Other' },
];
export const documentKindLabel = (k) => DOCUMENT_KINDS.find((d) => d.value === k)?.label ?? k;

export const DOCUMENT_TONE = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'critical',
  EXPIRED: 'critical',
};
export const ROLE_LABEL = { OWNER: 'Owner', MANAGER: 'Manager', STAFF: 'Staff' };

/** "18:30" → "6:30 pm"; "24:00" → "midnight". */
export function time12(hhmm) {
  if (hhmm === '24:00' || hhmm === '00:00') return 'midnight';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const clock = (value, timeZone) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));

/** Human summary of a branch's open state from the API (engine output). */
export function openStateText(state, timeZone = 'Asia/Kolkata') {
  switch (state.reason) {
    case 'OPEN':
      return {
        tone: 'success',
        text: state.closesAt ? `Open · closes ${clock(state.closesAt, timeZone)}` : 'Open 24 hours',
      };
    case 'PAUSED':
      return { tone: 'warning', text: `Paused until ${clock(state.pausedUntil, timeZone)}` };
    case 'CLOSED_MANUALLY':
      return { tone: 'critical', text: 'Closed by the restaurant' };
    case 'NO_HOURS':
      return { tone: 'neutral', text: 'No opening hours set' };
    case 'RESTAURANT_NOT_ACTIVE':
      return { tone: 'neutral', text: 'Not live' };
    default:
      return {
        tone: 'neutral',
        text: state.nextOpenLocal
          ? `Closed · opens ${DAY_SHORT[state.nextOpenLocal.dayOfWeek]} ${time12(state.nextOpenLocal.time)}`
          : 'Closed',
      };
  }
}

/** Product availability from the API → badge text. */
export function availabilityText(a, timeZone = 'Asia/Kolkata') {
  switch (a.reason) {
    case 'AVAILABLE':
      return { tone: 'success', text: 'Available' };
    case 'SOLD_OUT':
      return { tone: 'critical', text: 'Sold out' };
    case 'SOLD_OUT_UNTIL':
      return { tone: 'warning', text: a.until ? `Sold out until ${clock(a.until, timeZone)}` : 'Sold out' };
    case 'OUT_OF_STOCK':
      return { tone: 'critical', text: 'Out of stock' };
    case 'NO_VARIANT_AVAILABLE':
      return { tone: 'critical', text: 'All sizes sold out' };
    case 'OUTSIDE_SCHEDULE':
      return { tone: 'neutral', text: 'Outside its schedule' };
    case 'DRAFT':
      return { tone: 'neutral', text: 'Draft' };
    case 'ARCHIVED':
      return { tone: 'neutral', text: 'Archived' };
    default:
      return { tone: 'neutral', text: a.reason };
  }
}
