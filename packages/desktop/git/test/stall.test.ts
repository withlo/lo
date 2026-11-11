// Fetches that would wait forever, each stopped by its limit: one GitHub keeps alive without ever
// sending a pack, one GitHub keeps alive halfway through one, one that never gets past
// connecting, and one that brings more than it may; and a slow fetch that keeps getting further,
// which no limit stops. Each runs against a fake: a fake GitHub on this machine, or a fake git.
// The limits are a second or a few, and each test fails, rather than hangs, without its limit.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FAKE_OID, FakeGitHub, FakeServer, gitBytes, gitProgram, history } from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { GitError } from '../src/errors.ts';
import { gitAt } from '../src/find.ts';
import type { Git } from '../src/git.ts';
import { DEFAULT_FETCH_LIMITS, type FetchLimits } from '../src/limits.ts';
import { parseOid } from '../src/oid.ts';
import type { Activity } from '../src/progress.ts';
import { OVERVIEW_LIMIT, type Overview, type PullRequestRefs } from '../src/repo.ts';
import { Token } from '../src/token.ts';
import { cacheFor, eventually, foundGit, runnerIn, script, tempFolder } from './support.ts';

/** Pull request #1 into `main`, as an API that knows nothing else describes it. */
const PULL_ONE: PullRequestRefs = { number: 1, baseBranch: 'main' };

/** git, as if Lo's environment held only `PATH`: no proxy, whatever the machine has. */
function plainGit(): Promise<Git> {
  return foundGit({ PATH: '/usr/bin:/bin' });
}

async function failure(promise: Promise<unknown>): Promise<GitError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  return error;
}

async function started<T extends { close(): Promise<void> }>(server: Promise<T>): Promise<T> {
  const running = await server;
  onTestFinished(() => running.close());
  return running;
}

/** The command lines of the processes on this machine that mention `text`. */
function processesMentioning(text: string): string[] {
  return execFileSync('ps', ['axww', '-o', 'pid=,stat=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(text) && !line.includes('ps axww'));
}

/** Waits up to two seconds for no process to mention `text`, and says which still do. */
async function noProcessSoon(text: string): Promise<string[]> {
  await eventually(() => processesMentioning(text).length === 0, 2000).catch(() => undefined);
  return processesMentioning(text);
}

/** The trace files left in the cache at `root`'s `tmp/`. */
function tracesLeft(root: string): string[] {
  return existsSync(join(root, 'tmp'))
    ? readdirSync(join(root, 'tmp')).filter((name) => name.endsWith('.trace'))
    : [];
}

/** Whether process `pid` is gone. */
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}

test('a fetch github keeps alive without a pack stops at its limit', async () => {
  const github = await started(FakeGitHub.keepingAlive(true));
  const limit = 3000;
  const cache = await cacheFor(github.url, {
    git: await plainGit(),
    // A stall guard of a second, which the keep-alives never trip.
    config: ['http.lowSpeedTime=1'],
    limits: { ...DEFAULT_FETCH_LIMITS, fetch: limit, firstFetch: limit },
  });
  const activities: Activity[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  const began = Date.now();
  const error = await failure(repo.fetchPull(PULL_ONE));

  const took = Date.now() - began;
  expect(took).toBeGreaterThanOrEqual(limit);
  expect(took).toBeLessThan(limit * 3);
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'timedOut' });
  expect(error.message).toBe(
    "can't fetch pull request #1: GitHub took longer than 3 s to start sending, so Lo stopped it " +
      'while GitHub was still preparing what to send (counting objects, 50% of 2)',
  );
  expect(error.isRetryable()).toBe(true);
  // It got as far as asking for the pack.
  expect(github.commands()).toEqual(['ls-refs', 'fetch']);
  // The tab heard it connect, then GitHub count, and heard it again as it waited, once a second.
  expect(activities[0]?.kind).toBe('connecting');
  const counting = activities.findLast(
    (activity) => activity.kind === 'preparing' && activity.progress?.stage === 'Counting objects',
  );
  expect(counting?.kind === 'preparing' && counting.elapsed).toBeGreaterThanOrEqual(1000);
  // Nothing of git's is left running: not git, not git-remote-http.
  expect(await noProcessSoon(`127.0.0.1:${github.port}`)).toEqual([]);
  expect(tracesLeft(cache.root)).toEqual([]);
});

