import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
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
  '+not-found': NotFound,
};

const AsyncStorage = require('@react-native-async-storage/async-storage');
beforeEach(() => AsyncStorage.clear());

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

    // Checkout is honestly unavailable until Phase 5.
    expect(screen.getByLabelText('Proceed to checkout').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Checkout and payment arrive in Phase 5.')).toBeTruthy();
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
});
