// A pull request's revisions: fetching every head by ID at once, and listing its current commits.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, packs, type RepoServer } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import { blobs, fetch, type PullRequest, pullRequest, readFile } from './fixtures.ts';
import { cacheFor, repoServer } from './support.ts';

/** What `refs/lo/pull/<number>/<folder>/` pins, sorted. */
function pinned(folder: string, number: number, kind: string): string[] {
  return git(
    folder,
    'for-each-ref',
    '--format=%(refname:lstrip=5) %(objectname)',
    `refs/lo/pull/${number}/${kind}/`,
  )
    .split('\n')
    .filter((line) => line !== '')
    .toSorted();
}

function pins(heads: readonly Oid[]): string[] {
  return heads.map((oid) => `${oid} ${oid}`).toSorted();
}

/**
 * Pull request #1 force-pushed twice after its first head: `r1`, then `r2` and `r3`, each amending
 * the last. Only `r3` is on a ref the server advertises now.
 */
function forcePushed(pr: PullRequest): { r1: Oid; r2: Oid; r3: Oid } {
  const r1 = pr.head;
  pr.remote.switch('feature').write('feature.txt', 'second version\n');
  const r2 = parseOid(pr.remote.amend('feature, amended'));
  pr.remote.publish('refs/heads/feature').publish('refs/pull/1/head');
  pr.remote.write('feature.txt', 'third version\n');
  const r3 = parseOid(pr.remote.amend('feature, amended again'));
  pr.remote.publish('refs/heads/feature').publish('refs/pull/1/head');
  return { r1, r2, r3 };
}

const NEVER = parseOid('1234567890123456789012345678901234567890');

test('fetches every head it lacks in one fetch and pins them', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const { r1, r2, r3 } = forcePushed(pr);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  // The clone has the latest head already, from opening the pull request.
  expect((await fetch(repo, 1)).head).toBe(r3);
  const before = packs(repo.folder);

  const unavailable = await repo.fetchCommits(1, [r1, r2, r3, r1]);

  expect(unavailable).toEqual([]);
  // One fetch.
  expect(packs(repo.folder)).toBe(before + 1);
  expect(pinned(repo.folder, 1, 'revs')).toEqual(pins([r1, r2, r3]));
  expect(await repo.download([...blobs(repo, r1), ...blobs(repo, r2)])).toEqual([]);
  expect([readFile(repo, r1, 'feature.txt'), readFile(repo, r2, 'feature.txt')]).toEqual([
    'first version',
    'second version',
  ]);
  // A garbage collection keeps them.
  git(repo.folder, 'gc', '-q', '--prune=now');
  expect(await repo.isAncestor(pr.base, r1)).toBe(true);

  // Asking again fetches nothing.
  const after = packs(repo.folder);
  await repo.fetchCommits(1, [r1, r2]);
  expect(packs(repo.folder)).toBe(after);
});

test('heads github no longer has are unavailable and the rest are fetched', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const { r1, r2, r3 } = forcePushed(pr);
  // The server lost r1 and r2, which nothing it advertises reaches any more.
  pr.remote.forgetUnreachable();
  expect([pr.remote.has(r1), pr.remote.has(r2)]).toEqual([false, false]);
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');

  const unavailable = await repo.fetchCommits(1, [r1, NEVER, r3, r2]);

  const expected = [r1, r2, NEVER].toSorted();
  expect(unavailable.toSorted()).toEqual(expected);
  expect(pinned(repo.folder, 1, 'revs')).toEqual(pins([r3]));
  expect(await repo.download(blobs(repo, r3))).toEqual([]);
  expect(readFile(repo, r3, 'feature.txt')).toBe('third version');

  // The clone remembers them, so asking again asks GitHub for nothing: with the server gone, it
  // still answers.
  expect((await repo.unavailableRevisions(1)).toSorted()).toEqual(expected);
  expect(await repo.unavailableRevisions(2)).toEqual([]);
  server.remove();
  expect(await repo.fetchCommits(1, [r1, NEVER, r3, r2])).toHaveLength(3);
  repo.close();
  const offline = await cache.openOffline('owner', 'repo');
  expect(await offline?.unavailableRevisions(1)).toHaveLength(3);
});

test('revision bases are fetched at once pinned and pruned and lost ones asked for once', async () => {
  const server: RepoServer = repoServer();
  const pr = pullRequest(server);
  // Stand-ins for tips a force-push left behind: commits no ref on the server reaches.
  const { r1, r2 } = forcePushed(pr);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await fetch(repo, 1);
  const before = packs(repo.folder);

  expect(await repo.fetchRevisionBases(1, [r1, NEVER, r2])).toEqual([NEVER]);

  // One fetch.
  expect(packs(repo.folder)).toBe(before + 1);
  expect(pinned(repo.folder, 1, 'revision-bases')).toEqual(pins([r1, r2]));
  expect([await repo.hasCommit(r1), await repo.hasCommit(r2)]).toEqual([true, true]);

  // A tip no longer wanted loses its pin.
  expect(await repo.fetchRevisionBases(1, [r1, NEVER])).toEqual([NEVER]);
  expect(pinned(repo.folder, 1, 'revision-bases')).toEqual(pins([r1]));

  // The lost tip is remembered: with the server gone, nothing is asked for.
  server.remove();
  expect(await repo.fetchRevisionBases(1, [r1, NEVER])).toEqual([NEVER]);
  expect(await repo.unavailableRevisions(1)).toEqual([]);
});

