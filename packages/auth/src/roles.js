// Seeded system roles (RBAC.md §3, OD-24, CH-9). Editable data after seeding, except Super Admin.
import { PERMISSION_KEYS } from './permissions.js';

const all = PERMISSION_KEYS;
const except = (/** @type {string[]} */ ...keys) => all.filter((k) => !keys.includes(k));

const OPERATIONS = [
  'dashboard.view',
  'geo.view',
  'geo.manage',
  'config.view',
  'media.view',
  'restaurants.view',
  'restaurants.manage',
  'customers.view',
  'pricing.view',
  'pricing.surge',
  'orders.view',
  'orders.edit',
  'orders.cancel',
  'orders.assign_rider',
  'riders.view',
  'support.manage',
  'reports.view',
  'analytics.view',
];

/** @typedef {{ key: string, name: string, description: string, permissions: string[], cityScoped?: boolean }} RoleDefinition */

/** @type {RoleDefinition[]} */
export const SYSTEM_ROLES = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full access including Super Admin management.',
    permissions: all,
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Full access except Super Admin management.',
    permissions: except('rbac.super'),
  },
  {
    key: 'OPERATIONS',
    name: 'Operations',
    description: 'Day-to-day operations across all cities.',
    permissions: OPERATIONS,
  },
  {
    key: 'CITY_MANAGER',
    name: 'City Manager',
    description: 'Operations for one city (grant must include the city).',
    permissions: [...OPERATIONS, 'config.manage'],
    cityScoped: true,
  },
  {
    key: 'FINANCE',
    name: 'Finance',
    description: 'Payments, refunds, settlements, ledgers and commercial rules.',
    permissions: [
      'dashboard.view',
      'geo.view',
      'config.view',
      'audit.view',
      'restaurants.view',
      'riders.view',
      'customers.view',
      'orders.view',
      'payments.view',
      'payments.reconcile',
      'refunds.create',
      'refunds.approve',
      'settlements.view',
      'settlements.manage',
      'ledgers.adjust',
      'pricing.view',
      'pricing.manage',
      'commissions.manage',
      'taxes.manage',
      'reports.view',
      'analytics.view',
    ],
  },
  {
    key: 'SUPPORT',
    name: 'Support',
    description: 'Customer and order support.',
    permissions: [
      'dashboard.view',
      'geo.view',
      'orders.view',
      'orders.edit',
      'orders.cancel',
      'customers.view',
      'customers.pii',
      'customers.manage',
      'restaurants.view',
      'riders.view',
      'payments.view',
      'refunds.create',
      'support.manage',
    ],
  },
  {
    key: 'PARTNER_MANAGER',
    name: 'Partner Manager',
    description: 'Restaurant onboarding and menus (spec "Restaurant Manager", renamed — CH-9).',
    permissions: [
      'dashboard.view',
      'geo.view',
      'media.view',
      'media.manage',
      'restaurants.view',
      'restaurants.manage',
      'restaurants.approve',
      'products.manage',
      'pricing.view',
      'orders.view',
      'settlements.view',
      'reports.view',
      'analytics.view',
    ],
  },
  {
    key: 'RIDER_MANAGER',
    name: 'Rider Manager',
    description: 'Delivery partner onboarding and management.',
    permissions: [
      'dashboard.view',
      'geo.view',
      'riders.view',
      'riders.manage',
      'riders.approve',
      'orders.view',
      'orders.assign_rider',
      'settlements.view',
      'reports.view',
      'analytics.view',
    ],
  },
  {
    key: 'MARKETING',
    name: 'Marketing',
    description: 'Promotions, content and notifications.',
    permissions: [
      'dashboard.view',
      'geo.view',
      'media.view',
      'media.manage',
      'restaurants.view',
      'customers.view',
      'pricing.view',
      'promotions.manage',
      'cms.manage',
      'notifications.manage',
      'reports.view',
      'analytics.view',
    ],
  },
  {
    key: 'CONTENT_MANAGER',
    name: 'Content Manager',
    description: 'CMS and media library.',
    permissions: ['dashboard.view', 'media.view', 'media.manage', 'cms.manage'],
  },
];

for (const role of SYSTEM_ROLES) {
  for (const p of role.permissions)
    if (!PERMISSION_KEYS.includes(p)) throw new Error(`${role.key}: unknown permission ${p}`);
}
