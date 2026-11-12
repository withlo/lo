import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/ui',
    // The specs in e2e/ run under Playwright, in Electron's Chromium.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
