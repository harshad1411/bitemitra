// Phase 1 shell. Signing in does NOT make someone a restaurant partner (OD-13): what they see depends on
// the approval status the API reports. Order alerts and management arrive in Phase 5, menus in Phase 2.
import { useState } from 'react';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork } from '@jamzo/mobile-foundation';
import { Banner, Button, Card, Screen, Text } from '@jamzo/mobile-ui';

const STATUS_LABEL = {
  DRAFT: 'Draft',
  DOCUMENTS_PENDING: 'Documents pending',
  REVIEW: 'In review',
  APPROVED: 'Approved — not yet live',
  ACTIVE: 'Active',
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
  return (
    <>
      {status === 'PENDING_APPROVAL' ? (
        <Banner tone="info">Your restaurant is not live yet. We'll let you know when it's approved.</Banner>
      ) : null}
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

export default function Home() {
  const { session, env, config, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  const me = session.me;
  return (
    <Screen>
      <Text variant="title">{MOBILE_APPS.RESTAURANT.displayName}</Text>
      <Text variant="muted">Signed in as {me?.user.phone}</Text>
      <Access me={me} support={config?.support} />
      {me?.access.status === 'OK' ? (
        <Card>
          <Text variant="heading">Coming soon</Text>
          <Text variant="muted">
            New-order alerts and order management arrive in Phase 5; menu and availability management in Phase
            2.
          </Text>
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">Order alerts</Text>
        <Text variant="muted">
          {push
            ? `${push.status}${push.reason ? ` — ${push.reason}` : ''}`
            : 'Allow notifications so new orders are hard to miss (from Phase 5).'}
        </Text>
        <Button
          title="Enable notifications"
          variant="secondary"
          onPress={async () =>
            setPush(
              await registerForPush({
                api,
                easProjectId: env.easProjectId,
                androidChannel: { id: 'orders', name: 'New orders' },
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
