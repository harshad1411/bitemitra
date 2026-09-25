// Cart: the bill is always the server's quote (D-46) — the app shows it, never computes it. Checkout
// (addresses, payment, order placement) is Phase 5.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
  useTheme,
} from '@jamzo/mobile-ui';
import { VegMark } from '../components/bits';
import { useCart } from '../lib/cart';
import { etaLabel, money } from '../lib/format';
import { useLocation } from '../lib/location';
import { useQuote } from '../lib/queries';

function Row({ label, value, strong }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={strong ? { fontWeight: '700' } : undefined}>{label}</Text>
      <Text style={strong ? { fontWeight: '700' } : undefined}>{value}</Text>
    </View>
  );
}

export default function CartScreen() {
  const router = useRouter();
  const t = useTheme();
  const cart = useCart();
  const { place } = useLocation();
  const q = useQuote(cart, place);
  const [code, setCode] = useState(cart.couponCode ?? '');
  useEffect(() => setCode(cart.couponCode ?? ''), [cart.couponCode]);

  if (!cart.count)
    return (
      <Screen>
        <EmptyState
          title="Your cart is empty"
          message="Add dishes from a restaurant to see your bill."
          action={<Button title="Browse restaurants" onPress={() => router.replace('/')} />}
        />
      </Screen>
    );
  if (!place)
    return (
      <Screen>
        <Banner tone="info">Choose your delivery location to see the bill.</Banner>
        <Button title="Choose location" onPress={() => router.push('/location')} />
      </Screen>
    );
  const data = q.data;
  const issueFor = (key) => data?.issues.find((i) => i.lineKey === key);
  return (
    <Screen>
      <Text variant="title">{cart.restaurant.name}</Text>
      <Text variant="small">
        Delivering to {place.label}
        {data?.delivery?.eta ? ` · ${etaLabel(data.delivery.eta)}` : ''}
      </Text>

      <Card>
        {cart.lines.map((l) => {
          const priced = data?.lines?.find((x) => x.key === l.key);
          const issue = issueFor(l.key);
          return (
            <View
              key={l.key}
              style={{
                gap: 4,
                paddingVertical: t.spacing[2],
                borderBottomWidth: 1,
                borderBottomColor: t.colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <VegMark type={l.foodType} />
                <Text style={{ flex: 1, fontWeight: '600' }}>{l.name}</Text>
                <Text>{priced ? money(priced.lineTotalPaise) : '—'}</Text>
              </View>
              {l.variantName || l.addonNames?.length ? (
                <Text variant="small">
                  {[l.variantName, ...(l.addonNames ?? [])].filter(Boolean).join(', ')}
                </Text>
              ) : null}
              {issue ? (
                <Text variant="small" style={{ color: t.colors.critical }}>
                  {issue.message}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Button
                  title="−"
                  variant="secondary"
                  accessibilityHint={`One less ${l.name}`}
                  onPress={() => cart.setQuantity(l.key, l.quantity - 1)}
                />
                <Text accessibilityLabel={`${l.name} quantity ${l.quantity}`}>{l.quantity}</Text>
                <Button
                  title="+"
                  variant="secondary"
                  accessibilityHint={`One more ${l.name}`}
                  onPress={() => cart.setQuantity(l.key, l.quantity + 1)}
                />
              </View>
            </View>
          );
        })}
        <Button
          title="Add more items"
          variant="secondary"
          onPress={() => router.push(`/restaurant/${cart.restaurant.id}`)}
        />
      </Card>

      <Card>
        <Text variant="heading">Coupon</Text>
        <TextField
          label="Coupon code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="WELCOME50"
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Apply coupon"
              variant="secondary"
              disabled={!code.trim()}
              onPress={() => cart.setCoupon(code.trim().toUpperCase())}
            />
          </View>
          {cart.couponCode ? (
            <Button title="Remove coupon" variant="secondary" onPress={() => cart.setCoupon(null)} />
          ) : null}
        </View>
        {data?.coupon ? (
          <Banner tone={data.coupon.status === 'APPLIED' ? 'success' : 'warning'}>
            {`${data.coupon.code}: ${data.coupon.message}${data.coupon.shortByPaise ? ` Add ${money(data.coupon.shortByPaise)} more.` : ''}`}
          </Banner>
        ) : null}
        {data?.offers?.map((o) => (
          <Badge key={o.name} tone="accent">
            {`${o.name}: you save ${money(o.amountPaise)}`}
          </Badge>
        ))}
      </Card>

      {data?.tips?.enabled ? (
        <Card>
          <Text variant="heading">Tip your delivery partner</Text>
          <Text variant="small">The full tip goes to your delivery partner.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[0, ...data.tips.presetsPaise].map((p) => (
              <Button
                key={p}
                title={p === 0 ? 'No tip' : money(p)}
                variant={cart.tipPaise === p ? 'primary' : 'secondary'}
                onPress={() => cart.setTip(p)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">Bill details</Text>
        {q.isPending ? (
          <LoadingState label="Working out your bill" />
        ) : q.isError ? (
          <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
        ) : data.bill ? (
          <>
            {data.bill.lines.map((b) => (
              <Row key={b.code} label={b.label} value={money(b.amountPaise)} />
            ))}
            <Row label="To pay" value={money(data.bill.totalPayablePaise)} strong />
            {data.bill.notes.map((n) => (
              <Text key={n} variant="small">
                {n}
              </Text>
            ))}
            {data.delivery?.freeAboveSubtotalPaise && data.delivery.freeReason == null ? (
              <Text variant="small">{`Free delivery on orders above ${money(data.delivery.freeAboveSubtotalPaise)}.`}</Text>
            ) : null}
            <Text variant="small">{data.taxNote}</Text>
          </>
        ) : null}
        {data?.issues
          .filter((i) => !i.lineKey)
          .map((i) => (
            <Banner key={i.code} tone="warning">
              {i.message}
            </Banner>
          ))}
      </Card>

      <Button title="Proceed to checkout" disabled accessibilityHint={data?.checkoutNote} />
      <Text variant="small">{data?.checkoutNote ?? 'Checkout and payment arrive in Phase 5.'}</Text>
      <Button title="Clear cart" variant="secondary" onPress={cart.clear} />
    </Screen>
  );
}
