// The language servers that run, and for how long: one per repository and language, moving with
// the head on screen; stopped 10 minutes off screen and once their repository's last tab closes;
// held to 4 servers and 8 GB in all, never stopping one on screen for another; started again by
// themselves after a crash only once, after a minute's run; and each holding its repository in the
// cache from before it starts until it has stopped. Lifetimes run on stand-in servers under
// fake timers; the fake language server runs one for real.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  csharpWorkspace,
  DOTNET_HEAP,
  NO_NETWORK,
  type Server,
  serverEnvironment,
  type ServerSpec,
  startServer,
  toolchainUse,
} from '@lo/lsp';
import { fakeServer } from '@lo/testing/lsp';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { cacheFolder } from '../../../main/git.ts';
import { ADAPTERS as SHIPPED, type Adapter, type Prepared } from './adapters.ts';
import {
  noRoom,
  ServerPool,
  serversFolder,
  type PoolLimits,
  type PoolOptions,
  type PoolView,
} from './servers.ts';
import { StandIn } from './test/server.ts';
import { checkoutRefusal, listedToolchain } from './toolchains.ts';

/**
 * Where tsserver looks for a plugin above an install in `folder`: a `node_modules` in it and in
 * each folder above it, as `@lo/lsp`'s `test/plugins.test.ts` shows.
 */
function pluginFolders(folder: string): string[] {
  const found: string[] = [];
  for (let at = folder; ; at = dirname(at)) {
    found.push(join(at, 'node_modules'));
    if (at === dirname(at)) return found;
  }
}

/** The Mac's folder for this user's caches, as `getconf` names it. */
const macFolder = () => '/private/var/folders/ab/cd/C';

describe('serversFolder', () => {
  it('is outside the home folder on a Mac, so no plugin loads from a node_modules in it', () => {
    const home = '/Users/me';
    for (const packaged of [true, false]) {
      const root = cacheFolder({ packaged, platform: 'darwin', home, env: {}, macFolder });
      const folders = pluginFolders(join(serversFolder(root), 'vtsls', '0.3.0', 'files'));
      expect(folders).not.toContain(join(home, 'node_modules'));
      expect(folders.filter((each) => each.startsWith(`${home}/`))).toEqual([]);
    }
  });

  it('is in ~/.cache on Linux, so ~/node_modules is still one of them', () => {
    const root = cacheFolder({ packaged: true, platform: 'linux', home: '/home/me', env: {} });
    expect(pluginFolders(serversFolder(root))).toContain('/home/me/node_modules');
  });
});

function adapter(id: string, prepare?: Adapter['prepare']): Adapter {
  return {
    id,
    name: id === 'ts' ? 'TypeScript' : id,
    languages: { typescript: id },
    prepare:
      prepare ??
      (() => Promise.resolve({ kind: 'ready', launch: { program: '/bin/x', args: [] } })),
  };
}

const TS = adapter('ts');
const GO = adapter('go');

function view(
  id: string,
  repo: string,
  pull: number,
  wants: readonly Adapter[] = [TS],
  trust: PoolView['trust'] = 'trusted',
): PoolView {
  const root = { folder: `/cache/${repo}/pull-${pull}`, pull };
  return { id, repo, pull, trust, root: trust === 'trusted' ? root : undefined, wants };
}

/**
 * A pool of stand-ins, and each one it started, with `checkout` to look at each checkout and `hold`
 * to hold each repository in the cache.
 */
function standIns(
  limits: Partial<PoolLimits> = {},
  checkout?: PoolOptions['checkout'],
  hold?: PoolOptions['hold'],
) {
  const started: StandIn[] = [];
  const pool = new ServerPool({
    checkout,
    hold,
    prepare: (each, progress, signal) =>
      each.prepare({
        install: () => Promise.reject(new Error('no downloads in tests')),
        toolchain: () => Promise.reject(new Error('no downloads in tests')),
        findCopy: () => Promise.resolve(undefined),
        developerFolder: () => Promise.resolve(undefined),
        signal,
      }),
    start(spec) {
      const server = new StandIn(spec);
      started.push(server);
      return server;
    },
    // The folder of Lo's git.
    base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: ['/lo/git/bin'] }),
    changed: () => undefined,
    log: () => undefined,
    limits,
  });
  onTestFinished(() => pool.stop());
  const live = () => started.filter((server) => !server.stopped);
  /** Those whose process is still there, stopping or not. */
  const alive = () => started.filter((server) => !server.exited);
  return { pool, started, live, alive };
}

