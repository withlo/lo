import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/desktop',
    // The smoke test in e2e/ runs under Playwright, against the built app.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
