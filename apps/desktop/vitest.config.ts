import { defineProject } from 'vitest/config';

import { OVERVIEW_CHECKER } from './electron.vite.config.ts';

export default defineProject({
  // As electron.vite.config.ts defines it for the window.
  define: { LO_OVERVIEW_CHECKER: JSON.stringify(OVERVIEW_CHECKER) },
  test: {
    name: '@lo/desktop',
    // The smoke test in e2e/ runs under Playwright, against the built app: its specs are
    // `*.spec.ts`, and the unit tests of what it uses beside them `*.test.ts`.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'e2e/**/*.test.ts'],
  },
});
