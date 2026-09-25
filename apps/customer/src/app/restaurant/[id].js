// Restaurant menu with customer prices from the API (spec §8, §10). Adding an item with sizes or choices
// opens the customisation screen; simple items are added directly.
import { useState } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { CartBar, useMediaUrl, VegMark } from '../../components/bits';
import { useAddToCart } from '../../lib/add-to-cart';
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

function ProductRow({ p, restaurant, orderable }) {
  const router = useRouter();
  const t = useTheme();
  const url = useMediaUrl();
  const add = useAddToCart(restaurant);
  const needsChoice = p.variants.length > 0 || p.addonGroups.length > 0;
  const available = p.availability.available;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: t.spacing[3],
        paddingVertical: t.spacing[3],
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        opacity: available ? 1 : 0.55,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <VegMark type={p.foodType} />
          {p.isBestseller ? <Badge tone="warning">Bestseller</Badge> : null}
        </View>
        <Text style={{ fontWeight: '600' }}>{p.name}</Text>
        <Text>
          {p.variants.length > 1 ? 'from ' : ''}
          {money(p.pricePaise)}
        </Text>
        {p.description ? <Text variant="small">{p.description}</Text> : null}
        {!available ? (
          <Text variant="small">{UNAVAILABLE[p.availability.reason] ?? 'Not available'}</Text>
        ) : null}
      </View>
      <View style={{ width: 96, alignItems: 'center', gap: 6 }}>
        {p.images[0] ? (
          <Image
            source={{ uri: url(p.images[0], 'thumb') }}
            style={{ width: 88, height: 72, borderRadius: t.radius.md }}
          />
        ) : null}
        {available && orderable ? (
          <Button
            title="Add"
            variant="secondary"
            accessibilityHint={needsChoice ? 'Choose size and options' : undefined}
            onPress={() =>
              needsChoice
                ? router.push({
                    pathname: '/customize',
                    params: { restaurantId: restaurant.id, productId: p.id },
                  })
                : add({
                    productId: p.id,
                    variantId: null,
                    addonIds: [],
                    quantity: 1,
                    name: p.name,
                    unitPricePaise: p.pricePaise,
                    foodType: p.foodType,
                  })
            }
          />
        ) : null}
      </View>
    </View>
  );
}

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams();
  const { place } = useLocation();
  const { api, session } = useJamzo();
  const qc = useQueryClient();
  const q = useRestaurant(id, place);
  const [favBusy, setFavBusy] = useState(false);
  if (q.isPending) return <LoadingState label="Loading the menu" />;
  if (q.isError)
    return (
      <Screen>
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const { restaurant: r, delivery, sections } = q.data;
  const closed = openLabel(r.open);
  const deliverable = delivery.checked ? delivery.deliverable : false;
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
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text variant="title">{r.name}</Text>
        <Text variant="muted">
          {r.cuisines.join(', ')}
          {r.isPureVeg ? ' · Pure veg' : ''}
        </Text>
        {r.address ? <Text variant="small">{r.address}</Text> : null}
        {delivery.checked && delivery.deliverable ? (
          <Text variant="small">
            {[
              etaLabel(delivery.eta),
              distanceLabel(delivery.distanceM),
              delivery.feePaise === 0 ? 'Free delivery' : `${money(delivery.feePaise)} delivery`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {delivery.freeAboveSubtotalPaise ? ` · free above ${money(delivery.freeAboveSubtotalPaise)}` : ''}
          </Text>
        ) : null}
        {delivery.offers?.map((o) => (
          <Badge key={o.id} tone="accent">
            {o.text}
          </Badge>
        ))}
        {closed ? (
          <Banner tone="info">{closed}. You can look at the menu, but not order right now.</Banner>
        ) : null}
        {delivery.checked && !delivery.deliverable ? (
          <Banner tone="warning">This restaurant doesn’t deliver to your location.</Banner>
        ) : null}
        {!delivery.checked ? (
          <Banner tone="info">Choose your location to see if this restaurant delivers to you.</Banner>
        ) : null}
        {session.status === 'signedIn' ? (
          <Button
            title={r.isFavorite ? '♥ Saved to favourites' : '♡ Save to favourites'}
            variant="secondary"
            busy={favBusy}
            onPress={toggleFavorite}
          />
        ) : null}
        {sections.map((s) => (
          <Card key={s.id}>
            <Text variant="heading">{s.name}</Text>
            {s.products.map((p) => (
              <ProductRow key={p.id} p={p} restaurant={r} orderable={deliverable && r.open.isOpen} />
            ))}
          </Card>
        ))}
        <Text variant="small">{q.data.pricesInclude}</Text>
        {r.fssaiNumber ? <Text variant="small">FSSAI licence {r.fssaiNumber}</Text> : null}
      </Screen>
      <CartBar />
    </View>
  );
}
