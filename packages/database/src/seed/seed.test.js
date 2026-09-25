import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, SYSTEM_ROLES } from '@jamzo/auth';
import { createPrismaClient } from '../index.js';
import { startTestDatabase } from '../testing.js';
import { randomBytes } from 'node:crypto';
import { createFieldCipher } from '@jamzo/auth';
import { validateProductStructure, validateWeeklyRows } from '@jamzo/catalog-engine';
import { DEFAULT_FLAGS, seed } from './index.js';
import { DEMO_CATEGORIES, DEMO_RESTAURANTS } from './catalog-data.js';

let db;
let prisma;
beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient({ url: db.url });
});
afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

describe('seed', () => {
  it('seeds base + demo data and is idempotent', async () => {
    const admin = { email: 'Owner@Example.com', password: 'Correct-Horse-9' };
    await seed(prisma, { admin, demo: true });
    await seed(prisma, { admin: { ...admin, password: 'Different-Pass-1' }, demo: true });

    expect(await prisma.permission.count()).toBe(PERMISSION_KEYS.length);
    expect(await prisma.role.count()).toBe(SYSTEM_ROLES.length);
    const superRole = await prisma.role.findUnique({
      where: { key: 'SUPER_ADMIN' },
      include: { permissions: true },
    });
    expect(superRole.permissions).toHaveLength(PERMISSION_KEYS.length);
    expect(await prisma.featureFlag.count()).toBe(DEFAULT_FLAGS.length);
    expect(await prisma.appVersionPolicy.count()).toBe(6);

    const users = await prisma.user.findMany({
      where: { email: 'owner@example.com' },
      include: { identities: true, adminUser: true },
    });
    expect(users).toHaveLength(1);
    expect(users[0].identities[0].provider).toBe('PASSWORD');
    // the second run must not have reset the password
    const { verifyPassword } = await import('@jamzo/auth');
    expect(await verifyPassword(users[0].passwordHash, 'Correct-Horse-9')).toBe(true);

    expect(await prisma.city.count()).toBe(2);
    expect(await prisma.zone.count()).toBe(4);
    expect((await prisma.city.findUnique({ where: { slug: 'mehsana' } })).isActive).toBe(false);
    const north = await prisma.zone.findFirst({
      where: { slug: 'unjha-north' },
      include: { serviceAreas: true },
    });
    expect(north.serviceAreas).toHaveLength(1);
    expect(Number(north.minLat)).toBeCloseTo(23.815, 6);
    expect(await prisma.rider.count()).toBe(2);
    expect(await prisma.restaurantUser.count()).toBe(2);
  });

  it('adds the demo catalog idempotently, and every seeded menu obeys the catalog rules', async () => {
    const fieldCipher = createFieldCipher(randomBytes(32).toString('base64'));
    await seed(prisma, { demo: true, catalog: true, fieldCipher });
    const counts = async () => ({
      restaurants: await prisma.restaurant.count(),
      products: await prisma.product.count(),
      variants: await prisma.productVariant.count(),
      addons: await prisma.productAddon.count(),
      branches: await prisma.restaurantBranch.count(),
      banks: await prisma.restaurantBankAccount.count(),
      members: await prisma.restaurantUser.count(),
    });
    const first = await counts();
    await seed(prisma, { demo: true, catalog: true, fieldCipher });
    expect(await counts()).toEqual(first);

    const expectedProducts = DEMO_RESTAURANTS.reduce(
      (n, r) => n + r.menu.reduce((k, [, items]) => k + items.length, 0),
      0,
    );
    expect(first.restaurants).toBe(DEMO_RESTAURANTS.length);
    expect(first.products).toBe(expectedProducts);
    expect(first.products).toBeGreaterThanOrEqual(100); // spec §53
    expect(await prisma.category.count()).toBe(DEMO_CATEGORIES.length);
    expect(await prisma.restaurant.count({ where: { onboardingStatus: 'ACTIVE' } })).toBeGreaterThanOrEqual(
      9,
    );

    // Every branch is inside a zone; live restaurants have hours, a delivery area and a verified primary account.
    const restaurants = await prisma.restaurant.findMany({
      include: {
        branches: { include: { businessHours: true, deliveryAreas: true } },
        bankAccounts: true,
        products: {
          include: { variants: true, addonGroups: { include: { addons: true } }, schedules: true },
        },
      },
    });
    for (const r of restaurants) {
      for (const b of r.branches) {
        expect(b.zoneId, `${r.slug} branch zone`).not.toBeNull();
        expect(validateWeeklyRows(b.businessHours)).toEqual({});
      }
      if (r.onboardingStatus === 'ACTIVE') {
        expect(r.branches[0].businessHours.length, r.slug).toBeGreaterThan(0);
        expect(r.branches[0].deliveryAreas.length, r.slug).toBe(1);
        expect(
          r.bankAccounts.filter((a) => a.isPrimary && a.verifiedAt),
          r.slug,
        ).toHaveLength(1);
      }
      for (const p of r.products) {
        const errors = validateProductStructure(
          { ...p, imageMediaIds: [], addonGroups: p.addonGroups },
          { pureVeg: r.isPureVeg },
        );
        expect(errors, `${r.slug} / ${p.name}`).toEqual({});
        expect(validateWeeklyRows(p.schedules), p.name).toEqual({});
        if (p.variants.length)
          expect(p.basePricePaise).toBe(p.variants.find((v) => v.isDefault).basePricePaise);
      }
    }
    // Placeholder pricing rules (A-23): one open version per target, tax on every charge, nothing duplicated on re-run.
    expect(await prisma.taxRule.count({ where: { effectiveTo: null } })).toBe(7);
    expect(await prisma.deliveryPricingRule.count()).toBe(1);
    expect(await prisma.markupRule.count()).toBe(2);
    expect(await prisma.coupon.count()).toBe(2);
    expect(await prisma.cmsPage.count({ where: { isPublished: true } })).toBe(0); // legal texts are drafts (Q-12)
    // Bank numbers are stored encrypted, never in clear text.
    const bank = await prisma.restaurantBankAccount.findFirst();
    expect(bank.accountNumberEncrypted).not.toMatch(/^\d+$/);
    expect(fieldCipher.decrypt(bank.accountNumberEncrypted)).toMatch(
      new RegExp(`${bank.accountNumberLast4}$`),
    );
  });
});
