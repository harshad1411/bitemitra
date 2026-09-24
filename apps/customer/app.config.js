// Jamzo customer app config. Identity (bundle id, name, scheme, colour) comes from the central registry
// (packages/config/src/apps.js — DECISIONS D-15); this file adds only customer-specific settings.
// Env: APP_VARIANT = development | preview | production, EXPO_PUBLIC_API_URL, EAS_PROJECT_ID.
const { buildExpoConfig } = require('@jamzo/config/expo');
const { version } = require('./package.json');

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
  });
