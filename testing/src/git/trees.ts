/**
 * The files of the pull requests in GitHub's `rozed-dev/e2e` test repository that
 * `testing/fixtures/trees.sh` writes, byte for byte as they were pushed.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testGitEnvironment } from './git.ts';

/** The script, `testing/fixtures/trees.sh`. */
export const treesScript = fileURLToPath(new URL('../../fixtures/trees.sh', import.meta.url));

/** The pull requests the script writes, by the name of the function that writes each. */
export type Tree = 'e6_tree' | 'e9_tree' | 'e12_tree';

/** Writes `side` of `tree` into `folder`, a working copy, replacing what that tree had there. */
export function writeTree(tree: Tree, side: 'base' | 'head', folder: string): void {
  execFileSync(
    'bash',
    ['-c', 'set -euo pipefail; . "$0"; "$1" "$2" "$3"', treesScript, tree, side, folder],
    { env: { ...testGitEnvironment(), LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
