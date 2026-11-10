// Reading a clone offline: only what's there, without the server, without downloading anything,
// and without waiting for a fetch.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { git, missingObjects } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { parseOid } from '../src/oid.ts';
import { changedBlobs, fetch, pullRequest, refs } from './fixtures.ts';
import { cacheFor, repoServer } from './support.ts';

test('opening offline never makes a clone', async () => {
  const server = repoServer();
  pullRequest(server);
  const cache = await cacheFor(server);

  expect(await cache.openOffline('owner', 'repo')).toBeUndefined();

  expect(existsSync(cache.repoFolder('owner', 'repo'))).toBe(false);
  expect(existsSync(join(cache.root, 'repos'))).toBe(false);
});

test('what was fetched and diffed reads without the server', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  const online = await cache.open('owner', 'repo');
  await fetch(online, 1);
  // Showing the diff downloads both sides of each changed file.
  const changed = changedBlobs(online, pr.base, pr.head);
  expect(await online.download(changed)).toEqual([]);
  online.close();

  // Offline.
  server.remove();

  const repo = await cache.openOffline('owner', 'repo');
  if (repo === undefined) throw new Error('no clone');
  expect(await repo.pullRevisions(1)).toEqual([pr.head]);
  expect(await repo.hasBase(1, pr.trunkTip)).toBe(true);
  expect(await repo.hasBase(1, pr.base)).toBe(false);
  expect(await repo.hasBase(2, pr.trunkTip)).toBe(false);
  expect(await repo.branchBase(1, 'trunk')).toBe(pr.trunkTip);
  expect(await repo.mergeBase(pr.head, pr.trunkTip)).toBe(pr.base);
  expect(await repo.missingObjects(changed)).toEqual([]);
  const diff = cache.runner.command({ gitDir: repo.folder }).arg('diff', pr.base, pr.head);
  expect((await diff.run()).toString('utf8')).toContain('+first version');

  // It never writes.
  const error: unknown = await repo.fetchPull(refs(1, 'trunk')).catch((caught: unknown) => caught);
  expect(error instanceof GitError && error.detail.kind).toBe('readOnly');
});

test('offline what was never diffed is missing and isnt downloaded', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  // Fetched, but never diffed, so no file's contents were downloaded.
  const online = await cache.open('owner', 'repo');
  await fetch(online, 1);
  online.close();
  const missing = missingObjects(cache.repoFolder('owner', 'repo'), pr.head);
  expect(missing).not.toEqual([]);

  // The server is still there, so a read that could download would.
  const offline = await cache.openOffline('owner', 'repo');
  if (offline === undefined) throw new Error('no clone');
  expect(await offline.missingObjects(changedBlobs(offline, pr.base, pr.head))).not.toEqual([]);
  expect(missingObjects(offline.folder, pr.head)).toEqual(missing);
  // Reading the diff anyway fails rather than downloading.
  const diff = cache.runner.command({ gitDir: offline.folder }).arg('diff', pr.base, pr.head);
  await expect(diff.run()).rejects.toThrow(GitError);
  expect(missingObjects(offline.folder, pr.head)).toEqual(missing);
  await expect(offline.download(missing.map(parseOid))).rejects.toThrow('read offline');
});

test('each base branch keeps the tip it was last fetched at', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await fetch(repo, 1);
  // The pull request moves onto another branch, as a stack's upper layer does when the one below
  // merges.
  const other = pr.remote.switch('stack/lower').write('lower.txt', 'lower\n').commit('lower layer');
  pr.remote.publish('refs/heads/stack/lower');
  await repo.fetchPull(refs(1, 'stack/lower'));

  expect(await repo.branchBase(1, 'trunk')).toBe(pr.trunkTip);
  expect(await repo.branchBase(1, 'stack/lower')).toBe(other);
  expect(await repo.branchBase(1, 'stack')).toBeUndefined();
  expect(await repo.hasBase(1, pr.trunkTip)).toBe(true);
  expect(await repo.hasBase(1, parseOid(other))).toBe(true);
});

test('opening offline doesnt wait for another los fetch', async () => {
  const server = repoServer();
  pullRequest(server);
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  await fetch(repo, 1);
  repo.close();
  // A fetch holds the clone's lock.
  const release = await cache.cloneLock('owner', 'repo').acquire('fetching pull request #1');

  const opened = await Promise.race([
    cache.openOffline('owner', 'repo'),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 20_000)),
  ]);

  release();
  expect(opened).toBeDefined();
  expect(opened).not.toBe('still waiting');
  expect(git(cache.repoFolder('owner', 'repo'), 'rev-parse', '--is-bare-repository')).toBe('true');
});
