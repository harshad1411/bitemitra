// Choose where to deliver (D-55, D-114): current location, a spot on the map (search or move the pin — works
// without location permission), a saved address, or (development builds) a demo point.
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Pressable } from 'react-native';
import { Banner, Button, Card, Header, Icon, Screen, Text, useTheme } from '@jamzo/mobile-ui';
import { DEMO_POINT, useLocation } from '../lib/location';
import { useAddresses } from '../lib/queries';

export default function ChooseLocation() {
  const router = useRouter();
  const t = useTheme();
  const { env, session } = useJamzo();
  const { choose, detectLocation } = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const signedIn = session.status === 'signedIn';
  const addresses = useAddresses(signedIn);
  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen header={<Header title="Delivery location" />}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search for an area, street or landmark"
        onPress={() => router.push('/map?search=1')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 44,
          borderRadius: 22,
          paddingHorizontal: 14,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Icon name="search" size={18} color={t.colors.action} />
        <Text variant="muted">Search for an area, street or landmark</Text>
      </Pressable>
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
      <Button title="Set location on the map" variant="secondary" onPress={() => router.push('/map')} />
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
          <Button
            title="Add a new address"
            variant="secondary"
            onPress={() => router.push('/map?purpose=save&then=home')}
          />
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
    </Screen>
  );
}
