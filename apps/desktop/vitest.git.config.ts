import { configDefaults, defineProject } from 'vitest/config';

import { define, gitTests } from './vitest.config.ts';

// The desktop tests that run git (`gitTests`), which spawn it and clone repositories, so under load
// they take longer than the 5 s a test gets: they get 30 s, as `@lo/git`'s tests do. The rest of
// the desktop tests keep the default, so one that hangs still fails soon.
export default defineProject({
  define,
  test: {
    name: '@lo/desktop:git',
    include: gitTests(),
    exclude: configDefaults.exclude,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
