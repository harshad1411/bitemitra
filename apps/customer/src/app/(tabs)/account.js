// Account: profile, orders, addresses, favourites, help, notifications, legal pages and build info, as a
// profile card and grouped rows (D-109).
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { registerForPush, useJamzo, useNetwork } from '@jamzo/mobile-foundation';
import { Button, Card, ListRow, SectionTitle, Screen, Text, useTheme } from '@jamzo/mobile-ui';

function Favorites() {
  const router = useRouter();
  const { api } = useJamzo();
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => api.get('/v1/customer/favorites') });
  return (
    <Card>
      <SectionTitle>Favourite restaurants</SectionTitle>
      {q.data?.items.length ? (
        q.data.items.map((r, i) => (
          <ListRow
            key={r.id}
            icon="heart"
            label={r.name}
            last={i === q.data.items.length - 1}
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

function Profile() {
  const t = useTheme();
  const { session } = useJamzo();
  const user = session.me?.user;
  const name = user?.name || 'Jamzo customer';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[4],
        backgroundColor: t.colors.surface,
        borderRadius: 20,
        padding: t.spacing[4],
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: t.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: t.fonts.displayBold, fontSize: 26, color: t.colors.primary }}>
          {name[0].toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="title" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="muted">Signed in as {user?.phone ?? user?.email}</Text>
      </View>
    </View>
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
      <Text variant="title" accessibilityRole="header">
        Account
      </Text>
      {signedIn ? (
        <>
          <Profile />
          <Card>
            <SectionTitle>Food delivery</SectionTitle>
            <ListRow icon="receipt-outline" label="Your orders" onPress={() => router.navigate('/orders')} />
            <ListRow
              icon="location-outline"
              label="Saved addresses"
              onPress={() => router.push('/addresses')}
            />
            <ListRow icon="chatbubbles-outline" label="Help" last onPress={() => router.push('/support')} />
          </Card>
          <Favorites />
          <Card>
            <SectionTitle>Notifications</SectionTitle>
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
          <Text variant="subheading">Sign in to order</Text>
          <Text variant="muted">You’re browsing as a guest. Sign in to save addresses and favourites.</Text>
          <Button title="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      )}
      <Card>
        <SectionTitle>Legal</SectionTitle>
        <ListRow
          icon="document-text-outline"
          label="Terms of use"
          onPress={() => router.push('/page/terms')}
        />
        <ListRow
          icon="shield-checkmark-outline"
          label="Privacy policy"
          onPress={() => router.push('/page/privacy')}
        />
        <ListRow
          icon="return-down-back-outline"
          label="Cancellation and refund policy"
          last
          onPress={() => router.push('/page/refunds')}
        />
      </Card>
      {signedIn ? (
        <Card>
          <ListRow icon="log-out-outline" label="Sign out" danger last onPress={() => session.signOut()} />
        </Card>
      ) : null}
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text variant="small">
          Version {env.appVersion} ({env.variant}) · {env.platform} · {network.online ? 'online' : 'offline'}
        </Text>
        <Text variant="small">API {env.apiUrl}</Text>
        {config?.support?.phone ? <Text variant="small">Support {config.support.phone}</Text> : null}
      </View>
    </Screen>
  );
}
