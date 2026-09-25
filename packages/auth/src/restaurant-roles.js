// What each restaurant team role may do in the Restaurant Partner app (RESTAURANTS.md §7, DECISIONS D-42).
// Checked on every partner request together with membership and restaurant status.

/** @type {Readonly<Record<string, readonly string[]>>} */
export const RESTAURANT_ROLE_CAPABILITIES = Object.freeze({
  'store.view': ['OWNER', 'MANAGER', 'STAFF'],
  'menu.view': ['OWNER', 'MANAGER', 'STAFF'],
  'menu.availability': ['OWNER', 'MANAGER', 'STAFF'],
  'store.status': ['OWNER', 'MANAGER'],
  // Phase 5 (RESTAURANTS.md §8): everyone on shift handles orders; money and cancelling are for managers.
  'orders.view': ['OWNER', 'MANAGER', 'STAFF'],
  'orders.handle': ['OWNER', 'MANAGER', 'STAFF'],
  'orders.cancel': ['OWNER', 'MANAGER'],
  'orders.finance': ['OWNER', 'MANAGER'],
});

/**
 * @param {string} role OWNER | MANAGER | STAFF
 * @param {string} capability
 */
export function restaurantRoleCan(role, capability) {
  return Boolean(RESTAURANT_ROLE_CAPABILITIES[capability]?.includes(role));
}

/** Restaurant statuses whose members may use the partner app (D-34). */
export const PARTNER_APP_RESTAURANT_STATUSES = Object.freeze(['APPROVED', 'ACTIVE']);
