// Small presentational pieces for the customer app (food-app style, D-109). Data and prices always come
// from the API.
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Icon, Text, useTheme } from '@jamzo/mobile-ui';
import { distanceLabel, etaLabel, money, openLabel } from '../lib/format';
import { useCart } from '../lib/cart';

/** API media paths are relative; the app joins them with its API URL. */
export function useMediaUrl() {
  const { env } = useJamzo();
  return (urls, size = 'small') => (urls ? `${env.apiUrl}${urls[size] ?? urls.original}` : null);
}

export function VegMark({ type, size = 14 }) {
  const t = useTheme();
  const color = type === 'NON_VEG' ? t.colors.critical : type === 'EGG' ? t.colors.warning : t.colors.veg;
  const label = { VEG: 'Veg', VEGAN: 'Vegan', EGG: 'Contains egg', NON_VEG: 'Non-veg' }[type] ?? 'Veg';
  return (
    <View
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: color,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: size / 2.3, height: size / 2.3, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

const MARK = require('../../assets/mark.png');

/** Photo, or a tinted box with a faint Jamzo "J" when there is no photo yet (D-109). */
export function Photo({ media, name, size = 'medium', style, radius = 16 }) {
  const t = useTheme();
  const url = useMediaUrl();
  const uri = url(media, size);
  return (
    <View
      accessibilityLabel={uri ? name : undefined}
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: t.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
      ) : (
        <Image
          source={MARK}
          importantForAccessibility="no"
          resizeMode="contain"
          style={{ width: '42%', height: '42%', maxWidth: 72, maxHeight: 72, opacity: 0.12 }}
        />
      )}
    </View>
  );
}

/** Offer tag in the brand's turmeric. */
export function OfferTag({ text, style }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          backgroundColor: t.colors.accent,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Icon name="pricetag" size={12} color={t.colors.onAccent} />
      <Text style={{ fontFamily: t.fonts.semibold, fontSize: 12, color: t.colors.onAccent }}>{text}</Text>
    </View>
  );
}

/** Rating pill — the API sends an average only from enough ratings (D-110). */
export function Rating({ rating }) {
  const t = useTheme();
  if (rating?.average == null) return null; // shown only from enough ratings (D-110)
  return (
    <View
      accessibilityLabel={`Rated ${rating.average} from ${rating.count} ratings`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        backgroundColor: t.colors.action,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontFamily: t.fonts.semibold, fontSize: 12, color: t.colors.onAction }}>
        {rating.average.toFixed(1)}
      </Text>
      <Icon name="star" size={10} color={t.colors.onAction} />
    </View>
  );
}

/** Big restaurant card: photo with the offer on it, then name, cuisines, time, distance and fee. */
export function RestaurantCard({ r }) {
  const router = useRouter();
  const t = useTheme();
  const closed = openLabel(r.open);
  const fee = r.delivery.feePaise === 0 ? 'Free delivery' : `${money(r.delivery.feePaise)} delivery`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}${closed ? `, ${closed}` : ''}`}
      onPress={() => router.push(`/restaurant/${r.id}`)}
      style={({ pressed }) => ({
        backgroundColor: t.colors.surface,
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: t.colors.border,
        opacity: pressed ? 0.9 : r.open.isOpen ? 1 : 0.6,
      })}
    >
      <View>
        <Photo
          media={r.cover ?? r.logo}
          name={r.name}
          radius={0}
          style={{ height: r.cover || r.logo ? 170 : 110, width: '100%' }}
        />
        {r.offers?.[0] ? (
          <OfferTag text={r.offers[0].text} style={{ position: 'absolute', left: 12, bottom: 12 }} />
        ) : null}
        {closed ? (
          <View
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              backgroundColor: t.colors.primary,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: t.colors.onPrimary, fontSize: 12, fontFamily: t.fonts.semibold }}>
              {closed}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: t.spacing[3], gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="heading" style={{ flex: 1, fontSize: 17 }} numberOfLines={1}>
            {r.name}
          </Text>
          <Rating rating={r.rating} />
        </View>
        <Text variant="small" numberOfLines={1}>
          {r.cuisines.join(', ')}
          {r.isPureVeg ? ' · Pure veg' : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Icon name="time-outline" size={14} color={t.colors.action} />
          <Text variant="small" style={{ color: t.colors.text }}>
            {[etaLabel(r.eta), distanceLabel(r.distanceM), fee].filter(Boolean).join(' · ')}
          </Text>
        </View>
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
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], paddingVertical: t.spacing[2] }}
    >
      <Photo media={d.images?.[0]} name={d.name} size="thumb" radius={12} style={{ width: 56, height: 56 }} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <VegMark type={d.foodType} size={12} />
          <Text variant="strong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {d.name}
          </Text>
        </View>
        {d.restaurant ? <Text variant="small">{d.restaurant.name}</Text> : null}
      </View>
      <Text variant="price">{money(d.pricePaise)}</Text>
    </Pressable>
  );
}

/** Green bar pinned to the bottom while the cart has items (D-109). */
export function CartBar() {
  const cart = useCart();
  const router = useRouter();
  const t = useTheme();
  if (!cart?.count) return null;
  const items = `${cart.count} item${cart.count === 1 ? '' : 's'} added`;
  return (
    <View style={{ paddingHorizontal: t.spacing[3], paddingBottom: t.spacing[2], paddingTop: t.spacing[1] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View cart · ${items} from ${cart.restaurant.name}`}
        onPress={() => router.push('/cart')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.colors.action,
          borderRadius: 16,
          paddingHorizontal: t.spacing[4],
          paddingVertical: 12,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.colors.onAction, fontFamily: t.fonts.display, fontSize: 15 }}>{items}</Text>
          <Text style={{ color: t.colors.onAction, fontSize: 12, opacity: 0.9 }} numberOfLines={1}>
            {`from ${cart.restaurant.name}`}
          </Text>
        </View>
        <Text style={{ color: t.colors.onAction, fontFamily: t.fonts.display, fontSize: 16 }}>View cart</Text>
        <Icon name="chevron-forward" size={18} color={t.colors.onAction} />
      </Pressable>
    </View>
  );
}