/** Has `server` exit by itself, with code 1, after running for `uptime` ms. */
function crash(server: StandIn | undefined, uptime: number): void {
  if (!server) return;
  server.uptime = uptime;
  server.set({ kind: 'failed', failure: { kind: 'exited', code: 1, signal: null } });
}

/** Lets what's waiting on promises settle, under fake timers. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('which servers run', () => {
  it('runs one per repository and language, moving it with the head on screen', async () => {
    const { pool, started, live } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2), view('v3', 'b/y', 3, [TS, GO])];
    pool.sync(views, 'v1');
    await settle();
    expect(started.map((server) => server.spec.root)).toEqual(['/cache/a/x/pull-1']);
    started[0]?.set({ kind: 'ready' });
    expect(pool.find('a/x', 'ts', '/cache/a/x/pull-1')).toMatchObject({ kind: 'ready' });

    // Another head of the repository on screen: the same server moves there.
    pool.sync(views, 'v2');
    await settle();
    expect(started).toHaveLength(1);
    expect(started[0]?.moved).toEqual(['/cache/a/x/pull-2']);
    expect(pool.find('a/x', 'ts', '/cache/a/x/pull-1')).toBeUndefined();
    expect(pool.find('a/x', 'ts', '/cache/a/x/pull-2')).toMatchObject({ kind: 'ready' });

    // One that can't move starts again there.
    if (started[0]) started[0].moves = false;
    pool.sync(views, 'v1');
    await settle();
    expect(started).toHaveLength(2);
    expect(started[0]?.stopped).toBe(true);
    expect(started[1]?.spec.root).toBe('/cache/a/x/pull-1');

    // Another repository has its own, one for each language.
    pool.sync(views, 'v3');
    await settle();
    expect(live().map((server) => `${server.spec.name} ${server.spec.root}`)).toEqual([
      'TypeScript /cache/a/x/pull-1',
      'TypeScript /cache/b/y/pull-3',
      'go /cache/b/y/pull-3',
    ]);
  });

  it('starts nothing for a view off screen, or one held while it’s checked again', async () => {
    const { pool, started } = standIns();
    pool.sync([view('v1', 'a/x', 1), view('v2', 'b/y', 2, [TS], 'held')], 'v2');
    await settle();
    expect(started).toHaveLength(0);
  });

  it('says how far a download has got, and why one couldn’t start', async () => {
    let finish: ((prepared: Prepared) => void) | undefined;
    const slow = adapter('ts', (context) => {
      void context.install('x').catch(() => undefined);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const failing = adapter('go', () => Promise.reject(new Error('The download failed.')));
    const missing = adapter('java', () =>
      Promise.resolve({ kind: 'missing', needs: 'a JDK', install: 'brew install openjdk' }),
    );
    const progress: ((done: number, total: number) => void)[] = [];
    const pool = new ServerPool({
      prepare(each, report, signal) {
        progress.push(report);
        return each.prepare({
          install: () => Promise.reject(new Error('no downloads in tests')),
          toolchain: () => Promise.reject(new Error('no downloads in tests')),
          findCopy: () => Promise.resolve(undefined),
          developerFolder: () => Promise.resolve(undefined),
          signal,
        });
      },
      start: (spec) => new StandIn(spec),
      base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: [] }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(() => pool.stop());
    pool.sync([view('v1', 'a/x', 1, [slow, failing, missing])], 'v1');
    await settle();
    expect(pool.shown('a/x', 'ts')?.state).toEqual({ kind: 'starting' });
    progress[0]?.(12, 40);
    expect(pool.shown('a/x', 'ts')?.state).toEqual({ kind: 'downloading', done: 12, total: 40 });
    finish?.({ kind: 'ready', launch: { program: '/bin/x', args: [], version: 'x 1.0' } });
    await settle();
    expect(pool.shown('a/x', 'ts')).toEqual({ state: { kind: 'starting' }, version: 'x 1.0' });
    expect(pool.shown('a/x', 'go')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'download', message: 'The download failed.' },
    });
    expect(pool.shown('a/x', 'java')?.state).toEqual({
      kind: 'missing',
      needs: 'a JDK',
      install: 'brew install openjdk',
    });
  });
});

describe('how long they run', () => {
  it('stops one 10 minutes after its repository was last on screen', async () => {
    vi.useFakeTimers();
    const { pool, started } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'b/y', 2)];
    pool.sync(views, 'v1');
    await settle();
    pool.sync(views, 'v2');
    await settle();
    // Back on screen before the time is up: it starts counting again once it's off screen again.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    pool.sync(views, 'v1');
    pool.sync(views, 'v2');
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(started[0]?.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(started[0]?.stopped).toBe(true);
    // The one on screen runs on.
    expect(started[1]?.stopped).toBe(false);
  });

  it('stops one 10 minutes after its own pull request was last on screen, while another of the repo is', async () => {
    vi.useFakeTimers();
    const { pool, alive } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2, [])];
    pool.sync(views, 'v1');
    await settle();
    // #1's tab closes, and #2, which needs no server, is on screen: it runs on, for a while.
    pool.sync(views.slice(1), 'v2');
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(alive()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(alive()).toEqual([]);
  });

  it('stops one 10 minutes after its pull request was on screen, though its move to another never ends', async () => {
    vi.useFakeTimers();
    const { pool, started } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2), view('v3', 'a/x', 3, [])];
    pool.sync(views, 'v1');
    await settle();
    const first = started[0];
    if (!first) throw new Error('nothing started');
    first.set({ kind: 'ready' });
    // #2 on screen: it moves there, and the folder is never resolved. Then #3, which needs none.
    first.slowMoves = true;
    pool.sync(views, 'v2');
    await settle();
    pool.sync(views, 'v3');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(first.stopped).toBe(true);
  });

  it('stops one at once when its repository’s last tab closes', async () => {
    vi.useFakeTimers();
    const { pool, started } = standIns();
    pool.sync([view('v1', 'a/x', 1), view('v2', 'a/x', 2), view('v3', 'b/y', 3)], 'v1');
    await settle();
    // Another tab of the repository is still open.
    pool.sync([view('v2', 'a/x', 2), view('v3', 'b/y', 3)], 'v3');
    await settle();
    expect(started[0]?.stopped).toBe(false);
    pool.sync([view('v3', 'b/y', 3)], 'v3');
    await settle();
    expect(started[0]?.stopped).toBe(true);
    expect(pool.shown('a/x', 'ts')).toBeUndefined();
  });

  it('keeps what runs while a view is checked again, as after a push', async () => {
    vi.useFakeTimers();
    const { pool, started } = standIns();
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    pool.sync([view('v1', 'a/x', 1, [TS], 'held')], 'v1');
    await settle();
    expect(started[0]?.stopped).toBe(false);
  });

  it('stops the servers of what trust went from, by pull request', async () => {
    const { pool, started } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'b/y', 2)];
    pool.sync(views, 'v1');
    await settle();
    pool.sync(views, 'v2');
    await settle();
    await pool.stopWhere('a/x', (pull) => pull === 2);
    expect(started[0]?.stopped).toBe(false);
    await pool.stopWhere('a/x', (pull) => pull === 1);
    expect(started[0]?.stopped).toBe(true);
    expect(started[1]?.stopped).toBe(false);
  });

  it('starts one that crashed after a minute again by itself, once, and any other on Restart', async () => {
    const { pool, started, live } = standIns();
    const root = { folder: '/cache/a/x/pull-1', pull: 1 };
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    crash(started[0], 61_000);
    await settle();
    expect(started).toHaveLength(2);
    expect(started[1]?.spec.root).toBe(root.folder);
    // Again: it waits for Restart.
    crash(started[1], 61_000);
    await settle();
    expect(started).toHaveLength(2);
    expect(pool.shown('a/x', 'ts')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: 'It quit with exit code 1.' },
    });
    expect(pool.find('a/x', 'ts', root.folder)).toEqual({ kind: 'failed' });

    await pool.restart('a/x', TS, root);
    await settle();
    expect(started).toHaveLength(3);
    // Restarted, it may start again by itself once more; but not after a crash within a minute.
    crash(started[2], 30_000);
    await settle();
    expect(started).toHaveLength(3);
    expect(live()).toHaveLength(1);
  });

  it('never starts one again by itself after Lo stopped it for its memory', async () => {
    const { pool, started } = standIns();
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    if (started[0]) started[0].uptime = 120_000;
    started[0]?.set({ kind: 'failed', failure: { kind: 'memory', cap: 4 * 1024 ** 3 } });
    await settle();
    expect(started).toHaveLength(1);
    expect(pool.shown('a/x', 'ts')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'memory', cap: 4 * 1024 ** 3 },
    });
  });
});

describe('trust, then and there', () => {
  it('starts nothing on Restart once trust went while the server before it stopped', async () => {
    const { pool, started, alive } = standIns();
    const root = { folder: '/cache/a/x/pull-1', pull: 1 };
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    const first = started[0];
    if (first) first.slow = true;
    // Its tab closes, and it stops, slowly; the tab comes back, and Restart waits for that stop.
    pool.sync([], 'v1');
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    const restarting = pool.restart('a/x', TS, root);
    await settle();
    // Trust goes meanwhile.
    pool.sync([], 'v1');
    first?.exit();
    await restarting;
    await settle();
    expect(started).toHaveLength(1);
    expect(alive()).toEqual([]);
  });

  it('tells a server nothing of a move once trust went while it resolved the folder', async () => {
    const { pool, started } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2)];
    pool.sync(views, 'v1');
    await settle();
    const first = started[0];
    if (!first) throw new Error('nothing started');
    first.set({ kind: 'ready' });
    first.slowMoves = true;
    pool.sync(views, 'v2');
    await settle();
    // #2 isn't trusted any longer by the time the folder is resolved.
    pool.sync(views.slice(0, 1), 'v2');
    first.resolved();
    await settle();
    expect(first.moved).toEqual([]);
    expect(started).toHaveLength(1);
  });

  it('waits, when trust goes from a pull request, for a server still stopping on its checkout', async () => {
    const { pool, started } = standIns();
    const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2)];
    pool.sync(views, 'v1');
    await settle();
    const first = started[0];
    if (!first) throw new Error('nothing started');
    first.set({ kind: 'ready' });
    first.slow = true;
    // It can't move to #2, so it stops there to start again.
    first.moves = false;
    pool.sync(views, 'v2');
    await settle();
    expect(first.stopped).toBe(true);
    let stopped = false;
    void pool
      .stopWhere('a/x', (pull) => pull === 1)
      .then(() => {
        stopped = true;
      });
    await settle();
    expect(stopped).toBe(false);
    first.exit();
    await settle();
    expect(stopped).toBe(true);
  });

  it.each(['a move', 'Restart', 'a crash'])(
    'waits, as Lo quits, for the server stopped for %s',
    async (what) => {
      const { pool, started, alive } = standIns();
      const views = [view('v1', 'a/x', 1), view('v2', 'a/x', 2)];
      pool.sync(views, 'v1');
      await settle();
      const first = started[0];
      if (!first) throw new Error('nothing started');
      first.slow = true;
      first.set({ kind: 'ready' });
      if (what === 'a move') {
        first.moves = false;
        pool.sync(views, 'v2');
      } else if (what === 'Restart') {
        void pool.restart('a/x', TS, { folder: '/cache/a/x/pull-1', pull: 1 });
      } else {
        crash(first, 61_000);
      }
      await settle();
      expect(first.stopped).toBe(true);
      let quit = false;
      void pool.stop().then(() => {
        quit = true;
      });
      await settle();
      expect(quit).toBe(false);
      first.exit();
      await settle();
      expect(quit).toBe(true);
      expect(alive()).toEqual([]);
    },
  );

  it('puts a server’s toolchain first on its PATH, then Lo’s git', async () => {
    const { pool, started } = standIns();
    const tools = adapter('ts', () =>
      Promise.resolve({
        kind: 'ready',
        launch: { program: '/bin/x', args: [], path: ['/toolchain/bin'] },
      }),
    );
    pool.sync([view('v1', 'a/x', 1, [tools])], 'v1');
    await settle();
    // Homebrew's git, say, whose folder also holds Homebrew's `go`, comes after Lo's `go`.
    expect(started[0]?.spec.path).toEqual(['/toolchain/bin', '/lo/git/bin']);
  });
});

describe('the cache', () => {
  it('holds a server’s repository from before it starts until it has stopped', async () => {
    const said: string[] = [];
    const { pool, started } = standIns({}, undefined, (repo, each) => {
      said.push(`held ${repo} for ${each.id} with ${started.length} started`);
      return Promise.resolve(() => said.push(`let go of ${repo} for ${each.id}`));
    });
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    const first = started[0];
    if (!first) throw new Error('nothing started');
    expect(said).toEqual(['held a/x for ts with 0 started']);
    first.set({ kind: 'ready' });
    first.slow = true;

    // Its repository's last tab closes: it's held while the server stops, and let go once it has.
    pool.sync([], undefined);
    await settle();
    expect([first.stopped, said.length]).toEqual([true, 1]);
    first.exit();
    await settle();
    expect(said).toEqual(['held a/x for ts with 0 started', 'let go of a/x for ts']);
  });

  it.each(['a crash', 'Restart', 'a halt'])(
    'lets go of the hold of a server stopped for %s once it has stopped',
    async (what) => {
      const said: string[] = [];
      let holds = 0;
      const { pool, started } = standIns({}, undefined, () => {
        holds += 1;
        const hold = holds;
        said.push(`held ${hold}`);
        return Promise.resolve(() => said.push(`let go of ${hold}`));
      });
      pool.sync([view('v1', 'a/x', 1)], 'v1');
      await settle();
      const first = started[0];
      if (!first) throw new Error('nothing started');
      first.set({ kind: 'ready' });
      first.slow = true;
      if (what === 'a crash') crash(first, 61_000);
      else if (what === 'Restart') {
        void pool.restart('a/x', TS, { folder: '/cache/a/x/pull-1', pull: 1 });
      } else void pool.halt(() => true, 'Go was removed. Restart downloads it again.');
      await settle();
      expect([first.stopped, said]).toEqual([true, ['held 1']]);

      // Once it has stopped, its hold goes, and the one started in its place holds anew.
      first.exit();
      await settle();
      expect(said).toEqual(
        what === 'a halt' ? ['held 1', 'let go of 1'] : ['held 1', 'let go of 1', 'held 2'],
      );
      expect(started).toHaveLength(what === 'a halt' ? 1 : 2);
    },
  );

  it('starts nothing until the hold comes, and lets go of one whose server never starts', async () => {
    const waiting: (() => void)[] = [];
    const said: string[] = [];
    const { pool, started } = standIns(
      {},
      undefined,
      (repo) =>
        new Promise((resolve) => {
          waiting.push(() => resolve(() => said.push(`let go of ${repo}`)));
        }),
    );
    // Cleanup is removing something of the repository: nothing starts until it's done.
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    expect(started).toHaveLength(0);
    waiting.shift()?.();
    await settle();
    expect(started).toHaveLength(1);

    // Another repository's tab closes while its hold waits: its server never starts, and it lets go.
    pool.sync([view('v1', 'a/x', 1), view('v2', 'b/y', 2)], 'v2');
    await settle();
    pool.sync([view('v1', 'a/x', 1)], 'v1');
    await settle();
    waiting.shift()?.();
    await settle();
    expect([started.length, said]).toEqual([1, ['let go of b/y']]);
  });
});

describe('halting', () => {
  it('stops the servers that use a toolchain, each saying why until “Restart” starts it again', async () => {
    const { pool, started, live } = standIns();
    const views = [view('v1', 'a/x', 1, [TS, GO])];
    pool.sync(views, 'v1');
    await settle();
    for (const server of started) server.set({ kind: 'ready' });
    expect(live()).toHaveLength(2);

    await pool.halt((each) => each.id === 'go', 'Go was removed. Restart downloads it again.');
    expect(live().map((server) => server.spec.name)).toEqual(['TypeScript']);
    expect(pool.shown('a/x', 'go')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: 'Go was removed. Restart downloads it again.' },
    });
    expect(pool.find('a/x', 'go', '/cache/a/x/pull-1')).toEqual({ kind: 'failed' });
    // Nothing starts it again by itself, even as the view on screen changes.
    pool.sync(views, 'v1');
    await settle();
    expect(started).toHaveLength(2);

    await pool.restart('a/x', GO, { folder: '/cache/a/x/pull-1', pull: 1 });
    await settle();
    expect(started).toHaveLength(3);
    expect(live().map((server) => server.spec.name)).toEqual(['TypeScript', 'go']);
  });

  it('stops one getting ready, dropping what its download finds out late', async () => {
    const { promise, resolve } = Promise.withResolvers<Prepared>();
    let aborted = false;
    const slow = adapter('go', ({ signal }) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return promise;
    });
    const { pool, started } = standIns();
    pool.sync([view('v1', 'a/x', 1, [slow])], 'v1');
    await settle();
    await pool.halt(() => true, 'Go was removed. Restart downloads it again.');
    expect(aborted).toBe(true);
    resolve({ kind: 'ready', launch: { program: '/bin/x', args: [] } });
    await settle();
    expect(started).toEqual([]);
    expect(pool.shown('a/x', 'go')?.state.kind).toBe('failed');
  });
});

describe('Lo’s own servers', () => {
  it('that use no toolchain get git’s folder, then the system’s, on their PATH, and no variable of their own', async () => {
    const specs: ServerSpec[] = [];
    const pool = new ServerPool({
      prepare: (each, progress, signal) =>
        each.prepare({
          install: (id) =>
            Promise.resolve({ folder: `/lo/servers/${id}`, entry: `/lo/servers/${id}/entry` }),
          toolchain: listedToolchain(each, () => Promise.reject(new Error('no toolchain here'))),
          findCopy: () => Promise.resolve(undefined),
          developerFolder: () => Promise.resolve(undefined),
          signal,
        }),
      start(spec) {
        specs.push(spec);
        return new StandIn(spec);
      },
      base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: ['/lo/git/bin'] }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(() => pool.stop());
    const own = SHIPPED.filter((each) => each.downloads?.toolchains?.length === 0);
    pool.sync([view('v1', 'a/x', 1, own)], 'v1');
    await settle();
    expect(specs.map((spec) => spec.name).toSorted()).toEqual([
      'PHP',
      'Python',
      'Terraform',
      'TypeScript',
    ]);
    for (const spec of specs) {
      expect(serverEnvironment({ ...spec, roots: [spec.root] })).toEqual({
        GIT_CONFIG_COUNT: '0',
        HOME: '/home/lo',
        TMPDIR: '/home/lo/tmp',
        PATH: '/lo/git/bin:/usr/bin:/bin',
        HTTPS_PROXY: NO_NETWORK,
        https_proxy: NO_NETWORK,
        HTTP_PROXY: NO_NETWORK,
        http_proxy: NO_NETWORK,
        ALL_PROXY: NO_NETWORK,
        all_proxy: NO_NETWORK,
        LANG: 'C.UTF-8',
      });
      expect(spec.workspace).toBeUndefined();
    }
  });

  it('give C#’s Lo’s .NET first on its PATH, the SDK’s variables, a heap cap and its own project', async () => {
    /** Lo's .NET SDK, as a server gets it. */
    const DOTNET = { folder: '/lo/toolchains/dotnet', entry: '/lo/toolchains/dotnet/dotnet' };
    const specs: ServerSpec[] = [];
    const csharp = SHIPPED.filter((each) => each.id === 'csharp');
    const pool = new ServerPool({
      prepare: (each, progress, signal) =>
        each.prepare({
          install: (id) =>
            Promise.resolve({ folder: `/lo/servers/${id}`, entry: `/lo/servers/${id}/entry` }),
          toolchain: listedToolchain(each, (id) =>
            Promise.resolve({
              version: '10.0.404',
              installed: DOTNET,
              ...toolchainUse(id, '10.0.404', DOTNET, 'darwin'),
            }),
          ),
          findCopy: () => Promise.resolve(undefined),
          developerFolder: () => Promise.resolve(undefined),
          signal,
        }),
      start(spec) {
        specs.push(spec);
        return new StandIn(spec);
      },
      base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: ['/lo/git/bin'] }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(() => pool.stop());
    pool.sync([view('v1', 'a/x', 1, csharp)], 'v1');
    await settle();
    const [spec] = specs;
    expect([spec?.program, spec?.args.slice(0, 2)]).toEqual([
      DOTNET.entry,
      ['exec', '/lo/servers/roslyn/entry'],
    ]);
    if (spec === undefined) return;
    expect(serverEnvironment({ ...spec, roots: [spec.root] })).toEqual({
      ...toolchainUse('dotnet', '10.0.404', DOTNET, 'darwin').variables,
      DOTNET_GCHeapHardLimit: DOTNET_HEAP,
      GIT_CONFIG_COUNT: '0',
      HOME: '/home/lo',
      TMPDIR: '/home/lo/tmp',
      PATH: '/lo/toolchains/dotnet:/lo/git/bin:/usr/bin:/bin',
      HTTPS_PROXY: NO_NETWORK,
      https_proxy: NO_NETWORK,
      HTTP_PROXY: NO_NETWORK,
      http_proxy: NO_NETWORK,
      ALL_PROXY: NO_NETWORK,
      all_proxy: NO_NETWORK,
      LANG: 'C.UTF-8',
    });
    // It's told of the project Lo writes in its home, never the checkout.
    expect(spec.workspace).toBe(csharpWorkspace);
  });
});

