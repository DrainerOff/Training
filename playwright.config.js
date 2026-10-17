import { defineConfig, devices } from '@playwright/test';

// E2E runs in Chromium with iPhone 13 emulation (viewport, touch, UA). It is not real
// iOS Safari — see README for the manual airplane-mode checklist on a real iPhone.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
});
