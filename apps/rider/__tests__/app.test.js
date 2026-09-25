// Delivery Partner app: application, going online, the offer and the whole trip. API responses are the
// real API's, captured on the seeded development database (fixtures.json).
import { Vibration } from 'react-native';
import * as Location from 'expo-location';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Home from '../src/app/index';
import Apply from '../src/app/apply';
import Earnings from '../src/app/earnings';
import NotFound from '../src/app/+not-found';
import F from './fixtures.json';
import { installFakeApi } from './fake-api';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      extra: {
        appId: 'RIDER',
        variant: 'development',
        apiUrl: 'http://api.test',
        schemes: ['jamzo-rider-dev'],
        domains: [],
      },
    },
  },
}));

const routes = { _layout: RootLayout, index: Home, apply: Apply, earnings: Earnings, '+not-found': NotFound };
const AsyncStorage = require('@react-native-async-storage/async-storage');

/** Fake rider API walking through the captured states; records what the app sends. */
function riderApi(start) {
  const s = { ...start, posts: [] };
  const handler = (path, body, init = {}) => {
    const method = init.method ?? 'GET';
    if (path === '/v1/rider/me') {
      if (method === 'PUT') {
        s.posts.push({ path, body });
        s.me = {
          applied: true,
          rider: F.meVehicle.documents ? { ...F.meVehicle, vehicle: null, canSubmit: false } : F.meVehicle,
          cities: F.meNew.cities,
        };
        return { body: s.me.rider };
      }
      return { body: s.me };
    }
    if (path === '/v1/rider/vehicle') {
      s.posts.push({ path, body });
      s.me = { applied: true, rider: F.meVehicle, cities: F.meNew.cities };
      return { body: F.meVehicle };
    }
    if (path === '/v1/rider/documents') {
      s.posts.push({ path, form: true });
      s.docs = (s.docs ?? 0) + 1;
      if (s.docs >= F.meVehicle.documents.required.length) s.me = F.meReady;
      return { status: 201, body: { id: `d${s.docs}`, status: 'PENDING' } };
    }
    if (path === '/v1/rider/application/submit') {
      s.posts.push({ path });
      s.me = { applied: true, rider: F.meSubmitted, cities: F.meNew.cities };
      return { body: F.meSubmitted };
    }
    if (path === '/v1/rider/status') {
      s.posts.push({ path, body });
      s.online = body.online;
      s.work = { ...s.work, online: body.online };
      return { body: { ...F.meActive.rider, online: body.online } };
    }
    if (path === '/v1/rider/locations') {
      s.posts.push({ path, body });
      return { body: { accepted: body.points.length, online: true } };
    }
    if (path === '/v1/rider/work') return { body: s.work };
    const offer = /^\/v1\/rider\/offers\/[^/]+\/(accept|reject)$/.exec(path);
    if (offer) {
      s.posts.push({ path, body });
      s.work = offer[1] === 'accept' ? F.workAccepted : F.workIdle;
      return { body: { accepted: offer[1] === 'accept' } };
    }
    const trip = /^\/v1\/rider\/trips\/[^/]+\/([\w-]+)$/.exec(path);
    if (trip) {
      s.posts.push({ path, body, step: trip[1] });
      const next = {
        'at-restaurant': F.tripReady,
        'picked-up': F.tripOnTheWay,
        arrived: F.tripArrived,
        delivered: null,
      }[trip[1]];
      s.work = { ...F.workIdle, trip: next };
      return { body: next ?? F.tripDelivered };
    }
    if (path === '/v1/rider/earnings') return { body: F.earningsToday };
    if (path === '/v1/rider/wallet') return { body: s.wallet ?? F.wallet };
    if (path === '/v1/rider/cod-deposits') {
      s.posts.push({ path, body });
      s.wallet = F.walletAfterDeposit;
      return { body: F.depositReported };
    }
    return null;
  };
  return { s, handler };
}

