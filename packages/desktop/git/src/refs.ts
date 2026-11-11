/**
 * Where Lo keeps what it fetches in a clone: under its own refs, keyed by pull request so that no
 * two branch names can collide, and so nothing fetched is lost to a force-push.
 *
 * - `refs/lo/pull/<n>/head` and `refs/lo/pull/<n>/base`: pull request `n`'s head and its base
 *   branch's tip, as last fetched.
 * - `refs/lo/pull/<n>/revs/<oid>`: every head of pull request `n` ever fetched.
 * - `refs/lo/pull/<n>/bases/<oid>`: every tip of its base branch ever fetched.
 * - `refs/lo/pull/<n>/revision-bases/<oid>`: the base branch's tips that its revisions were
 *   pushed on, while its revisions need them.
 * - `refs/lo/pull/<n>/branch-bases/<hash>`: the tip of each branch pull request `n` was fetched
 *   against, as last fetched, by the SHA-256 of the branch's name, so any branch name fits in one
 *   ref and none is another's folder.
 * - `refs/lo/pull/<n>/overview` and `…/overview-fork`: its overview, from the base repository or
 *   from the fork its head is in.
 * - `refs/lo/commits/<oid>`: commits fetched by ID.
 */

import { createHash } from 'node:crypto';

import { GitError } from './errors.ts';
import type { Oid } from './oid.ts';

export function pullRef(number: number, name: string): string {
  return `refs/lo/pull/${number}/${name}`;
}

/** Where pull request `number`'s head `oid` is pinned. */
export function revisionRef(number: number, oid: Oid): string {
  return pullRef(number, `revs/${oid}`);
}

/** Where pull request `number`'s base tip `oid` is pinned. */
export function baseRef(number: number, oid: Oid): string {
  return pullRef(number, `bases/${oid}`);
}

/** Where the base tip `oid` one of pull request `number`'s revisions was pushed on is pinned. */
export function revisionBaseRef(number: number, oid: Oid): string {
  return pullRef(number, `revision-bases/${oid}`);
}

/** Where the tip of `branch`, as last fetched as pull request `number`'s base, is pinned. */
export function branchBaseRef(number: number, branch: string): string {
  const hash = createHash('sha256').update(branch, 'utf8').digest('hex');
  return pullRef(number, `branch-bases/${hash}`);
}

/** Where commit `oid`, fetched by ID, is pinned. */
export function commitRef(oid: Oid): string {
  return `refs/lo/commits/${oid}`;
}

/**
 * Fails unless `value` is safe as a repository's owner or name and as a folder's name: GitHub's
 * letters, digits, `-`, `_` and `.`, at most 100 of them, and not `.` or `..`.
 */
export function checkName(what: string, value: string): void {
  const valid =
    value.length > 0 &&
    value.length <= 100 &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(value);
  if (!valid) throw new GitError({ kind: 'invalid', what, value });
}

/** Fails unless `number` is a pull request's number. */
export function checkNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new GitError({ kind: 'invalid', what: 'pull request number', value: String(number) });
  }
}
