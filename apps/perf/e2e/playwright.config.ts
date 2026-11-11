import { defineConfig } from '@playwright/test';

// The key spec drives the built suite: `nx run perf:e2e` builds it first.
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  // Each test starts its own copy of the suite, so two at a time.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,
});
