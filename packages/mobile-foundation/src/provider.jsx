// Composes the foundations for one app (OD-26). Each app renders <JamzoProvider appId=… accent=…>.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createApiClient } from '@jamzo/api-client';
import { ThemeProvider, createTheme } from '@jamzo/mobile-ui';
import { createConsoleAnalytics, createLogger, noopAnalytics } from './core/index.js';
import { getAppEnv } from './env.js';
import { createTokenStore } from './storage.js';
import { useAppLifecycle } from './lifecycle.js';
import { ErrorBoundary } from './error-boundary.jsx';

const FoundationContext = createContext(null);

export function JamzoProvider({ appId, accent, children }) {
  const env = useMemo(() => getAppEnv(), []);
  const logger = useMemo(
    () => createLogger({ app: appId, level: env.variant === 'production' ? 'warn' : 'debug' }),
    [appId, env.variant],
  );
  const analytics = useMemo(
    () => (env.variant === 'production' ? noopAnalytics : createConsoleAnalytics(logger)),
    [env.variant, logger],
  );
  const tokens = useMemo(() => createTokenStore(appId), [appId]);
  const [config, setConfig] = useState({ status: 'loading', value: null, error: null });
  const [session, setSession] = useState({ status: 'restoring', me: null });
  const refreshConfigRef = useRef(() => {});

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: env.apiUrl,
        appId,
        appVersion: env.appVersion,
        platform: env.platform,
        tokens,
        refreshMode: 'body',
        onSessionExpired: () => setSession({ status: 'signedOut', me: null }),
        onUpgradeRequired: () => refreshConfigRef.current(),
        onMaintenance: () => refreshConfigRef.current(),
      }),
    [env, appId, tokens],
  );

  const refreshConfig = useCallback(async () => {
    try {
      const value = await api.get('/v1/app-config');
      setConfig({ status: 'ready', value, error: null });
    } catch (error) {
      logger.warn('remote config failed', { errorCode: error?.code });
      setConfig((c) => ({ status: c.value ? 'ready' : 'error', value: c.value, error }));
    }
  }, [api, logger]);
  refreshConfigRef.current = refreshConfig;

  const reloadMe = useCallback(async () => {
    const me = await api.get('/v1/me');
    setSession({ status: 'signedIn', me });
    analytics.identify(me.user.id);
    return me;
  }, [api, analytics]);

  useEffect(() => {
    refreshConfig();
    (async () => {
      try {
        if ((await tokens.getRefreshToken()) && (await api.refreshSession())) {
          await reloadMe();
          return;
        }
      } catch (err) {
        logger.warn('session restore failed', { errorCode: err?.code });
      }
      setSession({ status: 'signedOut', me: null });
    })();
  }, [api, tokens, refreshConfig, reloadMe, logger]);

  useAppLifecycle({ onForeground: refreshConfig });

  const value = useMemo(
    () => ({
      appId,
      env,
      api,
      logger,
      analytics,
      config: config.value,
      configStatus: config.status,
      configError: config.error,
      refreshConfig,
      /** Current access token (memory only) — for the realtime connection. */
      getAccessToken: tokens.getAccessToken,
      session: {
        ...session,
        reloadMe,
        requestOtp: (phone) =>
          api.post('/v1/auth/otp/request', { channel: 'SMS', destination: phone }, { auth: false }),
        async verifyOtp(challengeId, code) {
          const res = await api.post(
            '/v1/auth/otp/verify',
            { challengeId, code },
            { auth: false, idempotencyKey: false },
          );
          await tokens.setTokens(res);
          setSession({ status: 'signedIn', me: res.me });
          analytics.identify(res.me.user.id);
          return res.me;
        },
        async signOut() {
          try {
            await api.post('/v1/auth/logout', {}, { idempotencyKey: false });
          } catch (err) {
            logger.warn('logout request failed; clearing locally', { errorCode: err?.code });
          }
          await tokens.clear();
          analytics.reset();
          setSession({ status: 'signedOut', me: null });
        },
      },
    }),
    [appId, env, api, logger, analytics, config, refreshConfig, session, reloadMe, tokens],
  );

  const theme = useMemo(() => createTheme(accent), [accent]);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <ErrorBoundary logger={logger}>
          <FoundationContext.Provider value={value}>{children}</FoundationContext.Provider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export function useJamzo() {
  const ctx = useContext(FoundationContext);
  if (!ctx) throw new Error('useJamzo must be used inside <JamzoProvider>');
  return ctx;
}
