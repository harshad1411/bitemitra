// Maintenance / forced update / optional update gate driven by remote config (spec §72–§73).
import { useState } from 'react';
import { Linking } from 'react-native';
import { Banner, Button, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { decideGate, userMessage } from './core/index.js';
import { useJamzo } from './provider.jsx';

export function AppGate({ children }) {
  const { config, configStatus, configError, refreshConfig, env } = useJamzo();
  const [dismissed, setDismissed] = useState(false);
  if (configStatus === 'loading')
    return (
      <Screen scroll={false}>
        <LoadingState label="Starting" />
      </Screen>
    );
  if (configStatus === 'error') {
    return (
      <Screen scroll={false}>
        <ErrorState title="Can't reach Jamzo" message={userMessage(configError)} onRetry={refreshConfig} />
      </Screen>
    );
  }
  const gate = decideGate(config);
  if (gate.screen === 'MAINTENANCE') {
    return (
      <Screen scroll={false}>
        <ErrorState
          title="We'll be right back"
          message={gate.message ?? 'Jamzo is under maintenance. Please try again soon.'}
          onRetry={refreshConfig}
        />
      </Screen>
    );
  }
  if (gate.screen === 'FORCE_UPDATE') {
    return (
      <Screen scroll={false}>
        <Text variant="title">Update required</Text>
        <Text variant="muted">
          This version ({env.appVersion}) is no longer supported. Please update to continue.
        </Text>
        {gate.storeUrl ? (
          <Button title="Update now" onPress={() => Linking.openURL(gate.storeUrl)} />
        ) : (
          <Text variant="small">Store link not configured yet.</Text>
        )}
      </Screen>
    );
  }
  return (
    <>
      {gate.recommendUpdate && !dismissed ? (
        <Banner
          tone="info"
          action={
            <Button
              title={gate.storeUrl ? 'Update' : 'Dismiss'}
              variant="secondary"
              onPress={() => (gate.storeUrl ? Linking.openURL(gate.storeUrl) : setDismissed(true))}
            />
          }
        >
          A newer version is available.
        </Banner>
      ) : null}
      {children}
    </>
  );
}
