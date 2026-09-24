import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, isUniqueViolation } from './index.js';
import { startTestDatabase } from './testing.js';

let db;
let prisma;
beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient({ url: db.url });
}, 60_000);
afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

describe('test database (real PostgreSQL via PGlite)', () => {
  it('runs migrations and supports queries, relations and interactive transactions', async () => {
    const country = await prisma.country.create({ data: { code: 'IN', name: 'India' } });
    const state = await prisma.state.create({ data: { countryId: country.id, code: 'GJ', name: 'Gujarat' } });
    const city = await prisma.$transaction(async (tx) => {
      const c = await tx.city.create({ data: { stateId: state.id, slug: 'unjha', name: 'Unjha', centerLat: 23.8053, centerLng: 72.3935 } });
      await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'city.create', entityType: 'city', entityId: c.id } });
      return c;
    });
    const found = await prisma.city.findUnique({ where: { id: city.id }, include: { state: { include: { country: true } } } });
    expect(found.state.country.code).toBe('IN');
    expect(Number(found.centerLat)).toBeCloseTo(23.8053, 6);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('rolls back a failed transaction completely', async () => {
    const before = await prisma.auditLog.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'x', entityType: 'y' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('surfaces database constraints to the application', async () => {
    await prisma.setting.create({ data: { key: 'tips', scope: 'GLOBAL', value: { enabled: true } } });
    const dup = await prisma.setting.create({ data: { key: 'tips', scope: 'GLOBAL', value: { enabled: false } } }).catch((e) => e);
    expect(isUniqueViolation(dup)).toBe(true);
    const bad = await prisma.setting.create({ data: { key: 'x', scope: 'CITY', value: 1 } }).catch((e) => e);
    expect(String(bad.message)).toMatch(/settings_scope_ref_present|23514|check constraint/i);
  });
});
