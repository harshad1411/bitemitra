// Realtime order notices (D-62). The socket only says "order X changed"; screens re-fetch over REST, and
// they also poll, so a dropped connection never hides an order. Each connection attempt uses the current
// access token; an expired one is refreshed and the connection retried.
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useJamzo } from './provider.jsx';

/**
 * @param {{ enabled?: boolean, subscribe?: { restaurantId: string } | null,
 *           onOrderUpdated: (msg: { orderId: string, event: string, status: string, restaurantStatus: string, deliveryStatus: string }) => void }} opts
 */
export function useRealtime({ enabled = true, subscribe = null, onOrderUpdated }) {
  const { env, appId, session, api, getAccessToken, logger } = useJamzo();
  const handler = useRef(onOrderUpdated);
  handler.current = onOrderUpdated;
  const room = subscribe?.restaurantId ?? null;
  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    if (!enabled || !signedIn) return undefined;
    const socket = io(env.apiUrl, {
      path: '/v1/realtime',
      transports: ['websocket'],
      auth: (cb) => cb({ appId, token: getAccessToken() }),
      reconnectionDelayMax: 30_000,
    });
    let retried = false;
    socket.on('connect', () => {
      retried = false;
      if (room) socket.emit('subscribe', { restaurantId: room });
    });
    socket.on('connect_error', async (err) => {
      // Middleware refusals are not retried by socket.io itself: refresh the session once, then reconnect.
      if (!retried && (err?.message === 'TOKEN_EXPIRED' || err?.message === 'UNAUTHENTICATED')) {
        retried = true;
        try {
          if (await api.refreshSession()) socket.connect();
        } catch (e) {
          logger.warn('realtime token refresh failed', { errorCode: e?.code });
        }
      }
    });
    socket.on('order.updated', (msg) => handler.current?.(msg));
    return () => {
      socket.close();
    };
  }, [enabled, signedIn, env.apiUrl, appId, room, api, getAccessToken, logger]);
}
