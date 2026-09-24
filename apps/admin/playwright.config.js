import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for Jamzo Admin against a real API + PostgreSQL started by e2e/global-setup.js.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.js',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'next build && next start --port 3100',
    url: 'http://127.0.0.1:3100/login',
    timeout: 180_000,
    reuseExistingServer: false,
    env: { API_ORIGIN: 'http://127.0.0.1:4100', NEXT_DIST_DIR: '.next-e2e' },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.js/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.js/ },
  ],
});
