// "Order again" (D-116): the server rebuilds the cart from today's menu; the cart screen then gets a fresh
// quote as always. Dishes that cannot be ordered the same way now are named on the cart screen.
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { useCart } from './cart';

const WHY = { SOLD_OUT: 'sold out', REMOVED: 'no longer on the menu', OPTIONS_CHANGED: 'options changed' };

/** Returns `orderAgain(orderId)`. */
export function useReorder() {
  const { api } = useJamzo();
  const cart = useCart();
  const router = useRouter();
  return async (orderId) => {
    let r;
    try {
      r = await api.post(`/v1/customer/orders/${orderId}/reorder`, {}, { idempotencyKey: false });
    } catch (err) {
      Alert.alert('Could not repeat this order', userMessage(err));
      return;
    }
    if (!r.lines.length) {
      Alert.alert('Not available now', 'None of the dishes from this order can be ordered right now.');
      return;
    }
    const fill = () => {
      cart.clear();
      for (const line of r.lines) cart.add(r.restaurant, line);
      const notice = r.skipped.length
        ? `Not added: ${r.skipped.map((s) => `${s.name} (${WHY[s.reason] ?? 'not available'})`).join(', ')}.`
        : undefined;
      router.push({ pathname: '/cart', params: notice ? { notice } : {} });
    };
    if (cart.lines.length)
      Alert.alert('Replace your cart?', 'Your cart will be replaced with the dishes from this order.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: fill },
      ]);
    else fill();
  };
}
