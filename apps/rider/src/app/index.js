// Delivery Partner home. Signing in does NOT make someone a delivery partner (OD-13): applicants see their
// application, and only ACTIVE partners can go online and receive requests (D-73, D-74).
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork, useRealtime, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, ErrorState, LoadingState, Screen, Text, ToggleRow } from '@jamzo/mobile-ui';
import { OfferCard, TripCard } from '../components/work';
import { STATUS_TEXT, money } from '../lib/format';
import { startTracking, stopTracking } from '../lib/location';

function Work({ me }) {
  const { api } = useJamzo();
  const qc = useQueryClient();
  const router = useRouter();
  const work = useQuery({
    queryKey: ['work'],
    queryFn: () => api.get('/v1/rider/work'),
    refetchInterval: 10_000,
  });
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['work'] });
    qc.invalidateQueries({ queryKey: ['rider-me'] });
  };
  useRealtime({ onOrderUpdated: refresh });
  const online = work.data?.online ?? me.online;
  // Keep the location task in step with the server's online state (e.g. after an app restart).
  useEffect(() => {
    if (online && work.data?.intervals)
      startTracking({ intervalSec: work.data.intervals.tripIntervalSec }).catch(() => {});
  }, [online, work.data?.intervals]);
  const setOnline = async (next) => {
    setBusy(true);
    setError(null);
    try {
      if (next) {
        const t = await startTracking({ intervalSec: work.data?.intervals?.tripIntervalSec ?? 10 });
        if (!t.ok) throw new Error(t.reason);
        if (!t.background)
          setError('Allow location "All the time" so requests reach you with the app in the background.');
      }
      await api.post('/v1/rider/status', { online: next }, { idempotencyKey: false });
      if (!next) await stopTracking();
      setDisclosure(false);
    } catch (err) {
      setError(err?.code ? userMessage(err) : err.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return (
    <>
      {disclosure ? (
        <Card>
          <Text variant="heading">Location while you are online</Text>
          <Text>
            Jamzo collects your location while you are online — also when the app is closed or not in use — to
            send you nearby delivery requests and to let customers track their order. Location is not
            collected when you are offline.
          </Text>
          <Button title="Continue and go online" busy={busy} onPress={() => setOnline(true)} />
          <Button title="Not now" variant="secondary" onPress={() => setDisclosure(false)} />
        </Card>
      ) : (
        <ToggleRow
          label={online ? 'You are online' : 'You are offline'}
          description={
            online ? 'You will receive delivery requests.' : 'Go online to receive delivery requests.'
          }
          value={online}
          disabled={busy || me.activeOrderCount > 0}
          onValueChange={(next) => (next ? setDisclosure(true) : setOnline(false))}
        />
      )}
      {error ? <Banner tone="warning">{error}</Banner> : null}
      {work.isPending ? (
        <LoadingState label="Checking for requests" />
      ) : work.isError ? (
        <ErrorState message={userMessage(work.error)} onRetry={() => work.refetch()} />
      ) : work.data.trip ? (
        <TripCard trip={work.data.trip} support={work.data.support} onChanged={refresh} />
      ) : work.data.offer ? (
        <OfferCard offer={work.data.offer} onChanged={refresh} />
      ) : online ? (
        <Card>
          <Text variant="heading">Waiting for delivery requests</Text>
          <Text variant="muted">
            Keep the app open or allow background location. Requests appear here with a vibration.
          </Text>
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">Cash in hand</Text>
        <Text>{money(me.cod.balancePaise)}</Text>
        {me.cod.limitPaise ? (
          <Text variant="small">{`Limit ${money(me.cod.limitPaise)}. Depositing cash arrives with settlements.`}</Text>
        ) : null}
      </Card>
      <Button title="Earnings" variant="secondary" onPress={() => router.push('/earnings')} />
    </>
  );
}

export default function Home() {
  const router = useRouter();
  const { session, env, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  const q = useQuery({ queryKey: ['rider-me'], queryFn: () => api.get('/v1/rider/me') });
  const r = q.data?.rider;
  return (
    <Screen>
      <Text variant="title">{MOBILE_APPS.RIDER.displayName}</Text>
      <Text variant="muted">{`Signed in as ${session.me?.user.phone ?? ''}`}</Text>
      {q.isPending ? (
        <LoadingState label="Loading" />
      ) : q.isError ? (
        <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.applied ? (
        <Card>
          <Text variant="heading">Become a Jamzo delivery partner</Text>
          <Text variant="muted">Apply in a few minutes: your details, vehicle and document photos.</Text>
          <Button title="Start application" onPress={() => router.push('/apply')} />
        </Card>
      ) : r.onboardingStatus === 'ACTIVE' ? (
        <Work me={r} />
      ) : (
        <>
          <Banner tone={['SUSPENDED', 'REJECTED'].includes(r.onboardingStatus) ? 'critical' : 'info'}>
            {STATUS_TEXT[r.onboardingStatus]}
          </Banner>
          {['APPLIED', 'DOCUMENT_PENDING'].includes(r.onboardingStatus) ? (
            <Button title="Continue application" onPress={() => router.push('/apply')} />
          ) : null}
        </>
      )}
      <Card>
        <Text variant="heading">Delivery request alerts</Text>
        <Text variant="muted">
          {push
            ? `${push.status}${push.reason ? ` — ${push.reason}` : ''}`
            : 'Allow notifications so requests reach you when the app is closed.'}
        </Text>
        <Button
          title="Enable notifications"
          variant="secondary"
          onPress={async () =>
            setPush(
              await registerForPush({
                api,
                easProjectId: env.easProjectId,
                androidChannel: { id: 'delivery-requests', name: 'Delivery requests', importance: 'MAX' },
              }),
            )
          }
        />
      </Card>
      <Card>
        <Text variant="heading">About this build</Text>
        <Text variant="small">{`Version ${env.appVersion} (${env.variant}) · ${env.platform} · ${network.online ? 'online' : 'offline'}`}</Text>
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => session.signOut()} />
    </Screen>
  );
}
