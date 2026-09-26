import { formatPrice } from '@jamzo/ui';

/** Customer prices: "₹180", "₹180.50" (D-107). */
export const money = (paise) => formatPrice(paise);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** "Closed · opens Mon 6:00 pm" etc. from the API's open state. */
export function openLabel(open) {
  if (open.isOpen) return null;
  if (open.reason === 'PAUSED') return 'Not taking orders for a short while';
  if (open.reason === 'CLOSED_MANUALLY') return 'Closed for now';
  if (open.nextOpenLocal)
    return `Closed · opens ${DAYS[open.nextOpenLocal.dayOfWeek]} ${time12(open.nextOpenLocal.time)}`;
  return 'Closed';
}

export const etaLabel = (eta) => (eta ? `${eta.minMinutes}–${eta.maxMinutes} min` : null);
/** Arrival estimate for an order on its way (D-79): always shown as an estimate. */
export const arrivalLabel = (eta) =>
  !eta
    ? null
    : eta.arrivingNow
      ? 'Arriving now'
      : `Arriving in about ${eta.minMinutes}–${eta.maxMinutes} min (estimate)`;

/** A map pin at the partner's rounded position (opens Google Maps in the app or browser; no key needed). */
export const mapPinUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

export const distanceLabel = (m) => (m == null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

/** Why a location cannot be served, in plain words. */
export function notServedLabel(reason) {
  return (
    {
      NO_CITY: 'Jamzo doesn’t deliver in this city yet.',
      CITY_NOT_LIVE: 'Jamzo is coming to this city soon.',
      OUTSIDE_SERVICE_AREA: 'This spot is just outside our delivery area.',
      NO_ZONE: 'We don’t deliver to this area yet.',
    }[reason] ?? 'We don’t deliver here yet.'
  );
}
