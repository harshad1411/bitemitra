// "Order again", favourites on Home and opt-in offer notifications (D-116), against real PostgreSQL. Orders go
// through the real API (checkout → restaurant → dispatch → delivery).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminLogin, adminWithRole, bearer, ist, mobileLogin, startTestApp } from './helpers.js';
import { createFlows } from './flows.js';
import { rebuildCart } from '../src/modules/orders/reorder.js';
import { createNotificationDispatcher } from '../src/modules/notifications/dispatch.js';

let ctx;
let f;
let admin;
let delivered;
let customer;
const HERE = 'lat=23.805&lng=72.39';

beforeAll(async () => {
  ctx = await startTestApp({ catalog: true });
  ctx.clock.set(ist('2026-09-28T13:00:00'));
  const pizza = await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: 'pizza-point-unjha' } });
  f = createFlows(ctx, { owner: await mobileLogin(ctx, 'RESTAURANT', pizza.phone) });
  admin = (await adminLogin(ctx)).accessToken;
  delivered = await f.deliveredOrder();
  customer = delivered.customer;
});
afterAll(() => ctx?.stop());

const asCustomer = (method, url, token = customer, payload) =>
  f.call(method, url, token, payload, 'CUSTOMER');

describe('order again (D-116)', () => {
  it("rebuilds the cart from today's menu, never copying old prices", async () => {
    const res = await asCustomer('POST', `/v1/customer/orders/${delivered.order.id}/reorder`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      restaurant: { id: delivered.order.restaurantId, name: 'Pizza Point' },
      lines: [
        {
          productId: expect.any(String),
          variantId: null,
          addonIds: [],
          quantity: 2,
          name: 'Garlic Bread',
          variantName: null,
          addonNames: [],
          foodType: 'VEG',
        },
      ],
      skipped: [],
    });
    expect(res.body).not.toMatch(/Paise/); // the app re-quotes; nothing priced comes from the old order
  });

  it('leaves out a dish that is sold out now, and only the owner of the order may use it', async () => {
    const item = await ctx.prisma.orderItem.findFirstOrThrow({ where: { orderId: delivered.order.id } });
    await ctx.prisma.product.update({ where: { id: item.productId }, data: { isAvailable: false } });
    const res = await asCustomer('POST', `/v1/customer/orders/${delivered.order.id}/reorder`);
    expect(res.json()).toMatchObject({ lines: [], skipped: [{ name: 'Garlic Bread', reason: 'SOLD_OUT' }] });
    await ctx.prisma.product.update({ where: { id: item.productId }, data: { isAvailable: true } });

    const stranger = await mobileLogin(ctx, 'CUSTOMER', '9612300001');
    expect(
      (await asCustomer('POST', `/v1/customer/orders/${delivered.order.id}/reorder`, stranger)).statusCode,
    ).toBe(404);
  });

  it('options: a size or choice that no longer exists, or a new required choice, leaves the dish out', () => {
    const product = (over = {}) => ({
      id: 'p1',
      restaurantId: 'r1',
      name: 'Margherita',
      status: 'ACTIVE',
      isAvailable: true,
      foodType: 'VEG',
      variants: [{ id: 'v1', name: 'Medium', isAvailable: true }],
      addonGroups: [
        {
          id: 'g1',
          minSelect: 1,
          maxSelect: 1,
          addons: [{ id: 'a1', name: 'Thin crust', isAvailable: true }],
        },
      ],
      ...over,
    });
    const order = (item) => ({
      restaurantId: 'r1',
      items: [{ productId: 'p1', productName: 'Margherita', variantName: 'Medium', quantity: 1, ...item }],
    });
    const ok = order({ variantId: 'v1', addons: [{ addonId: 'a1' }] });
    expect(rebuildCart(ok, [product()]).lines).toEqual([
      expect.objectContaining({
        variantId: 'v1',
        addonIds: ['a1'],
        addonNames: ['Thin crust'],
        variantName: 'Medium',
      }),
    ]);
    const cases = [
      [ok, product({ variants: [] }), 'OPTIONS_CHANGED'], // the size is gone
      [order({ variantId: null, addons: [{ addonId: 'a1' }] }), product(), 'OPTIONS_CHANGED'], // now needs a size
      [
        ok,
        product({ addonGroups: [{ id: 'g1', minSelect: 1, maxSelect: 1, addons: [] }] }),
        'OPTIONS_CHANGED',
      ],
      [order({ variantId: 'v1', addons: [] }), product(), 'OPTIONS_CHANGED'], // a required choice was added
      [ok, product({ variants: [{ id: 'v1', name: 'Medium', isAvailable: false }] }), 'SOLD_OUT'],
      [ok, product({ status: 'ARCHIVED' }), 'REMOVED'],
      [ok, product({ restaurantId: 'other' }), 'REMOVED'],
    ];
    for (const [o, p, reason] of cases)
      expect(rebuildCart(o, [p]).skipped).toEqual([{ name: 'Margherita (Medium)', reason }]);
  });
});

