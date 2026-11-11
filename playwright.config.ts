import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.WGT_E2E_PORT ?? '4300';
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.005,
    },
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  ignoreSnapshots: process.platform !== 'win32',
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    // Visual baselines are generated and compared on Windows with Playwright's
    // package-pinned Chromium build, not the runner's changing Edge channel.
    baseURL: e2eBaseUrl,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-light',
      use: { colorScheme: 'light' },
    },
    {
      name: 'chromium-dark',
      use: { colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      WGT_BUILD_ID: 'playwright-visual-fixture',
      WGT_BUILD_COMMIT: 'playwright-visual-fixture',
      WGT_BUILD_TIME: '2026-01-01T00:00:00.000Z',
    },
  },
});
