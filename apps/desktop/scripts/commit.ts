// The commit a build is made from, which the About panel shows.

import { execFileSync } from 'node:child_process';

/** A commit's hash in full: SHA-1's 40 hex digits, or SHA-256's 64. */
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The commit a build is made from: `GITHUB_SHA`, which a workflow sets to the commit it runs on,
 * or else what `git rev-parse HEAD` says in the checkout at `cwd`. Empty when neither gives a
 * hash, as in a copy of the source with no history.
 */
export function buildCommit(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  git: (cwd: string) => string = (folder) =>
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: folder,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
): string {
  const given = env.GITHUB_SHA?.trim().toLowerCase();
  if (given !== undefined && HASH.test(given)) return given;
  try {
    const found = git(cwd).trim().toLowerCase();
    return HASH.test(found) ? found : '';
  } catch {
    return '';
  }
}