describe('checkouts a server won’t run on', () => {
  /** C#'s, which uses .NET. */
  const CSHARP: Adapter = { ...adapter('csharp'), downloads: { toolchains: ['dotnet'] } };
  const WHY = 'The checkout’s global.json names folders to look for an SDK in.';
  /** Refuses C#'s server on pull request 2's checkout. */
  const refusing: PoolOptions['checkout'] = (each, folder) =>
    Promise.resolve(each === CSHARP && folder === '/cache/a/x/pull-2' ? WHY : undefined);

  it('starts none on a checkout its toolchain refuses, and says why', async () => {
    const { pool, started } = standIns({}, refusing);
    pool.sync([view('v2', 'a/x', 2, [TS, CSHARP])], 'v2');
    await settle();
    expect(started.map((server) => server.spec.name)).toEqual(['TypeScript']);
    expect(pool.shown('a/x', 'csharp')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: WHY },
    });
  });

  it('moves none to such a checkout: it stops there, and says why', async () => {
    const { pool, started, live } = standIns({}, refusing);
    const views = [view('v1', 'a/x', 1, [CSHARP]), view('v2', 'a/x', 2, [CSHARP])];
    pool.sync(views, 'v1');
    await settle();
    started[0]?.set({ kind: 'ready' });
    pool.sync(views, 'v2');
    await settle();
    expect(started[0]?.moved).toEqual([]);
    expect(live()).toEqual([]);
    expect(pool.shown('a/x', 'csharp')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: WHY },
    });
  });

  it('never runs the SDK a checkout’s global.json plants for dotnet to find', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-planted-')));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const root = join(folder, 'pull-1');
    const planted = join(root, 'evil', 'sdk', '10.0.404');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'dotnet.dll'), 'an SDK of the checkout’s');
    writeFileSync(join(root, 'global.json'), '{ "sdk": { "paths": ["evil"] } }');
    const marker = join(folder, 'lo-hostile-dotnet');
    const pool = new ServerPool({
      prepare: (each, progress, signal) =>
        each.prepare({
          install: () => Promise.reject(new Error('no downloads in tests')),
          toolchain: () => Promise.reject(new Error('no downloads in tests')),
          findCopy: () => Promise.resolve(undefined),
          developerFolder: () => Promise.resolve(undefined),
          signal,
        }),
      checkout: checkoutRefusal,
      // Standing in for `dotnet` run in the checkout, which would find the planted SDK and run it.
      start(spec) {
        if (existsSync(join(spec.root, 'evil', 'sdk')))
          writeFileSync(marker, 'the planted SDK ran');
        return new StandIn(spec);
      },
      base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: [] }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(() => pool.stop());
    pool.sync(
      [
        {
          id: 'v1',
          repo: 'a/x',
          pull: 1,
          trust: 'trusted',
          root: { folder: root, pull: 1 },
          wants: [CSHARP],
        },
      ],
      'v1',
    );
    await vi.waitFor(() => expect(pool.shown('a/x', 'csharp')?.state.kind).toBe('failed'));
    expect(existsSync(marker)).toBe(false);
    expect(pool.shown('a/x', 'csharp')?.state).toEqual({
      kind: 'failed',
      why: {
        kind: 'error',
        message:
          'The checkout’s global.json names folders to look for an SDK in, so it could choose a .NET SDK other than Lo’s.',
      },
    });
  });

  it('starts none below a file MSBuild would import into every project under it', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-above-')));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const root = join(folder, 'pull-1');
    mkdirSync(root);
    writeFileSync(join(folder, 'Directory.Build.props'), '<Project />');
    const started: string[] = [];
    const pool = new ServerPool({
      prepare: () => Promise.resolve({ kind: 'ready', launch: { program: '/bin/x', args: [] } }),
      checkout: checkoutRefusal,
      start(spec) {
        started.push(spec.name);
        return new StandIn(spec);
      },
      base: () => ({ home: '/home/lo', git: { GIT_CONFIG_COUNT: '0' }, path: [] }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(() => pool.stop());
    const view1: PoolView = {
      id: 'v1',
      repo: 'a/x',
      pull: 1,
      trust: 'trusted',
      root: { folder: root, pull: 1 },
      wants: [CSHARP],
    };
    pool.sync([view1], 'v1');
    await vi.waitFor(() => expect(pool.shown('a/x', 'csharp')?.state.kind).toBe('failed'));
    expect(started).toEqual([]);
    expect(pool.shown('a/x', 'csharp')?.state).toEqual({
      kind: 'failed',
      why: {
        kind: 'error',
        message: `${join(folder, 'Directory.Build.props')} is in a folder above the checkout, and MSBuild would read it for every project below it.`,
      },
    });
  });
});

