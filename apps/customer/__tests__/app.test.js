import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import TabsLayout from '../src/app/(tabs)/_layout';
import Home from '../src/app/(tabs)/index';
import ChooseLocation from '../src/app/location';
import Search from '../src/app/(tabs)/search';
import RestaurantScreen from '../src/app/restaurant/[id]';
import Customize from '../src/app/customize';
import CartScreen from '../src/app/cart';
import Account from '../src/app/(tabs)/account';
import Addresses from '../src/app/addresses';
import SignIn from '../src/app/sign-in';
import CmsPage from '../src/app/page/[slug]';
import Checkout from '../src/app/checkout';
import OrdersList from '../src/app/(tabs)/orders';
import OrderScreen from '../src/app/orders/[id]';
import NewTicket from '../src/app/support/new';
import TicketScreen from '../src/app/support/[id]';
import Tickets from '../src/app/support/index';
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
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': Home,
  location: ChooseLocation,
  '(tabs)/search': Search,
  'restaurant/[id]': RestaurantScreen,
  customize: Customize,
  cart: CartScreen,
  '(tabs)/account': Account,
  addresses: Addresses,
  'sign-in': SignIn,
  'page/[slug]': CmsPage,
  checkout: Checkout,
  '(tabs)/orders': OrdersList,
  'orders/[id]': OrderScreen,
  'support/new': NewTicket,
  'support/[id]': TicketScreen,
  'support/index': Tickets,
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
    await fireEvent.press(screen.getByLabelText('Add Margherita'));
    expect(await screen.findByText('Crust')).toBeTruthy();
    expect(screen.getAllByText('Required · choose 1')).toHaveLength(2); // size and crust
    expect(screen.getByLabelText('Choose Crust')).toBeTruthy(); // the add button says what is missing
    await fireEvent.press(screen.getByLabelText('Medium 10"'));
    await fireEvent.press(screen.getByLabelText('Cheese burst'));
    // ₹242 (medium) + ₹66 (cheese burst) — menu prices, for guidance only.
    await fireEvent.press(await screen.findByLabelText('Add item · ₹308'));

    await fireEvent.press(await screen.findByLabelText('View cart · 1 item added from Pizza Point'));
    expect(await screen.findByText('Bill details')).toBeTruthy();
    expect(await screen.findByText('To pay')).toBeTruthy();
    // Total from the captured server quote, in the bill and in the bar at the bottom.
    expect(screen.getAllByText('₹321')).toHaveLength(2);
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
    expect(await screen.findAllByText('₹216')).toHaveLength(2);

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
    const { minMinutes, maxMinutes } = track.delivery.eta;
    expect(screen.getByText(`Arriving in about ${minMinutes}–${maxMinutes} min (estimate)`)).toBeTruthy();
    const { Linking } = require('react-native');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByLabelText('See on map'));
    const { lat, lng } = track.delivery.rider.position;
    expect(open).toHaveBeenCalledWith(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    // Calls go through Jamzo support only; no support number is configured in dev, so no call button.
    expect(track.delivery.contact).toEqual({ via: 'SUPPORT', phone: null });
    expect(screen.queryByText('Call your delivery partner (via Jamzo support)')).toBeNull();
    expect(JSON.stringify(track)).not.toContain('+919000000002');
  });

  it('get help: from a delivered order, choose what went wrong, write, and follow the conversation', async () => {
    const order = fixtures.delivery.delivered;
    const { created, replied } = fixtures.support;
    let sent = null;
    let ticket = created;
    installFakeApi({
      onRequest: (path, body) => {
        if (path === `/v1/customer/orders/${order.id}`) return { body: order };
        if (path === '/v1/customer/support/tickets') return ((sent = body), { status: 201, body: created });
        if (path === `/v1/customer/support/tickets/${created.id}`) return { body: ticket };
        return null;
      },
    });
    await renderRouter(routes, { initialUrl: `/orders/${order.id}` });
    await fireEvent.press(await screen.findByLabelText('Get help with this order'));
    expect(await screen.findByRole('header', { name: 'Get help' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Something is missing' }));
    await fireEvent.changeText(screen.getByLabelText('Tell us more'), 'The garlic dip was missing');
    await fireEvent.press(screen.getByLabelText('Send to Jamzo support'));
    expect(await screen.findByText('Waiting for Jamzo')).toBeTruthy();
    expect(screen.getByText(created.ticketNumber)).toBeTruthy();
    expect(sent).toEqual({
      orderId: order.id,
      issueType: 'MISSING_ITEM',
      message: 'The garlic dip was missing',
    });
    // Support answered (captured from the real API: the internal note is not in the customer's view).
    ticket = replied;
    expect(replied.messages.map((m) => m.from)).toEqual(['YOU', 'JAMZO']);
    await renderRouter(routes, { initialUrl: `/support/${created.id}` });
    expect(await screen.findByText('Sorry! We are refunding the dip.')).toBeTruthy();
    expect(screen.getByText('Jamzo replied')).toBeTruthy();
    expect(screen.queryByText('Checked: not packed.')).toBeNull();
  });

  it('rates a delivered order: stars for each item and the delivery partner, then shows the rating (D-110)', async () => {
    // The delivered fixture plus the review fields the API now adds (their API behaviour is tested in
    // services/api/test/reviews.test.js).
    const base = fixtures.delivery.delivered;
    const items = base.items.map((i, n) => ({ ...i, id: `item-${n}` }));
    const deadline = new Date(Date.now() + 6 * 86_400_000).toISOString();
    let order = {
      ...base,
      items,
      review: { canReview: true, deadline, ratesDelivery: true, given: null },
    };
    let sent = null;
    installFakeApi({
      onRequest: (path, body) => {
        if (path === `/v1/customer/orders/${base.id}`) return { body: order };
        if (path === `/v1/customer/orders/${base.id}/review`) {
          sent = body;
          const given = { foodRating: 4, deliveryRating: 5, comment: 'Hot and crisp', items: body.items };
          order = { ...order, review: { canReview: false, deadline: null, ratesDelivery: true, given } };
          return { status: 201, body: given };
        }
        return null;
      },
    });
    await renderRouter(routes, { initialUrl: `/orders/${base.id}` });
    expect(await screen.findByText('Rate your order')).toBeTruthy();
    // Nothing rated yet → the button waits.
    expect(screen.getByLabelText('Submit rating').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText(`${items[0].name}: 4 stars`));
    await fireEvent.press(screen.getByLabelText('Delivery: 5 stars'));
    await fireEvent.changeText(screen.getByLabelText('Anything to add? (optional)'), ' Hot and crisp ');
    await fireEvent.press(screen.getByLabelText('Submit rating'));
    expect(await screen.findByText('Your rating')).toBeTruthy();
    expect(sent).toEqual({
      items: [{ orderItemId: 'item-0', rating: 4 }],
      deliveryRating: 5,
      comment: 'Hot and crisp',
    });
    expect(screen.getByText('“Hot and crisp”')).toBeTruthy();
    expect(screen.queryByText('Rate your order')).toBeNull();
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
      // Both ways to pay are offered (payments.methods); cash is the default choice.
      expect(screen.getByRole('radio', { name: 'Cash on delivery', checked: true })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Pay online', checked: false })).toBeTruthy();
      await fireEvent.changeText(
        screen.getByLabelText('Note for the restaurant (optional)'),
        'Less spicy please',
      );
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321'));

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
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321'));
      await fireEvent.press(await screen.findByLabelText('Cancel order'));
      await fireEvent.press(screen.getByLabelText('I changed my mind'));
      expect(await screen.findByText('You cancelled this order.')).toBeTruthy();
    });

    it('pays online: the payment page opens in the in-app browser, then the server verifies (never the app)', async () => {
      const pay = fixtures.payment;
      await withCart();
      let sent = null;
      const calls = installFakeApi({
        withAddress: true,
        onRequest: (path, body) => {
          if (path === '/v1/orders') return ((sent = body), { status: 201, body: pay.placed });
          if (path === `/v1/customer/orders/${pay.placed.order.id}/payment/verify`)
            return { body: pay.verifyPaid };
          if (path === `/v1/customer/orders/${pay.placed.order.id}`) return { body: pay.paidView };
          return null;
        },
      });
      await renderRouter(routes, { initialUrl: '/checkout' });
      await signInFromCheckout();
      await fireEvent.press(screen.getByRole('radio', { name: 'Pay online' }));
      expect(
        screen.getByText(
          'A secure payment page opens after you place the order. The restaurant gets your order once the payment is confirmed.',
        ),
      ).toBeTruthy();
      await fireEvent.press(await screen.findByLabelText('Place order and pay · ₹321'));
      expect(await screen.findByRole('header', { name: 'Order placed' })).toBeTruthy();
      expect(sent).toMatchObject({ paymentMethod: 'UPI', expectedTotalPaise: 32_100 });
      const { openAuthSessionAsync } = require('expo-web-browser');
      const [url, returnTo] = openAuthSessionAsync.mock.calls.at(-1);
      const { path, token } = pay.placed.order.onlinePayment.pay;
      expect(url).toContain(
        `${path}?t=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`,
      );
      expect(calls.map((c) => c.path)).toContain(`/v1/customer/orders/${pay.placed.order.id}/payment/verify`);
    });

    it('a declined try: the order waits with "Pay now" and the bank\'s message; paying again places it', async () => {
      const pay = fixtures.payment;
      let current = pay.pendingView;
      installFakeApi({
        withAddress: true,
        onRequest: (path) => {
          if (path === `/v1/customer/orders/${pay.placed.order.id}/payment/verify`)
            return ((current = pay.paidView), { body: pay.verifyPaid });
          if (path === `/v1/customer/orders/${pay.placed.order.id}`) return { body: current };
          return null;
        },
      });
      await renderRouter(routes, { initialUrl: `/orders/${pay.placed.order.id}` });
      expect(await screen.findByRole('header', { name: 'Waiting for payment' })).toBeTruthy();
      expect(
        screen.getByText('Last try: Payment declined by the bank (test). You can try again.'),
      ).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Pay now'));
      expect(await screen.findByRole('header', { name: 'Order placed' })).toBeTruthy();
    });

    it('a paid order the restaurant could not take: refunded in full, and the customer is told so', async () => {
      const pay = fixtures.payment;
      installFakeApi({
        onRequest: (path) =>
          path === `/v1/customer/orders/${pay.placed.order.id}` ? { body: pay.rejectedView } : null,
      });
      await renderRouter(routes, { initialUrl: `/orders/${pay.placed.order.id}` });
      expect(await screen.findByRole('header', { name: 'Not accepted' })).toBeTruthy();
      expect(
        screen.getByText(
          'Pizza Point could not take this order. Your payment is refunded in full automatically.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('₹321 — refunded (banks usually take 5–7 working days)')).toBeTruthy();
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
      await fireEvent.press(await screen.findByLabelText('Place order · ₹321'));
      expect(await screen.findByText(/Prices changed\. The new total is ₹330/)).toBeTruthy();
      // Second attempt: the network drops once; the client retries by itself with the same key.
      // The press waits for the request, and the client's retry back-off runs on (fake) timers: start the press,
      // advance time, then let it finish.
      const pressing = fireEvent.press(screen.getByLabelText('Place order · ₹321'));
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
