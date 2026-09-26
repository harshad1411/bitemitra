// Choose where to deliver (D-55): current location, a saved address, or (development builds) a demo point.
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, Header, Screen, Text } from '@jamzo/mobile-ui';
import { DEMO_POINT, useLocation } from '../lib/location';
import { useAddresses } from '../lib/queries';

export default function ChooseLocation() {
  const router = useRouter();
  const { env, session } = useJamzo();
  const { choose, detectLocation } = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const signedIn = session.status === 'signedIn';
  const addresses = useAddresses(signedIn);
  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen header={<Header title="Delivery location" />}>
      {error ? <Banner tone="warning">{error}</Banner> : null}
      <Button
        title="Use my current location"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          const r = await detectLocation();
          setBusy(false);
          if (r.ok) done();
          else setError(r.reason);
        }}
      />
      {signedIn ? (
        <Card>
          <Text variant="heading">Saved addresses</Text>
          {(addresses.data?.items ?? []).map((a) => (
            <Button
              key={a.id}
              variant="secondary"
              title={`${a.label}: ${a.line1}${a.serviceable ? '' : ' (not served yet)'}`}
              onPress={() => {
                choose({ lat: a.lat, lng: a.lng, label: a.label, addressId: a.id });
                done();
              }}
            />
          ))}
          <Button title="Add a new address" variant="secondary" onPress={() => router.push('/addresses')} />
        </Card>
      ) : (
        <Text variant="muted">Sign in to use saved addresses.</Text>
      )}
      {env.variant === 'development' ? (
        <Button
          title="Use demo location (development)"
          variant="secondary"
          onPress={() => {
            choose(DEMO_POINT);
            done();
          }}
        />
      ) : null}
      <Text variant="small">Picking a spot on a map arrives once a maps provider is chosen.</Text>
    </Screen>
  );
}
