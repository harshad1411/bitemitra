import { Image } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MOBILE_APPS } from '@jamzo/config/apps';
import {
  AppGate,
  JamzoProvider,
  Navigation,
  OfflineBanner,
  PhoneSignIn,
  useJamzo,
} from '@jamzo/mobile-foundation';
import { LoadingState, Screen, useJamzoFonts } from '@jamzo/mobile-ui';

const APP = MOBILE_APPS.RESTAURANT;

/** The Jamzo logo above the sign-in form, with the partner app's name under it (D-107). */
function SignInLogo() {
  return (
    <Image
      source={require('../../assets/logo-on-light.png')}
      accessibilityLabel="Jamzo"
      resizeMode="contain"
      style={{ width: 150, height: 46, marginBottom: 8 }}
    />
  );
}

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
        logo={<SignInLogo />}
        title={APP.displayName}
        subtitle="Sign in with the mobile number registered for your restaurant."
      />
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const fontsReady = useJamzoFonts();
  if (!fontsReady) return null; // the splash screen stays up for the moment the fonts take
  return (
    <JamzoProvider appId="RESTAURANT" accent={APP.color}>
      <StatusBar style="dark" />
      <OfflineBanner />
      <AppGate>
        <Navigation>
          <Root />
        </Navigation>
      </AppGate>
    </JamzoProvider>
  );
}
