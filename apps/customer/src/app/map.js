// Set the delivery spot on a map (D-114). The map moves under a fixed centre pin; a search box finds streets,
// shops and landmarks; "Use current location" asks for permission only when pressed, and refusing never
// blocks. `purpose=browse` (default) sets where to deliver; `purpose=save` goes on to the address form and
// saves it. Lookups go through the Jamzo API — the app holds no Google key.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MapView from 'react-native-maps';
import * as Location from 'expo-location';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Chip,
  Header,
  Icon,
  Screen,
  Text,
  TextField,
  useTheme,
} from '@jamzo/mobile-ui';
import { DEMO_POINT, useLocation } from '../lib/location';

const ZOOM = { latitudeDelta: 0.004, longitudeDelta: 0.004 };
/**
 * Android draws maps with Google's SDK, which stops the app without the Maps SDK key (GOOGLE_MAPS_ANDROID_KEY,
 * D-114). Until the key is in the build, Android offers search and the current location without a map.
 */
const MAP_DRAWN = Platform.OS !== 'android' || Boolean(Constants.expoConfig?.extra?.androidMaps);
const LABELS = ['Home', 'Work', 'Other'];
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const newSession = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

/** The value after the customer stops typing for `ms`. */
function useSettled(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Where the map opens: the chosen place, else the last known position (only if already allowed), else a live city. */
function useStart(place) {
  const { api } = useJamzo();
  const [start, setStart] = useState(place ? { lat: place.lat, lng: place.lng } : null);
  useEffect(() => {
    if (start) return;
    let gone = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status === 'granted') {
          const pos = await Location.getLastKnownPositionAsync();
          if (pos && !gone)
            return setStart({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) });
        }
      } catch {
        // No position: fall through to the city centre.
      }
      try {
        const cities = await api.get('/v1/geo/cities');
        const c = cities.items[0];
        if (!gone) setStart(c ? { lat: c.lat, lng: c.lng } : { lat: DEMO_POINT.lat, lng: DEMO_POINT.lng });
      } catch {
        if (!gone) setStart({ lat: DEMO_POINT.lat, lng: DEMO_POINT.lng });
      }
    })();
    return () => {
      gone = true;
    };
  }, [api, start]);
  return start;
}

