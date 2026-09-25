// Small presentational pieces for the customer app. Data and prices always come from the API.
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Badge, Button, Text, useTheme } from '@jamzo/mobile-ui';
import { distanceLabel, etaLabel, money, openLabel } from '../lib/format';
import { useCart } from '../lib/cart';

/** API media paths are relative; the app joins them with its API URL. */
export function useMediaUrl() {
  const { env } = useJamzo();
  return (urls, size = 'small') => (urls ? `${env.apiUrl}${urls[size] ?? urls.original}` : null);
}

export function VegMark({ type }) {
  const t = useTheme();
  const color = type === 'NON_VEG' ? t.colors.critical : type === 'EGG' ? t.colors.warning : t.colors.success;
  const label = { VEG: 'Veg', VEGAN: 'Vegan', EGG: 'Contains egg', NON_VEG: 'Non-veg' }[type] ?? 'Veg';
  return (
    <View
      accessibilityLabel={label}
      style={{
        width: 14,
        height: 14,
        borderWidth: 1.5,
        borderColor: color,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

export function RestaurantCard({ r }) {
  const router = useRouter();
  const t = useTheme();
  const url = useMediaUrl();
  const closed = openLabel(r.open);
  const fee = r.delivery.feePaise === 0 ? 'Free delivery' : `${money(r.delivery.feePaise)} delivery`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}${closed ? `, ${closed}` : ''}`}
      onPress={() => router.push(`/restaurant/${r.id}`)}
      style={{
        flexDirection: 'row',
        gap: t.spacing[3],
        paddingVertical: t.spacing[2],
        opacity: r.open.isOpen ? 1 : 0.6,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        {r.cover || r.logo ? (
          <Image source={{ uri: url(r.cover ?? r.logo, 'thumb') }} style={{ width: 72, height: 72 }} />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" style={{ fontSize: 17 }}>
          {r.name}
        </Text>
        <Text variant="small">
          {r.cuisines.join(', ')}
          {r.isPureVeg ? ' · Pure veg' : ''}
        </Text>
        <Text variant="small">
          {[etaLabel(r.eta), distanceLabel(r.distanceM), fee].filter(Boolean).join(' · ')}
        </Text>
        {closed ? <Badge tone="neutral">{closed}</Badge> : null}
        {r.offers?.[0] ? <Badge tone="accent">{r.offers[0].text}</Badge> : null}
      </View>
    </Pressable>
  );
}

export function DishRow({ d, onPress }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${d.name}, ${money(d.pricePaise)}`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[2] }}
    >
      <VegMark type={d.foodType} />
      <View style={{ flex: 1 }}>
        <Text>{d.name}</Text>
        {d.restaurant ? <Text variant="small">{d.restaurant.name}</Text> : null}
      </View>
      <Text>{money(d.pricePaise)}</Text>
    </Pressable>
  );
}

/** Sticky "View cart" bar shown while the cart has items. */
export function CartBar() {
  const cart = useCart();
  const router = useRouter();
  const t = useTheme();
  if (!cart?.count) return null;
  return (
    <View
      style={{
        padding: t.spacing[3],
        borderTopWidth: 1,
        borderTopColor: t.colors.border,
        backgroundColor: t.colors.surface,
      }}
    >
      <Button
        title={`View cart · ${cart.count} item${cart.count === 1 ? '' : 's'} from ${cart.restaurant.name}`}
        onPress={() => router.push('/cart')}
      />
    </View>
  );
}
