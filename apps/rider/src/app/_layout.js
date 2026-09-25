import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { AppGate, JamzoProvider, OfflineBanner, PhoneSignIn, useJamzo } from '@jamzo/mobile-foundation';
import { LoadingState, Screen } from '@jamzo/mobile-ui';
import { enqueueAndFlush, setLocationSender } from '../lib/location';

const APP = MOBILE_APPS.RIDER;

function Root() {
  const { session, api } = useJamzo();
  // Location batches go through the signed-in API client; queued points are sent once signed in again.
  useEffect(() => {
    if (session.status !== 'signedIn') {
      setLocationSender(null);
      return;
    }
    setLocationSender((points) => api.post('/v1/rider/locations', { points }, { idempotencyKey: false }));
    enqueueAndFlush([]).catch(() => {});
  }, [session.status, api]);
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
        subtitle="Sign in or sign up with your mobile number to deliver with Jamzo."
      />
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );
  return (
    <JamzoProvider appId="RIDER" accent={APP.color}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <OfflineBanner />
        <AppGate>
          <Root />
        </AppGate>
      </QueryClientProvider>
    </JamzoProvider>
  );
}
