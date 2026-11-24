import { defineConfig } from '@playwright/test';

// Specs for ui's components in a real Chromium: Electron's, on a page each spec builds.
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  // CI's shards and the workers split the tests one by one, not a file at a time.
  fullyParallel: true,
  // Each test starts its own copy of Electron, so two at a time, each worker on a display of its
  // own on Linux (electron.ts).
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  // CI retries a failed test once, and reports one that then passes as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,
});
