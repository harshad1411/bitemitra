import { formatPaise } from '@jamzo/ui';

export const money = (p) => formatPaise(p ?? 0);
export const km = (m) => (m == null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
export const time = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';

export const DOC_LABEL = {
  DRIVING_LICENCE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  PAN: 'PAN card',
  ID_PROOF: 'Identity proof (e.g. voter ID, passport; mask any Aadhaar number)',
  PHOTO: 'Your photo',
  INSURANCE: 'Vehicle insurance',
};
export const VEHICLES = [
  ['MOTORCYCLE', 'Motorcycle'],
  ['SCOOTER', 'Scooter'],
  ['EV_SCOOTER', 'Electric scooter'],
  ['BICYCLE', 'Bicycle'],
  ['CAR', 'Car'],
];
export const STATUS_TEXT = {
  APPLIED: 'Complete your application',
  DOCUMENT_PENDING: 'Some documents need attention',
  UNDER_REVIEW: 'Your application is under review. We will let you know when you are approved.',
  SUSPENDED: 'Your account is paused. Please contact partner support.',
  REJECTED: 'Your application was not approved. Please contact partner support.',
};

/** Opens the phone's maps app with directions to a point. */
export const mapsUrl = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
