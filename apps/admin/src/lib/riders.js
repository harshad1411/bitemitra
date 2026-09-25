// Delivery partner vocabulary for the admin (D-73 … D-77). The API decides; this only words it.
export const RIDER_STATUS = {
  APPLIED: ['Applied', 'neutral'],
  DOCUMENT_PENDING: ['Documents pending', 'warning'],
  UNDER_REVIEW: ['Under review', 'info'],
  ACTIVE: ['Active', 'success'],
  SUSPENDED: ['Suspended', 'critical'],
  REJECTED: ['Rejected', 'critical'],
};
export const DOC_KIND = {
  DRIVING_LICENCE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  PAN: 'PAN',
  ID_PROOF: 'Identity proof',
  PHOTO: 'Photo',
  INSURANCE: 'Insurance',
};
export const VEHICLE = {
  BICYCLE: 'Bicycle',
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  EV_SCOOTER: 'Electric scooter',
  CAR: 'Car',
};
export const DELIVERY_STATUS = {
  NOT_STARTED: 'Waiting for kitchen',
  SEARCHING: 'Finding a partner',
  ASSIGNED: 'Request sent',
  ACCEPTED: 'Going to restaurant',
  AT_RESTAURANT: 'At restaurant',
  PICKED_UP: 'Picked up',
  ON_THE_WAY: 'On the way',
  ARRIVED: 'At customer',
  DELIVERED: 'Delivered',
  NO_RIDER_FOUND: 'No partner found',
  CANCELLED: 'Cancelled',
};
export const minutesAgo = (iso) =>
  iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : null;