function SearchResults({ items, onPick }) {
  const t = useTheme();
  return (
    // "handled": one tap picks a result even while the keyboard is open.
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: t.colors.surface }}>
      {items.map((p, i) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={[p.title, p.subtitle].filter(Boolean).join(', ')}
          onPress={() => onPick(p)}
          style={{
            flexDirection: 'row',
            gap: 12,
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: i ? 1 : 0,
            borderColor: t.colors.border,
          }}
        >
          <Icon name="location-outline" size={20} color={t.colors.textSubtle} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }} numberOfLines={1}>
              {p.title}
            </Text>
            {p.subtitle ? (
              <Text variant="small" numberOfLines={1}>
                {p.subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function AddressForm({ center, spot, onChangeSpot }) {
  const { api } = useJamzo();
  const router = useRouter();
  const qc = useQueryClient();
  const { choose } = useLocation();
  const params = useLocalSearchParams();
  const [form, setForm] = useState({
    house: '',
    // Only Google gives a real street; Jamzo's own area names are not one.
    street: spot?.source === 'GOOGLE' ? (spot.address?.line ?? '') : '',
    landmark: '',
    label: 'Home',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.house.trim()) return setError('Enter the house / flat number.');
    const line1 = [form.house.trim(), form.street.trim()].filter(Boolean).join(', ');
    if (line1.length < 3) return setError('Enter the house / flat and street.');
    setBusy(true);
    setError(null);
    try {
      const a = await api.post('/v1/customer/addresses', {
        label: form.label,
        line1,
        landmark: form.landmark.trim() || null,
        area: spot?.address?.area ?? null,
        pincode: spot?.address?.pincode ?? null,
        lat: center.lat,
        lng: center.lng,
      });
      await qc.invalidateQueries({ queryKey: ['addresses'] });
      choose({ lat: a.lat, lng: a.lng, label: a.label, addressId: a.id });
      // Back to where the customer came from (saved addresses); home when opened from a link.
      if (params.then === 'home' || !router.canGoBack()) router.dismissTo('/');
      else router.back();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={<Header title="Address details" onBack={onChangeSpot} />}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="location" size={22} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600' }}>{spot?.address?.title ?? 'Pinned spot'}</Text>
          {spot?.address?.line ? <Text variant="small">{spot.address.line}</Text> : null}
        </View>
        <Button title="Change" variant="ghost" onPress={onChangeSpot} />
      </View>
      {spot && !spot.serviceable ? (
        <Banner tone="warning">We don’t deliver here yet. You can still save this address.</Banner>
      ) : null}
      <TextField label="House / flat / floor" value={form.house} onChangeText={set('house')} autoFocus />
      <TextField label="Street, society or area" value={form.street} onChangeText={set('street')} />
      <TextField label="Landmark (optional)" value={form.landmark} onChangeText={set('landmark')} />
      <Text variant="muted">Save as</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {LABELS.map((l) => (
          <Chip key={l} label={l} selected={form.label === l} onPress={() => set('label')(l)} />
        ))}
      </View>
      {error ? <Banner tone="warning">{error}</Banner> : null}
      <Button title="Save address" busy={busy} onPress={save} />
    </Screen>
  );
}

export default function MapPicker() {
  const t = useTheme();
  const router = useRouter();
  const { api, session: auth } = useJamzo();
  const { place, choose } = useLocation();
  const params = useLocalSearchParams();
  const saving = params.purpose === 'save';
  const start = useStart(saving ? null : place);
  const [center, setCenter] = useState(null);
  const [q, setQ] = useState('');
  const [session, setSession] = useState(newSession);
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState('pin');
  const [locating, setLocating] = useState(false);
  const map = useRef(null);
  useEffect(() => {
    if (start && !center) setCenter(start);
  }, [start, center]);

  const settledCenter = useSettled(center, 400);
  const spot = useQuery({
    queryKey: ['spot', settledCenter?.lat, settledCenter?.lng],
    queryFn: () => api.get('/v1/geo/reverse', settledCenter),
    enabled: Boolean(settledCenter),
    staleTime: 10 * 60_000,
  });
  const settledQ = useSettled(q.trim(), 400);
  const results = useQuery({
    queryKey: ['places', settledQ],
    queryFn: () =>
      api.get('/v1/geo/places/search', {
        q: settledQ,
        ...(center ? { lat: center.lat, lng: center.lng } : {}),
        session,
      }),
    enabled: settledQ.length >= 3,
  });

  const moveTo = (p) => {
    const next = { lat: round6(p.lat), lng: round6(p.lng) };
    setCenter(next);
    map.current?.animateToRegion({ latitude: next.lat, longitude: next.lng, ...ZOOM }, 400);
  };
  const pick = async (p) => {
    Keyboard.dismiss();
    setNotice(null);
    try {
      const at = p.lat != null ? p : await api.get('/v1/geo/places/details', { id: p.id, session });
      setQ('');
      setSession(newSession()); // the next search is a new billing session
      moveTo(at);
    } catch (err) {
      setNotice(userMessage(err));
    }
  };
  const locate = async () => {
    setNotice(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted')
        return setNotice('Location is off. Move the map to your spot or search for your area instead.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      moveTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setNotice('Could not read your location. Move the map to your spot instead.');
    } finally {
      setLocating(false);
    }
  };
  const region = useMemo(
    () => (start ? { latitude: start.lat, longitude: start.lng, ...ZOOM } : null),
    [start],
  );

  if (saving && auth.status !== 'signedIn')
    return (
      <Screen header={<Header title="Add an address" />}>
        <Text variant="muted">Sign in to save addresses.</Text>
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  if (step === 'details' && center)
    return <AddressForm center={center} spot={spot.data} onChangeSpot={() => setStep('pin')} />;

  const looking = !settledCenter || settledCenter !== center || spot.isFetching;
  const a = spot.data?.address;
  const confirm = () => {
    if (saving) return setStep('details');
    choose({ lat: center.lat, lng: center.lng, label: a?.title || 'Pinned location' });
    router.dismissTo('/');
  };
  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <>
          <Header title={saving ? 'Add an address' : 'Set delivery location'} />
          <View style={{ paddingHorizontal: 16, paddingBottom: 8, backgroundColor: t.colors.background }}>
            <View
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
              <TextInput
                accessibilityLabel="Search for an area, street or landmark"
                placeholder="Search for an area, street or landmark"
                placeholderTextColor={t.colors.textSubtle}
                value={q}
                onChangeText={setQ}
                autoFocus={params.search === '1'}
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, fontFamily: t.fonts.regular, fontSize: 16, color: t.colors.text }}
              />
              {q ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setQ('')}
                >
                  <Icon name="close-circle" size={18} color={t.colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </>
      }
    >
      <View style={{ flex: 1 }}>
        {!MAP_DRAWN ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
            <Icon name="map-outline" size={40} color={t.colors.textSubtle} />
            <Text variant="muted" style={{ textAlign: 'center' }}>
              Search for your area above, or use your current location.
            </Text>
          </View>
        ) : region ? (
          <MapView
            ref={map}
            testID="map"
            style={{ flex: 1 }}
            initialRegion={region}
            onRegionChangeComplete={(r) => setCenter({ lat: round6(r.latitude), lng: round6(r.longitude) })}
            showsUserLocation={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="muted">Opening the map…</Text>
          </View>
        )}
        {/* The pin stays in the middle; the customer moves the map under it. */}
        {MAP_DRAWN ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* 80 pt tall with the 40 pt pin in the top half, so the pin's tip sits on the exact centre. */}
            <View style={{ width: 260, height: 80, alignItems: 'center' }}>
              <View
                style={{
                  position: 'absolute',
                  bottom: 84,
                  backgroundColor: t.colors.text,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text variant="small" style={{ color: t.colors.surface }}>
                  Order will be delivered here
                </Text>
              </View>
              <Icon name="location" size={40} color={t.colors.critical} />
            </View>
          </View>
        ) : null}
        <View style={{ position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center' }}>
          <Button title="Use current location" variant="secondary" busy={locating} onPress={locate} />
        </View>
        {settledQ.length >= 3 && q.trim().length >= 3 ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, maxHeight: '70%' }}>
            {results.isPending ? (
              <Text variant="muted" style={{ padding: 16, backgroundColor: t.colors.surface }}>
                Searching…
              </Text>
            ) : results.isError ? (
              <Text style={{ padding: 16, backgroundColor: t.colors.surface }}>
                {userMessage(results.error)}
              </Text>
            ) : results.data.items.length ? (
              <SearchResults items={results.data.items} onPick={pick} />
            ) : (
              <Text variant="muted" style={{ padding: 16, backgroundColor: t.colors.surface }}>
                No places found. Try another name, or move the map to your spot.
              </Text>
            )}
          </View>
        ) : null}
      </View>
      <View
        style={{
          padding: 16,
          gap: 10,
          backgroundColor: t.colors.surface,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          marginTop: -20,
        }}
      >
        {notice ? <Banner tone="warning">{notice}</Banner> : null}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Icon name="location" size={22} />
          <View style={{ flex: 1 }}>
            {looking && !spot.data ? (
              <Text variant="muted">Finding the address…</Text>
            ) : a ? (
              <>
                <Text style={{ fontWeight: '600' }} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text variant="small" numberOfLines={2}>
                  {a.line}
                </Text>
              </>
            ) : (
              <Text variant="muted">Move the map to put the pin on your delivery spot.</Text>
            )}
          </View>
        </View>
        {spot.data && !spot.data.serviceable ? <Badge tone="warning">We don’t deliver here yet</Badge> : null}
        <Button
          title={saving ? 'Confirm and add details' : 'Confirm location'}
          disabled={!center}
          onPress={confirm}
        />
      </View>
    </Screen>
  );
}
