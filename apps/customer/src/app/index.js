// Phase 1 shell: honest about what exists. Ordering (discovery, menus, cart, checkout) arrives in Phase 3–5.
import { useState } from 'react';
import { MOBILE_APPS } from '@jamzo/config/apps';
import { registerForPush, useJamzo, useNetwork } from '@jamzo/mobile-foundation';
import { Button, Card, Screen, Text } from '@jamzo/mobile-ui';

export default function Home() {
  const { session, env, config, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  return (
    <Screen>
      <Text variant="title">{MOBILE_APPS.CUSTOMER.displayName}</Text>
      <Text variant="muted">Signed in as {session.me?.user.phone ?? session.me?.user.email}</Text>
      <Card>
        <Text variant="heading">Coming soon</Text>
        <Text variant="muted">
          Restaurant discovery, menus and your cart arrive in Phase 3; ordering and payment in Phases 4–7.
        </Text>
      </Card>
      <Card>
        <Text variant="heading">Notifications</Text>
        <Text variant="muted">
          {push ? `${push.status}${push.reason ? ` — ${push.reason}` : ''}` : 'Not requested yet.'}
        </Text>
        <Button
          title="Enable notifications"
          variant="secondary"
          onPress={async () => setPush(await registerForPush({ api, easProjectId: env.easProjectId }))}
        />
      </Card>
      <Card>
        <Text variant="heading">About this build</Text>
        <Text variant="small">
          Version {env.appVersion} ({env.variant}) · {env.platform} · {network.online ? 'online' : 'offline'}
        </Text>
        <Text variant="small">API {env.apiUrl}</Text>
        {config?.support?.phone ? <Text variant="small">Support {config.support.phone}</Text> : null}
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => session.signOut()} />
    </Screen>
  );
}
