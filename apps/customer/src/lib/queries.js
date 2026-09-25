// Server state (TanStack Query, D-55). Every price comes from the API — the app never computes money.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useJamzo } from '@jamzo/mobile-foundation';
import { locationParams } from './location';

export function useHome(place) {
  const { api } = useJamzo();
  return useQuery({
    queryKey: ['home', place],
    queryFn: () => api.get('/v1/customer/home', locationParams(place)),
    enabled: Boolean(place),
  });
}

export function useRestaurant(id, place) {
  const { api } = useJamzo();
  return useQuery({
    queryKey: ['restaurant', id, place],
    queryFn: () => api.get(`/v1/customer/restaurants/${id}`, locationParams(place)),
    enabled: Boolean(id),
  });
}

export function useSearch(q, place) {
  const { api } = useJamzo();
  return useQuery({
    queryKey: ['search', q, place],
    queryFn: () => api.get('/v1/customer/search', { q, ...locationParams(place) }),
    enabled: Boolean(place) && q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useQuote(cart, place) {
  const { api } = useJamzo();
  const body =
    cart.restaurant && place
      ? {
          restaurantId: cart.restaurant.id,
          lines: cart.lines.map((l) => ({
            key: l.key,
            productId: l.productId,
            variantId: l.variantId ?? null,
            addonIds: l.addonIds ?? [],
            quantity: l.quantity,
          })),
          ...locationParams(place),
          couponCode: cart.couponCode ?? undefined,
          tipPaise: cart.tipPaise ?? 0,
        }
      : null;
  return useQuery({
    queryKey: ['quote', body],
    // Quotes are read-only, so no idempotency key is needed.
    queryFn: () => api.post('/v1/customer/cart/quote', body, { idempotencyKey: false }),
    enabled: Boolean(body && body.lines.length),
    placeholderData: keepPreviousData,
  });
}

export function useAddresses(enabled) {
  const { api } = useJamzo();
  return useQuery({ queryKey: ['addresses'], queryFn: () => api.get('/v1/customer/addresses'), enabled });
}
