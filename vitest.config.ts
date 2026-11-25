import { defineConfig } from 'vitest/config';

// Nx runs one project's tests at a time (`parallelism: false` in nx.json), so this is the whole
// run's share of the machine: two workers on a laptop, all of a CI runner's cores. A project in a
// file of its own takes none of this file's options, `maxWorkers` among them, so the limit goes
// in the variable Vitest reads for every project.
if (!process.env.CI) process.env.VITEST_MAX_WORKERS ??= '2';

export default defineConfig({
  test: {
    // The workspace's package folders, as in pnpm-workspace.yaml, written as globs so that folders
    // that don't exist yet match nothing. Each project is named after its package (`@lo/<name>`),
    // and runs through Nx with `vitest run --root <repo root> --project @lo/<name>`.
    projects: [
      '{apps,packages/core,packages/desktop}/*',
      '{skill,skill/checker,testing,scripts}',
      // The desktop tests that run git, a project of their own, with more time.
      'apps/desktop/vitest.git.config.ts',
    ],
  },
});
