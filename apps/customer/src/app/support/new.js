// "Get help" (D-93, spec §47): what went wrong with this order, in the customer's own words. A second request
// about the same order and issue continues the open conversation.
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, Header, Screen, Text, TextField } from '@jamzo/mobile-ui';
import { Option } from '../../components/option';

export const ISSUES = [
  ['MISSING_ITEM', 'Something is missing'],
  ['WRONG_ITEM', 'I got the wrong item'],
  ['FOOD_QUALITY', 'Food quality'],
  ['LATE_DELIVERY', 'Late delivery'],
  ['RIDER_ISSUE', 'The delivery partner'],
  ['RESTAURANT_ISSUE', 'The restaurant'],
  ['PAYMENT_ISSUE', 'Payment'],
  ['REFUND_ISSUE', 'Refund'],
  ['OTHER', 'Something else'],
];

export default function NewTicket() {
  const { orderId, orderNumber } = useLocalSearchParams();
  const router = useRouter();
  const { api } = useJamzo();
  const [issue, setIssue] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.post(
        '/v1/customer/support/tickets',
        { orderId: orderId ?? null, issueType: issue, message: message.trim() },
        { idempotencyKey: false },
      );
      router.replace(`/support/${t.id}`);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={<Header title="Get help" />}>
      {orderNumber ? <Text variant="muted">{`Order ${orderNumber}`}</Text> : null}
      <Card>
        <Text variant="heading">What went wrong?</Text>
        {ISSUES.map(([code, label]) => (
          <Option key={code} label={label} selected={issue === code} onPress={() => setIssue(code)} />
        ))}
      </Card>
      <TextField
        label="Tell us more"
        value={message}
        onChangeText={setMessage}
        maxLength={2000}
        multiline
        placeholder="e.g. the garlic dip was missing"
      />
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Button
        title="Send to Jamzo support"
        busy={busy}
        disabled={!issue || message.trim().length < 3 || busy}
        onPress={send}
      />
    </Screen>
  );
}
