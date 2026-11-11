// Opening clones, and fetching pull requests and commits into them.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, missingObjects, packs } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { type Oid, parseOid } from '../src/oid.ts';
import { blobs, changedBlobs, fetch, pullRequest, readFile, refs, revParse } from './fixtures.ts';
import { cacheFor, failureOf, repoServer, tempFolder } from './support.ts';

/** The error `promise` fails with. */
async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

test('opens a bare partial clone on first use', async () => {
  const server = repoServer();
  const cache = await cacheFor(server);

  // Nothing is fetched, so the repository needn't even exist yet.
  const repo = await cache.open('Owner', 'Repo.rs');

  const folder = repo.folder;
  expect(folder).toBe(join(cache.root, 'repos/github.com/owner/repo.rs.git'));
  expect(cache.repoFolder('OWNER', 'REPO.RS')).toBe(folder);
  expect(git(folder, 'rev-parse', '--is-bare-repository')).toBe('true');
  expect(git(folder, 'config', 'remote.origin.url')).toBe(`${server.baseUrl}/Owner/Repo.rs.git`);
  expect(git(folder, 'config', 'remote.origin.promisor')).toBe('true');
  expect(git(folder, 'config', 'remote.origin.partialclonefilter')).toBe('blob:none');
  expect(existsSync(join(folder, 'lo-last-used'))).toBe(true);
  // No template, so no sample hooks.
  expect(existsSync(join(folder, 'hooks'))).toBe(false);

  // Opening it again reuses it, and writes no config when nothing changed.
  writeFileSync(join(folder, 'marker'), '');
  const configBefore = statSync(join(folder, 'config')).mtimeMs;
  const again = await cache.open('Owner', 'Repo.rs');
  expect(again.folder).toBe(folder);
  expect(existsSync(join(folder, 'marker'))).toBe(true);
  expect(statSync(join(folder, 'config')).mtimeMs).toBe(configBefore);
  // A new canonical name (different case) for the same repository updates the URL.
  await cache.open('owner', 'repo.rs');
  expect(git(folder, 'config', 'remote.origin.url')).toBe(`${server.baseUrl}/owner/repo.rs.git`);
});

test('git never uses a repository above the cache', async () => {
  const server = repoServer();
  pullRequest(server);
  // The user's own repository around the cache, such as dotfiles kept in the home folder. Its
  // origin has pull request #1; the clone's own remote doesn't exist.
  const home = tempFolder();
  git(home, 'init', '-q');
  git(home, 'config', 'remote.origin.url', `${server.baseUrl}/owner/repo.git`);
  const cache = await cacheFor(server, { root: join(home, 'Library/Caches/Lo') });
  const repo = await cache.open('owner', 'not-on-the-server');
  // Half deleted, as by a cleanup that was interrupted.
  rmSync(join(repo.folder, 'HEAD'));

  const error = await failure(repo.fetchPull(refs(1, 'trunk')));

  expect(error.detail.kind).toBe('git');
  expect(error.message).toContain('not a git repository');
  expect(error.isRetryable()).toBe(false);
  expect(git(home, 'for-each-ref', '--format=%(refname)')).toBe('');
});

test('a clone left without head is made again', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  await fetch(repo, 1);
  rmSync(join(repo.folder, 'HEAD'));

  const again = await cache.open('owner', 'repo');

  expect((await fetch(again, 1)).head).toBe(pr.head);
  expect(existsSync(join(again.folder, 'HEAD'))).toBe(true);
});

test('refuses names that could leave the cache', async () => {
  const cache = await cacheFor(repoServer());
  const names = [
    ['..', 'x'],
    ['a/b', 'c'],
    ['o', '../../x'],
    ['', 'x'],
    ['o', '.'],
  ] as const;
  const errors = [];
  for (const [owner, name] of names) errors.push(await failure(cache.open(owner, name)));
  expect(errors.map((error) => error.detail.kind)).toEqual(names.map(() => 'invalid'));
});

