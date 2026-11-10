import { defineConfig } from '@playwright/test';

// The smoke test drives the built, unpackaged app: `nx run desktop:e2e` builds it first.
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  // Each test starts its own copy of Lo, so two at a time.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 30_000,
  // Baselines are made on Linux only, so they carry no system in their names.
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
});
