// Restaurant menu with customer prices from the API (spec §8, §10), in the food-app layout (D-109).
// Items with sizes or choices open the options sheet; simple items are added directly.
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  AddButton,
  Banner,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  IconButton,
  LoadingState,
  Screen,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { CartBar, OfferTag, Photo, Rating, VegMark } from '../../components/bits';
import { useAddToCart } from '../../lib/add-to-cart';
import { useCart } from '../../lib/cart';
import { distanceLabel, etaLabel, money, openLabel } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { useRestaurant } from '../../lib/queries';

const UNAVAILABLE = {
  SOLD_OUT: 'Sold out',
  SOLD_OUT_UNTIL: 'Sold out for now',
  OUTSIDE_SCHEDULE: 'Not available right now',
  NO_VARIANT_AVAILABLE: 'Sold out',
  OUT_OF_STOCK: 'Sold out',
};

function Bestseller() {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: t.colors.accent,
        borderRadius: 5,
        paddingHorizontal: 6,
        paddingVertical: 1,
      }}
    >
      <Icon name="flame" size={11} color={t.colors.onAccent} />
      <Text style={{ fontFamily: t.fonts.semibold, fontSize: 11, color: t.colors.onAccent }}>Bestseller</Text>
    </View>
  );
}

function ProductRow({ p, restaurant, orderable, last }) {
  const router = useRouter();
  const t = useTheme();
  const cart = useCart();
  const add = useAddToCart(restaurant);
  const [expanded, setExpanded] = useState(false);
  const needsChoice = p.variants.length > 0 || p.addonGroups.length > 0;
  const available = p.availability.available;
  const lines = cart.restaurant?.id === restaurant.id ? cart.lines.filter((l) => l.productId === p.id) : [];
  const inCart = lines.reduce((n, l) => n + l.quantity, 0);
  const openOptions = () =>
    router.push({ pathname: '/customize', params: { restaurantId: restaurant.id, productId: p.id } });
  const addSimple = () =>
    add({
      productId: p.id,
      variantId: null,
      addonIds: [],
      quantity: 1,
      name: p.name,
      unitPricePaise: p.pricePaise,
      foodType: p.foodType,
    });
  // Customisable items: "+" opens the options again, "−" takes one off the most recently added choice.
  const change = (next) => {
    if (next > inCart) return needsChoice ? openOptions() : addSimple();
    const line = lines[lines.length - 1];
    cart.setQuantity(line.key, line.quantity - 1);
  };
  const photo = p.images[0];
  const button =
    available && orderable ? (
      <AddButton
        label={p.name}
        quantity={inCart}
        customisable={needsChoice}
        onAdd={needsChoice ? openOptions : addSimple}
        onChange={change}
      />
    ) : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: t.spacing[3],
        paddingVertical: t.spacing[4],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
        borderStyle: 'dashed',
        opacity: available ? 1 : 0.55,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <VegMark type={p.foodType} />
          {p.isBestseller ? <Bestseller /> : null}
        </View>
        <Text variant="subheading" style={{ fontSize: 17 }}>
          {p.name}
        </Text>
        <Text variant="price">
          {p.variants.length > 1 ? 'from ' : ''}
          {money(p.pricePaise)}
        </Text>
        {p.description ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? p.description : `${p.description}. Show more`}
            onPress={() => setExpanded((v) => !v)}
          >
            <Text variant="muted" numberOfLines={expanded ? undefined : 2}>
              {p.description}
            </Text>
          </Pressable>
        ) : null}
        {!available ? (
          <Text variant="small" style={{ color: t.colors.critical }}>
            {UNAVAILABLE[p.availability.reason] ?? 'Not available'}
          </Text>
        ) : null}
      </View>
      {photo ? (
        <View style={{ width: 124, alignItems: 'center' }}>
          <Photo media={photo} name={p.name} size="small" style={{ width: 124, height: 118 }} />
          {button ? <View style={{ marginTop: -20 }}>{button}</View> : null}
          {button && needsChoice ? (
            <Text variant="small" style={{ fontSize: 11, marginTop: 2 }}>
              customisable
            </Text>
          ) : null}
        </View>
      ) : button ? (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          {button}
          {needsChoice ? (
            <Text variant="small" style={{ fontSize: 11, marginTop: 2 }}>
              customisable
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams();
  const t = useTheme();
  const { place } = useLocation();
  const { api, session } = useJamzo();
  const qc = useQueryClient();
  const q = useRestaurant(id, place);
  const [favBusy, setFavBusy] = useState(false);
  const [vegOnly, setVegOnly] = useState(false);
  const [bestOnly, setBestOnly] = useState(false);
  const [find, setFind] = useState('');
  const sections = useMemo(() => {
    const words = find.trim().toLowerCase();
    return (q.data?.sections ?? [])
      .map((s) => ({
        ...s,
        products: s.products.filter(
          (p) =>
            (!vegOnly || p.foodType === 'VEG' || p.foodType === 'VEGAN') &&
            (!bestOnly || p.isBestseller) &&
            (!words || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(words)),
        ),
      }))
      .filter((s) => s.products.length);
  }, [q.data, vegOnly, bestOnly, find]);

  if (q.isPending) return <LoadingState label="Loading the menu" />;
  if (q.isError)
    return (
      <Screen header={<Header title="Menu" />}>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const { restaurant: r, delivery } = q.data;
  const closed = openLabel(r.open);
  const deliverable = delivery.checked ? delivery.deliverable : false;
  const signedIn = session.status === 'signedIn';
  const toggleFavorite = async () => {
    setFavBusy(true);
    try {
      if (r.isFavorite) await api.delete(`/v1/customer/favorites/${r.id}`);
      else await api.put(`/v1/customer/favorites/${r.id}`, {});
      await qc.invalidateQueries({ queryKey: ['restaurant', r.id] });
    } finally {
      setFavBusy(false);
    }
  };
  const header = (
    <Header
      right={
        signedIn ? (
          <IconButton
            icon={r.isFavorite ? 'heart' : 'heart-outline'}
            label={r.isFavorite ? 'Saved to favourites' : 'Save to favourites'}
            color={r.isFavorite ? t.colors.critical : undefined}
            onPress={favBusy ? undefined : toggleFavorite}
          />
        ) : null
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 42,
          borderRadius: 21,
          paddingHorizontal: 14,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Icon name="search" size={18} color={t.colors.action} />
        <TextInput
          value={find}
          onChangeText={setFind}
          placeholder={`Search in ${r.name}`}
          placeholderTextColor={t.colors.textSubtle}
          accessibilityLabel={`Search in ${r.name}`}
          style={{ flex: 1, fontFamily: t.fonts.regular, fontSize: 15, color: t.colors.text }}
        />
      </View>
    </Header>
  );
  return (
    <Screen header={header} footer={<CartBar />} padded={false}>
      <View
        style={{
          margin: t.spacing[4],
          backgroundColor: t.colors.surface,
          borderRadius: 20,
          padding: t.spacing[4],
          gap: 4,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="title" style={{ flex: 1 }}>
            {r.name}
          </Text>
          <Rating rating={r.rating} />
        </View>
        <Text variant="muted">
          {r.cuisines.join(', ')}
          {r.isPureVeg ? ' · Pure veg' : ''}
        </Text>
        {r.address ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="location-outline" size={14} color={t.colors.textMuted} />
            <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.address}
            </Text>
          </View>
        ) : null}
        {delivery.checked && delivery.deliverable ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <Icon name="time-outline" size={15} color={t.colors.action} />
            <Text variant="small" style={{ color: t.colors.text, flexShrink: 1 }}>
              {[
                etaLabel(delivery.eta),
                distanceLabel(delivery.distanceM),
                delivery.feePaise === 0 ? 'Free delivery' : `${money(delivery.feePaise)} delivery`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ) : null}
        {delivery.freeAboveSubtotalPaise && deliverable ? (
          <Text variant="small">{`Free delivery above ${money(delivery.freeAboveSubtotalPaise)}`}</Text>
        ) : null}
        {delivery.offers?.length ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            {delivery.offers.map((o) => (
              <OfferTag key={o.id} text={o.text} />
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: t.spacing[4], gap: t.spacing[3] }}>
        {closed ? (
          <Banner tone="info">{closed}. You can look at the menu, but not order right now.</Banner>
        ) : null}
        {delivery.checked && !delivery.deliverable ? (
          <Banner tone="warning">This restaurant doesn’t deliver to your location.</Banner>
        ) : null}
        {!delivery.checked ? (
          <Banner tone="info">Choose your location to see if this restaurant delivers to you.</Banner>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!r.isPureVeg ? (
            <Chip
              label="Veg"
              selected={vegOnly}
              onPress={() => setVegOnly((v) => !v)}
              icon={<VegMark type="VEG" size={12} />}
            />
          ) : null}
          <Chip
            label="Bestseller"
            selected={bestOnly}
            onPress={() => setBestOnly((v) => !v)}
            icon={<Icon name="flame" size={14} color={t.colors.warning} />}
          />
        </View>
      </View>
      {sections.length ? (
        sections.map((s) => (
          <View
            key={s.id}
            style={{
              marginTop: t.spacing[4],
              backgroundColor: t.colors.surface,
              paddingHorizontal: t.spacing[4],
              paddingTop: t.spacing[4],
            }}
          >
            <Text variant="heading" accessibilityRole="header">
              {`${s.name} (${s.products.length})`}
            </Text>
            {s.products.map((p, i) => (
              <ProductRow
                key={p.id}
                p={p}
                restaurant={r}
                orderable={deliverable && r.open.isOpen}
                last={i === s.products.length - 1}
              />
            ))}
          </View>
        ))
      ) : (
        <EmptyState title="No dishes match" message="Try another word or clear the filters." />
      )}
      <View style={{ padding: t.spacing[4], gap: 4 }}>
        <Text variant="small">{q.data.pricesInclude}</Text>
        {r.fssaiNumber ? <Text variant="small">FSSAI licence {r.fssaiNumber}</Text> : null}
      </View>
    </Screen>
  );
}
