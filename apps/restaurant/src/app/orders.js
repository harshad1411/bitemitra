// Orders for one restaurant (spec §19, §20). New orders are hard to miss: they sit on top, the chime loops
// until each is accepted or rejected, and the time left to accept is shown. Refreshed by realtime notices
// and every 15 seconds (D-62).
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useJamzo, useRealtime, userMessage } from '@jamzo/mobile-foundation';
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
  useTheme,
} from '@jamzo/mobile-ui';
import { formatPaise } from '@jamzo/ui';
import { useNewOrderAlert } from '../lib/alert';
import { KITCHEN_LABEL, PREP_CHOICES, REJECT_REASONS, itemLine, timeText } from '../lib/orders';
import { useResource } from '../lib/use-resource';

const VIEWS = [
  ['NEW', 'New'],
  ['ACTIVE', 'In the kitchen'],
  ['PAST', 'Past'],
];

function NewOrder({ o, onAct, busy }) {
  const t = useTheme();
  const [rejecting, setRejecting] = useState(false);
  const left = Math.max(0, Math.round((new Date(o.acceptBy).getTime() - Date.now()) / 60_000));
  return (
    <Card style={{ borderWidth: 2, borderColor: t.colors.primary }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title" accessibilityRole="header">{`#${o.shortNumber}`}</Text>
        <Badge tone="warning">New</Badge>
      </View>
      <Text variant="muted">{`${o.customer.firstName} · ${o.payment.label}`}</Text>
      {o.items.map((i, n) => (
        <Text key={n}>{itemLine(i)}</Text>
      ))}
      {o.restaurantInstructions ? <Banner tone="info">{`Note: ${o.restaurantInstructions}`}</Banner> : null}
      <Text variant="heading">{`Food value ${formatPaise(o.foodValuePaise)}`}</Text>
      <Text variant="small">{left > 0 ? `Accept within ${left} min` : 'Accept now — time is up'}</Text>
      {rejecting ? (
        <>
          <Text variant="heading">Why can’t you take this order?</Text>
          {REJECT_REASONS.map(([code, label]) => (
            <Button
              key={code}
              title={label}
              variant="secondary"
              busy={busy}
              onPress={() => onAct(o, 'reject', { reasonCode: code })}
            />
          ))}
          <Button title="Back" variant="secondary" onPress={() => setRejecting(false)} />
        </>
      ) : (
        <>
          <Text variant="small">Accept with preparation time:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PREP_CHOICES.map((m) => (
              <Button
                key={m}
                title={`Accept · ${m} min`}
                busy={busy}
                onPress={() => onAct(o, 'accept', { prepTimeMinutes: m })}
              />
            ))}
          </View>
          <Button title="Reject order" variant="secondary" onPress={() => setRejecting(true)} />
        </>
      )}
    </Card>
  );
}

function KitchenOrder({ o, onAct, busy, onOpen, timeZone }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading">{`#${o.shortNumber}`}</Text>
        <Badge tone={o.restaurantStatus === 'READY_FOR_PICKUP' ? 'success' : 'info'}>
          {KITCHEN_LABEL[o.restaurantStatus]}
        </Badge>
      </View>
      {o.items.map((i, n) => (
        <Text key={n}>{itemLine(i)}</Text>
      ))}
      {o.estimatedPickupAt ? (
        <Text variant="small">{`Ready by ${timeText(o.estimatedPickupAt, timeZone)}`}</Text>
      ) : null}
      {o.restaurantStatus === 'ACCEPTED' ? (
        <Button title="Start preparing" busy={busy} onPress={() => onAct(o, 'preparing')} />
      ) : null}
      {o.restaurantStatus === 'ACCEPTED' || o.restaurantStatus === 'PREPARING' ? (
        <>
          <Button title="Food is ready" busy={busy} onPress={() => onAct(o, 'ready')} />
          <Button
            title="Need 5 more minutes"
            variant="secondary"
            busy={busy}
            onPress={() => onAct(o, 'prep-time', { prepTimeMinutes: o.prepTimeMinutes + 5 })}
          />
        </>
      ) : null}
      {o.restaurantStatus === 'READY_FOR_PICKUP' ? (
        <Text variant="small">Waiting for the delivery partner.</Text>
      ) : null}
      <Button
        title="Details"
        variant="secondary"
        accessibilityHint={`Order ${o.orderNumber}`}
        onPress={() => onOpen(o)}
      />
    </Card>
  );
}

