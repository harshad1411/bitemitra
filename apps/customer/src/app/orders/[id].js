// Order tracking: the current status, a timeline, the bill and — while the restaurant has not accepted yet —
// a cancel button. Refreshed by realtime notices and by polling (D-62).
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo, useRealtime, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { VegMark } from '../../components/bits';
import { money } from '../../lib/format';
import { CANCEL_REASONS, TIMELINE_LABEL, statusText } from '../../lib/order-status';
import { useOrder } from '../../lib/queries';

const time = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function OrderScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { api } = useJamzo();
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
  return (
    <Screen>
      <Text variant="small">{o.orderNumber}</Text>
      <Text variant="title" accessibilityRole="header">
        {s.title}
      </Text>
      <Text variant="muted">{s.text}</Text>
      {error ? <Banner tone="critical">{error}</Banner> : null}

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
