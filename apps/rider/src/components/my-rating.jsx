// The partner's own delivery rating (D-110): average and count only — no comments, no customer details.
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Card, Stars, Text } from '@jamzo/mobile-ui';

export function MyRating() {
  const { api } = useJamzo();
  const q = useQuery({ queryKey: ['rider-rating'], queryFn: () => api.get('/v1/rider/ratings') });
  const r = q.data?.rating;
  if (!r) return null;
  return (
    <Card>
      <Text variant="subheading">Your rating from customers</Text>
      {r.count ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text variant="title">{r.average.toFixed(1)}</Text>
          <Stars value={Math.round(r.average)} size={18} />
          <Text variant="small">{`${r.count} rating${r.count === 1 ? '' : 's'}`}</Text>
        </View>
      ) : (
        <Text variant="muted">No ratings yet. Customers can rate the delivery after each order.</Text>
      )}
    </Card>
  );
}
