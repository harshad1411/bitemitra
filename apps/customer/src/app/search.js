import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '@jamzo/mobile-ui';
import { CartBar, DishRow, RestaurantCard } from '../components/bits';
import { notServedLabel } from '../lib/format';
import { useLocation } from '../lib/location';
import { useSearch } from '../lib/queries';

export default function Search() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '');
  const { place } = useLocation();
  const res = useSearch(q, place);
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <TextField
          label="Search"
          placeholder="Dosa, pizza, thali…"
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCorrect={false}
        />
        {!place ? <Banner tone="info">Choose a delivery location first.</Banner> : null}
        {q.trim().length < 2 ? null : res.isPending ? (
          <LoadingState label="Searching" />
        ) : res.isError ? (
          <ErrorState message={userMessage(res.error)} onRetry={() => res.refetch()} />
        ) : !res.data.serviceable ? (
          <Banner tone="warning">{notServedLabel(res.data.reason)}</Banner>
        ) : !res.data.restaurants.length && !res.data.dishes.length ? (
          <EmptyState title="Nothing found" message="Try another dish or cuisine." />
        ) : (
          <>
            {res.data.restaurants.length ? (
              <Card>
                <Text variant="heading">Restaurants</Text>
                {res.data.restaurants.map((r) => (
                  <RestaurantCard key={r.id} r={r} />
                ))}
              </Card>
            ) : null}
            {res.data.dishes.length ? (
              <Card>
                <Text variant="heading">Dishes</Text>
                {res.data.dishes.map((d) => (
                  <DishRow key={d.id} d={d} onPress={() => router.push(`/restaurant/${d.restaurant.id}`)} />
                ))}
              </Card>
            ) : null}
          </>
        )}
      </Screen>
      <CartBar />
    </View>
  );
}
