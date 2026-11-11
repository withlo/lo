// Stopping a cache, as Lo does when it quits: every git running in it ends, fetches and reads and
// each clone's reader, what a stopped fetch leaves is removed, and nothing more runs there. And the
// proxy a cache is given for every repository, asked about each one's address.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FAKE_OID, FakeGitHub, FakeServer } from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { gitAt } from '../src/find.ts';
import { parseOid } from '../src/oid.ts';
import type { Activity } from '../src/progress.ts';
import type { PullRequestRefs } from '../src/repo.ts';
import { cacheFor, eventually, failureOf, tempFolder, wrappedGit } from './support.ts';

/** Pull request #1 into `main`, as an API that knows nothing else describes it. */
const PULL_ONE: PullRequestRefs = { number: 1, baseBranch: 'main' };

/** An object no clone here has. */
const MISSING = parseOid(FAKE_OID);

async function started<T extends { close(): Promise<void> }>(server: Promise<T>): Promise<T> {
  const running = await server;
  onTestFinished(() => running.close());
  return running;
}

/** Whether nothing is left running in the process group `pid` led. */
function groupGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
  // Something is in the group: only a process that has exited and waits to be collected, as one
  // whose parent exited first does until the system collects it, isn't running.
  return execFileSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .every((line) => {
      const [group, state = ''] = line.trim().split(/\s+/);
      return Number(group) !== pid || state.startsWith('Z');
    });
}

/** The files under `folder` whose names `match` picks, as paths from it. */
function filesIn(folder: string, match: (name: string) => boolean): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((path) =>
    match(path.split('/').at(-1) ?? ''),
  );
}

test('stopping a cache ends every git in it, and nothing more runs there', async () => {
  const github = await started(FakeGitHub.keepingAlive(true));
  // The real git, noting each process it runs as, since exec keeps the shell's process ID.
  const dir = tempFolder();
  const pids = join(dir, 'pids');
  const program = wrappedGit(join(dir, 'git'), { before: `echo $$ >> '${pids}'` });
  const status = await gitAt(program, { env: process.env, platform: process.platform });
  if (status.status !== 'found') throw new Error(`the wrapped git: ${status.status}`);
  const cache = await cacheFor(github.url, { git: status.git });
  const activities: Activity[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  // A fetch GitHub keeps alive, which no limit stops for minutes.
  const fetching = repo.fetchPull(PULL_ONE).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  await eventually(() => activities.some((activity) => activity.kind === 'preparing'));
  // The clone's reader, which runs as long as the clone is open.
  expect(await repo.readBlob(MISSING)).toBe(undefined);
  // A read that waits for input it never gets.
  const reading = cache.runner.command('none').arg('hash-object', '--stdin').start({ input: true });
  const ran = () =>
    readFileSync(pids, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map(Number);
  await eventually(() => ran().includes(reading.pid ?? 0));
  // The fetch, the reader and the read.
  expect(ran().filter((pid) => !groupGone(pid))).toHaveLength(3);
  // The fetch's trace, which it writes as it goes.
  expect(filesIn(join(cache.root, 'tmp'), (name) => name.endsWith('.trace'))).toHaveLength(1);

  const began = Date.now();
  await cache.stop();

  // Every git is gone, and what the fetch was writing, its trace, and the cache's lock with it,
  // before stopping returns.
  expect(Date.now() - began).toBeLessThan(5000);
  expect(ran().filter((pid) => !groupGone(pid))).toEqual([]);
  expect(filesIn(repo.folder, (name) => name.startsWith('tmp_') || name.endsWith('.lock'))).toEqual(
    [],
  );
  expect(filesIn(join(cache.root, 'tmp'), (name) => name.endsWith('.trace'))).toEqual([]);
  expect(existsSync(join(cache.root, 'lo-cache.lock'))).toBe(false);
  expect((await reading.exited).signal).toBe('SIGTERM');
  expect(await fetching).toBeInstanceOf(GitError);
  // Nothing more runs: not a new git, not the reader, not a fetch.
  expect(() => cache.runner.command('none')).toThrow('the cache is closed');
  expect(await failureOf(repo.readBlob(MISSING))).toBe(
    '`git cat-file --batch-command` failed: the repository was closed',
  );
  expect(await failureOf(repo.fetchPull(PULL_ONE))).toMatch(/the cache is closed/);
  expect(ran().filter((pid) => !groupGone(pid))).toEqual([]);
});

test('stopping a cache waits for a write to a clone to finish, for two seconds at most', async () => {
  const github = await started(FakeGitHub.keepingAlive(true));
  const cache = await cacheFor(github.url);
  // Writes that hold clones' locks once their gits have stopped: one that finishes soon, and one
  // that never does.
  const soon = await cache.cloneLock('owner', 'soon').acquire('removing what a fetch left');
  const finished = new Promise<number>((resolve) =>
    setTimeout(() => {
      soon();
      resolve(Date.now());
    }, 300),
  );
  await cache.cloneLock('owner', 'never').acquire('removing what a fetch left');

  const began = Date.now();
  await cache.stop();
  const stopped = Date.now();

  expect(stopped).toBeGreaterThanOrEqual(await finished);
  expect(stopped - began).toBeGreaterThanOrEqual(2000);
  expect(stopped - began).toBeLessThan(3000);
  expect(existsSync(join(cache.root, 'lo-cache.lock'))).toBe(false);
});

test('stopping a cache with nothing running in it closes it', async () => {
  const github = await started(FakeGitHub.keepingAlive(true));
  const cache = await cacheFor(github.url);

  await cache.stop();
  // Twice is the same as once.
  await cache.stop();

  expect(existsSync(join(cache.root, 'lo-cache.lock'))).toBe(false);
  await expect(cacheFor(github.url, { root: cache.root })).resolves.toBeDefined();
});

test('a cache asks its proxy about each repository’s own address, unless one is opened with its own', async () => {
  const proxy = await started(FakeServer.proxy());
  const asked: string[] = [];
  const cache = await cacheFor('https://github.com', {
    proxy: (address) => {
      asked.push(address);
      return Promise.resolve(proxy.url);
    },
  });
  const repo = await cache.open('owner', 'repo');

  expect(await failureOf(repo.fetchPull(PULL_ONE))).toBeDefined();

  expect(asked).toEqual(['https://github.com/owner/repo.git']);
  expect(proxy.saw('CONNECT github.com:443')).toBe(true);

  // One opened with a proxy of its own takes that one.
  const elsewhere = await started(FakeServer.proxy());
  const other = await cache.open('owner', 'other', {
    proxy: () => Promise.resolve(elsewhere.url),
  });
  expect(await failureOf(other.fetchPull(PULL_ONE))).toBeDefined();
  expect(asked).toHaveLength(1);
  expect(elsewhere.saw('CONNECT github.com:443')).toBe(true);
});
