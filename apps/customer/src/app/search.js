import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  LoadingState,
  Screen,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { CartBar, DishRow, RestaurantCard } from '../components/bits';
import { notServedLabel } from '../lib/format';
import { useLocation } from '../lib/location';
import { useSearch } from '../lib/queries';

export default function Search() {
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams();
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '');
  const { place } = useLocation();
  const res = useSearch(q, place);
  return (
    <View style={{ flex: 1 }}>
      <Screen
        header={
          <Header>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                height: 44,
                borderRadius: 22,
                paddingHorizontal: 14,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.border,
              }}
            >
              <Icon name="search" size={18} color={t.colors.action} />
              <TextInput
                accessibilityLabel="Search"
                placeholder="Search dishes or restaurants"
                placeholderTextColor={t.colors.textSubtle}
                value={q}
                onChangeText={setQ}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, fontFamily: t.fonts.regular, fontSize: 16, color: t.colors.text }}
              />
              {q ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setQ('')}
                >
                  <Icon name="close-circle" size={18} color={t.colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>
          </Header>
        }
      >
        {q.trim().length < 2 ? (
          <Text variant="muted">Type at least 2 letters: a dish like “dosa”, or a restaurant name.</Text>
        ) : null}
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
              <View style={{ gap: 12 }}>
                <Text variant="heading">Restaurants</Text>
                {res.data.restaurants.map((r) => (
                  <RestaurantCard key={r.id} r={r} />
                ))}
              </View>
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
