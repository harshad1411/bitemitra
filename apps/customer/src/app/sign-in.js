// Sign-in is asked for only when needed (saved addresses, favourites, and later checkout).
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { PhoneSignIn, useJamzo } from '@jamzo/mobile-foundation';
import { Header } from '@jamzo/mobile-ui';

export default function SignIn() {
  const router = useRouter();
  const { session } = useJamzo();
  useEffect(() => {
    if (session.status === 'signedIn') router.canGoBack() ? router.back() : router.replace('/');
  }, [session.status, router]);
  return (
    <PhoneSignIn
      header={<Header />}
      title="Sign in to Jamzo"
      subtitle="Use your mobile number. We’ll send you a one-time code."
    />
  );
}