describe('budgets', () => {
  it('runs 4 at most, stopping the one used longest ago off screen first', async () => {
    vi.useFakeTimers();
    const { pool, started, live } = standIns();
    const views = [1, 2, 3, 4, 5].map((n) => view(`v${n}`, `r/${n}`, n));
    for (const each of views) {
      pool.sync(views, each.id);
      await settle();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(started).toHaveLength(5);
    expect(started[0]?.stopped).toBe(true);
    expect(live()).toHaveLength(4);
  });

  it('starts one past 4 only once the one stopped for its room has', async () => {
    vi.useFakeTimers();
    const { pool, started, alive } = standIns();
    const views = [1, 2, 3, 4, 5].map((n) => view(`v${n}`, `r/${n}`, n));
    for (const each of views.slice(0, 4)) {
      pool.sync(views, each.id);
      await settle();
      await vi.advanceTimersByTimeAsync(1000);
    }
    const first = started[0];
    if (first) first.slow = true;
    pool.sync(views, 'v5');
    await settle();
    expect(first?.stopped).toBe(true);
    expect(started).toHaveLength(4);
    first?.exit();
    await settle();
    expect(started).toHaveLength(5);
    expect(alive()).toHaveLength(4);
  });

  it('never stops one on screen for another: past 4 on screen, the next waits for room', async () => {
    const { pool, live } = standIns();
    const adapters = ['a', 'b', 'c', 'd', 'e'].map((id) => adapter(id));
    pool.sync([view('v1', 'r/1', 1, adapters)], 'v1');
    await settle();
    expect(live()).toHaveLength(4);
    expect(pool.shown('r/1', 'e')?.state).toEqual({
      kind: 'failed',
      why: { kind: 'error', message: noRoom(4) },
    });
  });

  it('holds them to 8 GB in all, stopping those off screen used longest ago first', async () => {
    vi.useFakeTimers();
    const { pool, started } = standIns();
    const views = [1, 2, 3].map((n) => view(`v${n}`, `r/${n}`, n));
    for (const each of views) {
      pool.sync(views, each.id);
      await settle();
      await vi.advanceTimersByTimeAsync(1000);
    }
    for (const server of started) server.memory = 3.5 * 1024 ** 3;
    await vi.advanceTimersByTimeAsync(5000);
    expect(started.map((server) => server.stopped)).toEqual([true, false, false]);
    // Only the one on screen is left past the cap: it runs on.
    if (started[1]) started[1].memory = 0;
    if (started[2]) started[2].memory = 9 * 1024 ** 3;
    pool.sync(views.slice(1), 'v3');
    await vi.advanceTimersByTimeAsync(5000);
    expect(started[2]?.stopped).toBe(false);
  });
});

describe('a real server', () => {
  it('starts the fake server on its checkout, answers, and stops it with its group when trust goes', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-servers-')));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const checkout = join(folder, 'checkout');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    const fake = fakeServer(folder, {
      answers: { 'textDocument/hover': { '*': { contents: 'a' } } },
    });
    const real: Server[] = [];
    const pool = new ServerPool({
      prepare: () =>
        Promise.resolve({ kind: 'ready', launch: { program: fake.program, args: fake.args } }),
      start(spec) {
        const server = startServer(spec);
        real.push(server);
        return server;
      },
      base: () => ({
        home: join(folder, 'home'),
        git: {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'safe.bareRepository',
          GIT_CONFIG_VALUE_0: 'explicit',
        },
        path: [],
      }),
      changed: () => undefined,
      log: () => undefined,
    });
    onTestFinished(async () => {
      for (const server of real) {
        try {
          if (server.pid !== undefined) process.kill(-server.pid, 'SIGKILL');
        } catch {
          // It's gone.
        }
      }
      await pool.stop();
    });
    pool.sync(
      [
        {
          id: 'v1',
          repo: 'a/x',
          pull: 1,
          trust: 'trusted',
          root: { folder: checkout, pull: 1 },
          wants: [TS],
        },
      ],
      'v1',
    );
    await vi.waitFor(() => expect(pool.shown('a/x', 'ts')?.state).toEqual({ kind: 'ready' }), {
      timeout: 10_000,
    });
    const found = pool.find('a/x', 'ts', checkout);
    if (found?.kind !== 'ready') throw new Error('not ready');
    expect(found.server.open('src/a.ts', 'typescript', 'const a = 1;')).toBe(true);
    expect(
      await found.server.request(
        'textDocument/hover',
        { path: 'src/a.ts', position: { line: 0, character: 6 } },
        { deadline: 5000 },
      ),
    ).toEqual({ ok: true, value: { contents: 'a' } });
    const pid = real[0]?.pid;
    // Trust goes: the view is no longer one servers run for, and its servers stop.
    pool.sync([], 'v1');
    await pool.stopWhere('a/x', () => true);
    expect(pool.shown('a/x', 'ts')).toBeUndefined();
    expect(() => process.kill(-(pid ?? 0), 0)).toThrow('ESRCH');
  });
});
