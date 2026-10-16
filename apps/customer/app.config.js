// Jamzo customer app config. Identity (bundle id, name, scheme, colour) comes from the central registry
// (packages/config/src/apps.js — DECISIONS D-15); this file adds only customer-specific settings.
// Location: foreground only ("while using the app") to find restaurants that deliver to you (D-55). No
// background location is ever requested by the customer app.
// Env: APP_VARIANT = development | preview | production, EXPO_PUBLIC_API_URL, EAS_PROJECT_ID,
// GOOGLE_MAPS_ANDROID_KEY (D-114: draws the map in Android builds only; a "Maps SDK for Android" key restricted
// to the Jamzo package and signing certificate. Search and addresses use the server's key, never this one).
const { buildExpoConfig } = require('@jamzo/config/expo');
const { version } = require('./package.json');

const WHEN_IN_USE =
  'Jamzo uses your location to show restaurants that deliver to you and to fill in your delivery address.';

module.exports = ({ config }) =>
  buildExpoConfig({
    appId: 'CUSTOMER',
    version,
    base: config,
    tablet: true,
    env: {
      variant: process.env.APP_VARIANT,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      easProjectId: process.env.EAS_PROJECT_ID,
    },
    android: {
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
      blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
      ...(process.env.GOOGLE_MAPS_ANDROID_KEY
        ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } }
        : {}),
    },
    plugins: [
      [
        'expo-location',
        {
          locationWhenInUsePermission: WHEN_IN_USE,
          // `false` removes the "Always" and motion usage descriptions the plugin would otherwise add by default.
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
    ],
  });
