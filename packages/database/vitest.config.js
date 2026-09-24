import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['./src/test-global-setup.js'], testTimeout: 30_000, hookTimeout: 60_000 },
});
