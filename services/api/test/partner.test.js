// Restaurant Partner app endpoints (RESTAURANTS.md §7, D-34, D-42): approval and role are checked on every
// request; signing in is never enough (OD-13).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, bearer, mobileLogin, startTestApp } from './helpers.js';

let ctx;
let owner; // demo-kitchen OWNER (ACTIVE restaurant)
let kitchen;

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  owner = await mobileLogin(ctx, 'RESTAURANT', DEMO_ACCOUNTS.restaurantOwner);
  kitchen = await ctx.prisma.restaurant.findUniqueOrThrow({
    where: { slug: 'demo-kitchen' },
    include: { branches: true },
  });
});
afterAll(() => ctx?.stop());

const call = (method, url, session, payload, app = 'RESTAURANT') =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(session.accessToken, app),
    ...(payload !== undefined ? { payload } : {}),
  });

async function memberSession(role, restaurantId, phone) {
  const user = await ctx.prisma.user.create({
    data: { phone, identities: { create: { provider: 'PHONE_OTP', subject: phone } } },
  });
  await ctx.prisma.restaurantUser.create({ data: { restaurantId, userId: user.id, role } });
  return mobileLogin(ctx, 'RESTAURANT', phone);
}

describe('store status', () => {
  it('an approved owner sees the store, pauses, resumes, sets busy mode and prep time', async () => {
    let res = await call('GET', `/v1/restaurant/restaurants/${kitchen.id}`, owner);
    expect(res.statusCode, res.body).toBe(200);
    const store = res.json();
    expect(store).toMatchObject({
      role: 'OWNER',
      capabilities: { 'store.status': true, 'menu.availability': true },
    });
    expect(store.branches[0].hours.length).toBeGreaterThan(0);
    expect(store.branches[0]).not.toHaveProperty('deliveryArea');
    const branchId = store.branches[0].id;

    res = await call('PATCH', `/v1/restaurant/branches/${branchId}/status`, owner, { pauseMinutes: 30 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().branches[0].openState).toMatchObject({ open: false, reason: 'PAUSED' });
    res = await call('PATCH', `/v1/restaurant/branches/${branchId}/status`, owner, {
      pauseMinutes: 0,
      busyMode: true,
      prepTimeMinutes: 35,
    });
    expect(res.json().branches[0]).toMatchObject({ pausedUntil: null, busyMode: true, prepTimeMinutes: 35 });
    expect(
      (await call('PATCH', `/v1/restaurant/branches/${branchId}/status`, owner, { pauseMinutes: 600 }))
        .statusCode,
    ).toBe(400);
    res = await call('PATCH', `/v1/restaurant/branches/${branchId}/status`, owner, { isOpen: false });
    expect(res.json().branches[0].openState.reason).toBe('CLOSED_MANUALLY');
    await call('PATCH', `/v1/restaurant/branches/${branchId}/status`, owner, {
      isOpen: true,
      busyMode: false,
      prepTimeMinutes: 20,
    });

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityId: branchId, action: 'branch.status_update' },
    });
    expect(audit.actorType).toBe('RESTAURANT_USER');
  });

  it('staff can see the store but not change its status', async () => {
    const staff = await memberSession('STAFF', kitchen.id, '+919811100001');
    const res = await call('GET', `/v1/restaurant/restaurants/${kitchen.id}`, staff);
    expect(res.json().capabilities).toEqual({ 'store.status': false, 'menu.availability': true });
    expect(
      (
        await call('PATCH', `/v1/restaurant/branches/${kitchen.branches[0].id}/status`, staff, {
          isOpen: false,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('menu and sold-out toggles', () => {
  it('any member reads the menu and marks items sold out for today or back in stock', async () => {
    const staff = await memberSession('STAFF', kitchen.id, '+919811100002');
    let res = await call('GET', `/v1/restaurant/restaurants/${kitchen.id}/menu`, staff);
    expect(res.statusCode).toBe(200);
    const menu = res.json();
    expect(menu.sections.map((s) => s.name)).toEqual(['Thalis', 'Main course', 'Desserts', 'Drinks']);
    const thali = menu.sections[0].products[0];
    expect(thali).toMatchObject({ name: 'Gujarati Thali', basePricePaise: 18000 });
    const undhiyu = menu.sections[1].products.find((p) => p.name.startsWith('Undhiyu'));
    expect(undhiyu.availability.reason).toBe('SOLD_OUT'); // seeded as out of season

    res = await call('POST', `/v1/restaurant/products/${thali.id}/availability`, staff, {
      isAvailable: false,
      until: 'END_OF_DAY',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().availability.reason).toBe('SOLD_OUT_UNTIL');
    res = await call('POST', `/v1/restaurant/products/${thali.id}/availability`, staff, {
      isAvailable: true,
    });
    expect(res.json().availability.reason).toBe('AVAILABLE');
    res = await call('POST', `/v1/restaurant/products/${thali.id}/availability`, staff, {
      isAvailable: false,
      variantId: thali.variants[1].id,
    });
    expect(res.json().variants[1].isAvailable).toBe(false);
    await call('POST', `/v1/restaurant/products/${thali.id}/availability`, staff, {
      isAvailable: true,
      variantId: thali.variants[1].id,
    });
  });

  it('cannot touch another restaurant’s products', async () => {
    const other = await ctx.prisma.product.findFirstOrThrow({
      where: { restaurant: { slug: 'pizza-point-unjha' } },
    });
    const res = await call('POST', `/v1/restaurant/products/${other.id}/availability`, owner, {
      isAvailable: false,
    });
    expect(res.statusCode).toBe(404);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: other.id } })).isAvailable).toBe(true);
  });
});

describe('approval gate (OD-13, D-34)', () => {
  it('members of a draft restaurant are signed in but cannot use partner features', async () => {
    const manager = await mobileLogin(ctx, 'RESTAURANT', DEMO_ACCOUNTS.draftRestaurantManager);
    const me = (await call('GET', '/v1/me', manager)).json();
    expect(me.access.status).toBe('PENDING_APPROVAL');
    const pending = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pending-restaurant' } });
    expect((await call('GET', `/v1/restaurant/restaurants/${pending.id}/menu`, manager)).statusCode).toBe(
      403,
    );
  });

  it('members of an APPROVED (not yet live) restaurant can prepare their menu', async () => {
    const cafe = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'cafe-egg-station' } });
    const cafeOwner = await mobileLogin(ctx, 'RESTAURANT', cafe.phone);
    const me = (await call('GET', '/v1/me', cafeOwner)).json();
    expect(me.access.status).toBe('OK');
    expect(me.restaurants[0]).toMatchObject({ approved: true, live: false, onboardingStatus: 'APPROVED' });
    expect((await call('GET', `/v1/restaurant/restaurants/${cafe.id}/menu`, cafeOwner)).statusCode).toBe(200);
  });

  it('a suspended restaurant is blocked; a removed member loses access immediately', async () => {
    const dhaba = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: 'khodiyar-punjabi-dhaba' },
    });
    const dhabaOwner = await mobileLogin(ctx, 'RESTAURANT', dhaba.phone);
    expect((await call('GET', `/v1/restaurant/restaurants/${dhaba.id}`, dhabaOwner)).statusCode).toBe(200);
    await ctx.prisma.restaurant.update({ where: { id: dhaba.id }, data: { onboardingStatus: 'SUSPENDED' } });
    expect((await call('GET', `/v1/restaurant/restaurants/${dhaba.id}`, dhabaOwner)).statusCode).toBe(403);
    expect((await call('GET', '/v1/me', dhabaOwner)).json().access.status).toBe('BLOCKED');
    await ctx.prisma.restaurant.update({ where: { id: dhaba.id }, data: { onboardingStatus: 'ACTIVE' } });

    const temp = await memberSession('MANAGER', dhaba.id, '+919811100003');
    expect((await call('GET', `/v1/restaurant/restaurants/${dhaba.id}`, temp)).statusCode).toBe(200);
    await ctx.prisma.restaurantUser.updateMany({
      where: { restaurantId: dhaba.id, user: { phone: '+919811100003' } },
      data: { isActive: false },
    });
    expect((await call('GET', `/v1/restaurant/restaurants/${dhaba.id}`, temp)).statusCode).toBe(404);
  });

  it('only the Restaurant Partner app may call partner endpoints', async () => {
    const customer = await mobileLogin(ctx, 'CUSTOMER', '9811100004');
    expect(
      (await call('GET', `/v1/restaurant/restaurants/${kitchen.id}`, customer, undefined, 'CUSTOMER'))
        .statusCode,
    ).toBe(403);
    // A restaurant-app token presented as another app is rejected (tokens are bound to their app).
    expect(
      (await call('GET', `/v1/restaurant/restaurants/${kitchen.id}`, owner, undefined, 'CUSTOMER'))
        .statusCode,
    ).toBe(403);
  });
});
