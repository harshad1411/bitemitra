// Builds an Expo app config from the product registry (DECISIONS D-15), so bundle ids, names, schemes,
// colours and variants are never hand-typed in the apps. Each app passes only its own extras.
import { mobileIdentity } from './apps.js';

/**
 * @param {object} p
 * @param {'CUSTOMER' | 'RESTAURANT' | 'RIDER'} p.appId
 * @param {string} p.version app's own semver (from its package.json) — independent releases (B10)
 * @param {{ variant?: string, apiUrl?: string, easProjectId?: string }} p.env
 * @param {object} [p.base] static values from app.json
 * @param {object} [p.ios] extra iOS config (infoPlist etc.)
 * @param {object} [p.android] extra Android config (permissions etc.)
 * @param {any[]} [p.plugins] extra config plugins
 * @param {boolean} [p.tablet] support iPad layouts
 * @param {string[]} [p.notificationSounds] sound files bundled for push notifications (e.g. a new-order alert)
 */
export function buildExpoConfig({
  appId,
  version,
  env,
  base = {},
  ios = {},
  android = {},
  plugins = [],
  tablet = false,
  notificationSounds = [],
}) {
  const variant = /** @type {any} */ (env.variant ?? 'development');
  const id = mobileIdentity(appId, variant);
  const production = variant === 'production';
  const appLinks = production && id.associatedDomain;
  return {
    ...base,
    name: id.name,
    slug: `jamzo-${id.slug}`,
    version,
    scheme: id.scheme,
    runtimeVersion: { policy: 'appVersion' },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      ...ios,
      bundleIdentifier: id.bundleId,
      supportsTablet: tablet,
      ...(appLinks ? { associatedDomains: [`applinks:${id.associatedDomain}`] } : {}),
      infoPlist: { ITSAppUsesNonExemptEncryption: false, ...(ios.infoPlist ?? {}) },
    },
    android: {
      ...android,
      package: id.bundleId,
      // Expo template defaults this app does not need (privacy, Play review). The dev-client overlay
      // permission is kept only in development builds.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        ...(variant === 'development' ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
        ...(android.blockedPermissions ?? []),
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-foreground.png',
        backgroundImage: './assets/adaptive-icon-background.png',
        monochromeImage: './assets/adaptive-icon-monochrome.png',
        backgroundColor: id.color,
      },
      ...(appLinks
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [{ scheme: 'https', host: id.associatedDomain }],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    web: { favicon: './assets/favicon.png' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 220,
          backgroundColor: id.color, // navy, with the white Jamzo logo (D-107)
          resizeMode: 'contain',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: id.color,
          ...(notificationSounds.length ? { sounds: notificationSounds } : {}),
        },
      ],
      ...plugins,
    ],
    extra: {
      appId,
      variant,
      apiUrl: env.apiUrl ?? 'http://localhost:4000',
      schemes: [id.scheme],
      domains: id.associatedDomain ? [id.associatedDomain] : [],
      ...(env.easProjectId ? { eas: { projectId: env.easProjectId } } : {}),
    },
    ...(env.easProjectId ? { updates: { url: `https://u.expo.dev/${env.easProjectId}` } } : {}),
  };
}
