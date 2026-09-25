import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Home from '../src/app/index';
import Menu from '../src/app/menu';
import Orders from '../src/app/orders';
import OrderDetail from '../src/app/order/[id]';
import ORDERS from './order-fixtures.json';
import { Vibration } from 'react-native';
import NotFound from '../src/app/+not-found';
import { installFakeApi } from './fake-api';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      extra: {
        appId: 'RESTAURANT',
        variant: 'development',
        apiUrl: 'http://api.test',
        schemes: ['jamzo-restaurant-dev'],
        domains: [],
      },
    },
  },
}));

const routes = {
  _layout: RootLayout,
  index: Home,
  menu: Menu,
  orders: Orders,
  'order/[id]': OrderDetail,
  '+not-found': NotFound,
};
const OWNER_ME = {
  appId: 'RESTAURANT',
  access: { status: 'OK' },
  restaurants: [
    {
      id: 'r1',
      name: 'Jamzo Demo Kitchen',
      role: 'OWNER',
      onboardingStatus: 'ACTIVE',
      approved: true,
      live: true,
    },
  ],
};

// Realistic API responses (shapes as returned by /v1/restaurant/*).
const IN_ONE_HOUR = new Date(Date.now() + 3600_000).toISOString();
function storeFor(role, branch = {}) {
  return {
    restaurant: {
      id: 'r1',
      name: 'Jamzo Demo Kitchen',
      onboardingStatus: 'ACTIVE',
      isPureVeg: true,
      city: { name: 'Unjha', timezone: 'Asia/Kolkata' },
    },
    role,
    capabilities: { 'store.status': role !== 'STAFF', 'menu.availability': true },
    limits: { maxPauseMinutes: 120 },
    branches: [
      {
        id: 'b1',
        name: 'Station Road',
        isOpen: true,
        busyMode: false,
        pausedUntil: null,
        prepTimeMinutes: 20,
        hours: [],
        openState: {
          open: true,
          reason: 'OPEN',
          closesAt: IN_ONE_HOUR,
          pausedUntil: null,
          nextOpenAt: null,
          nextOpenLocal: null,
        },
        ...branch,
      },
    ],
  };
}
const product = (id, name, extra = {}) => ({
  id,
  name,
  foodType: 'VEG',
  basePricePaise: 18000,
  status: 'ACTIVE',
  isAvailable: true,
  variants: [],
  addonGroups: [],
  image: null,
  availability: { available: true, reason: 'AVAILABLE', until: null, nextAvailableAt: null },
  ...extra,
});
const MENU = {
  restaurant: { id: 'r1', name: 'Jamzo Demo Kitchen' },
  capabilities: { 'store.status': true, 'menu.availability': true },
  sections: [
    { id: 's1', name: 'Thalis', isActive: true, sortOrder: 0, products: [product('p1', 'Gujarati Thali')] },
  ],
  unsectioned: [],
  productCount: 1,
};

async function signIn(me, onRequest) {
  const calls = installFakeApi({ me, onRequest });
  await renderRouter(routes, { initialUrl: '/' });
  expect(
    await screen.findByText('Sign in with the mobile number registered for your restaurant.'),
  ).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '9000000001');
  await fireEvent.press(screen.getByLabelText('Send code'));
  await fireEvent.changeText(await screen.findByLabelText('Verification code'), '123456');
  await fireEvent.press(screen.getByLabelText('Verify and continue'));
  return calls;
}

/** Fake partner API: store, status changes and availability, recording what the app sent. */
function partnerApi(role = 'OWNER') {
  let store = storeFor(role);
  return (path, body) => {
    if (path === '/v1/restaurant/restaurants/r1') return { body: store };
    if (path === '/v1/restaurant/branches/b1/status') {
      const b = store.branches[0];
      const next = { ...b, ...body };
      if (body.isOpen === false) next.openState = { ...b.openState, open: false, reason: 'CLOSED_MANUALLY' };
      if (body.pauseMinutes) {
        next.pausedUntil = IN_ONE_HOUR;
        next.openState = { ...b.openState, open: false, reason: 'PAUSED', pausedUntil: IN_ONE_HOUR };
      }
      store = { ...store, branches: [next] };
      return { body: store };
    }
    if (path === '/v1/restaurant/restaurants/r1/menu') return { body: MENU };
    if (path === '/v1/restaurant/products/p1/availability')
      return {
        body: product('p1', 'Gujarati Thali', {
          availability: {
            available: false,
            reason: 'SOLD_OUT_UNTIL',
            until: IN_ONE_HOUR,
            nextAvailableAt: IN_ONE_HOUR,
          },
        }),
      };
    return null;
  };
}

