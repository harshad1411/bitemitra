import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Home from '../src/app/index';
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

const routes = { _layout: RootLayout, index: Home, '+not-found': NotFound };

async function signIn(me) {
  const calls = installFakeApi({ me });
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

describe('restaurant partner app shell', () => {
  it('approved member sees their restaurant and what is coming', async () => {
    const calls = await signIn({
      appId: 'RESTAURANT',
      access: { status: 'OK' },
      restaurants: [
        { id: 'r1', name: 'Jamzo Demo Kitchen', role: 'OWNER', onboardingStatus: 'ACTIVE', approved: true },
      ],
    });
    expect(await screen.findByText('Jamzo Demo Kitchen')).toBeTruthy();
    expect(screen.getByText(/your role: owner/)).toBeTruthy();
    expect(screen.getByText(/arrive in Phase 5/)).toBeTruthy();
    expect(calls.every((c) => c.headers['x-app-id'] === 'RESTAURANT')).toBe(true);
  });

  it('pending restaurant: no partner features, clear status', async () => {
    await signIn({
      appId: 'RESTAURANT',
      access: { status: 'PENDING_APPROVAL' },
      restaurants: [
        { id: 'r2', name: 'Pending Restaurant', role: 'MANAGER', onboardingStatus: 'DRAFT', approved: false },
      ],
    });
    expect(await screen.findByText(/not live yet/)).toBeTruthy();
    expect(screen.queryByText(/arrive in Phase 5/)).toBeNull();
  });

  it('signed in but not linked to any restaurant', async () => {
    await signIn({ appId: 'RESTAURANT', access: { status: 'NOT_REGISTERED' }, restaurants: [] });
    expect(await screen.findByText(/isn't linked to a Jamzo restaurant/)).toBeTruthy();
  });
});
