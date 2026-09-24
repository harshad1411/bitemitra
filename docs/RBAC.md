# Role-based access control

Status: **Phase 0 design.** Implemented in Phase 1 (`packages/auth` catalogue + API guards; seeded roles).

Covers MASTER_SPEC §42, §43, §48, §49, §67.

## 1. Principles

1. **Backend enforcement.** Every API route declares its required permission(s); the guard runs before
   the handler. Admin UI hiding is convenience only (§42).
2. **Deny by default.** A route without a declared permission fails a CI test.
3. **Resource scoping** in addition to permissions: restaurant users only see their restaurants;
   riders only themselves; customers only their own data; admins optionally limited to a city
   (`admin_user_roles.cityId`).
4. **Permissions are code, roles are data.** The permission catalogue lives in `packages/auth` and is
   synced to the `permissions` table on deploy. Roles (and their permission sets) are editable in Admin
   by users with `admins.manage`; the 8 spec roles are seeded as system roles.
5. Every grant/revoke is audit-logged. A user cannot grant permissions they do not hold.

## 2. Permission catalogue

| Key | Meaning |
|---|---|
| `orders.view` | list/view orders (customer phone masked unless `customers.pii`) |
| `orders.edit` | notes, prep-time override, change delivery zone |
| `orders.cancel` | cancel with outcome override |
| `orders.assign_rider` | manual assign / reassign |
| `payments.view` | payment details, events |
| `payments.reconcile` | mark payment after verified reconciliation, verify COD deposits |
| `refunds.create` | issue refunds up to the approval threshold |
| `refunds.approve` | approve refunds above threshold (maker-checker) |
| `settlements.view` / `settlements.manage` | view / run, approve, mark paid |
| `ledgers.adjust` | manual restaurant/rider ledger adjustments |
| `restaurants.view` / `restaurants.manage` | view / edit restaurants, hours, documents, pause |
| `restaurants.approve` | onboarding approval & activation, bank detail verification |
| `products.manage` | menu & products incl. bulk edits, disable product |
| `riders.view` / `riders.manage` / `riders.approve` | view / edit / KYC approve & activate |
| `customers.view` / `customers.pii` / `customers.manage` | view / unmasked phone & address / block COD, delete |
| `pricing.view` / `pricing.manage` | markup, delivery, platform fee, small order rules |
| `pricing.surge` | enable/disable surge & night rules (emergency control, §67) |
| `commissions.manage` | commission rules |
| `taxes.manage` | tax rules |
| `promotions.manage` | coupons & promotions |
| `cms.manage` | media, home sections, banners, pages |
| `notifications.manage` | notification templates |
| `support.manage` | support tickets |
| `reports.view` / `analytics.view` | reports & dashboards (financial reports need `payments.view`) |
| `geo.manage` | cities, zones, service areas |
| `config.manage` | operational settings, app version policy, maintenance mode |
| `flags.manage` | feature flags |
| `admins.manage` | admin users, roles |
| `audit.view` | audit log |

## 3. Default role matrix (seeded; editable)

| Permission \ Role | Super Admin | Operations | Finance | Restaurant Mgr | Rider Mgr | Support | Marketing | Content Mgr |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| orders.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| orders.edit | ✓ | ✓ | | | | ✓ | | |
| orders.cancel | ✓ | ✓ | | | | ✓ | | |
| orders.assign_rider | ✓ | ✓ | | | ✓ | | | |
| payments.view | ✓ | | ✓ | | | ✓ | | |
| payments.reconcile | ✓ | | ✓ | | | | | |
| refunds.create | ✓ | | ✓ | | | ✓ | | |
| refunds.approve | ✓ | | ✓ | | | | | |
| settlements.view | ✓ | | ✓ | ✓ | ✓ | | | |
| settlements.manage | ✓ | | ✓ | | | | | |
| ledgers.adjust | ✓ | | ✓ | | | | | |
| restaurants.view | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| restaurants.manage | ✓ | ✓ | | ✓ | | | | |
| restaurants.approve | ✓ | | | ✓ | | | | |
| products.manage | ✓ | | | ✓ | | | | |
| riders.view | ✓ | ✓ | ✓ | | ✓ | ✓ | | |
| riders.manage / riders.approve | ✓ | | | | ✓ | | | |
| customers.view | ✓ | ✓ | ✓ | | | ✓ | ✓ | |
| customers.pii | ✓ | | | | | ✓ | | |
| customers.manage | ✓ | | | | | ✓ | | |
| pricing.view | ✓ | ✓ | ✓ | ✓ | | | ✓ | |
| pricing.manage | ✓ | | ✓ | | | | | |
| pricing.surge | ✓ | ✓ | | | | | | |
| commissions.manage | ✓ | | ✓ | | | | | |
| taxes.manage | ✓ | | ✓ | | | | | |
| promotions.manage | ✓ | | | | | | ✓ | |
| cms.manage | ✓ | | | | | | ✓ | ✓ |
| notifications.manage | ✓ | | | | | | ✓ | |
| support.manage | ✓ | ✓ | | | | ✓ | | |
| reports.view / analytics.view | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| geo.manage | ✓ | ✓ | | | | | | |
| config.manage | ✓ | | | | | | | |
| flags.manage | ✓ | | | | | | | |
| admins.manage | ✓ | | | | | | | |
| audit.view | ✓ | | ✓ | | | | | |

## 4. Non-admin actors

| App | Actor | Access |
|---|---|---|
| Customer | customer | own profile, addresses, carts, orders, tickets, reviews |
| Restaurant | OWNER | everything for own restaurant(s) incl. bank details request, users, settlements |
| Restaurant | MANAGER | orders, menu, availability, hours, pause/busy, analytics, settlements (view) |
| Restaurant | STAFF | orders (accept/reject/ready), sold-out toggle |
| Rider | rider | own profile, documents, availability, offers, assigned orders, earnings, COD, payouts |

Menu editing by restaurants is additionally gated by the `restaurant_self_edit_menu` feature flag and
`restaurant_settings.selfEditMenu`.

## 5. Dangerous actions (§67)

Cancel order, refund, mark payment reconciled, ledger adjustments, pause restaurant, disable COD, surge
on/off, commission/tax changes, bank detail changes, role changes: require the permission, a typed
confirmation in the UI, a reason, and write an audit log entry (actor, action, entity, old → new, IP,
user agent, request id). Above configurable thresholds (refunds, ledger adjustments) a second approver is required.

## 6. Tests (Phase 1)

Permission catalogue ↔ DB sync · every registered route has a permission declaration · matrix test:
each seeded role × each permission-protected route returns 200/403 as expected · resource scoping
(restaurant A user cannot read restaurant B order; rider cannot read another rider's earnings) ·
cannot escalate own permissions · audit rows written for grants.
