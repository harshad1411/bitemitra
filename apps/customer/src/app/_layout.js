import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { AppGate, JamzoProvider, OfflineBanner, useJamzo } from '@jamzo/mobile-foundation';
import { LoadingState, Screen } from '@jamzo/mobile-ui';
import { CartProvider } from '../lib/cart';
import { LocationProvider } from '../lib/location';

const APP = MOBILE_APPS.CUSTOMER;

function Root() {
  const { session } = useJamzo();
  if (session.status === 'restoring') {
    return (
      <Screen scroll={false}>
        <LoadingState label="Starting Jamzo" />
      </Screen>
    );
  }
  // Guests can browse (setting customer.guestBrowsing, A-11); sign-in is asked for when it is needed.
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <JamzoProvider appId="CUSTOMER" accent={APP.color}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <OfflineBanner />
            <AppGate>
              <Root />
            </AppGate>
          </CartProvider>
        </LocationProvider>
      </QueryClientProvider>
    </JamzoProvider>
  );
}