test('fetches a pull requests head and base and pins them', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  const fetched = await fetch(repo, 1);

  expect(fetched).toEqual({
    head: pr.head,
    headSource: { kind: 'pullRef' },
    baseTip: pr.trunkTip,
    baseSource: 'branch',
  });
  expect(revParse(repo, 'refs/lo/pull/1/head')).toBe(pr.head);
  expect(revParse(repo, 'refs/lo/pull/1/base')).toBe(pr.trunkTip);
  expect(revParse(repo, `refs/lo/pull/1/revs/${pr.head}`)).toBe(pr.head);
  expect(revParse(repo, `refs/lo/pull/1/bases/${pr.trunkTip}`)).toBe(pr.trunkTip);
  expect(await repo.pullRevisions(1)).toEqual([pr.head]);
  expect(await repo.mergeBase(fetched.head, fetched.baseTip)).toBe(pr.base);

  // Only Lo's refs: no branches, tags or FETCH_HEAD.
  const names = git(repo.folder, 'for-each-ref', '--format=%(refname)').split('\n');
  expect(names.filter((name) => !name.startsWith('refs/lo/pull/1/'))).toEqual([]);
  expect(existsSync(join(repo.folder, 'FETCH_HEAD'))).toBe(false);
  // Partial: commits and trees, but no file contents yet.
  expect(missingObjects(repo.folder, pr.head)).not.toEqual([]);
});

test('fetches a pull request from a fork', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // The fork has the base's history and a commit of its own.
  const fork = server.repo('contributor', 'repo');
  fork.takeFrom(pr.remote, 'refs/heads/trunk', 'refs/heads/trunk');
  git(fork.work, 'fetch', '-q', fork.gitDir, 'trunk');
  git(fork.work, 'reset', '-q', '--hard', 'FETCH_HEAD');
  fork.write('from-fork.txt', "a contributor's change\n");
  const forkHead = fork.commit('from a fork');
  fork.publish('refs/heads/patch-1');
  // GitHub copies the fork's head into the base repository's refs/pull/<n>/head.
  pr.remote.takeFrom(fork, 'refs/heads/patch-1', 'refs/pull/2/head');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  const fetched = await fetch(repo, 2);

  expect(fetched.head).toBe(forkHead);
  expect(await repo.mergeBase(fetched.head, fetched.baseTip)).toBe(pr.trunkTip);
  // From the base repository alone.
  expect(git(repo.folder, 'config', 'remote.origin.url')).not.toContain('contributor');
});

test('a force pushed revision stays readable', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const r1 = (await fetch(repo, 1)).head;

  pr.remote.switch('feature').write('feature.txt', 'second version\n');
  const r2 = parseOid(pr.remote.amend('feature, amended'));
  pr.remote.publish('refs/pull/1/head');
  expect((await fetch(repo, 1)).head).toBe(r2);

  // refs/pull/1/head moved on; Lo kept both.
  expect(revParse(repo, 'refs/lo/pull/1/head')).toBe(r2);
  expect((await repo.pullRevisions(1)).toSorted()).toEqual([r1, r2].toSorted());

  // A garbage collection keeps every revision, with what was downloaded of it.
  expect(await repo.download([...blobs(repo, r1), ...blobs(repo, r2)])).toEqual([]);
  git(repo.folder, 'gc', '-q', '--prune=now');
  expect(readFile(repo, r1, 'feature.txt')).toBe('first version');
  expect(readFile(repo, r2, 'feature.txt')).toBe('second version');
  expect(git(repo.folder, 'diff', '--name-only', r1, r2)).toBe('feature.txt');
  expect(await repo.isAncestor(pr.base, r1)).toBe(true);
});

test('a revision the server lost stays readable once read', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const cache = await cacheFor(server);
  const repo = await cache.open('owner', 'repo');
  const r1 = (await fetch(repo, 1)).head;
  // Showing the revision's diff downloads both sides of each changed file.
  expect(await repo.download(changedBlobs(repo, pr.base, r1))).toEqual([]);

  pr.remote.switch('feature').write('feature.txt', 'second version\n');
  const r2 = parseOid(pr.remote.amend('feature, amended'));
  pr.remote.publish('refs/heads/feature').publish('refs/pull/1/head');
  await fetch(repo, 1);
  pr.remote.forgetUnreachable();
  expect(pr.remote.has(r1)).toBe(false);
  git(repo.folder, 'gc', '-q', '--prune=now');

  expect(readFile(repo, r1, 'feature.txt')).toBe('first version');
  expect(await repo.missingObjects(changedBlobs(repo, pr.base, r1))).toEqual([]);
  // Fetching it by ID needs nothing from the server.
  await repo.fetchCommit(r1);
  expect(await repo.isAncestor(pr.base, r2)).toBe(true);

  // A cache that never fetched it can't get it any more.
  const other = await (await cacheFor(server)).open('owner', 'repo');
  const error = await failure(other.fetchCommit(r1));
  expect(error.detail).toEqual({ kind: 'unavailable', oid: r1 });
  expect(error.message).toBe(`commit ${r1.slice(0, 7)} is no longer available`);
});

