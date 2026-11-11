// Which build of Lo is running, for the pollers' cache: what one build kept, another reads as
// missing, since the shape of what the pollers keep changes with their code.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A hash of every file in `folder` and its folders, by path and content. Given main's output
 * folder, it names this build of main: everything main runs is bundled into that folder
 * (`electron.vite.config.ts` bundles every dependency), `@lo/github`'s polling, its queries and
 * the shapes of their answers included, whichever file in it the bundler puts them in.
 */
export function buildOf(folder: string): string {
  const hash = createHash('sha256');
  const visit = (at: string, path: string) => {
    for (const name of readdirSync(at).toSorted()) {
      const file = join(at, name);
      if (statSync(file).isDirectory()) {
        visit(file, `${path}${name}/`);
      } else {
        hash.update(`${path}${name}\0`);
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  };
  visit(folder, '');
  return hash.digest('hex').slice(0, 16);
}
