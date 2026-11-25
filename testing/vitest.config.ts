import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@lo/testing',
    // A fixture's tests belong to the code it holds, such as the repository an overview describes,
    // not to this package.
    exclude: [...configDefaults.exclude, 'fixtures/**'],
  },
});
