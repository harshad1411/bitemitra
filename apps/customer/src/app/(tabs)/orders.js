// The customer's orders, newest first.
import { useRouter } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { money } from '../../lib/format';
import { TIMELINE_LABEL } from '../../lib/order-status';
import { TERMINAL, useOrders } from '../../lib/queries';

export default function Orders() {
  const router = useRouter();
  const { session } = useJamzo();
  const signedIn = session.status === 'signedIn';
  const q = useOrders(signedIn);
  if (!signedIn)
    return (
      <Screen>
        <EmptyState
          title="Your orders"
          message="Sign in to see your orders."
          action={<Button title="Sign in" onPress={() => router.push('/sign-in')} />}
        />
      </Screen>
    );
  if (q.isPending) return <LoadingState label="Loading your orders" />;
  if (q.isError)
    return (
      <Screen>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  return (
    <Screen>
      <Text variant="title">Your orders</Text>
      {!q.data.items.length ? (
        <EmptyState title="No orders yet" message="Your orders will appear here." />
      ) : null}
      {q.data.items.map((o) => (
        <Card key={o.id}>
          <Text variant="heading">{o.restaurant.name}</Text>
          <Text variant="small">{`${o.orderNumber} · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'} · ${money(o.totalPayablePaise)}`}</Text>
          <Badge
            tone={TERMINAL.includes(o.status) ? (o.status === 'DELIVERED' ? 'success' : 'neutral') : 'accent'}
          >
            {TIMELINE_LABEL[o.status] ?? o.status}
          </Badge>
          {o.canReview ? (
            <Button
              title="Rate this order"
              icon="star"
              accessibilityHint={o.orderNumber}
              onPress={() => router.push(`/orders/${o.id}`)}
            />
          ) : null}
          <Button
            title="View order"
            variant="secondary"
            accessibilityHint={o.orderNumber}
            onPress={() => router.push(`/orders/${o.id}`)}
          />
        </Card>
      ))}
    </Screen>
  );
}