async function signIn(api) {
  const calls = installFakeApi({ me: { appId: 'RIDER', access: { status: 'OK' } }, onRequest: api.handler });
  await renderRouter(routes, { initialUrl: '/' });
  await fireEvent.changeText(await screen.findByLabelText('Mobile number'), '9000000002');
  await fireEvent.press(screen.getByLabelText('Send code'));
  await fireEvent.changeText(await screen.findByLabelText('Verification code'), '123456');
  await fireEvent.press(screen.getByLabelText('Verify and continue'));
  return calls;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
});

describe('delivery partner app', () => {
  it('a new partner applies: details, vehicle, document photos, submit; then waits for review', async () => {
    const api = riderApi({ me: F.meNew });
    await signIn(api);
    await fireEvent.press(await screen.findByLabelText('Start application'));
    await fireEvent.changeText(await screen.findByLabelText('Full name'), 'Kiran Desai');
    await fireEvent.press(screen.getByLabelText('Unjha'));
    await fireEvent.press(screen.getByLabelText('Save details'));
    await fireEvent.changeText(
      await screen.findByLabelText('Registration number (not needed for a bicycle)'),
      'GJ02AB9999',
    );
    await fireEvent.press(screen.getByLabelText('Scooter'));
    await waitFor(() =>
      expect(api.s.posts.find((p) => p.path === '/v1/rider/vehicle')?.body).toEqual({
        type: 'SCOOTER',
        registrationNumber: 'GJ02AB9999',
      }),
    );
    expect(api.s.posts.find((p) => p.path === '/v1/rider/me').body).toMatchObject({
      name: 'Kiran Desai',
      cityId: F.meNew.cities.find((c) => c.name === 'Unjha').id,
    });
    for (const label of ['Driving licence', 'Vehicle RC', 'PAN card', 'Your photo'])
      await fireEvent.press(await screen.findByLabelText(`Add photo: ${label}`));
    await fireEvent.press(await screen.findByLabelText(/Add photo: Identity proof/));
    await fireEvent.press(await screen.findByLabelText('Submit application'));
    expect(await screen.findByText(/under review/)).toBeTruthy();
    expect(api.s.posts.filter((p) => p.path === '/v1/rider/documents')).toHaveLength(5);
    expect(screen.queryByLabelText(/You are o/)).toBeNull(); // cannot go online before approval
  });

  it('goes online after the location disclosure; a request vibrates; the whole trip to delivery', async () => {
    const api = riderApi({
      me: { ...F.meActive, rider: { ...F.meActive.rider, online: false } },
      work: { ...F.workIdle, online: false },
    });
    await signIn(api);
    const toggle = await screen.findByLabelText('You are offline');
    await fireEvent(toggle, 'valueChange', true);
    expect(await screen.findByText(/also when the app is closed or not in use/)).toBeTruthy(); // prominent disclosure
    await fireEvent.press(screen.getByLabelText('Continue and go online'));
    await waitFor(() =>
      expect(api.s.posts.find((p) => p.path === '/v1/rider/status')?.body).toEqual({ online: true }),
    );
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      'jamzo-rider-location',
      expect.objectContaining({ timeInterval: 10_000, foregroundService: expect.any(Object) }),
    );
    await waitFor(() =>
      expect(api.s.posts.find((p) => p.path === '/v1/rider/locations')?.body.points[0]).toMatchObject({
        lat: 23.8005,
        lng: 72.3905,
      }),
    );
    expect(await screen.findByText('Waiting for delivery requests')).toBeTruthy();

    // A request arrives (realtime notice → refresh).
    api.s.work = F.workOffer;
    await global.__realtime.emit('order.updated', { orderId: 'x' });
    expect(await screen.findByText('New delivery request')).toBeTruthy();
    expect(
      screen.getByText(`Collect ${'₹' + (F.workOffer.offer.cashToCollectPaise / 100).toFixed(2)} in cash`),
    ).toBeTruthy();
    expect(
      screen.getByText(`You earn about ₹${(F.workOffer.offer.estimatedEarningPaise / 100).toFixed(2)}`),
    ).toBeTruthy();
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 500, 500], true);
    await fireEvent.press(screen.getByLabelText('Accept'));
    expect(await screen.findByText('Go to the restaurant')).toBeTruthy();
    expect(Vibration.cancel).toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('I have reached the restaurant'));
    expect(await screen.findByText('Pick up the order')).toBeTruthy();
    expect(screen.getByText('2 × Garlic Bread')).toBeTruthy();
    expect(screen.getByText('Food is ready')).toBeTruthy();
    const digits = F.tripReady.orderNumber.slice(-4);
    await fireEvent.changeText(screen.getByLabelText('Last 4 digits of the order number'), digits);
    await fireEvent.press(screen.getByLabelText('Picked up'));
    expect(await screen.findByText('Go to the customer')).toBeTruthy();
    expect(screen.getByText('Note: Ring the bell twice')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('I have arrived'));
    expect(await screen.findByText('Hand over the order')).toBeTruthy();
    const delivered = screen.getByLabelText('Delivered');
    expect(delivered.props.accessibilityState.disabled).toBe(true); // needs the code and the cash confirmed
    await fireEvent.changeText(
      screen.getByLabelText('Delivery code from the customer'),
      F.custArrived.delivery.code,
    );
    await fireEvent(
      screen.getByLabelText(`I collected ₹${(F.tripArrived.cashToCollectPaise / 100).toFixed(2)} in cash`),
      'valueChange',
      true,
    );
    await fireEvent.press(screen.getByLabelText('Delivered'));
    await waitFor(() =>
      expect(api.s.posts.find((p) => p.step === 'delivered')?.body).toEqual({
        otp: F.custArrived.delivery.code,
        codCollectedPaise: F.tripArrived.cashToCollectPaise,
      }),
    );
    expect(api.s.posts.find((p) => p.step === 'picked-up').body).toEqual({ orderDigits: digits });
    expect(await screen.findByText('Waiting for delivery requests')).toBeTruthy();
  });

  it('shows earnings for today with tips', async () => {
    const api = riderApi({ me: F.meAfter, work: { ...F.workIdle, online: false } });
    await signIn(api);
    await fireEvent.press(await screen.findByLabelText('Earnings'));
    expect(await screen.findByText(`₹${(F.earningsToday.totalPaise / 100).toFixed(2)}`)).toBeTruthy();
    expect(screen.getByText(/1 deliveries · tips ₹20.00/)).toBeTruthy();
  });

  it('money: cash in hand and what is owed; reporting a UPI deposit (checked by Jamzo before it counts)', async () => {
    const api = riderApi({ me: F.meAfter, work: { ...F.workIdle, online: false } });
    await signIn(api);
    await fireEvent.press(await screen.findByLabelText('Earnings'));
    const w = F.wallet;
    const rupees = (p) => `₹${(p / 100).toFixed(2)}`;
    expect(await screen.findByText(`Cash in hand: ${rupees(w.codHeldPaise)}`)).toBeTruthy();
    expect(screen.getByText(`Earnings not yet paid: ${rupees(w.earningsBalancePaise)}`)).toBeTruthy();
    expect(
      screen.getByText(`You owe Jamzo ${rupees(w.owesPaise)}. Deposit the cash to keep taking cash orders.`),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('I deposited cash'));
    const d = F.depositReported;
    await fireEvent.changeText(screen.getByLabelText('Amount (₹)'), String(d.amountPaise / 100));
    await fireEvent.changeText(screen.getByLabelText('UPI / bank reference'), d.reference);
    await fireEvent.press(screen.getByLabelText('Send'));
    expect(await screen.findByText('Being checked')).toBeTruthy();
    const sent = api.s.posts.find((x) => x.path === '/v1/rider/cod-deposits').body;
    expect(sent).toMatchObject({ amountPaise: d.amountPaise, method: 'UPI', reference: d.reference });
    expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a suspended partner cannot go online and is told to contact support', async () => {
    const api = riderApi({
      me: { ...F.meActive, rider: { ...F.meActive.rider, onboardingStatus: 'SUSPENDED' } },
    });
    await signIn(api);
    expect(await screen.findByText('Your account is paused. Please contact partner support.')).toBeTruthy();
    expect(screen.queryByLabelText(/You are o/)).toBeNull();
  });
});
