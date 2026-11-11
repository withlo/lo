import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@withlo/overview',
    // The tests run the built checker, and real git on repositories they make.
    testTimeout: 30_000,
  },
});
