// Home: the CMS-driven sections for the customer's location (D-56). Nothing here is hard-coded per city.
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { CartBar, DishRow, RestaurantCard, useMediaUrl } from '../components/bits';
import { notServedLabel } from '../lib/format';
import { useLocation } from '../lib/location';
import { TERMINAL, useHome, useOrders } from '../lib/queries';
import { TIMELINE_LABEL } from '../lib/order-status';

function Section({ s }) {
  const router = useRouter();
  const t = useTheme();
  const url = useMediaUrl();
  const title = s.title ? <Text variant="heading">{s.title}</Text> : null;
  if (s.type === 'BANNER_CAROUSEL')
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.spacing[3] }}
      >
        {s.banners.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            accessibilityLabel={b.title ?? 'Offer'}
            onPress={() => b.deepLink?.startsWith('/') && router.push(b.deepLink)}
          >
            <Image
              source={{ uri: url(b.image, 'medium') }}
              style={{ width: 280, height: 140, borderRadius: t.radius.lg }}
            />
          </Pressable>
        ))}
      </ScrollView>
    );
  if (s.type === 'CATEGORIES')
    return (
      <View style={{ gap: t.spacing[2] }}>
        {title}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: t.spacing[2] }}
        >
          {s.categories.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => router.push({ pathname: '/search', params: { q: c.name } })}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: t.colors.surface,
              }}
            >
              <Text>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  if (s.restaurants)
    return (
      <Card>
        {title}
        {s.restaurants.map((r) => (
          <RestaurantCard key={r.id} r={r} />
        ))}
      </Card>
    );
  if (s.dishes)
    return (
      <Card>
        {title}
        {s.dishes.map((d) => (
          <DishRow key={d.id} d={d} onPress={() => router.push(`/restaurant/${d.restaurant.id}`)} />
        ))}
      </Card>
    );
  if (s.type === 'IMAGE_PROMO')
    return (
      <Image
        accessibilityLabel={s.title ?? 'Promotion'}
        source={{ uri: url(s.image, 'medium') }}
        style={{ width: '100%', height: 160, borderRadius: t.radius.lg }}
      />
    );
  if (s.type === 'TEXT')
    return (
      <Card>
        {title}
        {s.subtitle ? <Text variant="muted">{s.subtitle}</Text> : null}
      </Card>
    );
  return null;
}

export default function Home() {
  const router = useRouter();
  const t = useTheme();
  const { place, ready } = useLocation();
  const home = useHome(place);
  const { session } = useJamzo();
  const orders = useOrders(session.status === 'signedIn');
  const active = orders.data?.items.find((o) => !TERMINAL.includes(o.status));
  if (!ready) return <LoadingState label="Loading" />;
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change delivery location"
          onPress={() => router.push('/location')}
        >
          <Text variant="small">Delivering to</Text>
          <Text variant="heading">{place ? `${place.label} ▾` : 'Choose your location ▾'}</Text>
        </Pressable>
        {active ? (
          <Card>
            <Text variant="heading">{`Your order from ${active.restaurant.name}`}</Text>
            <Text variant="muted">{TIMELINE_LABEL[active.status] ?? active.status}</Text>
            <Button title="Track order" onPress={() => router.push(`/orders/${active.id}`)} />
          </Card>
        ) : null}
        <View style={{ flexDirection: 'row', gap: t.spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Search dishes & restaurants"
              variant="secondary"
              onPress={() => router.push('/search')}
            />
          </View>
          <Button title="Account" variant="secondary" onPress={() => router.push('/account')} />
        </View>
        {!place ? (
          <EmptyState
            title={`Welcome to ${MOBILE_APPS.CUSTOMER.displayName}`}
            message="Tell us where to deliver to see restaurants near you."
            action={<Button title="Choose location" onPress={() => router.push('/location')} />}
          />
        ) : home.isPending ? (
          <LoadingState label="Finding restaurants near you" />
        ) : home.isError ? (
          <ErrorState message={userMessage(home.error)} onRetry={() => home.refetch()} />
        ) : !home.data.serviceable ? (
          <Banner tone="warning">{notServedLabel(home.data.reason)}</Banner>
        ) : !home.data.restaurantCount ? (
          <EmptyState title="No restaurants deliver here yet" message="Try another address nearby." />
        ) : (
          home.data.sections.map((s) => <Section key={s.id} s={s} />)
        )}
      </Screen>
      <CartBar />
    </View>
  );
}
