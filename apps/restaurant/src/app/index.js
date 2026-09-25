// Restaurant Partner home. Signing in does NOT make someone a partner (OD-13): what they see depends on the
// approval status the API reports, and every action is re-checked by the API (D-42).
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork, userMessage } from '@jamzo/mobile-foundation';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  ToggleRow,
} from '@jamzo/mobile-ui';
import { useResource } from '../lib/use-resource';
import { openText } from '../lib/format';

const STATUS_LABEL = {
  DRAFT: 'Draft',
  DOCUMENTS_PENDING: 'Documents pending',
  REVIEW: 'In review',
  APPROVED: 'Approved — not yet live',
  ACTIVE: 'Live',
  SUSPENDED: 'Suspended',
};

function Access({ me, support }) {
  const { status } = me.access;
  if (status === 'NOT_REGISTERED') {
    return (
      <Banner tone="warning">
        This number isn't linked to a Jamzo restaurant yet. Ask the restaurant owner to add you, or contact
        Jamzo partner support
        {support?.phone ? ` on ${support.phone}` : ''}.
      </Banner>
    );
  }
  if (status === 'BLOCKED') {
    return (
      <Banner tone="critical">
        Your access to this restaurant is paused. Please contact Jamzo partner support.
      </Banner>
    );
  }
  return (
    <>
      <Banner tone="info">Your restaurant is not approved yet. We'll let you know when it is.</Banner>
      {me.restaurants.map((r) => (
        <Card key={r.id}>
          <Text variant="heading">{r.name}</Text>
          <Text variant="muted">
            {STATUS_LABEL[r.onboardingStatus] ?? r.onboardingStatus} · your role: {r.role.toLowerCase()}
          </Text>
        </Card>
      ))}
    </>
  );
}

/** Open / pause / busy / preparation time for one branch (owners and managers). */
function BranchControls({ branch, store, onChange }) {
  const { api } = useJamzo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const can = store.capabilities['store.status'];
  const tz = store.restaurant.city.timezone;
  const status = openText(branch.openState, tz);
  const paused = branch.openState.reason === 'PAUSED';
  const update = async (body) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.patch(`/v1/restaurant/branches/${branch.id}/status`, body));
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">{branch.name}</Text>
      <Badge tone={status.tone}>{status.text}</Badge>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {can ? (
        <>
          <ToggleRow
            label="Accepting orders"
            description={
              branch.isOpen ? 'Switch off to close until you switch it back on.' : 'You are closed.'
            }
            value={branch.isOpen}
            disabled={busy}
            onValueChange={(isOpen) => update({ isOpen })}
          />
          {paused ? (
            <Button
              title="Resume now"
              variant="secondary"
              busy={busy}
              onPress={() => update({ pauseMinutes: 0 })}
            />
          ) : (
            <>
              <Text variant="small">Pause new orders for a short while:</Text>
              {[15, 30, 60]
                .filter((n) => n <= store.limits.maxPauseMinutes)
                .map((n) => (
                  <Button
                    key={n}
                    title={`Pause ${n} minutes`}
                    variant="secondary"
                    disabled={busy || !branch.isOpen}
                    onPress={() => update({ pauseMinutes: n })}
                  />
                ))}
            </>
          )}
          <ToggleRow
            label="Busy mode"
            description="Customers see a longer preparation time."
            value={branch.busyMode}
            disabled={busy}
            onValueChange={(busyMode) => update({ busyMode })}
          />
          <Text variant="body">Preparation time: {branch.prepTimeMinutes} minutes</Text>
          <Button
            title="− 5 minutes"
            variant="secondary"
            disabled={busy || branch.prepTimeMinutes <= 5}
            onPress={() => update({ prepTimeMinutes: branch.prepTimeMinutes - 5 })}
          />
          <Button
            title="+ 5 minutes"
            variant="secondary"
            disabled={busy}
            onPress={() => update({ prepTimeMinutes: branch.prepTimeMinutes + 5 })}
          />
        </>
      ) : (
        <Text variant="muted">Only owners and managers can change the store status.</Text>
      )}
    </Card>
  );
}

