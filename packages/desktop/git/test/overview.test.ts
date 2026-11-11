// A pull request's overview: `refs/lo/pr/<n>` from the base repository, else from the fork its
// head is in, fetched as one commit and its trees, with none of their history and no file's
// contents.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  git,
  GitHttpServer,
  missingObjects,
  type RemoteRepo,
  type RepoServer,
} from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { parseOid } from '../src/oid.ts';
import { fetch, pullRequest } from './fixtures.ts';
import { cacheFor, repoServer } from './support.ts';

/**
 * Publishes an overview of pull request #1 at `refs/lo/pr/1` in `remote`, on a history of its own:
 * a first overview, then a rewrite. Returns the rewrite.
 */
function publishOverview(server: RepoServer, remote: RemoteRepo, text: string): string {
  const scratch = server.repo('scratch', `overview-${text.length}`);
  scratch.write('artifact.md', `# ${text}\n`).write('figures/flow.svg', '<svg/>\n');
  scratch.commit('first overview');
  scratch.write('artifact.md', `# ${text}, rewritten\n`);
  const commit = scratch.commit('the overview, rewritten');
  scratch.publish('refs/heads/trunk');
  remote.takeFrom(scratch, 'refs/heads/trunk', 'refs/lo/pr/1');
  return commit;
}

test('fetches an overview from the base repository, with no history or contents', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const commit = publishOverview(server, pr.remote, 'From the base');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  const overview = await repo.fetchOverview(1, { owner: 'contributor', name: 'repo' });

  expect(overview?.commit).toBe(commit);
  expect(overview?.source).toBe('base');
  expect(overview?.files.map((file) => file.path.toString('utf8'))).toEqual([
    'artifact.md',
    'figures/flow.svg',
  ]);
  // Sizes are known only once the files are downloaded.
  expect(overview?.files.map((file) => file.size)).toEqual([undefined, undefined]);
  // In a repository of their own, beside the code, with only the latest commit: its parent, the
  // first overview, never came.
  const overviews = join(repo.folder, 'lo-overviews.git');
  expect(git(overviews, 'rev-parse', 'refs/lo/pull/1/overview')).toBe(commit);
  expect(readFileSync(join(overviews, 'shallow'), 'utf8')).toBe(`${commit}\n`);
  expect(missingObjects(overviews, commit)).toHaveLength(2);
  expect(existsSync(join(repo.folder, 'shallow'))).toBe(false);

  // Once downloaded, the files have sizes.
  if (overview === undefined) throw new Error('no overview');
  expect(await repo.downloadOverview(1, overview)).toEqual([]);
  const again = await repo.fetchOverview(1);
  expect(again?.files.map((file) => file.size)).toEqual(['# From the base, rewritten\n'.length, 7]);
});

test('falls back to the fork’s overview, and writes nothing of the fork to the clone’s settings', async () => {
  const server = repoServer();
  pullRequest(server);
  const commit = publishOverview(server, server.repo('contributor', 'repo'), 'From the fork');
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  const settings = readFileSync(join(repo.folder, 'config'), 'utf8');

  const overview = await repo.fetchOverview(1, { owner: 'contributor', name: 'repo' });

  expect(overview?.commit).toBe(commit);
  expect(overview?.source).toBe('fork');
  const overviews = join(repo.folder, 'lo-overviews.git');
  expect(git(overviews, 'rev-parse', 'refs/lo/pull/1/overview-fork')).toBe(commit);
  expect(existsSync(join(overviews, 'refs/lo/pull/1/overview'))).toBe(false);
  // Blobless, and the clone's settings are as they were, so it's trusted when it's opened again.
  expect(missingObjects(overviews, commit)).toHaveLength(2);
  expect(readFileSync(join(repo.folder, 'config'), 'utf8')).toBe(settings);
  repo.close();
  await cache.close();
  const logged: string[] = [];
  const reopened = await cacheFor(server, { root: cache.root, log: (line) => logged.push(line) });
  const again = await reopened.open('owner', 'repo');
  expect(logged).toEqual([]);
  expect(
    git(join(again.folder, 'lo-overviews.git'), 'rev-parse', 'refs/lo/pull/1/overview-fork'),
  ).toBe(commit);
});

test('a pull request without an overview has none, which is no error', async () => {
  const server = repoServer();
  pullRequest(server);
  server.repo('contributor', 'repo');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  expect(await repo.fetchOverview(1)).toBeUndefined();
  expect(await repo.fetchOverview(1, { owner: 'contributor', name: 'repo' })).toBeUndefined();
});

test('the fork’s overview signs in to the remote’s own address alone', async () => {
  const server = repoServer();
  pullRequest(server);
  const commit = publishOverview(server, server.repo('contributor', 'repo'), 'From the fork');
  const http = await GitHttpServer.start(server.remotes, 'gho_TOKEN');
  onTestFinished(() => http.close());
  const cache = await cacheFor(http.url);
  const repo = await cache.open('owner', 'repo', { token: () => Promise.resolve('gho_TOKEN') });

  const overview = await repo.fetchOverview(1, { owner: 'contributor', name: 'repo' });

  expect(overview?.commit).toBe(parseOid(commit));
  expect(new Set(http.signedInWith())).toEqual(new Set(['gho_TOKEN']));
  // A fork is named by its owner and name, under the remote's own address.
  await expect(repo.fetchOverview(1, { owner: '..', name: 'repo' })).rejects.toThrow(
    "isn't a valid repository owner",
  );
  await expect(
    repo.fetchOverview(1, { owner: 'evil.example.com/x', name: 'repo' }),
  ).rejects.toThrow("isn't a valid repository owner");
});

test('an overview that names a commit of the code cuts none of its history short', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // A fork whose overview ref names the base branch's tip, whose history the clone has.
  const fork = server.repo('contributor', 'repo');
  fork.takeFrom(pr.remote, 'refs/heads/trunk', 'refs/lo/pr/1');
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  await fetch(repo, 1);
  expect(await repo.mergeBase(pr.head, pr.trunkTip)).toBe(pr.base);

  const overview = await repo.fetchOverview(1, { owner: 'contributor', name: 'repo' });

  expect(overview?.commit).toBe(pr.trunkTip);
  expect(await repo.mergeBase(pr.head, pr.trunkTip)).toBe(pr.base);
  expect(await repo.pullCommits(pr.base, pr.trunkTip)).toHaveLength(1);
  expect(existsSync(join(repo.folder, 'shallow'))).toBe(false);
});
