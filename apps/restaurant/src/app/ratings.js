// Ratings (D-110): the restaurant's average, the star spread and recent reviews with item stars and
// comments. No customer names or phone numbers; hidden reviews are left out.
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  Stars,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { useResource } from '../lib/use-resource';

const day = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function Spread({ spread, count }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {[5, 4, 3, 2, 1].map((n) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="small" style={{ width: 24 }}>{`${n}★`}</Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceMuted }}>
            <View
              style={{
                width: `${count ? Math.round((spread[n] / count) * 100) : 0}%`,
                height: 8,
                borderRadius: 4,
                backgroundColor: t.colors.accent,
              }}
            />
          </View>
          <Text variant="small" style={{ width: 28, textAlign: 'right' }}>
            {String(spread[n])}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function Ratings() {
  const { restaurantId } = useLocalSearchParams();
  const { api } = useJamzo();
  const q = useResource(() => api.get('/v1/restaurant/reviews', { restaurantId }), [restaurantId]);
  const d = q.data;
  return (
    <Screen header={<Header title="Ratings" />}>
      {q.status === 'loading' ? (
        <LoadingState label="Loading ratings" />
      ) : !d ? (
        <ErrorState message={userMessage(q.error)} onRetry={q.reload} />
      ) : !d.rating.count ? (
        <EmptyState
          title="No ratings yet"
          message="Customers can rate an order after it is delivered. Your stars show to customers from 5 ratings."
        />
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text variant="title" style={{ fontSize: 34, lineHeight: 42 }}>
                {d.rating.average.toFixed(1)}
              </Text>
              <View>
                <Stars value={Math.round(d.rating.average)} size={18} />
                <Text variant="small">{`${d.rating.count} rating${d.rating.count === 1 ? '' : 's'}`}</Text>
              </View>
            </View>
            <Spread spread={d.spread} count={d.rating.count} />
          </Card>
          <Text variant="heading">Recent reviews</Text>
          {d.items.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Stars value={Math.round(r.foodRating)} size={16} />
                <Text variant="small" style={{ flex: 1, textAlign: 'right' }}>
                  {`${day(r.createdAt)} · ${r.orderNumber}`}
                </Text>
              </View>
              {r.items.map((i) => (
                <Text key={i.name} variant="small">{`${i.name}: ${i.rating}★`}</Text>
              ))}
              {r.comment ? <Text>{`“${r.comment}”`}</Text> : null}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
