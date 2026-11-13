/**
 * The pull requests the app's end-to-end tests read review threads on, rozed-dev/e2e#94 and #95, as
 * a git remote on this machine: `testing/fixtures/comments.sh` makes every commit with the ID GitHub has
 * for it, so Lo can fetch it from here while the replay server answers for GitHub's API.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testGitEnvironment } from './git.ts';

/** The script, `testing/fixtures/comments.sh`. */
export const commentsScript = fileURLToPath(new URL('../../fixtures/comments.sh', import.meta.url));

/** The pull request and its commits, as GitHub has them. */
export const COMMENTS_PULL = {
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 94,
  /** The head now: the second push, one commit on the first. */
  head: 'cd44b64496be1a5e43c30aa48c8ed98edbbd7b3c',
  /** The first push's head. */
  firstHead: 'df679fae278ca2498e20e066e4bbd5456aa9748b',
  /** `comments/base`. */
  base: '821ed37fcaa08351275aa23203ed36569d0a8446',
} as const;

/** The pull request that renames docs/usage.md to docs/guide.md, with a thread on its old side. */
export const COMMENTS_RENAME_PULL = {
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 95,
  /** Its one commit, on `comments/base`. */
  head: 'c94f2a0782f2ca1e42a5ed0c5c04cbb4cb0e3dc1',
  base: COMMENTS_PULL.base,
} as const;

/**
 * Makes the pull requests' repository in `folder`, as `rozed-dev/e2e.git`, and returns the address
 * to give Lo as `LO_GIT_REMOTE`.
 */
export function writeCommentsRemote(folder: string): string {
  execFileSync('bash', [commentsScript, folder], {
    env: testGitEnvironment(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return `file://${folder}`;
}
