// Delete my account (D-117; required by the app stores). Says plainly what is erased and what is kept, asks
// twice, then signs out. The customer has 30 days to change their mind by signing in again.
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, Header, Screen, Text } from '@jamzo/mobile-ui';

const day = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

export default function DeleteAccount() {
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
        <Button title="Done" onPress={() => router.replace('/')} />
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
      await session.signOut();
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
          <Text>• You are signed out on every phone and no longer get notifications.</Text>
          <Text>
            • After 30 days we erase your name, mobile number, email, saved addresses and favourites.
          </Text>
          <Text>
            • Your past orders and payments are kept for tax records, without your name, number or address.
          </Text>
          <Text>
            • Until then you can sign in again and keep your account. You cannot order while it is waiting.
          </Text>
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
