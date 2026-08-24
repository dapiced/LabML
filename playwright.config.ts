import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'light',
    trace: 'on-first-retry',
    // The webcam e2e uses Chromium's built-in fake camera (a rolling test
    // pattern) so no real device or permission prompt is involved.
    permissions: ['camera'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      // Lets local sandboxes point at a pre-installed Chromium instead of downloading one.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  // V35 — until this wave there was ONE project: Desktop Chrome, light mode.
  // Every e2e test in the repository ran at 1280 px, which is exactly why six
  // doc pages shipped scrolling sideways on a phone and nobody saw it. The two
  // projects below close that blind spot without paying for it: the full suite
  // still runs once, and only the specs that can actually catch a viewport or
  // a theme regression are replayed.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      testMatch: /(layout|a11y)\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'dark',
      // Contrast and focus styling are the theme-dependent failures worth
      // guarding; the rest of the suite is theme-agnostic and replaying it
      // would only buy CI minutes.
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
