// Order wording for the Restaurant Partner app. The API decides every transition (D-61, D-67).
export const REJECT_REASONS = [
  ['ITEM_UNAVAILABLE', 'An item is not available'],
  ['TOO_BUSY', 'Kitchen too busy'],
  ['CLOSING_SOON', 'Closing soon'],
  ['CANNOT_PREPARE', 'Cannot prepare this order'],
];
export const CANCEL_REASONS = [
  ['ITEM_UNAVAILABLE', 'An item ran out'],
  ['KITCHEN_ISSUE', 'Kitchen problem'],
  ['CLOSING_SOON', 'Closing early'],
];
export const PREP_CHOICES = [10, 15, 20, 30, 45];

export const KITCHEN_LABEL = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  COMPLETED: 'Picked up',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const clock = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
export const timeText = (iso, timeZone = 'Asia/Kolkata') => (iso ? clock(iso, timeZone) : '');

/** "2 × Margherita (Medium 10") · Crust: Cheese burst" */
export function itemLine(i) {
  const addons = i.addons.map((a) => `${a.group}: ${a.name}`).join(', ');
  return `${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ''}${addons ? ` · ${addons}` : ''}`;
}
