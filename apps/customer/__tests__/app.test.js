import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
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
        appId: 'CUSTOMER',
        variant: 'development',
        apiUrl: 'http://api.test',
        schemes: ['jamzo-dev'],
        domains: ['jamzo.in'],
      },
    },
  },
}));

const routes = { _layout: RootLayout, index: Home, '+not-found': NotFound };

describe('customer app shell', () => {
  it('signs in with phone OTP and shows the honest home screen', async () => {
    const calls = installFakeApi();
    await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText('Welcome to Jamzo')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '12345');
    await fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText('Enter a valid 10-digit mobile number.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '98765 43210');
    await fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText(/Enter the 6-digit code sent to \+919876543210/)).toBeTruthy();
    const otpRequest = calls.find((c) => c.path === '/v1/auth/otp/request');
    expect(otpRequest.body).toEqual({ channel: 'SMS', destination: '+919876543210' });
    expect(otpRequest.headers['x-app-id']).toBe('CUSTOMER');

    await fireEvent.changeText(screen.getByLabelText('Verification code'), '000000');
    await fireEvent.press(screen.getByLabelText('Verify and continue'));
    expect(await screen.findByText('That code is not valid. 4 attempts left.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await fireEvent.press(screen.getByLabelText('Verify and continue'));
    expect(await screen.findByText(/Signed in as/)).toBeTruthy();
    expect(screen.getByText(/arrive in Phase 3/)).toBeTruthy();
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
