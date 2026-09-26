// "Rate your order" (D-110): stars for each item and for the delivery partner, and an optional comment.
// Customers never see other people's comments; the comment goes to the restaurant and Jamzo.
import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, SectionTitle, Stars, Text, TextField, useTheme } from '@jamzo/mobile-ui';
import { VegMark } from './bits';

const day = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function RateOrder({ order }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { api } = useJamzo();
  const r = order.review;
  const [items, setItems] = useState({});
  const [delivery, setDelivery] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!r) return null;

  if (r.given) {
    const stars = new Map(r.given.items.map((i) => [i.orderItemId, i.rating]));
    return (
      <Card>
        <SectionTitle>Your rating</SectionTitle>
        {order.items
          .filter((i) => stars.has(i.id))
          .map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1 }}>{i.name}</Text>
              <Stars value={stars.get(i.id)} size={16} />
            </View>
          ))}
        {r.given.deliveryRating ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1 }}>Delivery</Text>
            <Stars value={r.given.deliveryRating} size={16} />
          </View>
        ) : null}
        {r.given.comment ? <Text variant="muted">{`“${r.given.comment}”`}</Text> : null}
        <Text variant="small">Thank you. Your rating helps others choose.</Text>
      </Card>
    );
  }
  if (!r.canReview) return null;

  const rated = Object.entries(items).filter(([, v]) => v > 0);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/v1/customer/orders/${order.id}/review`,
        {
          items: rated.map(([orderItemId, rating]) => ({ orderItemId, rating })),
          ...(delivery ? { deliveryRating: delivery } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
        { idempotencyKey: false },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['order', order.id] }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionTitle>Rate your order</SectionTitle>
      <Text variant="small">{`How was the food? You can rate until ${day(r.deadline)}.`}</Text>
      {order.items.map((i) => (
        <View key={i.id} style={{ gap: 2, paddingVertical: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <VegMark type={i.foodType} size={12} />
            <Text variant="strong" style={{ flexShrink: 1 }}>
              {i.name}
            </Text>
          </View>
          <Stars
            label={i.name}
            value={items[i.id] ?? 0}
            onChange={(v) => setItems((s) => ({ ...s, [i.id]: v }))}
          />
        </View>
      ))}
      {r.ratesDelivery ? (
        <View style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border }}>
          <Text variant="strong">Your delivery partner</Text>
          <Stars label="Delivery" value={delivery} onChange={setDelivery} />
        </View>
      ) : null}
      <TextField
        label="Anything to add? (optional)"
        value={comment}
        onChangeText={setComment}
        maxLength={500}
        multiline
        placeholder="Only the restaurant and Jamzo see this"
      />
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Button
        title="Submit rating"
        busy={busy}
        disabled={!rated.length}
        accessibilityHint={!rated.length ? 'Rate at least one item' : undefined}
        onPress={submit}
      />
    </Card>
  );
}
