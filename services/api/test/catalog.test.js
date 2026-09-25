// Catalog administration (RESTAURANTS.md §4–§5, D-37, D-38, D-43) against real PostgreSQL, with the
// seeded demo catalog (12 restaurants, 100+ products).
import { endOfLocalDay } from '@jamzo/catalog-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, multipart, startTestApp, TINY_PNG } from './helpers.js';

let ctx;
let token;
let kitchen; // Jamzo Demo Kitchen (pure veg, ACTIVE)
let eggCafe; // Cafe Egg Station (not pure veg, APPROVED)

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true, countQueries: true });
  token = (await adminLogin(ctx)).accessToken;
  kitchen = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'demo-kitchen' } });
  eggCafe = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'cafe-egg-station' } });
});
afterAll(() => ctx?.stop());

const call = (method, url, payload, t = token) =>
  ctx.app.inject({ method, url, headers: bearer(t), ...(payload !== undefined ? { payload } : {}) });

const thali = (overrides = {}) => ({
  restaurantId: kitchen.id,
  name: `Test Thali ${Math.random().toString(36).slice(2, 7)}`,
  foodType: 'VEG',
  variants: [
    { name: 'Regular', basePricePaise: 18000, isDefault: true },
    { name: 'Unlimited', basePricePaise: 25000 },
  ],
  addonGroups: [
    {
      name: 'Preparation',
      minSelect: 1,
      maxSelect: 1,
      addons: [{ name: 'Regular' }, { name: 'Jain' }],
    },
    {
      name: 'Extras',
      minSelect: 0,
      maxSelect: 2,
      addons: [
        { name: 'Papad', basePricePaise: 1500 },
        { name: 'Butter roti', basePricePaise: 2500 },
      ],
    },
  ],
  ...overrides,
});