test('a fetch is preparing once gits trace says github answered', async () => {
  // GitHub says nothing of preparing: only git's trace tells connecting from preparing.
  const github = await started(FakeGitHub.keepingAlive(false));
  const cache = await cacheFor(github.url, {
    git: await plainGit(),
    config: ['http.lowSpeedTime=1'],
    limits: { ...DEFAULT_FETCH_LIMITS, connect: 1000, fetch: 2000, firstFetch: 2000 },
  });
  const activities: Activity[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  const error = await failure(repo.fetchPull(PULL_ONE));

  // Past the connect limit, as it had connected.
  expect(error.message).toBe(
    "can't fetch pull request #1: GitHub took longer than 2 s to start sending, so Lo stopped it " +
      'while GitHub was still working out what to send',
  );
  const preparing = activities.filter((activity) => activity.kind === 'preparing');
  expect(preparing.length).toBeGreaterThan(0);
  expect(preparing.filter((activity) => activity.progress !== undefined)).toEqual([]);
});

/** The limits of a fetch that may take a while to come in: a second to start, a second to stall. */
const SLOW: FetchLimits = { ...DEFAULT_FETCH_LIMITS, fetch: 1000, firstFetch: 1000, stall: 1000 };

test('a slow fetch that keeps getting further isnt stopped', async () => {
  const dir = tempFolder();
  const { first: main, last: head, pack } = history(join(dir, 'github.git'), 40);
  // Three seconds of pieces, well past both limits, each soon after the last.
  const github = await started(
    FakeGitHub.start(main, head, { kind: 'pack', pack, pieces: 60, every: 50 }),
  );
  const logged: string[] = [];
  const cache = await cacheFor(github.url, {
    git: await plainGit(),
    limits: SLOW,
    log: (line) => logged.push(line),
  });
  const activities: Activity[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  const began = Date.now();
  const fetched = await repo.fetchPull(PULL_ONE);

  expect(Date.now() - began).toBeGreaterThanOrEqual(2000);
  expect([fetched.head, fetched.baseTip]).toEqual([head, main]);
  const receiving = activities.filter(
    (activity) =>
      activity.kind === 'transferring' &&
      activity.progress.stage === 'Receiving objects' &&
      activity.elapsed >= 1000,
  );
  expect(receiving.length).toBeGreaterThan(0);
  expect(logged.filter((line) => line.includes('stopped'))).toEqual([]);
});

test('a fetch that stops getting further stops at its stall limit', async () => {
  const dir = tempFolder();
  const { first: main, last: head, pack } = history(join(dir, 'github.git'), 40);
  // A third of the pack, then only keep-alives.
  const github = await started(
    FakeGitHub.start(main, head, { kind: 'pack', pack, pieces: 60, every: 50, stopAfter: 20 }),
  );
  const cache = await cacheFor(github.url, {
    git: await plainGit(),
    // A stall guard of a second, which the keep-alives never trip.
    config: ['http.lowSpeedTime=1'],
    // Only the stall limit can stop it in time.
    limits: { ...SLOW, fetch: 20_000, firstFetch: 20_000 },
  });
  const repo = await cache.open('owner', 'repo');

  const began = Date.now();
  const error = await failure(repo.fetchPull(PULL_ONE));

  expect(Date.now() - began).toBeLessThan(10_000);
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'timedOut' });
  expect(error.message).toMatch(
    /^can't fetch pull request #1: it got no further for 1 s, so Lo stopped it while receiving objects, /,
  );
  expect(await noProcessSoon(`127.0.0.1:${github.port}`)).toEqual([]);
  expect(tracesLeft(cache.root)).toEqual([]);
});

test('a fetch that never connects stops at the connect limit', async () => {
  // It takes connections and never says anything, so a client that speaks first, as TLS does,
  // waits for its answer: still connecting, to curl.
  const silent = await started(FakeServer.silent());
  const cache = await cacheFor(`https://127.0.0.1:${silent.port}`, {
    git: await plainGit(),
    // A stall guard of a second, which doesn't cover connecting.
    config: ['http.lowSpeedTime=1'],
    limits: { ...DEFAULT_FETCH_LIMITS, connect: 1000 },
  });
  const activities: Activity[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => activities.push(activity),
  });

  const began = Date.now();
  const error = await failure(repo.fetchPull(PULL_ONE));

  const took = Date.now() - began;
  expect(took).toBeGreaterThanOrEqual(1000);
  expect(took).toBeLessThan(5000);
  expect(silent.connections()).toBeGreaterThan(0);
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'network' });
  expect(error.message).toBe(
    "can't fetch pull request #1: the network failed (GitHub didn't answer within 1 s, so Lo " +
      'stopped connecting)',
  );
  expect(error.isRetryable()).toBe(true);
  expect(activities.filter((activity) => activity.kind !== 'connecting')).toEqual([]);
  expect(await noProcessSoon(`127.0.0.1:${silent.port}`)).toEqual([]);
});

