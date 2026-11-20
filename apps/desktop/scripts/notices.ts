// Writes dist/licenses.txt: Lo's license, the license of every package the build bundled, and of
// what else Lo ships that isn't a package. It fails when a bundled package has no license, or one
// Lo can't carry. Run after electron-vite, which leaves each bundle's package list beside it:
//
//   node scripts/notices.ts [dist]
//
// electron-builder installs the file in the app's resources, outside the asar, so the system can
// open it. The lists are removed after: nothing but the notices need them.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { COPYRIGHT, FREE_SOFTWARE } from '../src/features/app/main/about.ts';
import { licenseProblems } from './notices/check.ts';
import { inlinedCode } from './notices/inlined.ts';
import { keptNotices } from './notices/kept.ts';
import { merged, type Bundled } from './notices/packages.ts';
import { renderNotices } from './notices/render.ts';

/** Where each bundle writes its package list, in the build's output. */
export const LISTS = ['main/bundled.json', 'preload/bundled.json', 'window/bundled.json'] as const;

/** What the build's plugin writes for each package. */
const bundled = z.array(
  z.object({
    name: z.string(),
    version: z.string(),
    license: z.string().optional(),
    text: z.string().optional(),
    notice: z.string().optional(),
    dir: z.string(),
    files: z.array(z.string()),
    nested: z.array(z.object({ path: z.string(), text: z.string() })),
  }),
);

/** The list of packages in the JSON at `path`, which the build wrote. */
function readList(path: string): Bundled[] {
  return bundled.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Writes `licenses.txt` in `dist` from the lists the bundles left there, with the licenses of the
 * repository at `root`, then removes the lists. Returns what's wrong with the bundled packages'
 * licenses, and what a person has to look at in their files, written nothing if there is any.
 */
export function writeNotices(root: string, dist: string): string[] {
  const listed = merged(LISTS.flatMap((list) => readList(join(dist, list))));
  const found = inlinedCode(listed);
  const packages = merged(found.packages);
  const problems = [...licenseProblems(packages), ...found.problems];
  if (problems.length > 0) return problems;
  const text = (path: string) => readFileSync(join(root, path), 'utf8').trim();
  writeFileSync(
    join(dist, 'licenses.txt'),
    renderNotices({
      copyright: COPYRIGHT,
      summary: FREE_SOFTWARE,
      gpl: text('LICENSE'),
      apache: text('packages/desktop/syntax/queries/LICENSE-APACHE'),
      packages,
      kept: [...keptNotices(root), ...found.kept],
    }),
  );
  for (const list of LISTS) rmSync(join(dist, list));
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = join(import.meta.dirname, '..');
  const problems = writeNotices(join(app, '..', '..'), process.argv[2] ?? join(app, 'dist'));
  if (problems.length > 0) {
    console.error(`Lo can't write its notices:\n${problems.map((each) => `- ${each}`).join('\n')}`);
    process.exit(1);
  }
}
