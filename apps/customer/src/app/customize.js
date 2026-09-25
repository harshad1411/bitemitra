// Choose size and options for an item. The price shown here is for guidance; the cart bill comes from the
// server quote (D-46), which also re-checks every choice.
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, LoadingState, Screen, Text, useTheme } from '@jamzo/mobile-ui';
import { VegMark } from '../components/bits';
import { money } from '../lib/format';
import { useLocation } from '../lib/location';
import { useRestaurant } from '../lib/queries';
import { useAddToCart } from '../lib/add-to-cart';

function Option({ label, detail, selected, onPress, disabled, multi }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[2],
        minHeight: t.minTouchTarget,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: multi ? 4 : 10,
          borderWidth: 2,
          borderColor: t.colors.primary,
          backgroundColor: selected ? t.colors.primary : 'transparent',
        }}
      />
      <Text style={{ flex: 1 }}>{label}</Text>
      {detail ? <Text variant="small">{detail}</Text> : null}
    </Pressable>
  );
}

export default function Customize() {
  const router = useRouter();
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
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <VegMark type={product.foodType} />
        <Text variant="title">{product.name}</Text>
      </View>
      {product.description ? <Text variant="muted">{product.description}</Text> : null}
      {product.variants.length ? (
        <Card>
          <Text variant="heading">Size</Text>
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
          <Text variant="heading">{g.name}</Text>
          <Text variant="small">
            {g.minSelect > 0
              ? `Required · choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}`
              : `Optional · up to ${g.maxSelect}`}
          </Text>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button
          title="−"
          variant="secondary"
          accessibilityHint="One less"
          onPress={() => setQuantity((n) => Math.max(1, n - 1))}
        />
        <Text accessibilityLabel={`Quantity ${quantity}`}>{quantity}</Text>
        <Button
          title="+"
          variant="secondary"
          accessibilityHint="One more"
          onPress={() => setQuantity((n) => Math.min(50, n + 1))}
        />
      </View>
      {missing.length ? (
        <Banner tone="info">{`Choose: ${missing.map((g) => g.name).join(', ')}`}</Banner>
      ) : null}
      <Button
        title={`Add ${quantity} · ${money(unit * quantity)}`}
        disabled={missing.length > 0 || (product.variants.length > 0 && !variant)}
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
      <Text variant="small">Taxes and fees are added in the cart.</Text>
    </Screen>
  );
}
