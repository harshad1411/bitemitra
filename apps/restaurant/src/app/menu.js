// Menu & sold-out items. Every member can mark items sold out; menu content and prices are managed by Jamzo
// in Phase 2 (DECISIONS D-39).
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatPaise } from '@jamzo/ui';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
  Text,
  ToggleRow,
} from '@jamzo/mobile-ui';
import { useResource } from '../lib/use-resource';
import { availabilityText } from '../lib/format';

function ProductItem({ product, timeZone, canToggle, onUpdated }) {
  const { api } = useJamzo();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const a = availabilityText(product.availability, timeZone);
  const inStock = product.isAvailable && product.availability.reason !== 'SOLD_OUT_UNTIL';
  const send = async (body) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.post(`/v1/restaurant/products/${product.id}/availability`, body));
      setChoosing(false);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 6, paddingVertical: 8 }}>
      <ToggleRow
        label={product.name}
        description={`${product.variants.length ? 'from ' : ''}${formatPaise(product.basePricePaise)}`}
        value={inStock && !choosing}
        disabled={!canToggle || busy || product.status !== 'ACTIVE'}
        onValueChange={(on) => (on ? send({ isAvailable: true }) : setChoosing(true))}
      />
      <Badge tone={a.tone}>{a.text}</Badge>
      {choosing ? (
        <View style={{ gap: 6 }}>
          <Text variant="small">Mark {product.name} sold out:</Text>
          <Button
            title="Sold out for today"
            busy={busy}
            onPress={() => send({ isAvailable: false, until: 'END_OF_DAY' })}
          />
          <Button
            title="Until I switch it back on"
            variant="secondary"
            disabled={busy}
            onPress={() => send({ isAvailable: false })}
          />
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => setChoosing(false)} />
        </View>
      ) : null}
      {product.variants.length > 1 && canToggle && inStock
        ? product.variants.map((v) => (
            <ToggleRow
              key={v.id}
              label={`${v.name} · ${formatPaise(v.basePricePaise)}`}
              value={v.isAvailable}
              disabled={busy}
              onValueChange={(isAvailable) => send({ isAvailable, variantId: v.id })}
            />
          ))
        : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}
    </View>
  );
}

export default function Menu() {
  const { api } = useJamzo();
  const { restaurantId } = useLocalSearchParams();
  const menu = useResource(() => api.get(`/v1/restaurant/restaurants/${restaurantId}/menu`), [restaurantId]);
  const store = useResource(() => api.get(`/v1/restaurant/restaurants/${restaurantId}`), [restaurantId]);
  const timeZone = store.data?.restaurant.city.timezone ?? 'Asia/Kolkata';

  if (menu.status === 'loading')
    return (
      <Screen scroll={false} header={<Header title="Menu" />}>
        <LoadingState label="Loading the menu" />
      </Screen>
    );
  if (menu.status === 'error' && !menu.data)
    return (
      <Screen header={<Header title="Menu" />}>
        <ErrorState message={userMessage(menu.error)} onRetry={menu.reload} />
      </Screen>
    );
  const m = menu.data;
  const replace = (updated) =>
    menu.setData({
      ...m,
      sections: m.sections.map((s) => ({
        ...s,
        products: s.products.map((p) => (p.id === updated.id ? updated : p)),
      })),
      unsectioned: m.unsectioned.map((p) => (p.id === updated.id ? updated : p)),
    });
  const groups = [
    ...m.sections.filter((s) => s.isActive),
    ...(m.unsectioned.length ? [{ id: 'none', name: 'Other items', products: m.unsectioned }] : []),
  ];
  const soldOut = groups
    .flatMap((g) => g.products)
    .filter((p) => !p.availability.available && p.status === 'ACTIVE').length;
  return (
    <Screen header={<Header title="Menu" />}>
      <Text variant="muted">
        {m.restaurant.name} · {m.productCount} items{soldOut ? ` · ${soldOut} unavailable now` : ''}
      </Text>
      {!groups.length ? (
        <EmptyState title="No menu yet" message="Jamzo adds your menu during onboarding." />
      ) : null}
      {groups.map((g) => (
        <Card key={g.id}>
          <Text variant="heading">{g.name}</Text>
          {g.products.map((p) => (
            <ProductItem
              key={p.id}
              product={p}
              timeZone={timeZone}
              canToggle={m.capabilities['menu.availability']}
              onUpdated={replace}
            />
          ))}
        </Card>
      ))}
      <Text variant="small">To change prices or items, contact Jamzo partner support.</Text>
    </Screen>
  );
}
