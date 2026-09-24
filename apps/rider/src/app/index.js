// Phase 1 shell. Signing in does NOT make someone a delivery partner (OD-13). Going online, trips,
// navigation, COD and earnings arrive in Phase 6; location is declared but not requested yet.
import { useState } from 'react';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, Screen, Text } from '@jamzo/mobile-ui';

const MESSAGES = {
  OK: { tone: 'success', text: "You're an approved Jamzo delivery partner." },
  PENDING_APPROVAL: {
    tone: 'info',
    text: 'Your application is under review. We will notify you when you are approved.',
  },
  BLOCKED: {
    tone: 'critical',
    text: 'Your delivery partner account is not active. Please contact partner support.',
  },
  NOT_REGISTERED: {
    tone: 'warning',
    text: "This number isn't registered as a delivery partner. Self sign-up arrives with rider onboarding in Phase 6.",
  },
};

export default function Home() {
  const { session, env, config, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  const me = session.me;
  const msg = MESSAGES[me?.access.status] ?? MESSAGES.NOT_REGISTERED;
  return (
    <Screen>
      <Text variant="title">{MOBILE_APPS.RIDER.displayName}</Text>
      <Text variant="muted">Signed in as {me?.user.phone}</Text>
      <Banner tone={msg.tone}>
        {msg.text}
        {me?.access.status !== 'OK' && config?.support?.phone ? ` Support: ${config.support.phone}.` : ''}
      </Banner>
      {me?.access.status === 'OK' ? (
        <Card>
          <Text variant="heading">Coming soon</Text>
          <Text variant="muted">
            Going online, delivery requests, navigation, cash on delivery and earnings arrive in Phase 6.
          </Text>
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">Delivery request alerts</Text>
        <Text variant="muted">
          {push ? `${push.status}${push.reason ? ` — ${push.reason}` : ''}` : 'Not requested yet.'}
        </Text>
        <Button
          title="Enable notifications"
          variant="secondary"
          onPress={async () =>
            setPush(
              await registerForPush({
                api,
                easProjectId: env.easProjectId,
                androidChannel: { id: 'offers', name: 'Delivery requests' },
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
        <Text variant="small">Location: declared for Phase 6, not requested yet.</Text>
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => session.signOut()} />
    </Screen>
  );
}
