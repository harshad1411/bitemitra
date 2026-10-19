// Delivery Partner home. Signing in does NOT make someone a delivery partner (OD-13): applicants see their
// application, and only ACTIVE partners can go online and receive requests (D-73, D-74).
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork, useRealtime, userMessage } from '@jamzo/mobile-foundation';
import {
  Banner,
  Button,
  Card,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  Text,
  useTheme,
} from '@jamzo/mobile-ui';
import { OfferCard, TripCard } from '../components/work';
import { STATUS_TEXT, money } from '../lib/format';
import { startTracking, stopTracking } from '../lib/location';

/** The big online / offline card at the top (D-119): green when taking requests, grey when not. */
function OnlineCard({ online, disabled, onChange, hint }) {
  const t = useTheme();
  const label = online ? 'You are online' : 'You are offline';
  return (
    <View
      style={{
        backgroundColor: online ? t.colors.action : t.colors.surfaceMuted,
        borderRadius: 20,
        padding: t.spacing[4],
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon
        name={online ? 'radio' : 'moon-outline'}
        size={28}
        color={online ? t.colors.onAction : t.colors.text}
      />
      <View style={{ flex: 1 }}>
        <Text variant="title" style={{ color: online ? t.colors.onAction : t.colors.text }}>
          {online ? 'Online' : 'Offline'}
        </Text>
        <Text variant="small" style={{ color: online ? t.colors.onAction : t.colors.textSubtle }}>
          {hint}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={online}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.colors.accent, false: t.colors.borderStrong }}
      />
    </View>
  );
}

/** A half-width tile (cash in hand, earnings). */
function Tile({ icon, title, value, small, onPress, label }) {
  const t = useTheme();
  const body = (
    <>
      <Icon name={icon} size={22} color={t.colors.primary} />
      <Text variant="small">{title}</Text>
      <Text variant="title">{value}</Text>
      {small ? <Text variant="small">{small}</Text> : null}
    </>
  );
  const style = {
    flex: 1,
    gap: 4,
    padding: t.spacing[3],
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  };
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

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
        <OnlineCard
          online={online}
          hint={online ? 'You will receive delivery requests.' : 'Go online to receive delivery requests.'}
          disabled={busy || me.activeOrderCount > 0}
          onChange={(next) => (next ? setDisclosure(true) : setOnline(false))}
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
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Tile
          icon="cash-outline"
          title="Cash in hand"
          value={money(me.cod.balancePaise)}
          small={me.cod.limitPaise ? `Limit ${money(me.cod.limitPaise)}` : null}
        />
        <Tile
          icon="wallet-outline"
          title="Earnings"
          value="View"
          small="Today, week, payouts"
          label="Earnings"
          onPress={() => router.push('/earnings')}
        />
      </View>
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