describe('Home for a signed-in customer (D-116)', () => {
  const home = async (token) => {
    const res = await f.call(
      'GET',
      `/v1/customer/home?${HERE}`,
      token ?? { accessToken: '' },
      undefined,
      'CUSTOMER',
    );
    return res;
  };

  it('"Order again" shows what was ordered last time; "Your favourites" the saved restaurants that deliver here', async () => {
    const before = (await home(customer)).json();
    expect(before.sections.find((s) => s.type === 'FAVOURITES')).toBeUndefined();
    const again = before.sections.find((s) => s.type === 'ORDER_AGAIN');
    expect(again).toMatchObject({
      title: 'Order again',
      orders: [
        {
          id: delivered.order.id,
          summary: 'Garlic Bread × 2',
          totalPayablePaise: delivered.order.totalPayablePaise,
          restaurant: { id: delivered.order.restaurantId, name: 'Pizza Point' },
        },
      ],
    });

    expect(
      (await asCustomer('PUT', `/v1/customer/favorites/${delivered.order.restaurantId}`, customer, {}))
        .statusCode,
    ).toBe(200);
    const after = (await home(customer)).json();
    expect(after.sections.find((s) => s.type === 'FAVOURITES')).toMatchObject({
      title: 'Your favourites',
      restaurants: [{ id: delivered.order.restaurantId }],
    });
    // Personal sections come before the rest of the page (after banners and categories only).
    const types = after.sections.map((s) => s.type);
    const firstOther = types.findIndex((t) => !['BANNER_CAROUSEL', 'CATEGORIES'].includes(t));
    expect(types.slice(firstOther, firstOther + 2)).toEqual(['ORDER_AGAIN', 'FAVOURITES']);
  });

  it('guests and customers with no delivered order see no personal sections', async () => {
    const guest = await ctx.app.inject({
      method: 'GET',
      url: `/v1/customer/home?${HERE}`,
      headers: { 'x-app-id': 'CUSTOMER', 'x-platform': 'IOS', 'x-app-version': '1.0.0' },
    });
    const newbie = await mobileLogin(ctx, 'CUSTOMER', '9612300002');
    for (const res of [guest, await home(newbie)]) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().sections.map((s) => s.type)).not.toContain('ORDER_AGAIN');
    }
  });
});

describe('offer notifications, only with consent (D-116)', () => {
  let optIn;
  const offer = (payload, token = admin) =>
    ctx.app.inject({ method: 'POST', url: '/v1/admin/offer-notifications', headers: bearer(token), payload });

  it('the customer turns offers on and off; the latest choice counts', async () => {
    optIn = await mobileLogin(ctx, 'CUSTOMER', '9612300003');
    const consent = (granted) =>
      asCustomer('POST', '/v1/customer/consents', optIn, {
        kind: 'MARKETING_PUSH',
        version: '2026-10',
        granted,
      });
    await consent(true);
    await consent(false);
    await consent(true);
    const res = await asCustomer('GET', '/v1/customer/consents', optIn);
    expect(res.json().items).toEqual([expect.objectContaining({ kind: 'MARKETING_PUSH', granted: true })]);
  });

  it('counts, then sends only to customers who said yes and have the app; the worker checks consent again', async () => {
    const draft = { title: 'Pizza Friday', body: '20% off at Pizza Point today', url: '/restaurant/x' };
    expect((await offer(draft)).json()).toEqual({ recipients: 0, sent: false }); // said yes, but no device yet
    for (const [who, token] of [
      [optIn, 'ExponentPushToken[optin]'],
      [customer, 'ExponentPushToken[noconsent]'],
    ])
      expect(
        (await asCustomer('POST', '/v1/me/devices', who, { platform: 'ANDROID', pushToken: token }))
          .statusCode,
      ).toBeLessThan(300);
    expect((await offer(draft)).json()).toEqual({ recipients: 1, sent: false });
    const unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
    expect((await offer({ ...draft, cityId: unjha.id })).json().recipients).toBe(0); // no address or order in Unjha

    const sent = await offer({ ...draft, send: true });
    expect(sent.json()).toEqual({ recipients: 1, sent: true });
    const event = await ctx.prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'offer.broadcast' } });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'offer_notification.send' } })).toBe(1);

    const push = { send: vi.fn(async (msgs) => msgs.map(() => ({ ok: true, providerRef: 'r1' }))) };
    const handlers = createNotificationDispatcher({ prisma: ctx.prisma, push });
    await handlers['offer.broadcast'](event);
    await handlers['offer.broadcast'](event); // a retry sends nothing twice
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.send.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        to: 'ExponentPushToken[optin]',
        title: 'Pizza Friday',
        channelId: 'offers',
        data: { event: 'offer', url: '/restaurant/x' },
      }),
    ]);

    // Switched off after the send was queued: the worker skips them.
    await asCustomer('POST', '/v1/customer/consents', optIn, {
      kind: 'MARKETING_PUSH',
      version: '2026-10',
      granted: false,
    });
    push.send.mockClear();
    await handlers['offer.broadcast']({ ...event, id: 'another-event' });
    expect(push.send).not.toHaveBeenCalled();
  });

  it('checks the message and the permission', async () => {
    expect((await offer({ title: 'Hi', body: 'x' })).statusCode).toBe(400);
    expect((await offer({ title: 'Offer', body: 'Something', url: 'https://evil.example' })).statusCode).toBe(
      400,
    );
    const support = (await adminWithRole(ctx, 'SUPPORT')).accessToken;
    expect((await offer({ title: 'Offer', body: 'Something' }, support)).statusCode).toBe(403);
  });
});
