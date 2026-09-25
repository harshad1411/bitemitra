// Account: sign in/out, favourites, saved addresses, notifications, legal pages and build info.
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { registerForPush, useJamzo, useNetwork } from '@jamzo/mobile-foundation';
import { Button, Card, Screen, Text } from '@jamzo/mobile-ui';

function Favorites() {
  const router = useRouter();
  const { api } = useJamzo();
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => api.get('/v1/customer/favorites') });
  return (
    <Card>
      <Text variant="heading">Favourite restaurants</Text>
      {q.data?.items.length ? (
        q.data.items.map((r) => (
          <Button
            key={r.id}
            variant="secondary"
            title={r.name}
            onPress={() => router.push(`/restaurant/${r.id}`)}
          />
        ))
      ) : (
        <Text variant="muted">
          {q.isPending ? 'Loading…' : 'No favourites yet. Tap ♡ on a restaurant to save it.'}
        </Text>
      )}
    </Card>
  );
}

export default function Account() {
  const router = useRouter();
  const { session, env, config, api } = useJamzo();
  const network = useNetwork();
  const [push, setPush] = useState(null);
  const signedIn = session.status === 'signedIn';
  return (
    <Screen>
      <Text variant="title">Account</Text>
      {signedIn ? (
        <>
          <Text variant="muted">Signed in as {session.me?.user.phone ?? session.me?.user.email}</Text>
          <Button title="Your orders" variant="secondary" onPress={() => router.push('/orders')} />
          <Button title="Saved addresses" variant="secondary" onPress={() => router.push('/addresses')} />
          <Button title="Help" variant="secondary" onPress={() => router.push('/support')} />
          <Favorites />
          <Card>
            <Text variant="heading">Notifications</Text>
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
                    androidChannel: { id: 'order-updates', name: 'Order updates', importance: 'HIGH' },
                  }),
                )
              }
            />
          </Card>
        </>
      ) : (
        <Card>
          <Text variant="muted">You’re browsing as a guest. Sign in to save addresses and favourites.</Text>
          <Button title="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      )}
      <Card>
        <Text variant="heading">Legal</Text>
        <Button title="Terms of use" variant="secondary" onPress={() => router.push('/page/terms')} />
        <Button title="Privacy policy" variant="secondary" onPress={() => router.push('/page/privacy')} />
        <Button
          title="Cancellation and refund policy"
          variant="secondary"
          onPress={() => router.push('/page/refunds')}
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
      {signedIn ? <Button title="Sign out" variant="secondary" onPress={() => session.signOut()} /> : null}
    </Screen>
  );
}
