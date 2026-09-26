// Cart: the bill is always the server's quote (D-46) — the app shows it, never computes it. Food-app
// layout (D-109): items with steppers, coupon, tip and bill in cards, and the total pinned at the bottom.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  LoadingState,
  Screen,
  Stepper,
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
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 }}>
      <Text variant={strong ? 'subheading' : 'muted'} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? 'subheading' : 'body'}>{value}</Text>
    </View>
  );
}

function CardTitle({ icon, children }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon ? <Icon name={icon} size={18} color={t.colors.textMuted} /> : null}
      <Text variant="subheading">{children}</Text>
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
      <Screen header={<Header title="Cart" />}>
        <EmptyState
          title="Your cart is empty"
          message="Add dishes from a restaurant to see your bill."
          action={<Button title="Browse restaurants" onPress={() => router.replace('/')} />}
        />
      </Screen>
    );
  if (!place)
    return (
      <Screen header={<Header title={cart.restaurant.name} />}>
        <Banner tone="info">Choose your delivery location to see the bill.</Banner>
        <Button title="Choose location" onPress={() => router.push('/location')} />
      </Screen>
    );
  const data = q.data;
  const issueFor = (key) => data?.issues.find((i) => i.lineKey === key);
  const eta = data?.delivery?.eta ? etaLabel(data.delivery.eta) : null;
  const header = (
    <Header>
      <Text variant="subheading" numberOfLines={1}>
        {cart.restaurant.name}
      </Text>
      <Text variant="small" numberOfLines={1}>
        {eta ? (
          <Text variant="small" style={{ color: t.colors.action, fontFamily: t.fonts.semibold }}>
            {`${eta} · `}
          </Text>
        ) : null}
        {`Delivering to ${place.label}`}
      </Text>
    </Header>
  );
  const footer = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[3],
        padding: t.spacing[4],
        backgroundColor: t.colors.surface,
        borderTopWidth: 1,
        borderTopColor: t.colors.border,
      }}
    >
      <View>
        <Text variant="title" style={{ fontSize: 20, lineHeight: 26 }}>
          {data?.bill ? money(data.bill.totalPayablePaise) : '—'}
        </Text>
        <Text variant="label">Total</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Button
          title="Proceed to checkout"
          size="lg"
          disabled={!data?.canCheckout}
          accessibilityHint={data?.checkoutNote ?? undefined}
          onPress={() => router.push('/checkout')}
        />
      </View>
    </View>
  );
  return (
    <Screen header={header} footer={footer}>
      <Card>
        {cart.lines.map((l) => {
          const priced = data?.lines?.find((x) => x.key === l.key);
          const issue = issueFor(l.key);
          return (
            <View
              key={l.key}
              style={{
                gap: 4,
                paddingVertical: t.spacing[3],
                borderBottomWidth: 1,
                borderBottomColor: t.colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
                <View style={{ paddingTop: 4 }}>
                  <VegMark type={l.foodType} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="strong">{l.name}</Text>
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
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Stepper value={l.quantity} label={l.name} onChange={(n) => cart.setQuantity(l.key, n)} />
                  <Text variant="price">{priced ? money(priced.lineTotalPaise) : '—'}</Text>
                </View>
              </View>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Chip
            label="Add more items"
            icon={<Icon name="add" size={16} color={t.colors.action} />}
            onPress={() => router.push(`/restaurant/${cart.restaurant.id}`)}
          />
          <Chip
            label="Clear cart"
            icon={<Icon name="trash-outline" size={15} color={t.colors.textMuted} />}
            onPress={cart.clear}
          />
        </View>
      </Card>

      <Card>
        <CardTitle icon="pricetag-outline">Coupon</CardTitle>
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
          <CardTitle icon="heart-outline">Tip your delivery partner</CardTitle>
          <Text variant="small">The full tip goes to your delivery partner.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[0, ...data.tips.presetsPaise].map((p) => (
              <Chip
                key={p}
                label={p === 0 ? 'No tip' : money(p)}
                selected={cart.tipPaise === p}
                onPress={() => cart.setTip(p)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <CardTitle icon="receipt-outline">Bill details</CardTitle>
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

      {data?.checkoutNote ? <Banner tone="info">{data.checkoutNote}</Banner> : null}
    </Screen>
  );
}
