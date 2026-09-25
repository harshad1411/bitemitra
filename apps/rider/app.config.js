// Jamzo Delivery Partner app config. Identity comes from the central registry (DECISIONS D-15).
// Location: foreground + background while the partner is online (Phase 6, D-74, MOBILE.md §5).
// Env: APP_VARIANT = development | preview | production, EXPO_PUBLIC_API_URL, EAS_PROJECT_ID.
const { buildExpoConfig } = require('@jamzo/config/expo');
const { version } = require('./package.json');

const WHEN_IN_USE =
  'Jamzo uses your location to show nearby delivery requests and guide you to restaurants and customers.';
const ALWAYS =
  'While you are online for deliveries, Jamzo uses your location in the background so customers can track their order and new requests reach you. Location is not used when you are offline.';

module.exports = ({ config }) =>
  buildExpoConfig({
    appId: 'RIDER',
    version,
    base: config,
    env: {
      variant: process.env.APP_VARIANT,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      easProjectId: process.env.EAS_PROJECT_ID,
    },
    ios: { infoPlist: { UIBackgroundModes: ['location', 'remote-notification'] } },
    android: {
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
      ],
    },
    plugins: [
      [
        'expo-location',
        {
          locationWhenInUsePermission: WHEN_IN_USE,
          locationAlwaysAndWhenInUsePermission: ALWAYS,
          locationAlwaysPermission: ALWAYS,
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        'expo-image-picker',
        {
          cameraPermission: 'Jamzo uses the camera for photos of your documents and of delivered orders.',
          photosPermission: 'Jamzo uses your photos only when you choose a document photo.',
          microphonePermission: false,
        },
      ],
    ],
  });