export default function Orders() {
  const { restaurantId, timeZone = 'Asia/Kolkata' } = useLocalSearchParams();
  const { api } = useJamzo();
  const router = useRouter();
  const [view, setView] = useState('NEW');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const list = useResource(
    () => api.get('/v1/restaurant/orders', { restaurantId, view }),
    [restaurantId, view],
  );
  // New orders are counted even while another tab is shown: the alert must not stop because of a tab.
  const waiting = useResource(
    () => api.get('/v1/restaurant/orders', { restaurantId, view: 'NEW' }),
    [restaurantId],
  );
  const reloads = useRef({ list: list.reload, waiting: waiting.reload });
  reloads.current = { list: list.reload, waiting: waiting.reload };
  useEffect(() => {
    const t = setInterval(() => {
      reloads.current.list();
      reloads.current.waiting();
    }, 15_000);
    return () => clearInterval(t);
  }, []);
  useRealtime({
    subscribe: { restaurantId },
    onOrderUpdated: () => {
      reloads.current.list();
      reloads.current.waiting();
    },
  });
  const newOrders = useMemo(() => waiting.data?.items ?? [], [waiting.data]);
  useNewOrderAlert(newOrders.length > 0);
  // Tell Jamzo the restaurant has seen each new order (the customer sees "seen by the restaurant").
  const seen = useRef(new Set());
  useEffect(() => {
    for (const o of newOrders)
      if (!seen.current.has(o.id)) {
        seen.current.add(o.id);
        api
          .post(`/v1/restaurant/orders/${o.id}/seen`, {}, { idempotencyKey: false })
          .catch(() => seen.current.delete(o.id));
      }
  }, [newOrders, api]);

  const act = async (o, step, extra = {}) => {
    setBusy(o.id);
    setError(null);
    try {
      await api.post(
        `/v1/restaurant/orders/${o.id}/${step}`,
        { version: o.version, ...extra },
        { idempotencyKey: false },
      );
    } catch (err) {
      setError(
        err?.code === 'CONFLICT' ? 'This order just changed. The list has been refreshed.' : userMessage(err),
      );
    } finally {
      setBusy(null);
      list.reload();
      waiting.reload();
    }
  };

  const items = list.data?.items ?? [];
  return (
    <Screen>
      <Text variant="title">Orders</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {VIEWS.map(([v, label]) => (
          <Button
            key={v}
            title={v === 'NEW' && newOrders.length ? `${label} (${newOrders.length})` : label}
            variant={view === v ? 'primary' : 'secondary'}
            onPress={() => setView(v)}
          />
        ))}
      </View>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {list.status === 'loading' ? (
        <LoadingState label="Loading orders" />
      ) : list.status === 'error' && !list.data ? (
        <ErrorState message={userMessage(list.error)} onRetry={list.reload} />
      ) : !items.length ? (
        <EmptyState
          title={
            view === 'NEW'
              ? 'No new orders'
              : view === 'ACTIVE'
                ? 'Nothing in the kitchen'
                : 'No past orders yet'
          }
          message={
            view === 'NEW' ? 'New orders appear here with a sound, even when another tab is open.' : ''
          }
        />
      ) : (
        items.map((o) =>
          view === 'NEW' ? (
            <NewOrder key={o.id} o={o} onAct={act} busy={busy === o.id} />
          ) : (
            <KitchenOrder
              key={o.id}
              o={o}
              onAct={act}
              busy={busy === o.id}
              timeZone={timeZone}
              onOpen={(x) => router.push({ pathname: '/order/[id]', params: { id: x.id, timeZone } })}
            />
          ),
        )
      )}
    </Screen>
  );
}
