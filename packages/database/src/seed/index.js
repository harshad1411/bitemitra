// Idempotent seed (DATABASE.md §8). Safe to run repeatedly: existing rows are left as they are, except
// that permissions are synced from code and the Super Admin role always has every permission.
import { MOBILE_APPS } from '@jamzo/config';
import { PERMISSIONS, SYSTEM_ROLES, hashPassword } from '@jamzo/auth';
import { bboxOf } from '@jamzo/delivery-engine';
import { seedCatalog } from './catalog.js';

/** Feature flags (CONFIGURATION.md §4). Values are development defaults. */
export const DEFAULT_FLAGS = [
  { key: 'cod', enabled: true, description: 'Cash on delivery' },
  { key: 'tips', enabled: true, description: 'Customer tips for delivery partners' },
  { key: 'ratings', enabled: false, description: 'Order ratings and reviews' },
  { key: 'scheduled_orders', enabled: false, description: 'Scheduled delivery' },
  { key: 'free_delivery', enabled: true, description: 'Free-delivery thresholds and promotions' },
  { key: 'night_pricing', enabled: false, description: 'Night surcharge rules' },
  { key: 'surge', enabled: false, description: 'Demand/manual surge' },
  { key: 'restaurant_self_edit_menu', enabled: false, description: 'Restaurants edit their own menus' },
  { key: 'rider_batching', enabled: false, description: 'More than one active order per delivery partner' },
  { key: 'delivery_otp', enabled: true, description: 'Customer OTP required at handover' },
  { key: 'proof_of_delivery', enabled: false, description: 'Photo proof of delivery' },
];

/** Approximate development shapes — NOT surveyed boundaries (DATABASE.md §8). */
const rect = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

export const DEMO_GEOGRAPHY = {
  country: { code: 'IN', name: 'India', currencyCode: 'INR', timezone: 'Asia/Kolkata' },
  state: { code: 'GJ', name: 'Gujarat' },
  cities: [
    {
      slug: 'unjha',
      name: 'Unjha',
      centerLat: 23.8053,
      centerLng: 72.3935,
      isActive: true,
      zones: [
        { slug: 'unjha-central', name: 'Unjha Central', geometry: rect(72.38, 23.795, 72.405, 23.815) },
        {
          slug: 'unjha-north',
          name: 'Unjha North',
          geometry: rect(72.38, 23.815, 72.405, 23.835),
          serviceAreas: [
            {
              name: 'North residential (radius)',
              kind: 'RADIUS',
              centerLat: 23.825,
              centerLng: 72.3925,
              radiusM: 1200,
            },
          ],
        },
        { slug: 'unjha-south', name: 'Unjha South', geometry: rect(72.38, 23.775, 72.405, 23.795) },
      ],
    },
    {
      // Second city proves nothing is Unjha-specific; inactive (not launched).
      slug: 'mehsana',
      name: 'Mehsana',
      centerLat: 23.588,
      centerLng: 72.3693,
      isActive: false,
      zones: [
        { slug: 'mehsana-central', name: 'Mehsana Central', geometry: rect(72.355, 23.575, 72.385, 23.6) },
      ],
    },
  ],
};

/** Demo partner accounts (fake numbers; OTPs only ever go to the console provider in development). */
export const DEMO_ACCOUNTS = {
  restaurantOwner: '+919000000001',
  activeRider: '+919000000002',
  pendingRider: '+919000000003',
  draftRestaurantManager: '+919000000004',
};

/**
 * @param {import('@jamzo/database').Db} prisma
 * @param {{
 *   admin?: { email: string, password: string, name?: string },
 *   demo?: boolean,
 *   catalog?: boolean,
 *   fieldCipher?: { encrypt: (v: string) => string },
 *   log?: (msg: string) => void,
 * }} [options] catalog = demo restaurants and menus (needs demo); fieldCipher enables demo bank accounts
 */
