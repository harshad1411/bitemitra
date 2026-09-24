import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { AppGate, JamzoProvider, OfflineBanner, PhoneSignIn, useJamzo } from '@jamzo/mobile-foundation';
import { LoadingState, Screen } from '@jamzo/mobile-ui';

const APP = MOBILE_APPS.CUSTOMER;

function Root() {
  const { session } = useJamzo();
  if (session.status === 'restoring') {
    return (
      <Screen scroll={false}>
        <LoadingState label="Signing you in" />
      </Screen>
    );
  }
  if (session.status === 'signedOut') {
    return (
      <PhoneSignIn
        title={`Welcome to ${APP.displayName}`}
        subtitle="Sign in with your mobile number. We'll send you a one-time code."
      />
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <JamzoProvider appId="CUSTOMER" accent={APP.color}>
      <StatusBar style="dark" />
      <OfflineBanner />
      <AppGate>
        <Root />
      </AppGate>
    </JamzoProvider>
  );
}
