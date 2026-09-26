// Delivery partner application (D-73): details, vehicle, document photos, submit. Aadhaar numbers are never
// asked for; if an Aadhaar card is used as identity proof the rider masks the number before taking the photo.
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '@jamzo/mobile-ui';
import { DOC_LABEL, VEHICLES } from '../lib/format';

const STATUS_TONE = { PENDING: 'warning', VERIFIED: 'success', REJECTED: 'critical' };
const STATUS_WORD = {
  PENDING: 'Uploaded — being checked',
  VERIFIED: 'Approved',
  REJECTED: 'Please upload again',
};

export default function Apply() {
  const router = useRouter();
  const qc = useQueryClient();
  const { api } = useJamzo();
  const q = useQuery({ queryKey: ['rider-me'], queryFn: () => api.get('/v1/rider/me') });
  const [form, setForm] = useState(null);
  const [plate, setPlate] = useState('');
  const [pan, setPan] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (q.isPending) return <LoadingState label="Loading" />;
  if (q.isError)
    return (
      <Screen>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const r = q.data.rider;
  const f = form ?? {
    name: r?.name ?? '',
    cityId: r?.cityId ?? q.data.cities[0]?.id ?? '',
    addressLine: r?.addressLine ?? '',
  };
  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['rider-me'] });
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const upload = (kind) =>
    run(kind, async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      const pick = perm.granted
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
      if (pick.canceled) return;
      const asset = pick.assets[0];
      const data = new FormData();
      data.append('kind', kind);
      if (kind === 'PAN' && pan.trim()) data.append('number', pan.trim().toUpperCase());
      data.append(
        'file',
        /** @type {any} */ ({
          uri: asset.uri,
          name: `${kind.toLowerCase()}.jpg`,
          type: asset.mimeType ?? 'image/jpeg',
        }),
      );
      await api.postForm('/v1/rider/documents', data, { idempotencyKey: false });
    });
  const docs = r?.documents;
  const byKind = new Map((docs?.items ?? []).map((d) => [d.kind, d]));
  return (
    <Screen header={<Header title="Deliver with Jamzo" />}>
      <Text variant="muted">Fill in your details, choose your vehicle and add photos of your documents.</Text>
      {error ? <Banner tone="critical">{error}</Banner> : null}

      <Card>
        <Text variant="heading">1. Your details</Text>
        <TextField label="Full name" value={f.name} onChangeText={(name) => setForm({ ...f, name })} />
        <Text variant="small">City</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {q.data.cities.map((c) => (
            <Button
              key={c.id}
              title={c.name}
              variant={f.cityId === c.id ? 'primary' : 'secondary'}
              onPress={() => setForm({ ...f, cityId: c.id })}
            />
          ))}
        </View>
        <TextField
          label="Address (optional)"
          value={f.addressLine ?? ''}
          onChangeText={(addressLine) => setForm({ ...f, addressLine })}
        />
        <Button
          title="Save details"
          busy={busy === 'me'}
          onPress={() =>
            run('me', () =>
              api.put('/v1/rider/me', { name: f.name, cityId: f.cityId, addressLine: f.addressLine || null }),
            )
          }
        />
      </Card>

      {r ? (
        <Card>
          <Text variant="heading">2. Your vehicle</Text>
          {r.vehicle ? (
            <Text>{`${VEHICLES.find((v) => v[0] === r.vehicle.type)?.[1]} ${r.vehicle.registrationNumber ?? ''}`}</Text>
          ) : null}
          <TextField
            label="Registration number (not needed for a bicycle)"
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
            placeholder="GJ02AB1234"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VEHICLES.map(([type, label]) => (
              <Button
                key={type}
                title={label}
                variant={r.vehicle?.type === type ? 'primary' : 'secondary'}
                busy={busy === type}
                onPress={() =>
                  run(type, () =>
                    api.put('/v1/rider/vehicle', { type, registrationNumber: plate.trim() || null }),
                  )
                }
              />
            ))}
          </View>
        </Card>
      ) : null}

      {r?.vehicle ? (
        <Card>
          <Text variant="heading">3. Documents</Text>
          <TextField
            label="PAN number"
            value={pan}
            onChangeText={setPan}
            autoCapitalize="characters"
            placeholder="ABCDE1234F"
          />
          {docs.required.map((kind) => {
            const d = byKind.get(kind);
            return (
              <View key={kind} style={{ gap: 4, paddingVertical: 6 }}>
                <Text style={{ fontWeight: '600' }}>{DOC_LABEL[kind]}</Text>
                {d ? <Badge tone={STATUS_TONE[d.status]}>{STATUS_WORD[d.status]}</Badge> : null}
                {d?.reviewNote ? <Text variant="small">{d.reviewNote}</Text> : null}
                {!d || d.status === 'REJECTED' ? (
                  <Button
                    title={`Add photo: ${DOC_LABEL[kind]}`}
                    variant="secondary"
                    busy={busy === kind}
                    onPress={() => upload(kind)}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {r?.canSubmit ? (
        <Button
          title="Submit application"
          busy={busy === 'submit'}
          onPress={() =>
            run('submit', async () => {
              await api.post('/v1/rider/application/submit', {}, { idempotencyKey: false });
              router.replace('/');
            })
          }
        />
      ) : (
        <Text variant="small">You can submit once your details, vehicle and every document are added.</Text>
      )}
    </Screen>
  );
}
