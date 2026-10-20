// Delete my account, shared by the three apps (D-117, D-120; required by the app stores). Says plainly what is
// erased and what is kept, asks twice, then signs out; 30 days to change one's mind by signing in again. The
// server decides whether deletion is allowed now (an order on its way, cash held, the only owner…) and says why.
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Header, Screen, Text } from '@jamzo/mobile-ui';
import { useJamzo } from './provider.jsx';
import { userMessage } from './core/index.js';

const day = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

/**
 * @param {{ points: string[], signOutFirst?: boolean }} p `points`: what happens, for this app. `signOutFirst`:
 *   sign out as soon as the request succeeds (apps that let guests browse); otherwise on "Done", because apps
 *   that require sign-in leave this screen as soon as the session ends.
 */
export function AccountDeletion({ points, signOutFirst = false }) {
  const router = useRouter();
  const { api, session } = useJamzo();
  const [step, setStep] = useState('explain'); // explain → confirm → done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scheduledFor, setScheduledFor] = useState(null);

  if (step === 'done')
    return (
      <Screen header={<Header title="Account deletion" back={false} />}>
        <Card>
          <Text variant="heading">Your account will be deleted on {day(scheduledFor)}</Text>
          <Text>
            You have been signed out. Changed your mind? Sign in with the same number before then and tap
            “Keep my account”.
          </Text>
        </Card>
        <Button
          title="Done"
          onPress={async () => {
            if (!signOutFirst) await session.signOut();
            router.replace('/');
          }}
        />
      </Screen>
    );

  if (session.status !== 'signedIn')
    return (
      <Screen header={<Header title="Delete my account" />}>
        <Text variant="muted">Sign in first to delete your account.</Text>
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/v1/me/deletion', {}, { idempotencyKey: false });
      setScheduledFor(r.scheduledFor);
      setStep('done');
      if (signOutFirst) await session.signOut();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title="Delete my account" />}>
      <Card>
        <Text variant="heading">What happens</Text>
        <View style={{ gap: 6 }}>
          {points.map((p) => (
            <Text key={p}>{`• ${p}`}</Text>
          ))}
        </View>
      </Card>
      {error ? <Banner tone="warning">{error}</Banner> : null}
      {step === 'explain' ? (
        <Button title="Delete my account" variant="secondary" onPress={() => setStep('confirm')} />
      ) : (
        <Card>
          <Text variant="heading">Are you sure?</Text>
          <Button title="Yes, delete my account" busy={busy} onPress={remove} />
          <Button title="No, keep it" variant="secondary" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  );
}

/** Shown while a deletion the user asked for is waiting: the date, and "Keep my account". */
export function DeletionPending({ blocked }) {
  const { api, session } = useJamzo();
  const [busy, setBusy] = useState(false);
  const at = session.me?.user?.deletionScheduledFor;
  if (!at) return null;
  return (
    <Card>
      <Text variant="heading">{`Your account will be deleted on ${day(at)}`}</Text>
      <Text variant="muted">{blocked}</Text>
      <Button
        title="Keep my account"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await api.delete('/v1/me/deletion');
            await session.reloadMe();
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}