describe('restaurant partner app', () => {
  it('an owner sees the live store status, closes the store and pauses it', async () => {
    const calls = await signIn(OWNER_ME, partnerApi('OWNER'));
    expect(await screen.findByText('Station Road')).toBeTruthy();
    expect(screen.getByText(/^Open · closes/)).toBeTruthy();
    expect(screen.getByLabelText('Orders')).toBeTruthy();

    await fireEvent(screen.getByLabelText('Accepting orders'), 'valueChange', false);
    expect(await screen.findByText('Closed — not taking orders')).toBeTruthy();
    const patch = calls.find((c) => c.path === '/v1/restaurant/branches/b1/status');
    expect(patch).toMatchObject({ method: 'PATCH', body: { isOpen: false } });
    expect(calls.every((c) => c.headers['x-app-id'] === 'RESTAURANT')).toBe(true);
  });

  it('pausing sends the minutes to the API and shows until when', async () => {
    const calls = await signIn(OWNER_ME, partnerApi('OWNER'));
    await fireEvent.press(await screen.findByLabelText('Pause 30 minutes'));
    expect(await screen.findByText(/^Paused until/)).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith('/status')).map((c) => c.body)).toEqual([
      { pauseMinutes: 30 },
    ]);
    expect(screen.getByLabelText('Resume now')).toBeTruthy();
  });

  it('staff cannot change the store status', async () => {
    await signIn(
      { ...OWNER_ME, restaurants: [{ ...OWNER_ME.restaurants[0], role: 'STAFF' }] },
      partnerApi('STAFF'),
    );
    expect(await screen.findByText('Only owners and managers can change the store status.')).toBeTruthy();
    expect(screen.queryByLabelText('Accepting orders')).toBeNull();
  });

  it('marks an item sold out for today from the menu screen', async () => {
    const calls = await signIn(OWNER_ME, partnerApi('OWNER'));
    await fireEvent.press(await screen.findByLabelText('Menu & sold-out items'));
    expect(await screen.findByText('Thalis')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Gujarati Thali'), 'valueChange', false);
    await fireEvent.press(screen.getByLabelText('Sold out for today'));
    expect(await screen.findByText(/^Sold out until/)).toBeTruthy();
    const post = calls.find((c) => c.path === '/v1/restaurant/products/p1/availability');
    expect(post).toMatchObject({ method: 'POST', body: { isAvailable: false, until: 'END_OF_DAY' } });
    expect(post.headers['idempotency-key']).toBeTruthy();
  });

  it('pending restaurant: no partner features, clear status', async () => {
    await signIn({
      appId: 'RESTAURANT',
      access: { status: 'PENDING_APPROVAL' },
      restaurants: [
        { id: 'r2', name: 'Pending Restaurant', role: 'MANAGER', onboardingStatus: 'DRAFT', approved: false },
      ],
    });
    expect(await screen.findByText(/not approved yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Orders')).toBeNull();
    expect(screen.queryByLabelText('Menu & sold-out items')).toBeNull();
  });

  it('blocked (suspended restaurant or removed member)', async () => {
    await signIn({
      appId: 'RESTAURANT',
      access: { status: 'BLOCKED' },
      restaurants: [
        { id: 'r3', name: 'Suspended Place', role: 'OWNER', onboardingStatus: 'SUSPENDED', approved: false },
      ],
    });
    expect(await screen.findByText(/access to this restaurant is paused/)).toBeTruthy();
  });

  it('signed in but not linked to any restaurant', async () => {
    await signIn({ appId: 'RESTAURANT', access: { status: 'NOT_REGISTERED' }, restaurants: [] });
    expect(await screen.findByText(/isn't linked to a Jamzo restaurant/)).toBeTruthy();
  });

  describe('orders (Phase 5)', () => {
    /** Kitchen state behind the fake API; orders are the real API's restaurant view (captured). */
    function kitchen({ newOrders = [ORDERS.newOrder], active = [], accept } = {}) {
      const state = { newOrders, active, posts: [] };
      const base = partnerApi('OWNER');
      const handler = (path, body, url) => {
        if (path === '/v1/restaurant/orders') {
          const view = url.searchParams.get('view');
          return {
            body: {
              items: view === 'NEW' ? state.newOrders : view === 'ACTIVE' ? state.active : [],
              nextCursor: null,
            },
          };
        }
        const m = /^\/v1\/restaurant\/orders\/([^/]+)\/(\w[\w-]*)$/.exec(path);
        if (m) {
          state.posts.push({ step: m[2], body });
          if (m[2] === 'seen') return { body: ORDERS.newOrder };
          if (m[2] === 'accept') {
            if (accept) return accept(body);
            state.newOrders = [];
            state.active = [ORDERS.accepted];
            return { body: ORDERS.accepted };
          }
          if (m[2] === 'reject') {
            state.newOrders = [];
            return {
              body: { ...ORDERS.newOrder, restaurantStatus: 'REJECTED', status: 'RESTAURANT_REJECTED' },
            };
          }
          if (m[2] === 'ready') {
            state.active = [{ ...ORDERS.accepted, restaurantStatus: 'READY_FOR_PICKUP', version: 2 }];
            return { body: state.active[0] };
          }
        }
        return base(path, body);
      };
      return { state, handler };
    }
    async function openOrders(k) {
      const calls = await signIn(OWNER_ME, k.handler);
      await fireEvent.press(await screen.findByLabelText('Orders'));
      return calls;
    }
    beforeEach(() => {
      global.__player.play.mockClear();
      global.__player.pause.mockClear();
      jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
      jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
    });

    it('a new order rings until it is accepted; the restaurant sees its own prices, never the customer’s', async () => {
      const k = kitchen();
      await openOrders(k);
      expect(await screen.findByText(`#${ORDERS.newOrder.shortNumber}`)).toBeTruthy();
      expect(screen.getByText('1 × Margherita (Medium 10") · Crust: Cheese burst')).toBeTruthy();
      expect(screen.getByText('Note: Less spicy please')).toBeTruthy();
      expect(screen.getByText('Food value ₹280.00')).toBeTruthy(); // restaurant prices; the customer paid ₹321
      expect(screen.queryByText(/321/)).toBeNull();
      await waitFor(() => expect(global.__player.play).toHaveBeenCalled());
      expect(global.__player.loop).toBe(true);
      expect(Vibration.vibrate).toHaveBeenCalledWith([0, 700, 700], true);
      await waitFor(() => expect(k.state.posts.map((p) => p.step)).toContain('seen'));

      await fireEvent.press(screen.getByLabelText('Accept · 20 min'));
      await waitFor(() =>
        expect(k.state.posts.find((p) => p.step === 'accept')?.body).toEqual({
          version: 0,
          prepTimeMinutes: 20,
        }),
      );
      expect(await screen.findByText('No new orders')).toBeTruthy();
      await waitFor(() => expect(global.__player.pause).toHaveBeenCalled());
      expect(Vibration.cancel).toHaveBeenCalled();

      await fireEvent.press(screen.getByLabelText('In the kitchen'));
      expect(await screen.findByText('Accepted')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Food is ready'));
      await waitFor(() =>
        expect(k.state.posts.find((p) => p.step === 'ready')?.body).toEqual({ version: 1 }),
      );
      expect(await screen.findByText('Ready for pickup')).toBeTruthy();
    });

    it('rejects with a reason', async () => {
      const k = kitchen();
      await openOrders(k);
      await fireEvent.press(await screen.findByLabelText('Reject order'));
      await fireEvent.press(screen.getByLabelText('Kitchen too busy'));
      await waitFor(() =>
        expect(k.state.posts.find((p) => p.step === 'reject')?.body).toEqual({
          version: 0,
          reasonCode: 'TOO_BUSY',
        }),
      );
      expect(await screen.findByText('No new orders')).toBeTruthy();
    });

    it('a new order arriving by realtime notice appears and starts the alert', async () => {
      const k = kitchen({ newOrders: [] });
      await openOrders(k);
      expect(await screen.findByText('No new orders')).toBeTruthy();
      expect(global.__player.play).not.toHaveBeenCalled();
      k.state.newOrders = [ORDERS.newOrder];
      await act(() =>
        global.__realtime.emit('order.updated', { orderId: ORDERS.newOrder.id, status: 'PLACED' }),
      );
      expect(await screen.findByText(`#${ORDERS.newOrder.shortNumber}`)).toBeTruthy();
      await waitFor(() => expect(global.__player.play).toHaveBeenCalled());
    });

    it('shows who collects the order: the partner’s first name at the counter, never their phone', async () => {
      const k = kitchen({ newOrders: [], active: [ORDERS.withRider] });
      await openOrders(k);
      await fireEvent.press(await screen.findByLabelText('In the kitchen'));
      expect(await screen.findByText('Delivery partner Demo is at the counter')).toBeTruthy();
      expect(JSON.stringify(ORDERS.withRider.rider)).toBe('{"firstName":"Demo","atRestaurant":true}');
    });

    it('someone else acted first: the conflict is explained and the list refreshed', async () => {
      const k = kitchen({
        accept: () => ({
          status: 409,
          body: { error: { code: 'CONFLICT', message: 'Changed.', requestId: 'r' } },
        }),
      });
      await openOrders(k);
      await fireEvent.press(await screen.findByLabelText('Accept · 15 min'));
      expect(await screen.findByText('This order just changed. The list has been refreshed.')).toBeTruthy();
    });
  });
});
