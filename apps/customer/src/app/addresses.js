// Saved addresses. New ones are set on the map (D-114): search or move the pin, then type the house / flat.
// The server decides serviceability.
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Badge, Button, Card, Header, Screen, Text } from '@jamzo/mobile-ui';
import { useLocation } from '../lib/location';
import { useAddresses } from '../lib/queries';

export default function Addresses() {
  const router = useRouter();
  const qc = useQueryClient();
  const { api, session } = useJamzo();
  const { choose, place } = useLocation();
  const signedIn = session.status === 'signedIn';
  const q = useAddresses(signedIn);
  if (!signedIn)
    return (
      <Screen header={<Header title="Saved addresses" />}>
        <Text variant="muted">Sign in to save addresses.</Text>
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] });
  return (
    <Screen header={<Header title="Saved addresses" />}>
      {(q.data?.items ?? []).map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Text variant="heading">{a.label}</Text>
            {a.isDefault ? <Badge tone="info">Default</Badge> : null}
            {a.serviceable ? null : <Badge tone="warning">Not served yet</Badge>}
          </View>
          <Text>{[a.line1, a.landmark, a.cityName].filter(Boolean).join(', ')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={place?.addressId === a.id ? 'Delivering here' : 'Deliver here'}
                variant="secondary"
                disabled={place?.addressId === a.id}
                onPress={() => {
                  choose({ lat: a.lat, lng: a.lng, label: a.label, addressId: a.id });
                  router.replace('/');
                }}
              />
            </View>
            <Button
              title={`Delete ${a.label}`}
              variant="secondary"
              onPress={async () => {
                await api.delete(`/v1/customer/addresses/${a.id}`);
                if (place?.addressId === a.id) choose(null);
                refresh();
              }}
            />
          </View>
        </Card>
      ))}
      {q.data && !q.data.items.length ? <Text variant="muted">No saved addresses yet.</Text> : null}
      <Button title="Add a new address" onPress={() => router.push('/map?purpose=save')} />
    </Screen>
  );
}
