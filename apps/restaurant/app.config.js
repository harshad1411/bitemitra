// Jamzo Restaurant Partner app config. Identity comes from the central registry (DECISIONS D-15).
// Env: APP_VARIANT = development | preview | production, EXPO_PUBLIC_API_URL, EAS_PROJECT_ID.
const { buildExpoConfig } = require('@jamzo/config/expo');
const { version } = require('./package.json');

module.exports = ({ config }) =>
  buildExpoConfig({
    appId: 'RESTAURANT',
    version,
    base: config,
    tablet: true, // counter tablets are common in restaurants
    notificationSounds: ['./assets/sounds/new_order.wav'], // placeholder chime (Q-13)
    env: {
      variant: process.env.APP_VARIANT,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      easProjectId: process.env.EAS_PROJECT_ID,
    },
  });
