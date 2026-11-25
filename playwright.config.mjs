import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  // Multi-page WebRTC and camera-animation tests are timing sensitive; fewer workers avoids CPU starvation.
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:19100',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/support/server.mjs',
    url: 'http://127.0.0.1:19100',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