async function createProduct(body) {
  const res = await call('POST', '/v1/admin/products', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function uploadImage() {
  const body = multipart(
    { title: 'Thali photo' },
    { filename: 'thali.png', contentType: 'image/png', content: TINY_PNG },
  );
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/admin/media',
    headers: { ...bearer(token), 'content-type': body.contentType },
    payload: body.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

describe('product create and read', () => {
  it('creates a product with variants, add-ons, images and a schedule; base price mirrors the default variant', async () => {
    const imageId = await uploadImage();
    const p = await createProduct(
      thali({
        imageMediaIds: [imageId],
        schedules: [{ dayOfWeek: 1, startsAt: '11:00', endsAt: '15:00' }],
        description: 'Full meal',
      }),
    );
    expect(p.basePricePaise).toBe(18000);
    expect(p.variants.map((v) => [v.name, v.basePricePaise, v.isDefault])).toEqual([
      ['Regular', 18000, true],
      ['Unlimited', 25000, false],
    ]);
    expect(p.addonGroups[0]).toMatchObject({ name: 'Preparation', minSelect: 1, maxSelect: 1 });
    expect(p.images[0].urls.original).toMatch(/^\/v1\/media\/files\/media\//);
    expect(p.version).toBe(0);
    expect(p.availability).toHaveProperty('reason');
    const again = (await call('GET', `/v1/admin/products/${p.id}`)).json();
    expect(again.addonGroups[1].addons.map((a) => a.name)).toEqual(['Papad', 'Butter roti']);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: p.id, action: 'product.create' } })).toBe(1);
  });

  it('rejects invalid structures with field errors', async () => {
    const cases = [
      [{ foodType: 'EGG' }, 'foodType'], // pure-veg restaurant
      [{ variants: [{ name: 'Only', basePricePaise: 100, isDefault: true }] }, 'variants'],
      [
        {
          addonGroups: [
            { name: 'Egg', minSelect: 0, maxSelect: 1, addons: [{ name: 'Egg', foodType: 'EGG' }] },
          ],
        },
        'addonGroups.0.addons.0.foodType',
      ],
      [
        { addonGroups: [{ name: 'X', minSelect: 0, maxSelect: 3, addons: [{ name: 'A' }] }] },
        'addonGroups.0.maxSelect',
      ],
      [
        {
          schedules: [
            { dayOfWeek: 1, startsAt: '10:00', endsAt: '12:00' },
            { dayOfWeek: 1, startsAt: '11:00', endsAt: '13:00' },
          ],
        },
        'schedules.1.start',
      ],
      [{ imageMediaIds: ['0199a3c4-1111-7000-8000-000000000001'] }, 'imageMediaIds'],
      [{ variants: [], basePricePaise: undefined }, 'basePricePaise'],
    ];
    for (const [overrides, field] of cases) {
      const res = await call('POST', '/v1/admin/products', thali(overrides));
      expect(res.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(Object.keys(res.json().error.fieldErrors), JSON.stringify(overrides)).toContain(field);
    }
    // A menu section of another restaurant is refused.
    const otherSection = await ctx.prisma.menuCategory.findFirstOrThrow({
      where: { restaurantId: eggCafe.id },
    });
    const res = await call('POST', '/v1/admin/products', thali({ menuCategoryId: otherSection.id }));
    expect(res.json().error.fieldErrors.menuCategoryId).toBeTruthy();
    // Egg items are fine in a restaurant that is not pure veg.
    await createProduct({
      restaurantId: eggCafe.id,
      name: 'Egg Roll',
      basePricePaise: 6000,
      foodType: 'EGG',
      addonGroups: [
        {
          name: 'Add',
          minSelect: 0,
          maxSelect: 1,
          addons: [{ name: 'Egg', foodType: 'EGG', basePricePaise: 1500 }],
        },
      ],
    });
  });
});

describe('product update (D-37)', () => {
  it('keeps ids of children that remain, removes missing ones and can switch the default variant', async () => {
    const p = await createProduct(thali());
    const [regular, unlimited] = p.variants;
    const res = await call('PUT', `/v1/admin/products/${p.id}`, {
      version: p.version,
      name: p.name,
      foodType: 'VEG',
      variants: [
        { id: regular.id, name: 'Regular', basePricePaise: 19000, isDefault: false },
        { id: unlimited.id, name: 'Unlimited', basePricePaise: 26000, isDefault: true },
        { name: 'Mini', basePricePaise: 12000 },
      ],
      addonGroups: [
        {
          id: p.addonGroups[1].id,
          name: 'Extras',
          minSelect: 0,
          maxSelect: 1,
          addons: [{ id: p.addonGroups[1].addons[0].id, name: 'Papad', basePricePaise: 2000 }],
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const u = res.json();
    expect(u.version).toBe(1);
    expect(u.basePricePaise).toBe(26000); // new default
    expect(u.variants.map((v) => v.id).slice(0, 2)).toEqual([regular.id, unlimited.id]);
    expect(u.variants.find((v) => v.isDefault).id).toBe(unlimited.id);
    expect(u.addonGroups).toHaveLength(1);
    expect(u.addonGroups[0].addons).toEqual([
      expect.objectContaining({ id: p.addonGroups[1].addons[0].id, basePricePaise: 2000 }),
    ]);
    expect(await ctx.prisma.productAddonGroup.count({ where: { id: p.addonGroups[0].id } })).toBe(0);
  });

  it('refuses a stale version (two admins editing): nothing is overwritten', async () => {
    const p = await createProduct(thali());
    const base = { name: p.name, foodType: 'VEG', basePricePaise: 20000, variants: [], addonGroups: [] };
    const first = await call('PUT', `/v1/admin/products/${p.id}`, { ...base, version: 0 });
    expect(first.statusCode).toBe(200);
    const second = await call('PUT', `/v1/admin/products/${p.id}`, {
      ...base,
      basePricePaise: 1,
      version: 0,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.details.currentVersion).toBe(1);
    expect((await call('GET', `/v1/admin/products/${p.id}`)).json().basePricePaise).toBe(20000);
  });

  it('refuses child ids that belong to another product', async () => {
    const a = await createProduct(thali());
    const b = await createProduct(thali());
    const res = await call('PUT', `/v1/admin/products/${b.id}`, {
      version: b.version,
      name: b.name,
      foodType: 'VEG',
      variants: [
        { id: a.variants[0].id, name: 'Stolen', basePricePaise: 1, isDefault: true },
        { name: 'Other', basePricePaise: 2 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors['variants.0.id']).toBeTruthy();
    expect(
      (await ctx.prisma.productVariant.findUniqueOrThrow({ where: { id: a.variants[0].id } })).name,
    ).toBe('Regular');
  });
});

describe('availability (D-38)', () => {
  it('sold out for today ends at the next local midnight; back in stock ends it now', async () => {
    const p = await createProduct(thali());
    let res = await call('POST', `/v1/admin/products/${p.id}/availability`, {
      isAvailable: false,
      until: 'END_OF_DAY',
      reason: 'Ran out',
    });
    expect(res.statusCode, res.body).toBe(200);
    const expected = endOfLocalDay(ctx.clock.now(), 'Asia/Kolkata').toISOString();
    expect(res.json().availability).toMatchObject({
      available: false,
      reason: 'SOLD_OUT_UNTIL',
      until: expected,
    });
    expect(res.json().version).toBe(1); // an editor opened before this cannot silently undo it
    // The list filter sees it as unavailable.
    const list = (
      await call('GET', `/v1/admin/products?restaurantId=${kitchen.id}&available=false&limit=100`)
    ).json();
    expect(list.items.map((x) => x.id)).toContain(p.id);

    res = await call('POST', `/v1/admin/products/${p.id}/availability`, { isAvailable: true });
    expect(res.json().availability).toMatchObject({ available: true, reason: 'AVAILABLE' });
    const windows = await ctx.prisma.productAvailability.findMany({ where: { productId: p.id } });
    expect(windows).toHaveLength(1);
    expect(windows[0].endsAt.getTime()).toBeLessThanOrEqual(ctx.clock.now().getTime());
  });

  it('indefinite sold out, variant and add-on toggles', async () => {
    const p = await createProduct(thali());
    let res = await call('POST', `/v1/admin/products/${p.id}/availability`, { isAvailable: false });
    expect(res.json().availability.reason).toBe('SOLD_OUT');
    await call('POST', `/v1/admin/products/${p.id}/availability`, { isAvailable: true });
    for (const v of p.variants)
      await call('POST', `/v1/admin/products/${p.id}/availability`, { isAvailable: false, variantId: v.id });
    res = await call('GET', `/v1/admin/products/${p.id}`);
    expect(res.json().availability.reason).toBe('NO_VARIANT_AVAILABLE');
    res = await call('POST', `/v1/admin/products/${p.id}/availability`, {
      isAvailable: false,
      addonId: p.addonGroups[1].addons[0].id,
    });
    expect(res.json().addonGroups[1].addons[0].isAvailable).toBe(false);
    const other = await createProduct(thali());
    res = await call('POST', `/v1/admin/products/${p.id}/availability`, {
      isAvailable: false,
      variantId: other.variants[0].id,
    });
    expect(res.statusCode).toBe(404);
    res = await call('POST', `/v1/admin/products/${p.id}/availability`, {
      isAvailable: false,
      until: new Date(Date.now() - 1000).toISOString(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('bulk actions (D-43)', () => {
  it('applies to every product or to none', async () => {
    const a = await createProduct(thali());
    const b = await createProduct(thali());
    let res = await call('POST', '/v1/admin/products/bulk', { ids: [a.id, b.id], action: 'SOLD_OUT' });
    expect(res.json()).toEqual({ updated: 2, action: 'SOLD_OUT' });
    expect(await ctx.prisma.product.count({ where: { id: { in: [a.id, b.id] }, isAvailable: false } })).toBe(
      2,
    );
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'product.bulk', entityId: { in: [a.id, b.id] } } }),
    ).toBe(2);

    // One unknown id → nothing changes.
    res = await call('POST', '/v1/admin/products/bulk', {
      ids: [a.id, '0199a3c4-1111-7000-8000-000000000009'],
      action: 'AVAILABLE',
    });
    expect(res.statusCode).toBe(404);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.id } })).isAvailable).toBe(false);

    // Moving to a section of another restaurant is refused.
    const eggSection = await ctx.prisma.menuCategory.findFirstOrThrow({
      where: { restaurantId: eggCafe.id },
    });
    res = await call('POST', '/v1/admin/products/bulk', {
      ids: [a.id],
      action: 'MOVE_SECTION',
      menuCategoryId: eggSection.id,
    });
    expect(res.statusCode).toBe(400);

    // A menu editor whose grant is limited to Mehsana cannot touch Unjha products — nothing changes.
    const mehsana = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'mehsana' } });
    const perms = await ctx.prisma.permission.findMany({
      where: { key: { in: ['products.manage', 'restaurants.view'] } },
    });
    await ctx.prisma.role.create({
      data: {
        key: 'MENU_EDITOR',
        name: 'Menu editor',
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    const editor = await adminWithRole(ctx, 'MENU_EDITOR', { cityId: mehsana.id });
    res = await call(
      'POST',
      '/v1/admin/products/bulk',
      { ids: [a.id], action: 'ARCHIVE' },
      editor.accessToken,
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/outside your cities/);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ACTIVE');
  });
});

describe('menu sections', () => {
  it('unique names (case-insensitive), full reorder, delete only when empty', async () => {
    const url = `/v1/admin/restaurants/${eggCafe.id}/menu-categories`;
    let res = await call('POST', url, { name: 'Wraps' });
    expect(res.statusCode).toBe(201);
    const wraps = res.json();
    expect((await call('POST', url, { name: 'WRAPS' })).statusCode).toBe(409);
    const sections = await ctx.prisma.menuCategory.findMany({
      where: { restaurantId: eggCafe.id },
      orderBy: { sortOrder: 'asc' },
    });
    const reversed = sections.map((s) => s.id).reverse();
    expect((await call('PUT', `${url}/order`, { ids: reversed.slice(1) })).statusCode).toBe(400);
    expect((await call('PUT', `${url}/order`, { ids: reversed })).statusCode).toBe(200);
    const menu = (await call('GET', `/v1/admin/restaurants/${eggCafe.id}/menu`)).json();
    expect(menu.sections.map((s) => s.id)).toEqual(reversed);
    const full = sections.find((s) => s.name === 'Egg specials');
    expect((await call('DELETE', `/v1/admin/menu-categories/${full.id}`)).statusCode).toBe(409);
    expect((await call('DELETE', `/v1/admin/menu-categories/${wraps.id}`)).statusCode).toBe(204);
  });

  it('food categories: unique slug, list with product counts', async () => {
    expect(
      (await call('POST', '/v1/admin/categories', { slug: 'thali', name: 'Thali again' })).statusCode,
    ).toBe(409);
    const res = await call('GET', '/v1/admin/categories');
    expect(res.json().items.find((c) => c.slug === 'thali').productCount).toBeGreaterThan(0);
  });
});

describe('lists and performance (OD-27)', () => {
  it('searches across restaurants and filters by status, food type and city', async () => {
    let res = await call('GET', '/v1/admin/products?q=dosa&limit=50');
    expect(res.json().items.length).toBeGreaterThanOrEqual(5);
    expect(res.json().items.every((p) => /dosa/i.test(`${p.name} ${p.restaurant.name}`))).toBe(true);
    res = await call('GET', '/v1/admin/products?foodType=EGG&limit=50');
    expect(res.json().items.every((p) => p.foodType === 'EGG')).toBe(true);
    const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
    const all = [];
    let cursor;
    do {
      const page = (
        await call(
          'GET',
          `/v1/admin/products?cityId=${unjha.id}&limit=40${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json();
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all.length).toBeGreaterThanOrEqual(100);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length); // keyset pages never repeat
  });

  it('loads a whole menu with a constant number of SQL statements, whatever its size (no N+1)', async () => {
    // Prisma emits query events asynchronously: let earlier events land before and after measuring.
    const settle = () => new Promise((r) => setTimeout(r, 150));
    const measure = async (restaurantId) => {
      await settle();
      const before = ctx.queries.count;
      const res = await call('GET', `/v1/admin/restaurants/${restaurantId}/menu`);
      expect(res.statusCode).toBe(200);
      await settle();
      return { sql: ctx.queries.count - before, products: res.json().productCount };
    };
    const small = await measure(eggCafe.id);
    // Grow a restaurant's menu to 60 extra products, then measure again.
    const big = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'royal-bakery-unjha' } });
    for (let i = 0; i < 60; i += 1) {
      await ctx.prisma.product.create({
        data: {
          restaurantId: big.id,
          name: `Bulk item ${i}`,
          basePricePaise: 1000 + i,
          variants: {
            create: [
              { name: 'S', basePricePaise: 1000, isDefault: true },
              { name: 'L', basePricePaise: 2000 },
            ],
          },
          addonGroups: {
            create: [{ name: 'Extra', addons: { create: [{ name: 'Cheese', basePricePaise: 500 }] } }],
          },
        },
      });
    }
    const large = await measure(big.id);
    expect(large.products).toBeGreaterThan(small.products + 50);
    expect(large.sql).toBe(small.sql);
  });
});