/**
 * A git, in `dir`, whose fetch leaves what one stopped halfway would: a ref's lock, packed-refs'
 * lock and its pack's keep file. It starts a process of its own, as git starts
 * git-remote-https, writes both their IDs into `dir`'s `pids`, says GitHub is counting objects,
 * and waits. Asked to stop, with SIGTERM, it writes `dir`'s `terminated` and exits, leaving its
 * locks, as a git killed before it could clean up would. Every other command is git's.
 */
async function stuckGit(dir: string): Promise<Git> {
  const real = gitProgram();
  const pids = join(dir, 'pids');
  const program = script(
    join(dir, 'git'),
    [
      `case " $* " in *" fetch "*) ;; *) exec '${real}' "$@";; esac`,
      'for arg; do case "$arg" in --git-dir=*) git_dir="${arg#--git-dir=}";; esac; done',
      'mkdir -p "$git_dir/refs/lo/pull/1" "$git_dir/objects/pack"',
      'touch "$git_dir/refs/lo/pull/1/head.lock" "$git_dir/packed-refs.lock"',
      'echo "fetch-pack $$ on test" > "$git_dir/objects/pack/pack-1.keep"',
      `trap "touch '${join(dir, 'terminated')}'; exit 143" TERM`,
      'sleep 60 &',
      `echo "$$ $!" > '${pids}.new' && mv '${pids}.new' '${pids}'`,
      "printf 'remote: Counting objects:  50%% (1/2)\\r' >&2",
      'wait',
    ].join('\n'),
  );
  const status = await gitAt(program, {
    env: { PATH: '/usr/bin:/bin' },
    platform: process.platform,
  });
  if (status.status !== 'found') throw new Error(`the stuck git: ${status.status}`);
  return status.git;
}

/** The IDs a fake git wrote into `dir`'s `pids`. */
function pidsIn(dir: string): number[] {
  return readFileSync(join(dir, 'pids'), 'utf8').trim().split(/\s+/).map(Number);
}

test('a stopped fetch leaves no process or lock behind', async () => {
  const dir = tempFolder();
  const cache = await cacheFor('https://127.0.0.1:1', {
    git: await stuckGit(dir),
    limits: { ...DEFAULT_FETCH_LIMITS, fetch: 1000, firstFetch: 1000 },
  });
  const repo = await cache.open('owner', 'repo');
  // What isn't the stopped git's stays: another fetch's pack, a checkout's index lock, and the
  // lock of a replayed tree's pin, which a comparison writes meanwhile.
  const kept = [
    'objects/pack/pack-2.keep',
    'worktrees/x/index.lock',
    `refs/lo/replays/${FAKE_OID}/4242.lock`,
  ];
  for (const file of kept) {
    mkdirSync(dirname(join(repo.folder, file)), { recursive: true });
    writeFileSync(join(repo.folder, file), file.endsWith('.keep') ? 'fetch-pack 1 on test\n' : '');
  }

  const error = await failure(repo.fetchPull(PULL_ONE));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'timedOut' });
  expect(error.message).toMatch(
    /while GitHub was still preparing what to send \(counting objects, 50% of 2\)$/,
  );
  const pids = pidsIn(dir);
  expect(pids).toHaveLength(2);
  for (const pid of pids) await eventually(() => gone(pid), 2000);
  // git was asked to stop before it was killed, so it could clean up after itself.
  expect(existsSync(join(dir, 'terminated'))).toBe(true);
  const left = ['refs/lo/pull/1/head.lock', 'packed-refs.lock', 'objects/pack/pack-1.keep'];
  expect(left.filter((file) => existsSync(join(repo.folder, file)))).toEqual([]);
  expect(kept.filter((file) => !existsSync(join(repo.folder, file)))).toEqual([]);
  expect(tracesLeft(cache.root)).toEqual([]);
});

/** Waits, without letting anything else run, up to five seconds for `path` to exist. */
function blockUntilExists(path: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < 5000 && !existsSync(path); waited += 10) {
    Atomics.wait(sleeper, 0, 0, 10);
  }
}

