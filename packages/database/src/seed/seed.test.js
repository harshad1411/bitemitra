import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, SYSTEM_ROLES } from '@jamzo/auth';
import { createPrismaClient } from '../index.js';
import { startTestDatabase } from '../testing.js';
import { DEFAULT_FLAGS, seed } from './index.js';

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
    const superRole = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' }, include: { permissions: true } });
    expect(superRole.permissions).toHaveLength(PERMISSION_KEYS.length);
    expect(await prisma.featureFlag.count()).toBe(DEFAULT_FLAGS.length);
    expect(await prisma.appVersionPolicy.count()).toBe(6);

    const users = await prisma.user.findMany({ where: { email: 'owner@example.com' }, include: { identities: true, adminUser: true } });
    expect(users).toHaveLength(1);
    expect(users[0].identities[0].provider).toBe('PASSWORD');
    // the second run must not have reset the password
    const { verifyPassword } = await import('@jamzo/auth');
    expect(await verifyPassword(users[0].passwordHash, 'Correct-Horse-9')).toBe(true);

    expect(await prisma.city.count()).toBe(2);
    expect(await prisma.zone.count()).toBe(4);
    expect((await prisma.city.findUnique({ where: { slug: 'mehsana' } })).isActive).toBe(false);
    const north = await prisma.zone.findFirst({ where: { slug: 'unjha-north' }, include: { serviceAreas: true } });
    expect(north.serviceAreas).toHaveLength(1);
    expect(Number(north.minLat)).toBeCloseTo(23.815, 6);
    expect(await prisma.rider.count()).toBe(2);
    expect(await prisma.restaurantUser.count()).toBe(2);
  });
});
