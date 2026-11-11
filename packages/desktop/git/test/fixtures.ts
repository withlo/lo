/** Repositories the fetch tests share. */

import { git, type RemoteRepo, type RepoServer } from '@lo/testing/git';

import { type Oid, parseOid } from '../src/oid.ts';
import type { FetchedPull, PullRequestRefs, Repo } from '../src/repo.ts';

/**
 * A repository with `trunk` and pull request #1 on it:
 *
 * ```text
 * base ── trunkTip      (trunk)
 *   └── head            (refs/pull/1/head, branch feature)
 * ```
 */
export interface PullRequest {
  remote: RemoteRepo;
  base: Oid;
  head: Oid;
  trunkTip: Oid;
}

export function pullRequest(server: RepoServer): PullRequest {
  const remote = server.repo('owner', 'repo');
  remote.write('README.md', '# repo\n').write('src/lib.rs', 'pub fn a() {}\n');
  const base = parseOid(remote.commit('base'));
  remote.switch('feature').write('feature.txt', 'first version\n');
  const head = parseOid(remote.commit('feature'));
  remote.publish('refs/heads/feature').publish('refs/pull/1/head');
  remote.switch('trunk').write('trunk.txt', 'trunk moved on\n');
  const trunkTip = parseOid(remote.commit('trunk moves on'));
  remote.publish('refs/heads/trunk');
  return { remote, base, head, trunkTip };
}

/** Pull request `number` into `baseBranch`, as an API that knows nothing else describes it. */
export function refs(number: number, baseBranch: string): PullRequestRefs {
  return { number, baseBranch };
}

export function fetch(repo: Repo, number: number): Promise<FetchedPull> {
  return repo.fetchPull(refs(number, 'trunk'));
}

/** The commit `rev` names in `repo`'s clone. */
export function revParse(repo: Repo, rev: string): string {
  return git(repo.folder, 'rev-parse', rev);
}

/** The file at `path` in `rev`, read from `repo`'s clone without downloading anything. */
export function readFile(repo: Repo, rev: string, path: string): string {
  return git(repo.folder, '--no-lazy-fetch', 'cat-file', '-p', `${rev}:${path}`);
}

/** The blobs of every file in `rev`, from `repo`'s clone, which lists them without downloading. */
export function blobs(repo: Repo, rev: string): Oid[] {
  return git(repo.folder, '--no-lazy-fetch', 'ls-tree', '-r', '--object-only', rev)
    .split('\n')
    .filter((line) => line !== '')
    .map(parseOid);
}

/** The two sides of every file that changed from `from` to `to`, from `repo`'s clone. */
export function changedBlobs(repo: Repo, from: string, to: string): Oid[] {
  return git(
    repo.folder,
    '--no-lazy-fetch',
    'diff',
    '--raw',
    '--no-abbrev',
    '--no-renames',
    from,
    to,
  )
    .split('\n')
    .flatMap((line) => line.split(' ').slice(2, 4))
    .filter((oid) => !/^0+$/.test(oid))
    .map(parseOid);
}
