import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The workspace's package folders, as in pnpm-workspace.yaml, written as globs so that folders
    // that don't exist yet match nothing. Each project is named after its package (`@lo/<name>`),
    // and runs through Nx with `vitest run --root <repo root> --project @lo/<name>`.
    projects: ['{apps,packages/core,packages/desktop}/*', '{skill,skill/checker,testing,scripts}'],
    maxWorkers: 2,
  },
});
