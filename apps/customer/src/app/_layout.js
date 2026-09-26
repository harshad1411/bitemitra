import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { AppGate, JamzoProvider, Navigation, OfflineBanner, useJamzo } from '@jamzo/mobile-foundation';
import { LoadingState, Screen, useJamzoFonts } from '@jamzo/mobile-ui';
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
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Dish options slide up over the menu (D-108). */}
      <Stack.Screen
        name="customize"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.75, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 20,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const fontsReady = useJamzoFonts();
  if (!fontsReady) return null; // the splash screen stays up for the moment the fonts take
  return (
    <JamzoProvider appId="CUSTOMER" accent={APP.color}>
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <OfflineBanner />
            <AppGate>
              <Navigation>
                <Root />
              </Navigation>
            </AppGate>
          </CartProvider>
        </LocationProvider>
      </QueryClientProvider>
    </JamzoProvider>
  );
}
