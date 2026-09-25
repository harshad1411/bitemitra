import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Home from '../src/app/index';
import ChooseLocation from '../src/app/location';
import Search from '../src/app/search';
import RestaurantScreen from '../src/app/restaurant/[id]';
import Customize from '../src/app/customize';
import CartScreen from '../src/app/cart';
import Account from '../src/app/account';
import Addresses from '../src/app/addresses';
import SignIn from '../src/app/sign-in';
import CmsPage from '../src/app/page/[slug]';
import Checkout from '../src/app/checkout';
import OrdersList from '../src/app/orders/index';
import OrderScreen from '../src/app/orders/[id]';
import { lineKey } from '../src/lib/cart';
import NotFound from '../src/app/+not-found';
import { fixtures, installFakeApi } from './fake-api';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      extra: {
        appId: 'CUSTOMER',
        variant: 'development',
        apiUrl: 'http://api.test',
        schemes: ['jamzo-dev'],
        domains: ['jamzo.in'],
      },
    },
  },
}));

const routes = {
  _layout: RootLayout,
  index: Home,
  location: ChooseLocation,
  search: Search,
  'restaurant/[id]': RestaurantScreen,
  customize: Customize,
  cart: CartScreen,
  account: Account,
  addresses: Addresses,
  'sign-in': SignIn,
  'page/[slug]': CmsPage,
  checkout: Checkout,
  'orders/index': OrdersList,
  'orders/[id]': OrderScreen,
  '+not-found': NotFound,
};

const AsyncStorage = require('@react-native-async-storage/async-storage');
const SecureStore = require('expo-secure-store');
// Each test starts signed out: a sign-in in an earlier test must not leave a refresh token behind.
beforeEach(() =>
  Promise.all([AsyncStorage.clear(), SecureStore.deleteItemAsync('jamzo.customer.refreshToken')]),
);

async function chooseDemoLocation() {
  await fireEvent.press(await screen.findByLabelText('Choose location'));
  await fireEvent.press(await screen.findByLabelText('Use demo location (development)'));
  expect(await screen.findByText('Recommended for you')).toBeTruthy();
}

