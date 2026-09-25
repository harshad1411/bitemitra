// Earnings (D-78): today or this week, per trip, with tips shown separately. Only the rider's own money.
import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { money, time } from '../lib/format';

export default function Earnings() {
  const { api } = useJamzo();
  const [range, setRange] = useState('TODAY');
  const q = useQuery({
    queryKey: ['earnings', range],
    queryFn: () => api.get('/v1/rider/earnings', { range }),
  });
  return (
    <Screen>
      <Text variant="title">Earnings</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="Today"
          variant={range === 'TODAY' ? 'primary' : 'secondary'}
          onPress={() => setRange('TODAY')}
        />
        <Button
          title="This week"
          variant={range === 'WEEK' ? 'primary' : 'secondary'}
          onPress={() => setRange('WEEK')}
        />
      </View>
      {q.isPending ? (
        <LoadingState label="Loading earnings" />
      ) : q.isError ? (
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Card>
            <Text variant="title">{money(q.data.totalPaise)}</Text>
            <Text>{`${q.data.deliveries} deliveries · tips ${money(q.data.tipsPaise)}`}</Text>
            <Text variant="small">{q.data.note}</Text>
          </Card>
          {!q.data.items.length ? (
            <EmptyState title="No trips yet" message="Your trips will appear here." />
          ) : null}
          {q.data.items.map((e, i) => (
            <Card key={i}>
              <Text variant="heading">{`${money(e.totalPaise)} · ${e.orderNumber ?? ''}`}</Text>
              <Text variant="small">
                {e.kind === 'CANCELLED_TRIP'
                  ? 'Cancelled after you accepted — paid by Jamzo'
                  : `Trip ${money(e.breakdown.tripPaise)} · tip ${money(e.breakdown.tipPaise)}${e.breakdown.waitingPaise ? ` · waiting ${money(e.breakdown.waitingPaise)}` : ''}`}
              </Text>
              <Text variant="small">{time(e.at)}</Text>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
