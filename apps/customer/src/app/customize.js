// Choose size and options for an item, as a sheet over the menu (D-108). The price shown here is for
// guidance; the cart bill comes from the server quote (D-46), which also re-checks every choice.
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, IconButton, LoadingState, Stepper, Text, useTheme } from '@jamzo/mobile-ui';
import { VegMark } from '../components/bits';
import { Option } from '../components/option';
import { money } from '../lib/format';
import { useLocation } from '../lib/location';
import { useRestaurant } from '../lib/queries';
import { useAddToCart } from '../lib/add-to-cart';

export default function Customize() {
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { restaurantId, productId } = useLocalSearchParams();
  const { place } = useLocation();
  const q = useRestaurant(restaurantId, place);
  const product = useMemo(
    () => q.data?.sections.flatMap((s) => s.products).find((p) => p.id === productId),
    [q.data, productId],
  );
  const [variantId, setVariantId] = useState(null);
  const [chosen, setChosen] = useState({}); // groupId → addonIds
  const [quantity, setQuantity] = useState(1);
  const add = useAddToCart(q.data?.restaurant ?? { id: restaurantId, name: '' });
  if (!product) return <LoadingState label="Loading" />;
  const variant = product.variants.find(
    (v) =>
      v.id ===
      (variantId ??
        product.variants.find((x) => x.isDefault && x.isAvailable)?.id ??
        product.variants.find((x) => x.isAvailable)?.id),
  );
  const addons = product.addonGroups.flatMap((g) =>
    (chosen[g.id] ?? []).map((aid) => g.addons.find((a) => a.id === aid)),
  );
  const missing = product.addonGroups.filter((g) => (chosen[g.id]?.length ?? 0) < g.minSelect);
  const unit = (variant?.pricePaise ?? product.pricePaise) + addons.reduce((n, a) => n + a.pricePaise, 0);
  const toggle = (g, a) =>
    setChosen((c) => {
      const cur = c[g.id] ?? [];
      if (g.maxSelect === 1) return { ...c, [g.id]: [a.id] };
      if (cur.includes(a.id)) return { ...c, [g.id]: cur.filter((x) => x !== a.id) };
      return cur.length >= g.maxSelect ? c : { ...c, [g.id]: [...cur, a.id] };
    });
  const ready = missing.length === 0 && !(product.variants.length > 0 && !variant);
  const footer = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[3],
        padding: t.spacing[4],
        paddingBottom: t.spacing[4] + insets.bottom,
        backgroundColor: t.colors.surface,
        borderTopWidth: 1,
        borderTopColor: t.colors.border,
      }}
    >
      <Stepper
        value={quantity}
        min={1}
        label={product.name}
        width={112}
        onChange={(n) => setQuantity(Math.max(1, Math.min(50, n)))}
      />
      <View style={{ flex: 1 }}>
        <Button
          title={ready ? `Add item · ${money(unit * quantity)}` : `Choose ${missing[0]?.name ?? 'size'}`}
          disabled={!ready}
          onPress={() => {
            add({
              productId: product.id,
              variantId: variant?.id ?? null,
              addonIds: addons.map((a) => a.id),
              quantity,
              name: product.name,
              variantName: variant?.name ?? null,
              addonNames: addons.map((a) => a.name),
              unitPricePaise: unit,
              foodType: product.foodType,
            });
            router.back();
          }}
        />
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: t.spacing[4], gap: t.spacing[4], paddingBottom: t.spacing[8] }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ paddingTop: 7 }}>
            <VegMark type={product.foodType} />
          </View>
          <Text variant="title" style={{ flex: 1 }}>
            {product.name}
          </Text>
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        </View>
        {product.description ? <Text variant="muted">{product.description}</Text> : null}
        {product.variants.length ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="subheading">Size</Text>
              <Text variant="small">Required · choose 1</Text>
            </View>
            {product.variants.map((v) => (
              <Option
                key={v.id}
                label={v.name}
                detail={v.isAvailable ? money(v.pricePaise) : 'Sold out'}
                selected={variant?.id === v.id}
                disabled={!v.isAvailable}
                onPress={() => setVariantId(v.id)}
              />
            ))}
          </Card>
        ) : null}
        {product.addonGroups.map((g) => (
          <Card key={g.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="subheading" style={{ flexShrink: 1 }}>
                {g.name}
              </Text>
              <Text
                variant="small"
                style={
                  g.minSelect > 0 && (chosen[g.id]?.length ?? 0) < g.minSelect
                    ? { color: t.colors.warning }
                    : null
                }
              >
                {g.minSelect > 0
                  ? `Required · choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}`
                  : `Optional · up to ${g.maxSelect}`}
              </Text>
            </View>
            {g.addons.map((a) => (
              <Option
                key={a.id}
                multi={g.maxSelect > 1}
                label={a.name}
                detail={a.isAvailable ? (a.pricePaise ? `+ ${money(a.pricePaise)}` : null) : 'Sold out'}
                selected={(chosen[g.id] ?? []).includes(a.id)}
                disabled={!a.isAvailable}
                onPress={() => toggle(g, a)}
              />
            ))}
          </Card>
        ))}
        <Text variant="small">Taxes and fees are added in the cart.</Text>
      </ScrollView>
      {footer}
    </View>
  );
}
