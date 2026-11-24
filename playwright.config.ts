// End-to-end tests: the production build in a real browser. `npm run test:e2e`.
// Locally, PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of downloading Chromium.
import { defineConfig, devices } from '@playwright/test'

const PORT = 4174
const HOSTED_PORT = 4176

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: /phone|hosted/,
    },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone/ },
    {
      // self-hosted: the same build served by the Meshboard server (e2e/hosted-server.ts)
      name: 'hosted',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${HOSTED_PORT}`,
      },
      testMatch: /hosted\.spec/,
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'node --disable-warning=ExperimentalWarning e2e/hosted-server.ts',
      url: `http://localhost:${HOSTED_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 150_000,
    },
  ],
})
