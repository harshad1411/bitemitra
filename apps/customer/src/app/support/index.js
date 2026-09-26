// Your conversations with Jamzo support (D-93).
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Button, EmptyState, ErrorState, Header, LoadingState, Screen } from '@jamzo/mobile-ui';

export default function Tickets() {
  const router = useRouter();
  const { api } = useJamzo();
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api.get('/v1/customer/support/tickets') });
  if (q.isPending) return <LoadingState label="Loading" />;
  if (q.isError)
    return (
      <Screen header={<Header title="Help" />}>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  return (
    <Screen header={<Header title="Help" />}>
      {q.data.items.length ? (
        q.data.items.map((t) => (
          <Button
            key={t.id}
            variant="secondary"
            title={`${t.subject} · ${t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'resolved' : 'open'}`}
            onPress={() => router.push(`/support/${t.id}`)}
          />
        ))
      ) : (
        <EmptyState title="No questions yet" message="For help with an order, open it and choose Get help." />
      )}
      <Button title="Ask about something else" onPress={() => router.push('/support/new')} />
    </Screen>
  );
}
