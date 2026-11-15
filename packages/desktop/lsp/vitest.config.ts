import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/lsp',
    // The tests in test/ start the fake language server, and one waits out a whole stop.
    testTimeout: 20_000,
  },
});
