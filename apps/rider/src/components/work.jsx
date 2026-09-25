// The delivery request and the trip (spec §21, D-76). Riders see what they need to do the job — where, what,
// how much cash to collect, what they will earn — never food prices or restaurant money.
import { useEffect, useState } from 'react';
import { Linking, Vibration, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Badge, Banner, Button, Card, Text, TextField, ToggleRow } from '@jamzo/mobile-ui';
import { km, mapsUrl, money, time } from '../lib/format';

/** Seconds left until `iso`, ticking. */
function useCountdown(iso) {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(
      () => setLeft(Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(t);
  }, [iso]);
  return left;
}

export function OfferCard({ offer, onChanged }) {
  const { api } = useJamzo();
  const left = useCountdown(offer.expiresAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    Vibration.vibrate([0, 500, 500], true); // hard to miss while the request is open
    return () => Vibration.cancel();
  }, [offer.assignmentId]);
  const respond = async (accept) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/v1/rider/offers/${offer.assignmentId}/${accept ? 'accept' : 'reject'}`,
        accept ? {} : { reason: 'OTHER' },
        { idempotencyKey: false },
      );
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title" accessibilityRole="header">
          New delivery request
        </Text>
        <Badge tone="warning">{`${left}s`}</Badge>
      </View>
      {offer.manual ? <Text variant="small">Sent to you by Jamzo operations.</Text> : null}
      <Text variant="heading">{offer.restaurant.name}</Text>
      <Text variant="small">{offer.restaurant.address}</Text>
      <Text>{`Pickup ${km(offer.pickupDistanceM)} away · delivery ${km(offer.deliveryDistanceM)}${offer.dropArea ? ` to ${offer.dropArea}` : ''}`}</Text>
      <Text>{`${offer.itemCount} item${offer.itemCount === 1 ? '' : 's'}`}</Text>
      {offer.cashToCollectPaise ? (
        <Banner tone="info">{`Collect ${money(offer.cashToCollectPaise)} in cash`}</Banner>
      ) : null}
      <Text variant="heading">{`You earn about ${money(offer.estimatedEarningPaise)}`}</Text>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Button title="Accept" busy={busy} onPress={() => respond(true)} />
      <Button title="Reject" variant="secondary" disabled={busy} onPress={() => respond(false)} />
    </Card>
  );
}

const STEP_TITLE = {
  ACCEPTED: 'Go to the restaurant',
  AT_RESTAURANT: 'Pick up the order',
  PICKED_UP: 'Go to the customer',
  ON_THE_WAY: 'Go to the customer',
  ARRIVED: 'Hand over the order',
};

export function TripCard({ trip, support, onChanged }) {
  const { api } = useJamzo();
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [cashOk, setCashOk] = useState(false);
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(null); // 'issue' | 'handback'
  const step = async (path, body = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/rider/trips/${trip.orderId}/${path}`, body, { idempotencyKey: false });
      setAsking(null);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const takeProof = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError('Camera permission is needed for the delivery photo.');
    const pick = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (pick.canceled) return undefined;
    const data = new FormData();
    data.append(
      'file',
      /** @type {any} */ ({ uri: pick.assets[0].uri, name: 'proof.jpg', type: 'image/jpeg' }),
    );
    try {
      setProof((await api.postForm('/v1/rider/proof', data, { idempotencyKey: false })).mediaId);
    } catch (err) {
      setError(userMessage(err));
    }
    return undefined;
  };
  const toRestaurant = ['ACCEPTED', 'AT_RESTAURANT'].includes(trip.deliveryStatus);
  const dest = toRestaurant ? trip.restaurant : trip.customer;
  const cash = trip.cashToCollectPaise;
  return (
    <Card>
      <Text variant="small">{`Order #${trip.shortNumber}`}</Text>
      <Text variant="title" accessibilityRole="header">
        {STEP_TITLE[trip.deliveryStatus] ?? trip.deliveryStatus}
      </Text>
      <Text variant="heading">{toRestaurant ? trip.restaurant.name : trip.customer.firstName}</Text>
      <Text>{toRestaurant ? trip.restaurant.address : trip.customer.address}</Text>
      {!toRestaurant && trip.customer.instructions ? (
        <Banner tone="info">{`Note: ${trip.customer.instructions}`}</Banner>
      ) : null}
      {!toRestaurant && trip.customer.contactless ? (
        <Badge tone="info">Contactless: leave at the door</Badge>
      ) : null}
      {dest.lat != null ? (
        <Button
          title="Navigate"
          variant="secondary"
          onPress={() => Linking.openURL(mapsUrl(dest.lat, dest.lng))}
        />
      ) : null}
      {!toRestaurant && support?.phone ? (
        <Button
          title="Call customer via Jamzo support"
          variant="secondary"
          onPress={() => Linking.openURL(`tel:${support.phone}`)}
        />
      ) : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}

      {trip.deliveryStatus === 'ACCEPTED' ? (
        <Button title="I have reached the restaurant" busy={busy} onPress={() => step('at-restaurant')} />
      ) : null}

      {trip.deliveryStatus === 'AT_RESTAURANT' ? (
        <>
          <Text variant="heading">Check the bag</Text>
          {trip.items.map((i, n) => (
            <Text key={n}>{`${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`}</Text>
          ))}
          {trip.restaurant.foodReady ? (
            <Badge tone="success">Food is ready</Badge>
          ) : (
            <Text variant="small">{`The restaurant is still preparing${trip.restaurant.estimatedReadyAt ? ` — ready about ${time(trip.restaurant.estimatedReadyAt)}` : ''}.`}</Text>
          )}
          <TextField
            label="Last 4 digits of the order number"
            value={digits}
            onChangeText={setDigits}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Button
            title="Picked up"
            busy={busy}
            disabled={digits.length !== 4 || !trip.restaurant.foodReady}
            onPress={() => step('picked-up', { orderDigits: digits })}
          />
        </>
      ) : null}

      {trip.deliveryStatus === 'ON_THE_WAY' ? (
        <Button title="I have arrived" busy={busy} onPress={() => step('arrived')} />
      ) : null}

      {trip.deliveryStatus === 'ARRIVED' ? (
        <>
          {trip.requires.deliveryCode ? (
            <TextField
              label="Delivery code from the customer"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={4}
            />
          ) : null}
          {cash ? (
            <ToggleRow
              label={`I collected ${money(cash)} in cash`}
              description="Collect the exact amount."
              value={cashOk}
              onValueChange={setCashOk}
            />
          ) : (
            <Text variant="small">Already paid — do not collect cash.</Text>
          )}
          {trip.requires.proofPhoto ? (
            <Button
              title={proof ? 'Photo added ✓' : 'Take delivery photo'}
              variant="secondary"
              onPress={takeProof}
            />
          ) : null}
          <Button
            title="Delivered"
            busy={busy}
            disabled={
              (trip.requires.deliveryCode && code.length !== 4) ||
              (cash > 0 && !cashOk) ||
              (trip.requires.proofPhoto && !proof)
            }
            onPress={() =>
              step('delivered', {
                ...(code ? { otp: code } : {}),
                ...(cash ? { codCollectedPaise: cash } : {}),
                ...(proof ? { proofMediaId: proof } : {}),
              })
            }
          />
        </>
      ) : null}

      {asking === 'issue' ? (
        <>
          <Text variant="heading">What happened?</Text>
          {[
            ['ACCIDENT', 'Accident'],
            ['FOOD_DAMAGED', 'Food damaged'],
            ['CUSTOMER_UNREACHABLE', 'Cannot reach the customer'],
            ['RESTAURANT_DELAY', 'Restaurant is very late'],
            ['OTHER', 'Something else'],
          ].map(([kind, label]) => (
            <Button
              key={kind}
              title={label}
              variant="secondary"
              busy={busy}
              onPress={() => step('issue', { kind })}
            />
          ))}
        </>
      ) : null}
      {asking === 'handback' ? (
        <>
          <Text>Jamzo will find another delivery partner.</Text>
          <Button
            title="Yes, hand back this order"
            variant="secondary"
            busy={busy}
            onPress={() => step('unassign', { reason: 'Rider handed the order back' })}
          />
        </>
      ) : null}
      <Button
        title="Report a problem"
        variant="secondary"
        onPress={() => setAsking(asking === 'issue' ? null : 'issue')}
      />
      {toRestaurant ? (
        <Button
          title="I can't do this delivery"
          variant="secondary"
          onPress={() => setAsking(asking === 'handback' ? null : 'handback')}
        />
      ) : null}
      <Text variant="small">{`You earn about ${money(trip.estimatedEarningPaise)} for this trip.`}</Text>
    </Card>
  );
}
