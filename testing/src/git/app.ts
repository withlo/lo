/**
 * The pull request the app's end-to-end tests open, rozed-dev/e2e#78, as a git remote on this
 * machine: `testing/fixtures/app.sh` makes every commit with the ID GitHub has for it, so Lo can
 * fetch it from here while the replay server answers for GitHub's API.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testGitEnvironment } from './git.ts';

/** The script, `testing/fixtures/app.sh`. */
export const appScript = fileURLToPath(new URL('../../fixtures/app.sh', import.meta.url));

/** The pull request and its commits, as GitHub has them. */
export const APP_PULL = {
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 78,
  /** The head now: the second push. */
  head: '5530830f535b2947f1b50a184dc58a9c7b2845ad',
  /** The first push's head, which the second built on. */
  firstHead: '45e4f22d09ea29631f43d3f8c1e05b7fb4001099',
  /** `app/base` now. */
  base: 'dccd782aff9cd7a5088122cd3fb4a515964acee7',
  /** `app/base` when the first push was made. */
  firstBase: '99d29e0c4b73b37b7a59349c8ab0744d02ddf575',
} as const;

/**
 * Makes the pull request's repository in `folder`, as `rozed-dev/e2e.git`, and returns the
 * address to give Lo as `LO_GIT_REMOTE`.
 */
export function writeAppRemote(folder: string): string {
  execFileSync('bash', [appScript, folder], {
    env: testGitEnvironment(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return `file://${folder}`;
}
