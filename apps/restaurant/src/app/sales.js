// Sales (spec §45, D-96), owners and managers: the restaurant's own orders, sales at its own prices, what was
// deducted, top items and busy hours. Never Jamzo's margins.
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatPaise } from '@jamzo/ui';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Button, Card, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { useResource } from '../lib/use-resource';

const RANGES = [
  ['TODAY', 'Today'],
  ['WEEK', 'This week'],
  ['MONTH', 'This month'],
];
const hour = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;

function Row({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

export default function Sales() {
  const { restaurantId } = useLocalSearchParams();
  const { api } = useJamzo();
  const [range, setRange] = useState('WEEK');
  const q = useResource(
    () => api.get('/v1/restaurant/analytics', { restaurantId, range }),
    [restaurantId, range],
  );
  const a = q.data;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Sales
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {RANGES.map(([v, l]) => (
          <Button
            key={v}
            title={l}
            variant={range === v ? 'primary' : 'secondary'}
            onPress={() => setRange(v)}
          />
        ))}
      </View>
      {q.status === 'loading' ? (
        <LoadingState label="Loading sales" />
      ) : !a ? (
        <ErrorState message={userMessage(q.error)} onRetry={q.reload} />
      ) : (
        <>
          <Card>
            <Text variant="heading">{`${formatPaise(a.salesPaise)} from ${a.delivered} delivered orders`}</Text>
            <Row label="Orders received" value={String(a.orders)} />
            <Row label="Cancelled" value={String(a.cancelled)} />
            <Row
              label="Average order"
              value={a.averageOrderValuePaise == null ? '—' : formatPaise(a.averageOrderValuePaise)}
            />
            <Row label="Commission and tax" value={`− ${formatPaise(a.commissionPaise)}`} />
            <Row label="Your discounts" value={`− ${formatPaise(a.discountsPaise)}`} />
            <Row label="Net for you" value={formatPaise(a.netPaise)} />
          </Card>
          <Card>
            <Text variant="heading">Top items</Text>
            {a.topItems.length ? (
              a.topItems.map((i) => <Row key={i.name} label={i.name} value={`${i.quantity} sold`} />)
            ) : (
              <Text variant="muted">No delivered orders yet.</Text>
            )}
          </Card>
          <Card>
            <Text variant="heading">Busiest hours</Text>
            {a.busyHours.length ? (
              a.busyHours.map((h) => (
                <Row
                  key={h.hour}
                  label={`${hour(h.hour)} – ${hour((h.hour + 1) % 24)}`}
                  value={`${h.count} orders`}
                />
              ))
            ) : (
              <Text variant="muted">No orders yet.</Text>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