test('uses the head githubs api reported', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // A push GitHub's API already shows, before refs/pull/1/head catches up.
  pr.remote.switch('feature').write('feature.txt', 'pushed a moment ago\n');
  const pushed = parseOid(pr.remote.commit('a new push'));
  pr.remote.publish('refs/heads/feature');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  const fetched = await repo.fetchPull({ ...refs(1, 'trunk'), head: pushed });

  expect(fetched.head).toBe(pushed);
  expect(fetched.headSource).toEqual({ kind: 'api', pullRef: pr.head });
  // Both are pinned.
  expect((await repo.pullRevisions(1)).toSorted()).toEqual([pr.head, pushed].toSorted());

  // The API's head, already fetched, isn't fetched again.
  const before = packs(repo.folder);
  const again = await repo.fetchPull({ ...refs(1, 'trunk'), head: pushed });
  expect(again.head).toBe(pushed);
  expect(packs(repo.folder)).toBe(before);
  // Nor is anything when the API's head is refs/pull/1/head's.
  const same = await repo.fetchPull({ ...refs(1, 'trunk'), head: pr.head });
  expect(same.headSource).toEqual({ kind: 'pullRef' });
  expect(packs(repo.folder)).toBe(before);
});

test('says when githubs head is gone', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const unknown = parseOid('1234567890123456789012345678901234567890');

  const fetched = await repo.fetchPull({ ...refs(1, 'trunk'), head: unknown });

  expect(fetched.head).toBe(pr.head);
  expect(fetched.headSource).toEqual({ kind: 'pullRefNotApi', api: unknown });
});

test('a deleted base branch falls back to the apis base', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // Pull request #2 sits on `feature`, which was merged and deleted.
  pr.remote.switch('feature').write('upper.txt', 'upper\n');
  const upper = pr.remote.commit('upper layer');
  pr.remote.publish('refs/pull/2/head');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  // Without the API's base, the missing branch is an error.
  const error = await failure(repo.fetchPull(refs(2, 'gone')));
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'refNotFound' });

  const fetched = await repo.fetchPull({ ...refs(2, 'gone'), base: pr.head });
  expect(fetched.head).toBe(upper);
  expect(fetched.baseTip).toBe(pr.head);
  expect(fetched.baseSource).toBe('api');
  expect(revParse(repo, 'refs/lo/pull/2/base')).toBe(pr.head);
});

test('a deleted base branch whose commit github lost is unavailable', async () => {
  const server = repoServer();
  pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const lost = parseOid('1234567890123456789012345678901234567890');

  const error = await failure(repo.fetchPull({ ...refs(1, 'gone'), base: lost }));

  expect(error.detail).toEqual({ kind: 'unavailable', oid: lost });
  expect(error.isRetryable()).toBe(false);
});

test('base branches whose names nest dont collide', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // Pull request #1 goes into `rel`. Then `rel` is deleted and `rel/1.0` created, and pull
  // request #2 goes into that.
  pr.remote.switch('rel').publish('refs/heads/rel');
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await repo.fetchPull(refs(1, 'rel'));
  git(pr.remote.gitDir, 'update-ref', '-d', 'refs/heads/rel');
  git(pr.remote.work, 'branch', '-q', '-m', 'rel', 'rel-old');
  pr.remote.switch('rel/1.0').publish('refs/heads/rel/1.0');
  pr.remote.publish('refs/pull/2/head');

  const fetched = await repo.fetchPull(refs(2, 'rel/1.0'));

  expect(fetched.baseTip).toBe(pr.trunkTip);
  // And #1 still fetches, with the API's base now that its branch is gone.
  const again = await repo.fetchPull({ ...refs(1, 'rel'), base: pr.trunkTip });
  expect(again.baseSource).toBe('api');
});

test('refuses base branches that arent branch names', async () => {
  const server = repoServer();
  pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const names = ['', 'a..b', 'with space', 'trunk:refs/heads/x', 'x.lock', '-x', 'a~1'];
  const failures = [];
  for (const name of names) failures.push(await failureOf(repo.fetchPull(refs(1, name))));
  expect(failures).toEqual(names.map(() => expect.stringContaining("isn't a valid branch name")));
});

test('fetches a commit by id and pins it', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // A commit on no ref Lo fetches.
  pr.remote.switch('elsewhere').write('elsewhere.txt', 'elsewhere\n');
  const elsewhere = parseOid(pr.remote.commit('elsewhere'));
  pr.remote.publish('refs/heads/elsewhere');
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  await repo.fetchCommit(elsewhere);

  expect(revParse(repo, `refs/lo/commits/${elsewhere}`)).toBe(elsewhere);
  expect(await repo.download(blobs(repo, elsewhere))).toEqual([]);
  expect(readFile(repo, elsewhere, 'elsewhere.txt')).toBe('elsewhere');
  // Asking again is fine.
  await repo.fetchCommit(elsewhere);
});

