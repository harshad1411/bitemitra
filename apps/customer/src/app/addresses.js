// Saved addresses. The spot is the device's current location (or, in development builds, the demo point);
// a map pin picker needs the maps provider decision (Q-14). The server decides serviceability.
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Badge, Banner, Button, Card, Header, Screen, Text, TextField } from '@jamzo/mobile-ui';
import { DEMO_POINT, useLocation } from '../lib/location';
import { useAddresses } from '../lib/queries';

function AddAddress({ onSaved }) {
  const { api, env } = useJamzo();
  const [form, setForm] = useState({ label: 'Home', line1: '', landmark: '' });
  const [spot, setSpot] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const useCurrent = async () => {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return setError('Location permission was not given.');
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setSpot({
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        source: 'Current location',
      });
    } catch {
      setError('Could not read your location.');
    }
  };
  const save = async () => {
    if (form.line1.trim().length < 3) return setError('Enter the house / flat and street.');
    if (!spot) return setError('Set the delivery spot first.');
    setBusy(true);
    setError(null);
    try {
      const a = await api.post('/v1/customer/addresses', {
        label: form.label.trim() || 'Home',
        line1: form.line1.trim(),
        landmark: form.landmark.trim() || null,
        lat: spot.lat,
        lng: spot.lng,
      });
      onSaved(a);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">Add an address</Text>
      <TextField label="Label" value={form.label} onChangeText={set('label')} placeholder="Home, Work…" />
      <TextField label="House / flat and street" value={form.line1} onChangeText={set('line1')} />
      <TextField label="Landmark (optional)" value={form.landmark} onChangeText={set('landmark')} />
      <Text variant="small">
        {spot ? `Delivery spot: ${spot.source} (${spot.lat}, ${spot.lng})` : 'Delivery spot not set.'}
      </Text>
      <Button title="Use my current location as the spot" variant="secondary" onPress={useCurrent} />
      {env.variant === 'development' ? (
        <Button
          title="Use demo spot (development)"
          variant="secondary"
          onPress={() => setSpot({ lat: DEMO_POINT.lat, lng: DEMO_POINT.lng, source: 'Demo spot' })}
        />
      ) : null}
      {error ? <Banner tone="warning">{error}</Banner> : null}
      <Button title="Save address" busy={busy} onPress={save} />
    </Card>
  );
}

export default function Addresses() {
  const router = useRouter();
  const qc = useQueryClient();
  const { api, session } = useJamzo();
  const { choose, place } = useLocation();
  const signedIn = session.status === 'signedIn';
  const q = useAddresses(signedIn);
  const [adding, setAdding] = useState(false);
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
      {adding ? (
        <AddAddress
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : (
        <Button title="Add a new address" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