test('a panic while git fetches leaves no process behind', async () => {
  const dir = tempFolder();
  const cache = await cacheFor('https://127.0.0.1:1', { git: await stuckGit(dir) });
  // A progress function that fails, once git has started what it starts.
  const repo = await cache.open('owner', 'repo', {
    progress: () => {
      blockUntilExists(join(dir, 'pids'));
      throw new Error('a progress function that fails');
    },
  });

  await expect(repo.fetchPull(PULL_ONE)).rejects.toThrow('a progress function that fails');

  const pids = pidsIn(dir);
  expect(pids).toHaveLength(2);
  for (const pid of pids) await eventually(() => gone(pid), 2000);
  expect(tracesLeft(cache.root)).toEqual([]);
});

test('gits trace never holds the token', async () => {
  const dir = tempFolder();
  const secret = 'SECRET_TOKEN_FOR_TRACE_TESTS';
  const trace = join(dir, 'trace');
  const lo = await runnerIn(dir, { git: await plainGit() });

  const credentials = await lo
    .command('none', { fetching: { token: new Token(secret) } })
    .env('GIT_TRACE2_EVENT', trace)
    .arg('credential', 'fill')
    .run('url=https://github.com/a/b.git\n\n');

  // The helper ran, and the trace saw it run.
  expect(credentials.toString('utf8')).toContain(secret);
  const traced = readFileSync(trace, 'utf8');
  expect(traced).toContain('"child_start"');
  expect(traced).not.toContain(secret);
});

test('the progress function is told only on the thread that fetches', async () => {
  // GitHub says it's counting objects, which reaches the watch between its own turns.
  const github = await started(FakeGitHub.keepingAlive(true));
  const cache = await cacheFor(github.url, {
    git: await plainGit(),
    limits: { ...DEFAULT_FETCH_LIMITS, fetch: 1000, firstFetch: 1000 },
  });
  let fetching = true;
  const told: { fetching: boolean; activity: Activity }[] = [];
  const repo = await cache.open('owner', 'repo', {
    progress: (activity) => told.push({ fetching, activity }),
  });

  const error = await failure(repo.fetchPull(PULL_ONE));
  fetching = false;
  await new Promise((resolve) => setTimeout(resolve, 1500));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'timedOut' });
  // It heard GitHub count, and nothing once the fetch was done.
  expect(
    told.some(
      ({ activity }) =>
        activity.kind === 'preparing' && activity.progress?.stage === 'Counting objects',
    ),
  ).toBe(true);
  expect(told.filter((each) => !each.fetching)).toEqual([]);
});

test('what git leaves running as it exits is stopped', async () => {
  const dir = tempFolder();
  const pids = join(dir, 'pids');
  // A fetch that exits at once, leaving a process of its own that keeps git's stderr open, as a
  // `git-remote-https` waiting on GitHub does when git dies mid-transfer.
  const program = script(
    join(dir, 'git'),
    [
      `case " $* " in *" fetch "*) ;; *) exec '${gitProgram()}' "$@";; esac`,
      'sleep 60 &',
      `echo "$!" > '${pids}.new' && mv '${pids}.new' '${pids}'`,
      "echo 'fatal: the transfer broke off' >&2",
      'exit 128',
    ].join('\n'),
  );
  const status = await gitAt(program, {
    env: { PATH: '/usr/bin:/bin' },
    platform: process.platform,
  });
  if (status.status !== 'found') throw new Error(status.message);
  const repo = await (
    await cacheFor('https://127.0.0.1:1', { git: status.git })
  ).open('owner', 'repo');

  const began = Date.now();
  const error = await failure(repo.fetchPull(PULL_ONE));

  // git's own failure, at once, rather than once what it left exits a minute later.
  expect(Date.now() - began).toBeLessThan(10_000);
  expect(error.message).toContain('the transfer broke off');
  const [straggler = 0] = pidsIn(dir);
  await eventually(() => gone(straggler), 2000);
});

/**
 * A pack of files holding `contents`, written into the bare repository `gitDir`, and their IDs.
 * git says how much has come in only once the first file has, so a test that stops a download
 * part way sends several.
 */
function packOf(gitDir: string, contents: readonly Buffer[]): { blobs: string[]; pack: Buffer } {
  const folder = `${gitDir}-files`;
  mkdirSync(folder);
  const paths = contents.map((bytes, index) => {
    const path = join(folder, String(index));
    writeFileSync(path, bytes);
    return path;
  });
  const git = (args: string[], input: string) =>
    gitBytes(gitDir, [`--git-dir=${gitDir}`, ...args], input).toString('utf8');
  const blobs = git(['hash-object', '-w', '--stdin-paths'], `${paths.join('\n')}\n`)
    .trim()
    .split('\n');
  // Random bytes have no deltas to look for.
  const pack = gitBytes(
    gitDir,
    [`--git-dir=${gitDir}`, 'pack-objects', '--stdout', '--quiet', '--window=0'],
    `${blobs.join('\n')}\n`,
  );
  return { blobs, pack };
}

