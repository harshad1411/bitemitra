// Checkout (D-60, D-64, D-83): a saved address, cash on delivery or online payment, notes, and the server's
// bill. The server re-prices and re-checks everything when the order is placed; one idempotency key per
// attempt makes a double tap or a retry after a network error return the same order. Online orders then open
// the payment page; the server confirms the payment with the gateway (D-84).
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey, useJamzo, userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Header,
  LoadingState,
  Screen,
  Text,
  TextField,
  ToggleRow,
} from '@jamzo/mobile-ui';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import { useLocation } from '../lib/location';
import { useAddresses, useQuote } from '../lib/queries';
import { payOnline } from '../lib/pay';
import { Option } from '../components/option';

const ONLINE_LABEL = { UPI: 'UPI', CARD: 'cards', NETBANKING: 'netbanking', WALLET: 'wallets' };

export default function Checkout() {
  const router = useRouter();
  const qc = useQueryClient();
  const { api, session, env } = useJamzo();
  const cart = useCart();
  const { place, choose } = useLocation();
  const signedIn = session.status === 'signedIn';
  const addresses = useAddresses(signedIn);
  const q = useQuote(cart, place);
  const [deliveryInstructions, setDeliveryNote] = useState('');
  const [restaurantInstructions, setRestaurantNote] = useState('');
  const [contactless, setContactless] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(null); // 'COD' | 'ONLINE'; null until the customer or the default decides
  const [problem, setProblem] = useState(null); // { message, issues? }
  const attempt = useRef(null); // idempotency key of the current attempt (reused on retry)

  if (!signedIn)
    return (
      <Screen header={<Header title="Checkout" />}>
        <EmptyState
          title="Sign in to place your order"
          message="Your cart is saved. Sign in with your mobile number to continue."
          action={<Button title="Sign in" onPress={() => router.push('/sign-in')} />}
        />
      </Screen>
    );
  if (!cart.count)
    return (
      <Screen header={<Header title="Checkout" />}>
        <EmptyState title="Your cart is empty" message="Add dishes first." />
      </Screen>
    );

  const saved = addresses.data?.items ?? [];
  const address = place?.addressId ? saved.find((a) => a.id === place.addressId) : null;
  const data = q.data;
  const total = data?.bill?.totalPayablePaise;
  const methods = data?.paymentMethods ?? ['COD'];
  const online = methods.filter((m) => m !== 'COD');
  const pay = choice ?? (methods.includes('COD') ? 'COD' : 'ONLINE');

  const placeOrder = async () => {
    setBusy(true);
    setProblem(null);
    attempt.current ??= newIdempotencyKey();
    try {
      const res = await api.post(
        '/v1/orders',
        {
          restaurantId: cart.restaurant.id,
          addressId: address.id,
          lines: cart.lines.map((l) => ({
            key: l.key,
            productId: l.productId,
            variantId: l.variantId ?? null,
            addonIds: l.addonIds ?? [],
            quantity: l.quantity,
          })),
          couponCode: cart.couponCode ?? undefined,
          tipPaise: cart.tipPaise ?? 0,
          // The customer picks UPI, card… in the gateway; the method actually used is recorded when paid.
          paymentMethod: pay === 'COD' ? 'COD' : online[0],
          expectedTotalPaise: total,
          deliveryInstructions: deliveryInstructions.trim() || null,
          restaurantInstructions: restaurantInstructions.trim() || null,
          contactless,
        },
        { idempotencyKey: attempt.current },
      );
      cart.clear();
      if (res.order.status === 'PAYMENT_PENDING') {
        // If the page is closed or the gateway is slow, the order screen offers "Pay now" again.
        await payOnline({
          api,
          apiUrl: env.apiUrl,
          orderId: res.order.id,
          payment: res.order.onlinePayment,
        }).catch(() => null);
      }
      await qc.invalidateQueries({ queryKey: ['orders'] });
      router.replace(`/orders/${res.order.id}`);
    } catch (err) {
      if (err?.code === 'PRICE_CHANGED') {
        attempt.current = null; // a new total is a new attempt
        await q.refetch();
        setProblem({
          message: `Prices changed. The new total is ${money(err.details?.quote?.bill?.totalPayablePaise)}. Check the bill and place the order again.`,
        });
      } else if (err?.code === 'CHECKOUT_BLOCKED') {
        attempt.current = null;
        await q.refetch();
        setProblem({ message: userMessage(err), issues: err.details?.issues ?? [] });
      } else {
        // Network or server error: keep the same key so a retry cannot create a second order.
        setProblem({ message: userMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title="Checkout" />}>
      <Text variant="muted">{cart.restaurant.name}</Text>

      <Card>
        <Text variant="heading">Deliver to</Text>
        {address ? (
          <Text>{[address.label, address.line1, address.landmark].filter(Boolean).join(', ')}</Text>
        ) : (
          <Text variant="muted">Choose a saved address for this order.</Text>
        )}
        {saved
          .filter((a) => a.id !== address?.id)
          .map((a) => (
            <Button
              key={a.id}
              variant="secondary"
              title={`Deliver to ${a.label}: ${a.line1}${a.serviceable ? '' : ' (not served)'}`}
              disabled={!a.serviceable}
              onPress={() => choose({ lat: a.lat, lng: a.lng, label: a.label, addressId: a.id })}
            />
          ))}
        <Button title="Add a new address" variant="secondary" onPress={() => router.push('/addresses')} />
      </Card>

      <Card>
        <Text variant="heading">Payment</Text>
        {methods.includes('COD') ? (
          <Option
            label="Cash on delivery"
            detail="Pay the delivery partner"
            selected={pay === 'COD'}
            onPress={() => setChoice('COD')}
          />
        ) : null}
        {online.length ? (
          <Option
            label="Pay online"
            detail={online.map((m) => ONLINE_LABEL[m]).join(', ')}
            selected={pay === 'ONLINE'}
            onPress={() => setChoice('ONLINE')}
          />
        ) : null}
        {pay === 'ONLINE' ? (
          <Text variant="small">
            A secure payment page opens after you place the order. The restaurant gets your order once the
            payment is confirmed.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text variant="heading">Notes</Text>
        <TextField
          label="Note for the restaurant (optional)"
          value={restaurantInstructions}
          onChangeText={setRestaurantNote}
          maxLength={300}
          placeholder="e.g. less spicy"
        />
        <TextField
          label="Note for the delivery partner (optional)"
          value={deliveryInstructions}
          onChangeText={setDeliveryNote}
          maxLength={300}
          placeholder="e.g. ring the bell twice"
        />
        <ToggleRow
          label="Contactless delivery"
          description="Leave the order at the door."
          value={contactless}
          onValueChange={setContactless}
        />
      </Card>

      <Card>
        <Text variant="heading">Bill</Text>
        {!address ? (
          <Text variant="muted">Choose an address to see the final bill.</Text>
        ) : q.isPending ? (
          <LoadingState label="Working out your bill" />
        ) : data?.bill ? (
          <>
            {data.bill.lines.map((b) => (
              <View key={b.code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text>{b.label}</Text>
                <Text>{money(b.amountPaise)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{pay === 'COD' ? 'To pay (cash)' : 'To pay (online)'}</Text>
              <Text style={{ fontWeight: '700' }}>{money(total)}</Text>
            </View>
          </>
        ) : null}
        {data?.issues?.map((i) => (
          <Banner key={`${i.code}-${i.lineKey ?? ''}`} tone="warning">
            {i.message}
          </Banner>
        ))}
      </Card>

      {problem ? (
        <Banner tone="critical">
          {[
            problem.message,
            ...(problem.issues ?? []).map((i) => i.message).filter((m) => m !== problem.message),
          ].join(' ')}
        </Banner>
      ) : null}
      <Button
        title={
          total != null
            ? `${pay === 'COD' ? 'Place order' : 'Place order and pay'} · ${money(total)}`
            : 'Place order'
        }
        busy={busy}
        disabled={!address || !data?.canCheckout || busy}
        onPress={placeOrder}
      />
      <Text variant="small">
        {pay === 'COD'
          ? 'By placing the order you agree to pay the total in cash on delivery.'
          : 'By placing the order you agree to pay the total online now.'}
      </Text>
    </Screen>
  );
}
