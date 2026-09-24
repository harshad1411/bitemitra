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
        appId: 'RIDER',
        variant: 'development',
        apiUrl: 'http://api.test',
        schemes: ['jamzo-rider-dev'],
        domains: [],
      },
    },
  },
}));

const routes = { _layout: RootLayout, index: Home, '+not-found': NotFound };

async function signIn(me) {
  installFakeApi({ me });
  await renderRouter(routes, { initialUrl: '/' });
  expect(
    await screen.findByText('Sign in with the mobile number you registered as a delivery partner.'),
  ).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '9000000002');
  await fireEvent.press(screen.getByLabelText('Send code'));
  await fireEvent.changeText(await screen.findByLabelText('Verification code'), '123456');
  await fireEvent.press(screen.getByLabelText('Verify and continue'));
}

describe('delivery partner app shell', () => {
  it.each([
    ['OK', "You're an approved Jamzo delivery partner.", true],
    ['PENDING_APPROVAL', 'Your application is under review.', false],
    ['BLOCKED', 'Your delivery partner account is not active.', false],
    ['NOT_REGISTERED', "This number isn't registered as a delivery partner.", false],
  ])('access %s', async (status, text, features) => {
    await signIn({
      appId: 'RIDER',
      access: { status },
      rider: status === 'NOT_REGISTERED' ? null : { id: 'x', onboardingStatus: 'ACTIVE' },
    });
    expect(await screen.findByText(new RegExp(text.replace(/[.']/g, '.')))).toBeTruthy();
    expect(Boolean(screen.queryByText(/arrive in Phase 6/))).toBe(features);
    expect(screen.getByText('Location: declared for Phase 6, not requested yet.')).toBeTruthy();
  });
});
