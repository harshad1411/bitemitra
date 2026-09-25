// Adding an item: the cart holds one restaurant at a time, so adding from another asks first.
import { Alert } from 'react-native';
import { useCart } from './cart';

export function useAddToCart(restaurant) {
  const cart = useCart();
  return (item) => {
    const doAdd = () => cart.add({ id: restaurant.id, name: restaurant.name }, item);
    if (cart.restaurant && cart.restaurant.id !== restaurant.id)
      Alert.alert(
        'Start a new cart?',
        `Your cart has items from ${cart.restaurant.name}. Adding this will remove them.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start new cart', style: 'destructive', onPress: doAdd },
        ],
      );
    else doAdd();
  };
}
