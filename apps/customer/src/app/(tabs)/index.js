// Home: the CMS-driven sections for the customer's location (D-56), in the food-app layout (D-109).
// Nothing here is hard-coded per city.
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { CartBar, DishRow, RestaurantCard, useMediaUrl } from '../../components/bits';
import { notServedLabel } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { TERMINAL, useHome, useOrders } from '../../lib/queries';
import { TIMELINE_LABEL } from '../../lib/order-status';

const LOGO = require('../../../assets/logo-on-dark.png');

/** Until categories have photos (uploaded in Jamzo Admin), an icon per food category. */
const CATEGORY_ICON = {
  thali: 'restaurant',
  gujarati: 'restaurant',
  punjabi: 'flame',
  chinese: 'fast-food',
  pizza: 'pizza',
  'south-indian': 'sunny',
  'fast-food': 'fast-food',
  sweets: 'ice-cream',
  farsan: 'nutrition',
  beverages: 'cafe',
  'ice-cream': 'ice-cream',
  desserts: 'ice-cream',
  biryani: 'flame',
  breakfast: 'cafe',
  snacks: 'nutrition',
};

function Heading({ children, subtitle }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="heading" accessibilityRole="header">
        {children}
      </Text>
      {subtitle ? <Text variant="small">{subtitle}</Text> : null}
    </View>
  );
}

function Section({ s }) {
  const router = useRouter();
  const t = useTheme();
  const url = useMediaUrl();
  const title = s.title ? <Heading subtitle={s.subtitle}>{s.title}</Heading> : null;
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
              style={{ width: 300, height: 150, borderRadius: 20 }}
            />
          </Pressable>
        ))}
      </ScrollView>
    );
  if (s.type === 'CATEGORIES')
    return (
      <View style={{ gap: t.spacing[3] }}>
        {title}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: t.spacing[4] }}
        >
          {s.categories.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => router.push({ pathname: '/search', params: { q: c.name } })}
              style={{ alignItems: 'center', gap: 6, width: 68 }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: t.colors.accent + '33',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {c.icon ? (
                  <Image source={{ uri: url(c.icon, 'thumb') }} style={{ width: 64, height: 64 }} />
                ) : (
                  <Icon name={CATEGORY_ICON[c.slug] ?? 'restaurant'} size={28} color={t.colors.primary} />
                )}
              </View>
              <Text variant="small" numberOfLines={1} style={{ color: t.colors.text }}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  if (s.restaurants)
    return (
      <View style={{ gap: t.spacing[3] }}>
        {title}
        {s.restaurants.map((r) => (
          <RestaurantCard key={r.id} r={r} />
        ))}
      </View>
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
        style={{ width: '100%', height: 160, borderRadius: 20 }}
      />
    );
  if (s.type === 'TEXT') return <Card>{title}</Card>;
  return null;
}

/** Navy top: logo, delivery address and the search bar. */
function Top({ place }) {
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: t.colors.primary,
        paddingTop: insets.top + t.spacing[2],
        paddingHorizontal: t.spacing[4],
        paddingBottom: t.spacing[4],
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        gap: t.spacing[3],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image
          source={LOGO}
          accessibilityLabel={MOBILE_APPS.CUSTOMER.displayName}
          resizeMode="contain"
          style={{ width: 104, height: 32 }}
        />
        <View style={{ flex: 1 }} />
        <IconButton
          icon="person"
          label="Account"
          color={t.colors.onPrimary}
          background="rgba(255,255,255,0.14)"
          onPress={() => router.navigate('/account')}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          place ? `Delivering to ${place.label}. Change location` : 'Change delivery location'
        }
        onPress={() => router.push('/location')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Icon name="location" size={20} color={t.colors.accent} />
        <View style={{ flexShrink: 1 }}>
          <Text variant="small" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Delivering to
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text
              numberOfLines={1}
              style={{ color: t.colors.onPrimary, fontFamily: t.fonts.display, fontSize: 16, flexShrink: 1 }}
            >
              {place ? place.label : 'Choose your location'}
            </Text>
            <Icon name="chevron-down" size={16} color={t.colors.onPrimary} />
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search dishes and restaurants"
        onPress={() => router.navigate('/search')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 48,
          borderRadius: 14,
          backgroundColor: t.colors.surface,
          paddingHorizontal: 14,
        }}
      >
        <Icon name="search" size={20} color={t.colors.action} />
        <Text variant="muted">Search “thali” or “pizza”</Text>
      </Pressable>
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const t = useTheme();
  const { place, ready } = useLocation();
  const home = useHome(place);
  const { session } = useJamzo();
  const orders = useOrders(session.status === 'signedIn');
  const active = orders.data?.items.find((o) => !TERMINAL.includes(o.status));
  // White clock and battery on the navy header, only while Home is on screen.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (!ready) return <LoadingState label="Loading" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {focused ? <StatusBar style="light" /> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: t.spacing[8] }}>
        <Top place={place} />
        <View style={{ padding: t.spacing[4], gap: t.spacing[5] }}>
          {active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Track order from ${active.restaurant.name}`}
              onPress={() => router.push(`/orders/${active.id}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing[3],
                backgroundColor: t.colors.actionSoft,
                borderRadius: 16,
                padding: t.spacing[3],
                borderWidth: 1,
                borderColor: t.colors.action,
              }}
            >
              <Icon name="bicycle" size={28} color={t.colors.action} />
              <View style={{ flex: 1 }}>
                <Text variant="strong">{`Your order from ${active.restaurant.name}`}</Text>
                <Text variant="small">{TIMELINE_LABEL[active.status] ?? active.status}</Text>
              </View>
              <Text style={{ color: t.colors.action, fontFamily: t.fonts.display }}>Track order</Text>
            </Pressable>
          ) : null}
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
        </View>
      </ScrollView>
      <CartBar />
    </View>
  );
}
