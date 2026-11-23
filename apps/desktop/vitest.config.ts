import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { configDefaults, defineProject } from 'vitest/config';

import { OVERVIEW_CHECKER } from './electron.vite.config.ts';

/** As electron.vite.config.ts defines them: the overview checker for the window, and the commit, which no test needs, for main. */
export const define = {
  LO_OVERVIEW_CHECKER: JSON.stringify(OVERVIEW_CHECKER),
  LO_COMMIT: JSON.stringify(''),
};

/** What a relative import, an `import()` or a `vi.mock` names. */
const RELATIVE_IMPORT = /(?:from|import|mock)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;

/**
 * The unit tests that run git: those that import `@lo/testing/git`, which builds repositories and
 * serves them to clone, directly or through a helper or another module they import. Cloning and
 * fetching are slow while the machine is busy, so `vitest.git.config.ts` runs these as a project
 * of their own, with more time. Where a test is, and what it imports, is read from the source, so a
 * new test that runs git is found without a list to keep.
 */
export function gitTests(): string[] {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = ['src', 'scripts', 'e2e'].flatMap((folder) =>
    readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.tsx?$/.test(path) && !path.includes('node_modules'))
      .map((path) => join(root, folder, path)),
  );
  const imports = new Map<string, string[]>();
  const runs = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('@lo/testing/git')) runs.add(file);
    imports.set(
      file,
      [...text.matchAll(RELATIVE_IMPORT)].map(([, path]) => resolve(dirname(file), path!)),
    );
  }
  // Whatever imports a module that runs git does too.
  for (let size = 0; size < runs.size;) {
    size = runs.size;
    for (const [file, paths] of imports) {
      if (paths.some((path) => runs.has(path))) runs.add(file);
    }
  }
  return files
    .filter((file) => /\.test\.tsx?$/.test(file) && runs.has(file))
    .map((file) => relative(root, file))
    .toSorted();
}

export default defineProject({
  define,
  test: {
    name: '@lo/desktop',
    // The smoke test in e2e/ runs under Playwright, against the built app: its specs are
    // `*.spec.ts`, and the unit tests of what it uses beside them `*.test.ts`.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'e2e/**/*.test.ts'],
    // The tests that run git are another project's, with more time: `vitest.git.config.ts`.
    exclude: [...configDefaults.exclude, ...gitTests()],
  },
});
