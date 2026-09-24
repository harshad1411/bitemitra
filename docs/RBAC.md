# Role-based access control

Status: **Phase 1 implements** the permission catalogue, seeded system roles, admin user/role
management, the server-side permission guard, city scoping and audit logging. Restaurant/rider
member roles exist as data (approval gates); their feature permissions arrive with Phases 2/5/6.
Decisions: OD-13, OD-24, CH-9. Source of truth in code: `packages/auth/src/permissions.js`.

## 1. Principles

1. **Server-side enforcement.** Every privileged route declares its permission; the guard runs before the handler. Admin UI hiding is convenience only.
2. **Deny by default.** A test fails if any `/v1/admin/*` route lacks a permission declaration.
3. **Resource scoping** on top of permissions: City Managers (and any grant with `cityId`) only see/change their city's data; restaurant members only their restaurants; riders only themselves; customers only their own data.
4. **Permissions are code, roles are data.** The catalogue is synced to `permissions` on seed/deploy. System roles are seeded; custom roles can be created in Admin.
5. **No self-escalation.** You cannot grant a permission you do not hold; only holders of `rbac.super` can create/modify Super Admins or the Super Admin role. The last active Super Admin cannot be removed.
6. Every grant/revoke/role change is audit-logged with old → new.
7. **Authentication is not authorisation** (OD-13): a signed-in person must also have an *approved* restaurant membership or rider profile to use partner features.

## 2. Permission catalogue

`P1` = enforced by routes that exist in Phase 1; others are defined now and enforced when their module ships.

| Key | Meaning | Phase |
|---|---|---|
| `dashboard.view` | Admin home | P1 |
| `admins.view` / `admins.manage` | list / create, edit, deactivate admin users, assign roles | P1 |
| `roles.view` / `roles.manage` | view / create and edit custom roles | P1 |
| `rbac.super` | manage Super Admins and system role definitions | P1 |
| `geo.view` / `geo.manage` | countries, states, cities, zones, service areas | P1 |
| `config.view` / `config.manage` | operational settings, app version policies, maintenance | P1 |
| `flags.manage` | feature flags | P1 |
| `media.view` / `media.manage` | media library | P1 |
| `audit.view` | audit log | P1 |
| `orders.view`, `orders.edit`, `orders.cancel`, `orders.assign_rider` | orders | 5–6 |
| `payments.view`, `payments.reconcile` | payments, COD deposits | 7–8 |
| `refunds.create`, `refunds.approve` | refunds (maker-checker) | 7 |
| `settlements.view`, `settlements.manage`, `ledgers.adjust` | finance | 8 |
| `restaurants.view`, `restaurants.manage`, `restaurants.approve`, `products.manage` | restaurants & menu | 2 |
| `riders.view`, `riders.manage`, `riders.approve` | delivery partners | 6 |
| `customers.view`, `customers.pii`, `customers.manage` | customers | 3 |
| `pricing.view`, `pricing.manage`, `pricing.surge`, `commissions.manage`, `taxes.manage` | commercial rules | 4 |
| `promotions.manage`, `cms.manage`, `notifications.manage` | marketing & content | 3–5 |
| `support.manage` | support tickets | 9 |
| `reports.view`, `analytics.view` | reporting | 9 |

## 3. Admin roles (seeded system roles)

| Role | Summary |
|---|---|
| **Super Admin** | Everything, including `rbac.super`. |
| **Admin** | Everything except `rbac.super`. |
| **Operations** | Orders, dispatch, restaurants/riders (view + operational manage), geography, surge switch, support. |
| **City Manager** | Operations permissions **scoped to one city** (grant carries `cityId`), plus `geo.manage` and `config.manage` for that city's scope only. |
| **Finance** | Payments, refunds (+ approve), settlements, ledger adjustments, pricing/commission/tax rules, reports, audit. |
| **Support** | Orders (view/edit/cancel), customers incl. PII, refunds (create), support tickets. |
| **Partner Manager** | Restaurant onboarding/approval, restaurants & menus. *(Spec §42 calls this "Restaurant Manager"; renamed to avoid clashing with the restaurant-side role — CH-9.)* |
| **Rider Manager** | Delivery partner onboarding/approval and management, rider assignment. |
| **Marketing** | Promotions, CMS, notifications, reports. |
| **Content Manager** | CMS and media. |

Phase 1 matrix (P1 permissions only):

| Permission | Super Admin | Admin | Operations | City Mgr | Finance | Support | Partner Mgr | Rider Mgr | Marketing | Content Mgr |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admins.view | ✓ | ✓ | | | | | | | | |
| admins.manage | ✓ | ✓ | | | | | | | | |
| roles.view | ✓ | ✓ | | | | | | | | |
| roles.manage | ✓ | ✓ | | | | | | | | |
| rbac.super | ✓ | | | | | | | | | |
| geo.view | ✓ | ✓ | ✓ | ✓ (own city) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| geo.manage | ✓ | ✓ | ✓ | ✓ (own city) | | | | | | |
| config.view | ✓ | ✓ | ✓ | ✓ (own city) | ✓ | | | | | |
| config.manage | ✓ | ✓ | | ✓ (own city) | | | | | | |
| flags.manage | ✓ | ✓ | | | | | | | | |
| media.view | ✓ | ✓ | ✓ | ✓ | | | ✓ | | ✓ | ✓ |
| media.manage | ✓ | ✓ | | | | | ✓ | | ✓ | ✓ |
| audit.view | ✓ | ✓ | | | ✓ | | | | | |

The full later-phase matrix follows the role summaries above and is encoded in `packages/auth/src/roles.js`.

## 4. Non-admin actors

| App | Actor | Gate | Phase 1 |
|---|---|---|---|
| Customer | Customer | signed in (profile auto-created) | profile + device registration |
| Restaurant Partner | Restaurant Owner / Manager / Staff (`restaurant_users.role`) | membership `isActive` **and** restaurant `onboardingStatus = ACTIVE` | `/v1/me` reports memberships and approval; no restaurant features yet |
| Delivery Partner | Rider | `riders.onboardingStatus = ACTIVE` | `/v1/me` reports approval; no rider features yet |

Planned restaurant-side permissions: Owner — everything for own restaurant(s) incl. bank details and
users; Manager — orders, menu, availability, hours, pause/busy, analytics, settlements (view);
Staff — accept/reject/ready and sold-out toggles.

## 5. Dangerous actions

Require the permission, a UI confirmation, a reason, and an audit entry (actor, action, entity, old →
new, IP, user agent, request id). Phase 1 examples: deactivating an admin, changing role permissions,
changing critical settings, forcing an app update, turning maintenance mode on. Later: cancellations,
refunds (maker-checker above threshold), ledger adjustments, pausing restaurants, COD/surge switches.

## 6. Tests

Catalogue ↔ database sync · every admin route declares a permission · per-role allow/deny matrix
across Phase 1 routes · city scoping (City Manager of Unjha cannot edit Mehsana) · no self-escalation ·
last Super Admin protection · audit rows for grants.
