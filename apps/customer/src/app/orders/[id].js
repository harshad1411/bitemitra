// Order tracking: the current status, "Pay now" while an online payment is open (D-84), refunds, a timeline,
// the bill and — while allowed — a cancel button. Refreshed by realtime notices and by polling (D-62).
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo, useRealtime, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { VegMark } from '../../components/bits';
import { arrivalLabel, mapPinUrl, money } from '../../lib/format';
import { CANCEL_REASONS, REFUND_TEXT, TIMELINE_LABEL, statusText } from '../../lib/order-status';
import { payOnline } from '../../lib/pay';
import { useOrder } from '../../lib/queries';

const VEHICLE = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  EV_SCOOTER: 'Electric scooter',
  BICYCLE: 'Bicycle',
  CAR: 'Car',
};
const time = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function OrderScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { api, env } = useJamzo();
  const q = useOrder(id);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useRealtime({
    onOrderUpdated: (m) => {
      if (m.orderId === id) qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  if (q.isPending) return <LoadingState label="Loading your order" />;
  if (q.isError)
    return (
      <Screen>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const o = q.data;
  const s = statusText(o);
  const cancel = async (reasonCode) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(
        ['order', id],
        await api.post(`/v1/customer/orders/${id}/cancel`, { reasonCode }, { idempotencyKey: false }),
      );
      setAsking(false);
    } catch (err) {
      setError(userMessage(err));
      q.refetch();
    } finally {
      setBusy(false);
    }
  };
  const payNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await payOnline({ api, apiUrl: env.apiUrl, orderId: id, payment: o.onlinePayment });
      if (v.orderStatus === 'PAYMENT_PENDING' && v.payment?.lastError) setError(v.payment.lastError);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
      q.refetch();
    }
  };
  return (
    <Screen>
      <Text variant="small">{o.orderNumber}</Text>
      <Text variant="title" accessibilityRole="header">
        {s.title}
      </Text>
      <Text variant="muted">{s.text}</Text>
      {error ? <Banner tone="critical">{error}</Banner> : null}

      {o.status === 'PAYMENT_PENDING' ? (
        <Card>
          <Text variant="heading">{`Pay ${money(o.totalPayablePaise)}`}</Text>
          {o.onlinePayment?.lastError && !error ? (
            <Banner tone="warning">{`Last try: ${o.onlinePayment.lastError}. You can try again.`}</Banner>
          ) : null}
          {o.onlinePayment?.expiresAt ? (
            <Text variant="small">{`Complete the payment by ${time(o.onlinePayment.expiresAt)}.`}</Text>
          ) : null}
          <Button title="Pay now" busy={busy} disabled={busy} onPress={payNow} />
        </Card>
      ) : null}

      {o.refunds?.length ? (
        <Card>
          <Text variant="heading">Refunds</Text>
          {o.refunds.map((r) => (
            <Text key={r.id}>{`${money(r.amountPaise)} — ${REFUND_TEXT[r.status] ?? r.status}${
              r.status === 'SUCCEEDED' && r.toGateway ? ' (banks usually take 5–7 working days)' : ''
            }`}</Text>
          ))}
        </Card>
      ) : null}

      {o.delivery?.rider ? (
        <Card>
          <Text variant="heading">{`${o.delivery.rider.firstName}${o.delivery.rider.vehicle ? ` · ${VEHICLE[o.delivery.rider.vehicle] ?? ''}` : ''}`}</Text>
          {o.delivery.code ? (
            <Banner tone="info">{`Share this delivery code with ${o.delivery.rider.firstName} at the door: ${o.delivery.code}`}</Banner>
          ) : null}
          {o.delivery.eta ? <Text>{arrivalLabel(o.delivery.eta)}</Text> : null}
          {o.delivery.rider.position ? (
            <>
              <Text variant="small">{`Location updated ${time(o.delivery.rider.position.at)}`}</Text>
              <Button
                title="See on map"
                variant="secondary"
                onPress={() => Linking.openURL(mapPinUrl(o.delivery.rider.position))}
              />
            </>
          ) : null}
          {o.delivery.contact?.phone ? (
            <Button
              title="Call your delivery partner (via Jamzo support)"
              variant="secondary"
              onPress={() => Linking.openURL(`tel:${o.delivery.contact.phone}`)}
            />
          ) : null}
          <Text variant="small">A live map inside the app follows once maps are switched on.</Text>
        </Card>
      ) : null}

      {!['CREATED', 'PAYMENT_PENDING'].includes(o.status) ? (
        <Button
          title="Get help with this order"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/support/new', params: { orderId: o.id, orderNumber: o.orderNumber } })
          }
        />
      ) : null}

      <Card>
        <Text variant="heading">Progress</Text>
        {o.timeline.map((t, i) => (
          <View key={`${t.status}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>{TIMELINE_LABEL[t.status] ?? t.status}</Text>
            <Text variant="small">{time(t.at)}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text variant="heading">{o.restaurant.name}</Text>
        {o.items.map((it, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <VegMark type={it.foodType} />
            <Text style={{ flex: 1 }}>
              {`${it.quantity} × ${it.name}${it.variantName ? ` (${it.variantName})` : ''}${it.addons.length ? ` · ${it.addons.join(', ')}` : ''}`}
            </Text>
            <Text>{money(it.lineTotalPaise)}</Text>
          </View>
        ))}
        {o.restaurantInstructions ? <Text variant="small">{`Note: ${o.restaurantInstructions}`}</Text> : null}
      </Card>

      <Card>
        <Text variant="heading">Bill</Text>
        {o.bill?.lines.map((b) => (
          <View key={b.code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>{b.label}</Text>
            <Text>{money(b.amountPaise)}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '700' }}>{o.payment.method === 'COD' ? 'Pay in cash' : 'Paid'}</Text>
          <Text style={{ fontWeight: '700' }}>{money(o.totalPayablePaise)}</Text>
        </View>
        {o.address ? (
          <Text variant="small">{`Delivering to ${[o.address.label, o.address.line1].filter(Boolean).join(', ')}`}</Text>
        ) : null}
      </Card>

      {o.canCancel ? (
        asking ? (
          <Card>
            {o.cancelTerms?.noRefundAfterAccept ? (
              <Banner tone="warning">
                {[
                  `${o.restaurant.name} has already accepted your order.`,
                  o.payment.method === 'COD'
                    ? 'You will not be charged, but Jamzo pays the restaurant for the food.'
                    : `You will not get a refund${o.cancelTerms.keptPaise ? ` of ${money(o.cancelTerms.keptPaise)}` : ''}.`,
                  o.cancelTerms.codCancellation
                    ? `After ${o.cancelTerms.codCancellation.limit} cancellations like this, cash on delivery is switched off for your account (this would be ${o.cancelTerms.codCancellation.used + 1} of ${o.cancelTerms.codCancellation.limit}).`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Banner>
            ) : null}
            <Text variant="heading">Why are you cancelling?</Text>
            {CANCEL_REASONS.map(([code, label]) => (
              <Button key={code} title={label} variant="secondary" busy={busy} onPress={() => cancel(code)} />
            ))}
            <Button title="Keep my order" onPress={() => setAsking(false)} />
          </Card>
        ) : (
          <Button title="Cancel order" variant="secondary" onPress={() => setAsking(true)} />
        )
      ) : null}
      <Button title="All orders" variant="secondary" onPress={() => router.push('/orders')} />
    </Screen>
  );
}