test('heads the clone kept are pinned without the server', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const r1 = (await fetch(repo, 1)).head;
  const { r3 } = forcePushed(pr);
  expect((await fetch(repo, 1)).head).toBe(r3);
  // The clone's pins went, as an older copy's would never have made them; its commits stay.
  git(repo.folder, 'update-ref', '-d', `refs/lo/pull/1/revs/${r1}`);
  pr.remote.forgetUnreachable();
  const before = packs(repo.folder);

  expect(await repo.fetchCommits(1, [r1])).toEqual([]);

  expect(packs(repo.folder)).toBe(before);
  expect(pinned(repo.folder, 1, 'revs')).toContain(`${r1} ${r1}`);
});

test('fetching heads is refused offline', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  await fetch(await cache.open('owner', 'repo'), 1);
  const repo = await cache.openOffline('owner', 'repo');

  const error: unknown = await repo?.fetchCommits(1, [pr.head]).catch((caught: unknown) => caught);

  expect(error instanceof GitError && error.detail.kind).toBe('readOnly');
});

/**
 * Pull request #1 with a merge in it:
 *
 * ```text
 * base ── c1 ── c2 ──── m (head)
 *           └── s1 ──┘
 * ```
 */
function merged(server: RepoServer) {
  const remote = server.repo('owner', 'repo');
  remote.write('README.md', '# repo\n');
  const base = parseOid(remote.commit('base'));
  remote.publish('refs/heads/trunk');
  remote.switch('feature').write('a.txt', 'a\n');
  const c1 = parseOid(remote.commit('c1'));
  remote.switch('side').write('s.txt', 's\n');
  const s1 = parseOid(remote.commit('s1'));
  remote.switch('feature').write('b.txt', 'b\n');
  const c2 = parseOid(remote.commit('c2'));
  git(remote.work, 'merge', '-q', '--no-ff', '-m', 'm', 'side');
  const m = parseOid(remote.head());
  remote.publish('refs/heads/feature').publish('refs/pull/1/head');
  return { base, c1, c2, s1, m };
}

test('lists a pull requests commits each after its parents', async () => {
  const server = repoServer();
  const { base, c1, c2, s1, m } = merged(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const fetched = await fetch(repo, 1);
  expect(fetched.head).toBe(m);
  const before = packs(repo.folder);

  const commits = await repo.pullCommits(fetched.baseTip, m);

  expect(commits).toHaveLength(4);
  expect([commits[0], commits.at(-1)]).toEqual([c1, m]);
  expect(commits.indexOf(c1)).toBeLessThan(commits.indexOf(c2));
  expect(commits.indexOf(c1)).toBeLessThan(commits.indexOf(s1));
  expect(commits).not.toContain(base);
  // Reading commits downloads nothing.
  expect(packs(repo.folder)).toBe(before);
  // From a commit of the pull request, only what came after it.
  expect(await repo.pullCommits(c2, c2)).toEqual([]);
  expect(await repo.pullCommits(base, c1)).toEqual([c1]);
});

test('lists commits offline but never downloads one', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  const fetched = await fetch(await cache.open('owner', 'repo'), 1);
  // A commit the server has but the clone never fetched.
  pr.remote.switch('trunk').write('later.txt', 'later\n');
  const later = parseOid(pr.remote.commit('later'));
  pr.remote.publish('refs/heads/trunk');
  const repo = await cache.openOffline('owner', 'repo');
  if (repo === undefined) throw new Error('no clone');

  expect(await repo.pullCommits(fetched.baseTip, fetched.head)).toEqual([pr.head]);
  const error: unknown = await repo
    .pullCommits(later, fetched.head)
    .catch((caught: unknown) => caught);
  expect(error instanceof GitError && error.detail).toEqual({ kind: 'notFetched', oid: later });
});

test('heads noted as lost that the clone has now or that dont parse are left out', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const { r1, r3 } = forcePushed(pr);
  pr.remote.forgetUnreachable();
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  expect((await fetch(repo, 1)).head).toBe(r3);
  expect(await repo.fetchCommits(1, [r1])).toEqual([r1]);
  // A write cut short, and a head the clone got since, from another pull request's fetch.
  const file = join(repo.folder, 'lo-unavailable/pull-1');
  const noted = readFileSync(file, 'utf8');
  writeFileSync(file, `${noted}${pr.base}\n12ab`);

  expect(await repo.unavailableRevisions(1)).toEqual([r1]);
  // The next fetch writes the file again with only what's still lost.
  expect(await repo.fetchCommits(1, [r1, r3])).toEqual([r1]);
  expect(readFileSync(file, 'utf8')).toBe(`${r1}\n`);
});
