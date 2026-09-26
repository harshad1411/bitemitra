// One order in full: items and choices, notes, payment, and — for owners and managers — the money (D-67:
// restaurant prices, restaurant-funded discount, commission and net payable; never platform margins).
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
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
} from '@jamzo/mobile-ui';
import { formatPaise } from '@jamzo/ui';
import { CANCEL_REASONS, KITCHEN_LABEL, itemLine, riderLine, timeText } from '../../lib/orders';
import { useResource } from '../../lib/use-resource';

const Row = ({ label, value, strong }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    <Text style={strong ? { fontWeight: '700' } : undefined}>{label}</Text>
    <Text style={strong ? { fontWeight: '700' } : undefined}>{value}</Text>
  </View>
);

export default function OrderDetail() {
  const { id, timeZone = 'Asia/Kolkata' } = useLocalSearchParams();
  const { api } = useJamzo();
  const o = useResource(() => api.get(`/v1/restaurant/orders/${id}`), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (o.status === 'loading') return <LoadingState label="Loading the order" />;
  if (o.status === 'error' && !o.data)
    return (
      <Screen header={<Header title="Order" />}>
        <ErrorState message={userMessage(o.error)} onRetry={o.reload} />
      </Screen>
    );
  const d = o.data;
  const f = d.finance;
  const cancel = async (reasonCode) => {
    setBusy(true);
    setError(null);
    try {
      o.setData(
        await api.post(
          `/v1/restaurant/orders/${id}/cancel`,
          { reasonCode, version: d.version },
          { idempotencyKey: false },
        ),
      );
      setCancelling(false);
    } catch (err) {
      setError(userMessage(err));
      o.reload();
    } finally {
      setBusy(false);
    }
  };
  const canCancel = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(d.restaurantStatus);
  return (
    <Screen header={<Header title={`Order #${d.shortNumber}`} />}>
      <Text variant="small">{d.orderNumber}</Text>
      <Badge tone="info">{KITCHEN_LABEL[d.restaurantStatus]}</Badge>
      {d.rider ? <Banner tone={d.rider.atRestaurant ? 'success' : 'info'}>{riderLine(d)}</Banner> : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Card>
        <Text variant="heading">{d.customer.firstName}</Text>
        {d.items.map((i, n) => (
          <Row key={n} label={itemLine(i)} value={formatPaise(i.lineTotalPaise)} />
        ))}
        {d.restaurantInstructions ? <Banner tone="info">{`Note: ${d.restaurantInstructions}`}</Banner> : null}
        <Text variant="small">{d.payment.label}</Text>
        {d.placedAt ? <Text variant="small">{`Placed ${timeText(d.placedAt, timeZone)}`}</Text> : null}
        {d.estimatedPickupAt ? (
          <Text variant="small">{`Ready by ${timeText(d.estimatedPickupAt, timeZone)}`}</Text>
        ) : null}
      </Card>
      {f ? (
        <Card>
          <Text variant="heading">Your earnings (estimate)</Text>
          <Row label="Food value" value={formatPaise(f.foodValuePaise)} />
          <Row label="Discount you fund" value={`−${formatPaise(f.restaurantFundedDiscountPaise)}`} />
          <Row label="Packaging" value={formatPaise(f.packagingPaise)} />
          <Row label="Jamzo commission" value={`−${formatPaise(f.commissionPaise)}`} />
          <Row label="Tax on commission" value={`−${formatPaise(f.commissionTaxPaise)}`} />
          {f.withholdingPaise ? (
            <Row label="Tax withheld (TCS/TDS)" value={`−${formatPaise(f.withholdingPaise)}`} />
          ) : null}
          <Row label="You receive" value={formatPaise(f.netPayablePaise)} strong />
          <Text variant="small">Final amounts appear in your settlement statement.</Text>
        </Card>
      ) : null}
      {d.cancellation ? (
        <Banner tone="warning">{`Cancelled: ${d.cancellation.reasonCode.replace(/_/g, ' ').toLowerCase()}`}</Banner>
      ) : null}
      {canCancel && f ? (
        cancelling ? (
          <Card>
            <Text variant="heading">Why are you cancelling?</Text>
            {CANCEL_REASONS.map(([code, label]) => (
              <Button key={code} title={label} variant="secondary" busy={busy} onPress={() => cancel(code)} />
            ))}
            <Button title="Keep the order" onPress={() => setCancelling(false)} />
          </Card>
        ) : (
          <Button title="Cancel this order" variant="secondary" onPress={() => setCancelling(true)} />
        )
      ) : null}
    </Screen>
  );
}
