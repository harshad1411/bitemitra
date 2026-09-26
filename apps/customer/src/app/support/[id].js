// A conversation with Jamzo support (D-93). The customer sees support's replies — never internal notes.
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ISSUES } from './new';

const STATUS = {
  OPEN: ['Waiting for Jamzo', 'warning'],
  IN_PROGRESS: ['Jamzo is looking into it', 'info'],
  WAITING_ON_CUSTOMER: ['Jamzo replied', 'info'],
  RESOLVED: ['Resolved', 'success'],
  CLOSED: ['Closed', 'neutral'],
};
const when = (d) =>
  new Date(d).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

export default function Ticket() {
  const { id } = useLocalSearchParams();
  const { api } = useJamzo();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get(`/v1/customer/support/tickets/${id}`),
    refetchInterval: 30_000,
  });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (q.isPending) return <LoadingState label="Loading your conversation" />;
  if (q.isError)
    return (
      <Screen header={<Header title="Help" />}>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const t = q.data;
  const [label, tone] = STATUS[t.status];
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(
        ['ticket', id],
        await api.post(
          `/v1/customer/support/tickets/${id}/messages`,
          { body: body.trim() },
          { idempotencyKey: false },
        ),
      );
      setBody('');
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={<Header title="Help" subtitle={t.ticketNumber} />}>
      <Text variant="title" accessibilityRole="header">
        {ISSUES.find(([c]) => c === t.issueType)?.[1] ?? 'Help'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Badge tone={tone}>{label}</Badge>
        {t.orderNumber ? <Text variant="small">{`Order ${t.orderNumber}`}</Text> : null}
      </View>
      {t.messages.map((m) => (
        <Card key={m.id}>
          <Text variant="small">{`${m.from === 'YOU' ? 'You' : 'Jamzo support'} · ${when(m.createdAt)}`}</Text>
          <Text>{m.body}</Text>
        </Card>
      ))}
      {t.resolution && t.status !== 'OPEN' ? (
        <Banner tone="success">{`Resolved: ${t.resolution}`}</Banner>
      ) : null}
      {t.status === 'CLOSED' ? (
        <Text variant="muted">
          This conversation is closed. For something new, use Get help on the order.
        </Text>
      ) : (
        <>
          <TextField
            label="Write to Jamzo support"
            value={body}
            onChangeText={setBody}
            maxLength={2000}
            multiline
          />
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <Button title="Send" busy={busy} disabled={!body.trim() || busy} onPress={send} />
        </>
      )}
    </Screen>
  );
}
