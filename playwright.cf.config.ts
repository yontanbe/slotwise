import { defineConfig, devices } from '@playwright/test'

/**
 * Runs the e2e suite against the Cloudflare Pages runtime (`wrangler pages dev`), so the real
 * public/_headers (CSP and friends) apply. Every CSP violation of the whole run is reported to a
 * local collector and fails the run in globalTeardown; tests/cf/csp.spec.ts also checks headers,
 * all routes and a cross-origin embed.
 *
 *   npm run build && npx playwright test -c playwright.cf.config.ts --trace off --project=desktop
 */
const PORT = 8788

export default defineConfig({
  testDir: 'tests',
  testMatch: /(e2e|cf)\/.*\.spec\.ts/,
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalTeardown: './tests/cf/csp-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'off',
  },
  webServer: [
    {
      command: 'node tests/cf/csp-collector.mjs',
      port: 8789,
      reuseExistingServer: false,
    },
    {
      command: `node tests/cf/prepare.mjs && npx wrangler pages dev test-results/cf-dist --port ${PORT} --ip 127.0.0.1 --log-level warn`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
})
