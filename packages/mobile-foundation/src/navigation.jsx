// Back-arrow behaviour for the shared Header (DECISIONS D-108): go back, or to the app's home screen when
// the screen was opened directly (a notification or a link) and there is nothing to go back to.
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { NavProvider } from '@jamzo/mobile-ui';

export function Navigation({ children }) {
  const router = useRouter();
  const nav = useMemo(
    () => ({ back: () => (router.canGoBack() ? router.back() : router.replace('/')) }),
    [router],
  );
  return <NavProvider value={nav}>{children}</NavProvider>;
}
