import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Banner } from '@jamzo/mobile-ui';

/** Current connectivity. `isInternetReachable` can be null while unknown — treated as online. */
export function useNetwork() {
  const [state, setState] = useState({ online: true, type: 'unknown' });
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setState({ online: Boolean(s.isConnected) && s.isInternetReachable !== false, type: s.type });
      }),
    [],
  );
  return state;
}

export function OfflineBanner() {
  const { online } = useNetwork();
  if (online) return null;
  return <Banner tone="warning">You are offline. We will retry when your connection is back.</Banner>;
}
