import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/perf',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