function Store({ restaurantId }) {
  const { api } = useJamzo();
  const router = useRouter();
  const store = useResource(() => api.get(`/v1/restaurant/restaurants/${restaurantId}`), [restaurantId]);
  if (store.status === 'loading') return <LoadingState label="Loading your store" />;
  if (store.status === 'error' && !store.data)
    return <ErrorState message={userMessage(store.error)} onRetry={store.reload} />;
  const s = store.data;
  return (
    <>
      {s.restaurant.onboardingStatus === 'APPROVED' ? (
        <Banner tone="info">
          You're approved. Customers can order once Jamzo makes your restaurant live.
        </Banner>
      ) : null}
      {s.branches.map((b) => (
        <BranchControls key={b.id} branch={b} store={s} onChange={store.setData} />
      ))}
      <Button
        title="Orders"
        onPress={() =>
          router.push({ pathname: '/orders', params: { restaurantId, timeZone: s.restaurant.city.timezone } })
        }
      />
      {s.capabilities['orders.finance'] ? (
        <Button
          title="Payouts"
          variant="secondary"
          onPress={() => router.push({ pathname: '/payouts', params: { restaurantId } })}
        />
      ) : null}
      {s.capabilities['orders.finance'] ? (
        <Button
          title="Sales"
          variant="secondary"
          onPress={() => router.push({ pathname: '/sales', params: { restaurantId } })}
        />
      ) : null}
      <Button
        title="Menu & sold-out items"
        onPress={() => router.push({ pathname: '/menu', params: { restaurantId } })}
      />
      <Text variant="small">Menu content and prices are edited by Jamzo for now.</Text>
    </>
  );
}

export default function Home() {
  const { session, env, config, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  const me = session.me;
  const approved = (me?.restaurants ?? []).filter((r) => r.approved);
  const [selected, setSelected] = useState(null);
  const restaurantId = selected ?? approved[0]?.id;
  return (
    <Screen>
      <Text variant="title">{MOBILE_APPS.RESTAURANT.displayName}</Text>
      <Text variant="muted">Signed in as {me?.user.phone}</Text>
      {me?.access.status === 'OK' && restaurantId ? (
        <>
          {approved.length > 1 ? (
            <Card>
              <Text variant="small">Your restaurants</Text>
              {approved.map((r) => (
                <Button
                  key={r.id}
                  title={r.name}
                  variant={r.id === restaurantId ? 'primary' : 'secondary'}
                  onPress={() => setSelected(r.id)}
                />
              ))}
            </Card>
          ) : (
            <Text variant="heading">{approved[0].name}</Text>
          )}
          <Store key={restaurantId} restaurantId={restaurantId} />
        </>
      ) : (
        <Access me={me} support={config?.support} />
      )}
      <Card>
        <Text variant="heading">Order alerts</Text>
        <Text variant="muted">
          {push
            ? `${push.status}${push.reason ? ` — ${push.reason}` : ''}`
            : 'Allow notifications so new orders reach you with a sound even when the app is closed.'}
        </Text>
        <Button
          title="Enable notifications"
          variant="secondary"
          onPress={async () =>
            setPush(
              await registerForPush({
                api,
                easProjectId: env.easProjectId,
                androidChannel: {
                  id: 'new-orders',
                  name: 'New orders',
                  importance: 'MAX',
                  sound: 'new_order.wav',
                },
              }),
            )
          }
        />
      </Card>
      <Card>
        <Text variant="heading">About this build</Text>
        <Text variant="small">
          Version {env.appVersion} ({env.variant}) · {env.platform} · {network.online ? 'online' : 'offline'}
        </Text>
        <Text variant="small">API {env.apiUrl}</Text>
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => session.signOut()} />
    </Screen>
  );
}
