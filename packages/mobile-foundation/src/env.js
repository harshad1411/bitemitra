// Build-time configuration from app.config.js `extra` (never secrets — anything here ships in the app).
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getAppEnv() {
  const extra = Constants.expoConfig?.extra ?? {};
  if (!extra.apiUrl) throw new Error('expo.extra.apiUrl is not configured (set EXPO_PUBLIC_API_URL)');
  return {
    appId: extra.appId,
    variant: extra.variant ?? 'development',
    apiUrl: extra.apiUrl.replace(/\/$/, ''),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB',
    schemes: extra.schemes ?? [],
    domains: extra.domains ?? [],
    easProjectId: extra.eas?.projectId ?? null,
  };
}