test('a commit the server never had is unavailable', async () => {
  const server = repoServer();
  pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  const unknown = parseOid('1234567890123456789012345678901234567890');

  const error = await failure(repo.fetchCommit(unknown));

  expect(error.detail.kind).toBe('unavailable');
});

test('a missing pull request is a fetch error', async () => {
  const server = repoServer();
  pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');

  const error = await failure(repo.fetchPull(refs(9, 'trunk')));

  expect(error.detail).toMatchObject({
    kind: 'fetch',
    what: 'pull request #9',
    failure: 'refNotFound',
  });
  expect(error.isRetryable()).toBe(false);
  expect(error.message).toMatch(/^can't fetch pull request #9: GitHub doesn't have it/);
});

test('a missing repository is a fetch error', async () => {
  const repo = await (await cacheFor(repoServer())).open('owner', 'nothing-here');

  const error = await failure(repo.fetchPull(refs(1, 'trunk')));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'repoNotFound' });
});

test('an unreachable server is a retryable network error', async () => {
  // Nothing listens on port 1.
  const repo = await (await cacheFor('https://127.0.0.1:1')).open('owner', 'repo');

  const error = await failure(repo.fetchPull(refs(1, 'trunk')));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'network' });
  expect(error.isRetryable()).toBe(true);
});

test('without opting in only https is allowed', async () => {
  const server = repoServer();
  pullRequest(server);
  // A cache that fetches from a server on this machine, over HTTPS, which isn't there, pointed at
  // a file:// remote behind its back.
  const cache = await cacheFor('https://127.0.0.1:1');
  const repo = await cache.open('owner', 'repo');
  git(repo.folder, 'config', 'remote.origin.url', `${server.baseUrl}/owner/repo.git`);

  const error = await failure(repo.fetchPull(refs(1, 'trunk')));

  // The fetch goes where the cache says, over HTTPS, never where the clone's settings say.
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'network' });
  expect(error.message).toContain('127.0.0.1');
  expect(git(repo.folder, 'for-each-ref')).toBe('');
});

test('many fetches at once all succeed', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  pr.remote.switch('feature').publish('refs/pull/2/head');
  const cache = await cacheFor(server);

  const fetched = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const repo = await cache.open('owner', 'repo');
      return repo.fetchPull(refs(1 + (i % 2), 'trunk'));
    }),
  );

  expect(fetched.map((each) => each.head)).toEqual(fetched.map(() => pr.head));
});

test('fetches of one pull request at once each get what they asked for', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  // Two windows disagree about pull request #1's base: one still has `trunk`, the other knows it
  // was retargeted to `rel`, whose tip is another commit.
  pr.remote.switch('rel').write('rel.txt', 'release\n');
  const relTip = parseOid(pr.remote.commit('release'));
  pr.remote.publish('refs/heads/rel');
  const cache = await cacheFor(server);

  for (let round = 0; round < 5; round++) {
    const repos = await Promise.all(Array.from({ length: 8 }, () => cache.open('owner', 'repo')));
    const results = await Promise.all(
      repos.map(async (repo, i): Promise<[Oid, Oid]> => {
        const [branch, tip] = i % 2 === 0 ? ['trunk', pr.trunkTip] : ['rel', relTip];
        const fetched = await repo.fetchPull(refs(1, branch));
        return [fetched.baseTip, tip];
      }),
    );
    expect(results.map(([got]) => got)).toEqual(results.map(([, expected]) => expected));
  }
});

test('a lock left on a ref the fetch writes is removed first', async () => {
  const server = repoServer();
  const pr = pullRequest(server);
  const repo = await (await cacheFor(server)).open('owner', 'repo');
  await fetch(repo, 1);
  // As a git killed from outside, or in a crash, leaves it.
  const lock = join(repo.folder, 'refs/lo/pull/1/head.lock');
  mkdirSync(join(repo.folder, 'refs/lo/pull/1'), { recursive: true });
  writeFileSync(lock, '');

  pr.remote.switch('feature').write('feature.txt', 'second version\n');
  const r2 = pr.remote.amend('feature, amended');
  pr.remote.publish('refs/pull/1/head');

  expect((await fetch(repo, 1)).head).toBe(r2);
  expect(existsSync(lock)).toBe(false);
});
