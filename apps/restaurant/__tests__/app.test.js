import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Home from '../src/app/index';
import Menu from '../src/app/menu';
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

const routes = { _layout: RootLayout, index: Home, menu: Menu, '+not-found': NotFound };
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
    expect(screen.getByText(/arrive in Phase 5/)).toBeTruthy();

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
    expect(screen.queryByText(/arrive in Phase 5/)).toBeNull();
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
});
