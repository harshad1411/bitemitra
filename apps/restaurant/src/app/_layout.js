import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { AppGate, JamzoProvider, OfflineBanner, PhoneSignIn, useJamzo } from '@jamzo/mobile-foundation';
import { LoadingState, Screen } from '@jamzo/mobile-ui';

const APP = MOBILE_APPS.RESTAURANT;

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
        title={APP.displayName}
        subtitle="Sign in with the mobile number registered for your restaurant."
      />
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <JamzoProvider appId="RESTAURANT" accent={APP.color}>
      <StatusBar style="dark" />
      <OfflineBanner />
      <AppGate>
        <Root />
      </AppGate>
    </JamzoProvider>
  );
}
