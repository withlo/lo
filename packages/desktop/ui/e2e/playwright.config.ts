import { defineConfig } from '@playwright/test';

// Specs for ui's components in a real Chromium: Electron's, on a page each spec builds.
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  // Each spec builds its page once, before its tests, which start a copy of Electron each.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,
});
