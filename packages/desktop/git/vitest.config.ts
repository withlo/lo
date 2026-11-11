import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/git',
    // Most tests run real git on repositories they build, some of them over HTTP.
    testTimeout: 30_000,
  },
});
