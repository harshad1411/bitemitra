export * from './permissions.js';
export * from './roles.js';
export * from './password.js';
export * from './secrets.js';

/**
 * @param {Iterable<string>} granted
 * @param {string | string[]} required all must be granted
 */
export function hasPermissions(granted, required) {
  const set = granted instanceof Set ? granted : new Set(granted);
  return (Array.isArray(required) ? required : [required]).every((p) => set.has(p));
}
export * from './crypto.js';
export * from './restaurant-roles.js';