/** An overview, at `commit`, of the files `blobs`. */
function overviewOf(commit: string, blobs: readonly string[]): Overview {
  return {
    commit: parseOid(commit),
    source: 'base',
    files: blobs.map((blob, index) => ({
      path: Buffer.from(`figure-${index}.bin`),
      oid: parseOid(blob),
      mode: '100644',
    })),
  };
}

const MIB = 1 << 20;

/** Limits under which a fetch that stops getting further fails in seconds, not minutes. */
const SHORT_STALL: FetchLimits = { ...DEFAULT_FETCH_LIMITS, stall: 10_000 };

test('a download that brings more than it may is stopped part way', async () => {
  // Files of random bytes, which nothing compresses, sent slowly. git says how much has come in
  // about twice a second, so GitHub sends well past the cap, 2.5 MB of 3, then nothing more: only
  // the cap on what comes in, and not the end of the pack, ends it.
  const github = join(tempFolder(), 'github.git');
  const { first: main, last: head } = history(github, 1);
  const { blobs, pack } = packOf(
    github,
    Array.from({ length: 6 }, () => randomBytes(MIB / 2)),
  );
  const piece = MIB / 16;
  const server = await started(
    FakeGitHub.start(main, head, {
      kind: 'pack',
      pack,
      pieces: Math.ceil(pack.length / piece),
      every: 50,
      stopAfter: 40,
    }),
  );
  const cache = await cacheFor(server.url, { git: await plainGit(), limits: SHORT_STALL });
  const repo = await cache.open('owner', 'repo');

  const error = await failure(repo.download(blobs.map(parseOid), 'the figures', { maxBytes: MIB }));

  expect(error.detail).toMatchObject({ kind: 'fetch', what: 'the figures', failure: 'tooLarge' });
  expect(error.message).toBe(
    "can't fetch the figures: it's more than 1 MB, so Lo stopped downloading it",
  );
  expect(await noProcessSoon(`127.0.0.1:${server.port}`)).toEqual([]);
});

test('an overview that brings more than 50 MB is stopped part way', async () => {
  // As above: GitHub sends 70 MB of 72, then nothing more.
  const github = join(tempFolder(), 'github.git');
  const { first: main, last: head } = history(github, 1);
  const { blobs, pack } = packOf(
    github,
    Array.from({ length: OVERVIEW_LIMIT / MIB + 22 }, () => randomBytes(MIB)),
  );
  const server = await started(
    FakeGitHub.start(main, head, {
      kind: 'pack',
      pack,
      pieces: Math.ceil(pack.length / MIB),
      every: 50,
      stopAfter: OVERVIEW_LIMIT / MIB + 20,
    }),
  );
  const cache = await cacheFor(server.url, { git: await plainGit(), limits: SHORT_STALL });
  const repo = await cache.open('owner', 'repo');

  const error = await failure(repo.downloadOverview(1, overviewOf(head, blobs)));

  expect(error.detail).toMatchObject({
    kind: 'fetch',
    what: "pull request #1's overview",
    failure: 'tooLarge',
  });
  expect(error.message).toBe(
    "can't fetch pull request #1's overview: it's more than 50 MB, so Lo stopped downloading it",
  );
  expect(await noProcessSoon(`127.0.0.1:${server.port}`)).toEqual([]);
});

test('an overview of more than 50 MB that comes smaller is refused once it has come', async () => {
  const github = join(tempFolder(), 'github.git');
  const { first: main, last: head } = history(github, 1);
  // Zeros, which compress to almost nothing: what comes in is far under the cap.
  const { blobs, pack } = packOf(github, [Buffer.alloc(OVERVIEW_LIMIT + 1)]);
  const server = await started(
    FakeGitHub.start(main, head, { kind: 'pack', pack, pieces: 1, every: 0 }),
  );
  const repo = await (await cacheFor(server.url, { git: await plainGit() })).open('owner', 'repo');

  const error = await failure(repo.downloadOverview(1, overviewOf(head, blobs)));

  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'tooLarge' });
  expect(error.message).toBe(
    "can't fetch pull request #1's overview: it's more than 50 MB, so Lo stopped downloading it",
  );
});
