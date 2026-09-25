// Presentation of API values. The server decides open/closed and availability; this only words it.
const clock = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function openText(state, timeZone) {
  switch (state.reason) {
    case 'OPEN':
      return {
        tone: 'success',
        text: state.closesAt ? `Open · closes ${clock(state.closesAt, timeZone)}` : 'Open 24 hours',
      };
    case 'PAUSED':
      return { tone: 'warning', text: `Paused until ${clock(state.pausedUntil, timeZone)}` };
    case 'CLOSED_MANUALLY':
      return { tone: 'critical', text: 'Closed — not taking orders' };
    case 'NO_HOURS':
      return { tone: 'neutral', text: 'No opening hours set — ask Jamzo to add them' };
    case 'RESTAURANT_NOT_ACTIVE':
      return { tone: 'neutral', text: 'Not live on Jamzo yet' };
    default:
      return {
        tone: 'neutral',
        text: state.nextOpenLocal
          ? `Closed · opens ${DAYS[state.nextOpenLocal.dayOfWeek]} ${state.nextOpenLocal.time}`
          : 'Closed',
      };
  }
}

export function availabilityText(a, timeZone) {
  switch (a.reason) {
    case 'AVAILABLE':
      return { tone: 'success', text: 'In stock' };
    case 'SOLD_OUT':
      return { tone: 'critical', text: 'Sold out' };
    case 'SOLD_OUT_UNTIL':
      return { tone: 'warning', text: a.until ? `Sold out until ${clock(a.until, timeZone)}` : 'Sold out' };
    case 'NO_VARIANT_AVAILABLE':
      return { tone: 'critical', text: 'All sizes sold out' };
    case 'OUTSIDE_SCHEDULE':
      return { tone: 'neutral', text: 'Not in its time window now' };
    case 'OUT_OF_STOCK':
      return { tone: 'critical', text: 'Out of stock' };
    case 'DRAFT':
      return { tone: 'neutral', text: 'Hidden (draft)' };
    default:
      return { tone: 'neutral', text: a.reason };
  }
}