export async function seed(
  prisma,
  { admin, demo = false, catalog = false, fieldCipher, log = () => {} } = {},
) {
  // ── Permissions (code is the source of truth) ──
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, description: p.description },
      update: { description: p.description },
    });
  }
  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  log(`permissions: ${PERMISSIONS.length}`);

  // ── System roles: created once; Super Admin always kept complete ──
  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: role.key } });
    if (!existing) {
      await prisma.role.create({
        data: {
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: true,
          permissions: { create: role.permissions.map((k) => ({ permissionId: permissionIds.get(k) })) },
        },
      });
    } else if (role.key === 'SUPER_ADMIN') {
      await prisma.rolePermission.createMany({
        data: role.permissions.map((k) => ({ roleId: existing.id, permissionId: permissionIds.get(k) })),
        skipDuplicates: true,
      });
    }
  }
  log(`roles: ${SYSTEM_ROLES.length}`);

  // ── Feature flags & app version policies ──
  for (const f of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: {} });
  }
  for (const appId of /** @type {('CUSTOMER' | 'RESTAURANT' | 'RIDER')[]} */ (Object.keys(MOBILE_APPS))) {
    for (const platform of /** @type {const} */ (['IOS', 'ANDROID'])) {
      await prisma.appVersionPolicy.upsert({
        where: { appId_platform: { appId, platform } },
        create: {
          appId,
          platform,
          minSupportedVersion: '1.0.0',
          recommendedVersion: '1.0.0',
          forceUpdate: false,
        },
        update: {},
      });
    }
  }
  log('flags and app version policies');

  // ── First Super Admin (never overwrites an existing account or password) ──
  if (admin) {
    const email = admin.email.trim().toLowerCase();
    const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const user = await prisma.user.findUnique({ where: { email }, include: { adminUser: true } });
    if (!user) {
      await prisma.user.create({
        data: {
          email,
          emailVerified: true,
          name: admin.name ?? 'Super Admin',
          passwordHash: await hashPassword(admin.password),
          identities: { create: { provider: 'PASSWORD', subject: email, verifiedAt: new Date() } },
          adminUser: { create: { roles: { create: { roleId: superRole.id } } } },
        },
      });
      log(`super admin created: ${email}`);
    } else {
      log(`super admin exists, unchanged: ${email}`);
    }
  }

  if (demo) {
    const cityIds = await seedDemo(prisma, log);
    if (catalog) await seedCatalog(prisma, { cityId: cityIds.unjha, log, fieldCipher });
  }
}

/** @param {import('@jamzo/database').Db} prisma @param {(m: string) => void} log */
async function seedDemo(prisma, log) {
  const g = DEMO_GEOGRAPHY;
  const country = await prisma.country.upsert({
    where: { code: g.country.code },
    create: g.country,
    update: {},
  });
  const state = await prisma.state.upsert({
    where: { countryId_code: { countryId: country.id, code: g.state.code } },
    create: { ...g.state, countryId: country.id },
    update: {},
  });
  const cityIds = {};
  for (const c of g.cities) {
    const { zones, ...cityData } = c;
    const city = await prisma.city.upsert({
      where: { slug: c.slug },
      create: { ...cityData, stateId: state.id },
      update: {},
    });
    cityIds[c.slug] = city.id;
    for (const z of zones) {
      const { serviceAreas = [], ...zoneData } = z;
      const existing = await prisma.zone.findUnique({
        where: { cityId_slug: { cityId: city.id, slug: z.slug } },
      });
      if (existing) continue;
      const zone = await prisma.zone.create({
        data: { ...zoneData, cityId: city.id, ...bboxOf(z.geometry) },
      });
      for (const sa of serviceAreas) await prisma.serviceArea.create({ data: { ...sa, zoneId: zone.id } });
    }
  }
  log(`demo geography: ${g.cities.map((c) => c.name).join(', ')}`);

  const userFor = (phone, name) =>
    prisma.user.upsert({
      where: { phone },
      create: { phone, name, identities: { create: { provider: 'PHONE_OTP', subject: phone } } },
      update: {},
    });

  const owner = await userFor(DEMO_ACCOUNTS.restaurantOwner, 'Demo Restaurant Owner');
  const kitchen = await prisma.restaurant.upsert({
    where: { slug: 'demo-kitchen' },
    create: {
      slug: 'demo-kitchen',
      name: 'Jamzo Demo Kitchen',
      cityId: cityIds.unjha,
      cuisines: ['Gujarati', 'North Indian'],
      onboardingStatus: 'ACTIVE',
    },
    update: {},
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: kitchen.id, userId: owner.id } },
    create: { restaurantId: kitchen.id, userId: owner.id, role: 'OWNER' },
    update: {},
  });

  const manager = await userFor(DEMO_ACCOUNTS.draftRestaurantManager, 'Pending Restaurant Manager');
  const pending = await prisma.restaurant.upsert({
    where: { slug: 'pending-restaurant' },
    create: {
      slug: 'pending-restaurant',
      name: 'Pending Restaurant',
      cityId: cityIds.unjha,
      cuisines: ['Cafe'],
      onboardingStatus: 'DRAFT',
    },
    update: {},
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: pending.id, userId: manager.id } },
    create: { restaurantId: pending.id, userId: manager.id, role: 'MANAGER' },
    update: {},
  });

  const activeRider = await userFor(DEMO_ACCOUNTS.activeRider, 'Demo Delivery Partner');
  await prisma.rider.upsert({
    where: { userId: activeRider.id },
    create: { userId: activeRider.id, cityId: cityIds.unjha, onboardingStatus: 'ACTIVE' },
    update: {},
  });
  const pendingRider = await userFor(DEMO_ACCOUNTS.pendingRider, 'Pending Delivery Partner');
  await prisma.rider.upsert({
    where: { userId: pendingRider.id },
    create: { userId: pendingRider.id, cityId: cityIds.unjha, onboardingStatus: 'APPLIED' },
    update: {},
  });
  log('demo partner accounts');
  return cityIds;
}
