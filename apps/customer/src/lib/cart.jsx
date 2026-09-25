// The cart lives on the device (D-46): one restaurant at a time. Prices shown before the server quote are
// menu prices for guidance; the bill always comes from POST /v1/customer/cart/quote.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { load, save } from './storage';

const KEY = 'jamzo.cart.v2';
const CartContext = createContext(null);

/** Same product, size and choices → same line. Hashed (cyrb53) so the key stays short for the API (≤ 64). */
export const lineKey = (l) =>
  hash([l.productId, l.variantId ?? '', [...(l.addonIds ?? [])].sort().join('+')].join('|'));
function hash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `l${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ restaurant: null, lines: [], couponCode: null, tipPaise: 0 });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    load(KEY, null).then((c) => {
      if (c) setCart(c);
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (ready) save(KEY, cart);
  }, [cart, ready]);

  const add = useCallback((restaurant, item) => {
    setCart((c) => {
      const base =
        c.restaurant?.id === restaurant.id ? c : { restaurant, lines: [], couponCode: null, tipPaise: 0 };
      const key = lineKey(item);
      const existing = base.lines.find((l) => l.key === key);
      const lines = existing
        ? base.lines.map((l) =>
            l.key === key ? { ...l, quantity: Math.min(50, l.quantity + item.quantity) } : l,
          )
        : [...base.lines, { ...item, key }];
      return { ...base, restaurant, lines };
    });
  }, []);
  const setQuantity = useCallback((key, quantity) => {
    setCart((c) => {
      const lines =
        quantity <= 0
          ? c.lines.filter((l) => l.key !== key)
          : c.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l));
      return lines.length ? { ...c, lines } : { restaurant: null, lines: [], couponCode: null, tipPaise: 0 };
    });
  }, []);
  const clear = useCallback(
    () => setCart({ restaurant: null, lines: [], couponCode: null, tipPaise: 0 }),
    [],
  );
  const setCoupon = useCallback(
    (couponCode) => setCart((c) => ({ ...c, couponCode: couponCode || null })),
    [],
  );
  const setTip = useCallback((tipPaise) => setCart((c) => ({ ...c, tipPaise })), []);

  const value = useMemo(
    () => ({
      ...cart,
      ready,
      count: cart.lines.reduce((n, l) => n + l.quantity, 0),
      add,
      setQuantity,
      clear,
      setCoupon,
      setTip,
    }),
    [cart, ready, add, setQuantity, clear, setCoupon, setTip],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
