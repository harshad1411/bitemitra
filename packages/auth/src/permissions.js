// Permission catalogue (RBAC.md §2). Permissions are code; roles are data (seeded from roles.js).

/** @typedef {{ key: string, description: string, phase: number }} PermissionDefinition */

/** @type {PermissionDefinition[]} */
export const PERMISSIONS = [
  { key: 'dashboard.view', description: 'View the admin home', phase: 1 },
  { key: 'admins.view', description: 'View admin users', phase: 1 },
  { key: 'admins.manage', description: 'Create, edit and deactivate admin users; assign roles', phase: 1 },
  { key: 'roles.view', description: 'View roles and permissions', phase: 1 },
  { key: 'roles.manage', description: 'Create and edit custom roles', phase: 1 },
  { key: 'rbac.super', description: 'Manage Super Admins and system role definitions', phase: 1 },
  { key: 'geo.view', description: 'View countries, states, cities, zones and service areas', phase: 1 },
  { key: 'geo.manage', description: 'Create and edit geography', phase: 1 },
  { key: 'config.view', description: 'View settings, app version policies and feature flags', phase: 1 },
  { key: 'config.manage', description: 'Change settings, app version policies and maintenance mode', phase: 1 },
  { key: 'flags.manage', description: 'Change feature flags', phase: 1 },
  { key: 'media.view', description: 'View the media library', phase: 1 },
  { key: 'media.manage', description: 'Upload, edit and delete media', phase: 1 },
  { key: 'audit.view', description: 'View the audit log', phase: 1 },
  { key: 'restaurants.view', description: 'View restaurants', phase: 2 },
  { key: 'restaurants.manage', description: 'Edit restaurants, hours, documents; pause restaurants', phase: 2 },
  { key: 'restaurants.approve', description: 'Approve and activate restaurants; verify bank details', phase: 2 },
  { key: 'products.manage', description: 'Manage menus and products', phase: 2 },
  { key: 'customers.view', description: 'View customers (masked contact details)', phase: 3 },
  { key: 'customers.pii', description: 'View unmasked customer phone and address', phase: 3 },
  { key: 'customers.manage', description: 'Block COD, delete accounts', phase: 3 },
  { key: 'cms.manage', description: 'Manage home sections, banners and pages', phase: 3 },
  { key: 'pricing.view', description: 'View commercial rules', phase: 4 },
  { key: 'pricing.manage', description: 'Change markup, delivery, platform fee and small-order rules', phase: 4 },
  { key: 'pricing.surge', description: 'Enable or disable surge and night rules', phase: 4 },
  { key: 'commissions.manage', description: 'Change commission rules', phase: 4 },
  { key: 'taxes.manage', description: 'Change tax and withholding rules', phase: 4 },
  { key: 'promotions.manage', description: 'Manage coupons and promotions', phase: 4 },
  { key: 'orders.view', description: 'View orders', phase: 5 },
  { key: 'orders.edit', description: 'Edit orders (notes, prep time, zone)', phase: 5 },
  { key: 'orders.cancel', description: 'Cancel orders and override outcomes', phase: 5 },
  { key: 'notifications.manage', description: 'Manage notification templates', phase: 5 },
  { key: 'orders.assign_rider', description: 'Assign and reassign delivery partners', phase: 6 },
  { key: 'riders.view', description: 'View delivery partners', phase: 6 },
  { key: 'riders.manage', description: 'Edit delivery partners', phase: 6 },
  { key: 'riders.approve', description: 'Approve and activate delivery partners', phase: 6 },
  { key: 'payments.view', description: 'View payments', phase: 7 },
  { key: 'refunds.create', description: 'Issue refunds up to the approval threshold', phase: 7 },
  { key: 'refunds.approve', description: 'Approve refunds above the threshold', phase: 7 },
  { key: 'payments.reconcile', description: 'Reconcile payments and verify COD deposits', phase: 8 },
  { key: 'settlements.view', description: 'View settlements', phase: 8 },
  { key: 'settlements.manage', description: 'Run, approve and mark settlements paid', phase: 8 },
  { key: 'ledgers.adjust', description: 'Post manual ledger adjustments', phase: 8 },
  { key: 'support.manage', description: 'Handle support tickets', phase: 9 },
  { key: 'reports.view', description: 'View reports', phase: 9 },
  { key: 'analytics.view', description: 'View analytics dashboards', phase: 9 },
];

/** @type {string[]} */
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const KEY_SET = new Set(PERMISSION_KEYS);
if (KEY_SET.size !== PERMISSIONS.length) throw new Error('Duplicate permission key');

/** @param {string} key */
export const isPermission = (key) => KEY_SET.has(key);