describe('customer app', () => {
  it('lets a guest browse: location → home sections → menu → customise → cart with the server bill', async () => {
    const calls = installFakeApi();
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Welcome to Jamzo')).toBeTruthy(); // no forced sign-in (A-11)
    await chooseDemoLocation();
    const home = calls.find((c) => c.path === '/v1/customer/home');
    expect(home).toBeTruthy();
    expect(screen.getByText('What are you craving?')).toBeTruthy();

    await fireEvent.press(screen.getAllByLabelText('Pizza Point')[0]);
    expect(await screen.findByText('Margherita')).toBeTruthy();
    expect(screen.getByText('10% off up to ₹75 above ₹199')).toBeTruthy();
    expect(screen.getByText(fixtures.restaurant.pricesInclude)).toBeTruthy();

    // Margherita has sizes and a required crust → the customise screen.
    const addButtons = screen.getAllByLabelText('Add');
    await fireEvent.press(addButtons[0]);
    expect(await screen.findByText('Crust')).toBeTruthy();
    expect(screen.getByText('Required · choose 1')).toBeTruthy();
    expect(screen.getByText('Choose: Crust')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Medium 10"'));
    await fireEvent.press(screen.getByLabelText('Cheese burst'));
    // ₹242 (medium) + ₹66 (cheese burst) — menu prices, for guidance only.
    await fireEvent.press(await screen.findByLabelText('Add 1 · ₹308.00'));

    await fireEvent.press(await screen.findByLabelText('View cart · 1 item from Pizza Point'));
    expect(await screen.findByText('Bill details')).toBeTruthy();
    expect(await screen.findByText('To pay')).toBeTruthy();
    expect(screen.getByText('₹321.00')).toBeTruthy(); // total from the captured server quote
    expect(screen.getByText('Offer: Pizza Point: 10% off')).toBeTruthy();
    expect(
      screen.getByText('Tax amounts are provisional pending confirmation of GST treatment.'),
    ).toBeTruthy();
    const quote = calls.filter((c) => c.path === '/v1/customer/cart/quote').at(-1);
    expect(quote.body).toMatchObject({ lat: 23.805, lng: 72.39, tipPaise: 0 });
    expect(quote.body.lines[0]).toMatchObject({
      variantId: expect.any(String),
      addonIds: [expect.any(String)],
      quantity: 1,
    });
    expect(quote.body.lines[0].key.length).toBeLessThanOrEqual(64);
    expect(quote.headers['idempotency-key']).toBeUndefined(); // quotes are read-only

    // Coupons: unknown code explained; valid code re-priced by the server.
    await fireEvent.changeText(screen.getByLabelText('Coupon code'), 'nope');
    await fireEvent.press(screen.getByLabelText('Apply coupon'));
    expect(await screen.findByText('NOPE: This coupon code does not exist.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Coupon code'), 'welcome50');
    await fireEvent.press(screen.getByLabelText('Apply coupon'));
    expect(await screen.findByText('WELCOME50: Coupon applied.')).toBeTruthy();
    expect(await screen.findByText('₹216.00')).toBeTruthy();

    // Nothing blocks this cart, so checkout is open (sign-in is asked for there).
    expect(screen.getByLabelText('Proceed to checkout').props.accessibilityState.disabled).toBe(false);
  });

  it('asks for sign-in only when needed (saved addresses)', async () => {
    const calls = installFakeApi();
    await renderRouter(routes, { initialUrl: '/account' });
    expect(await screen.findByText(/browsing as a guest/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Sign in'));

    await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '98765 43210');
    await fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText(/Enter the 6-digit code sent to \+919876543210/)).toBeTruthy();
    const otpRequest = calls.find((c) => c.path === '/v1/auth/otp/request');
    expect(otpRequest.headers['x-app-id']).toBe('CUSTOMER');
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '000000');
    await fireEvent.press(screen.getByLabelText('Verify and continue'));
    expect(await screen.findByText('That code is not valid. 4 attempts left.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await fireEvent.press(screen.getByLabelText('Verify and continue'));

    expect(await screen.findByText(/Signed in as/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Saved addresses'));
    expect(await screen.findByText('No saved addresses yet.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add a new address'));
    await fireEvent.press(screen.getByLabelText('Save address'));
    expect(await screen.findByText('Enter the house / flat and street.')).toBeTruthy();
  });

  it('explains a denied location permission and offers alternatives', async () => {
    installFakeApi();
    await renderRouter(routes, { initialUrl: '/location' });
    await fireEvent.press(await screen.findByLabelText('Use my current location'));
    expect(await screen.findByText(/Location permission was not given/)).toBeTruthy();
    expect(screen.getByText('Sign in to use saved addresses.')).toBeTruthy();
  });

  it('shows unpublished legal pages honestly', async () => {
    installFakeApi();
    await renderRouter(routes, { initialUrl: '/page/terms' });
    expect(await screen.findByText('Not published yet')).toBeTruthy();
  });

  it('blocks an outdated build with a forced-update screen', async () => {
    installFakeApi({
      appConfig: {
        version: {
          status: 'UPDATE_REQUIRED',
          minSupportedVersion: '2.0.0',
          recommendedVersion: '2.0.0',
          forceUpdate: false,
          storeUrl: 'https://store.example',
        },
      },
    });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Update required')).toBeTruthy();
    expect(screen.getByLabelText('Update now')).toBeTruthy();
    expect(screen.queryByText('Welcome to Jamzo')).toBeNull();
  });

  it('shows maintenance mode', async () => {
    installFakeApi({ appConfig: { maintenance: { enabled: true, message: 'Back at 6 AM' } } });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Back at 6 AM')).toBeTruthy();
  });

  it('explains when the server cannot be reached and offers retry', async () => {
    installFakeApi({
      onRequest: (path) =>
        path === '/v1/app-config'
          ? { status: 503, body: { error: { code: 'INTERNAL', message: 'down', requestId: 'r' } } }
          : null,
    });
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText("Can't reach Jamzo")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());
  });

  it('follows the delivery: partner name and vehicle and the delivery code; never the partner’s phone number', async () => {
    const track = fixtures.delivery.tracking;
    installFakeApi({
      onRequest: (path) => (path === `/v1/customer/orders/${track.id}` ? { body: track } : null),
    });
    await renderRouter(routes, { initialUrl: `/orders/${track.id}` });
    const name = track.delivery.rider.firstName;
    expect(await screen.findByText(`${name} · Motorcycle`)).toBeTruthy();
    expect(
      screen.getByText(`Share this delivery code with ${name} at the door: ${track.delivery.code}`),
    ).toBeTruthy();
    expect(screen.getByText(/^Location updated /)).toBeTruthy();
    // Calls go through Jamzo support only; no support number is configured in dev, so no call button.
    expect(track.delivery.contact).toEqual({ via: 'SUPPORT', phone: null });
    expect(screen.queryByText('Call your delivery partner (via Jamzo support)')).toBeNull();
    expect(JSON.stringify(track)).not.toContain('+919000000002');
  });

  describe('checkout and tracking (Phase 5)', () => {
    const placed = fixtures.orders.placed.order;
    const address = fixtures.orders.addresses.items[0];
    async function withCart() {
      const p = fixtures.restaurant.sections.flatMap((x) => x.products).find((x) => x.name === 'Margherita');
      const item = {
        productId: p.id,
        variantId: p.variants[1].id,
        addonIds: [p.addonGroups[0].addons[2].id],
        quantity: 1,
        name: 'Margherita',
        variantName: 'Medium 10"',
        addonNames: ['Cheese burst'],
        unitPricePaise: 30_800,
        foodType: 'VEG',
      };
      await AsyncStorage.setItem(
        'jamzo.cart.v2',
        JSON.stringify({
          restaurant: { id: fixtures.restaurant.restaurant.id, name: 'Pizza Point' },
          lines: [{ ...item, key: lineKey(item) }],
          couponCode: null,
          tipPaise: 0,
        }),
      );
      await AsyncStorage.setItem(
        'jamzo.location.v1',
        JSON.stringify({ lat: address.lat, lng: address.lng, label: 'Home', addressId: address.id }),
      );
    }
    async function signInFromCheckout() {
      await fireEvent.press(await screen.findByLabelText('Sign in'));
      await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '98765 43210');
      await fireEvent.press(screen.getByLabelText('Send code'));
      await fireEvent.changeText(await screen.findByLabelText('Verification code'), '123456');
      await fireEvent.press(screen.getByLabelText('Verify and continue'));
      expect(await screen.findByText('Checkout')).toBeTruthy();
      expect(await screen.findByText(`Home, ${address.line1}`)).toBeTruthy(); // the saved address has loaded
    }

    it('places a cash-on-delivery order and follows it live; cancelling after acceptance is explained first', async () => {
      await withCart();
      const calls = installFakeApi({ withAddress: true });
      await renderRouter(routes, { initialUrl: '/checkout' });
      expect(await screen.findByText('Sign in to place your order')).toBeTruthy();
      await signInFromCheckout();
      expect(screen.getByText('○ UPI — coming soon')).toBeTruthy();
      await fireEvent.changeText(
        screen.getByLabelText('Note for the restaurant (optional)'),
        'Less spicy please',
      );
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321.00'));

      await waitFor(() => expect(calls.orders.checkouts).toHaveLength(1));
      expect(await screen.findByRole('header', { name: 'Order placed' })).toBeTruthy();
      expect(screen.getByText('Waiting for Pizza Point to accept it.')).toBeTruthy();
      expect(screen.getByLabelText('Cancel order')).toBeTruthy();
      const [checkout] = calls.orders.checkouts;
      expect(checkout.body).toMatchObject({
        addressId: address.id,
        paymentMethod: 'COD',
        expectedTotalPaise: 32_100,
        restaurantInstructions: 'Less spicy please',
        contactless: false,
      });
      expect(checkout.key).toMatch(/^[0-9a-f-]{36}$/);

      // The restaurant accepts: a realtime notice makes the screen re-fetch.
      calls.orders.current = fixtures.orders.accepted;
      await act(() =>
        global.__realtime.emit('order.updated', { orderId: placed.id, status: 'RESTAURANT_ACCEPTED' }),
      );
      expect(await screen.findByRole('header', { name: 'Order accepted' })).toBeTruthy();
      expect(screen.getByText('Ready in about 20 minutes.')).toBeTruthy();
      // After acceptance the customer may still cancel, but is told what it means first (OD-38).
      await fireEvent.press(screen.getByLabelText('Cancel order'));
      expect(
        screen.getByText(
          'Pizza Point has already accepted your order. You will not be charged, but Jamzo pays the restaurant for the food. After 2 cancellations like this, cash on delivery is switched off for your account (this would be 1 of 2).',
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Keep my order'));
    });

    it('cancels before the restaurant accepts', async () => {
      await withCart();
      installFakeApi({ withAddress: true });
      await renderRouter(routes, { initialUrl: '/checkout' });
      await signInFromCheckout();
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321.00'));
      await fireEvent.press(await screen.findByLabelText('Cancel order'));
      await fireEvent.press(screen.getByLabelText('I changed my mind'));
      expect(await screen.findByText('You cancelled this order.')).toBeTruthy();
    });

    it('prices changed: shows the new total and starts a new attempt; a network error retries with the same key', async () => {
      await withCart();
      let mode = 'price';
      const calls = installFakeApi({
        withAddress: true,
        onRequest: (path, body) => {
          if (path !== '/v1/orders') return null;
          if (mode === 'price') {
            mode = 'network';
            calls.orders.checkouts.push({ failed: 'price' });
            return {
              status: 409,
              body: {
                error: {
                  code: 'PRICE_CHANGED',
                  message: 'Prices changed.',
                  requestId: 'r',
                  details: {
                    quote: { bill: { totalPayablePaise: 33_000 } },
                    previousTotalPaise: body.expectedTotalPaise,
                  },
                },
              },
            };
          }
          return null;
        },
      });
      const realFetch = global.fetch;
      const keys = [];
      global.fetch = jest.fn(async (url, init = {}) => {
        if (new URL(url).pathname === '/v1/orders') {
          keys.push(init.headers['idempotency-key']);
          if (mode === 'network') {
            mode = 'ok';
            throw new TypeError('Network request failed');
          }
        }
        return realFetch(url, init);
      });
      await renderRouter(routes, { initialUrl: '/checkout' });
      await signInFromCheckout();
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321.00'));
      expect(await screen.findByText(/Prices changed\. The new total is ₹330\.00/)).toBeTruthy();
      // Second attempt: the network drops once; the client retries by itself with the same key.
      // The press waits for the request, and the client's retry back-off runs on (fake) timers: start the press,
      // advance time, then let it finish.
      const pressing = fireEvent.press(screen.getByLabelText('Place order · ₹321.00'));
      await act(() => jest.advanceTimersByTimeAsync(10_000));
      await pressing;
      expect(await screen.findByRole('header', { name: 'Order placed' })).toBeTruthy();
      expect(keys).toHaveLength(3);
      expect(keys[1]).not.toBe(keys[0]); // a new total is a new attempt
      expect(keys[2]).toBe(keys[1]); // a retry is the same attempt: never two orders
      expect(calls.orders.checkouts.filter((c) => !c.failed)).toHaveLength(1);
    }, 15_000);
  });
});
