// The language servers that run, and for how long: one per repository and language, moving with
// the head on screen; stopped 10 minutes off screen and once their repository's last tab closes;
// held to 4 servers and 8 GB in all, never stopping one on screen for another; and started again
// by themselves after a crash only once, after a minute's run. Lifetimes run on stand-in servers
// under fake timers; the fake language server runs one for real.

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Server, startServer } from '@lo/lsp';
import { fakeServer } from '@lo/testing/lsp';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { Adapter, Prepared } from './adapters.ts';
import { noRoom, ServerPool, type PoolLimits, type PoolView } from './servers.ts';
import { StandIn } from './test/server.ts';

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

/** A pool of stand-ins, and each one it started. */
function standIns(limits: Partial<PoolLimits> = {}) {
  const started: StandIn[] = [];
  const pool = new ServerPool({
    prepare: (each, progress, signal) =>
      each.prepare({
        install: () => Promise.reject(new Error('no downloads in tests')),
        findCopy: () => Promise.resolve(undefined),
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
          findCopy: () => Promise.resolve(undefined),
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

  it('puts Lo’s git first on a server’s PATH, before its toolchain’s folders', async () => {
    const { pool, started } = standIns();
    const tools = adapter('ts', () =>
      Promise.resolve({
        kind: 'ready',
        launch: { program: '/bin/x', args: [], path: ['/toolchain/bin'] },
      }),
    );
    pool.sync([view('v1', 'a/x', 1, [tools])], 'v1');
    await settle();
    expect(started[0]?.spec.path).toEqual(['/lo/git/bin', '/toolchain/bin']);
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

/** A license of the kind Intelephense's is, for an adapter that asks the reader to accept it. */
const LICENSE = {
  server: 'intelephense',
  serverName: 'Intelephense',
  name: 'the Intelephense Licence',
  url: 'https://intelephense.com/eula',
  major: 1,
};

/** PHP's adapter, as Lo's is: its server has a license, shows its messages and has no hints. */
function php(prepare?: Adapter['prepare']): Adapter {
  return {
    ...adapter('php', prepare),
    name: 'PHP',
    license: LICENSE,
    shows: true,
    hints: false,
  };
}

/** A pool of stand-ins whose licenses are accepted while `accepted()` says. */
function licensedPool(accepted: () => boolean) {
  const started: StandIn[] = [];
  const prepared: string[] = [];
  const changed: string[] = [];
  const pool = new ServerPool({
    prepare(each, _progress, signal) {
      prepared.push(each.id);
      return each.prepare({
        install: () => Promise.reject(new Error('no downloads in tests')),
        findCopy: () => Promise.resolve(undefined),
        signal,
      });
    },
    start(spec) {
      const server = new StandIn(spec);
      started.push(server);
      return server;
    },
    base: () => ({ home: '/home/lo', git: {}, path: [] }),
    changed: (repo) => changed.push(repo),
    accepted: (each) => each.license === undefined || accepted(),
    log: () => undefined,
  });
  onTestFinished(() => pool.stop());
  return { pool, started, prepared, changed };
}

describe('a server with a license of its own', () => {
  it('downloads and starts only once its license is accepted, and stops once it’s withdrawn', async () => {
    let yes = false;
    const { pool, started, prepared } = licensedPool(() => yes);
    const PHP = php(() =>
      Promise.resolve({
        kind: 'ready',
        launch: { program: '/bin/x', args: [], never: ['textDocument/inlayHint'] },
      }),
    );
    const views = [view('v1', 'a/x', 1, [PHP, TS])];
    pool.sync(views, 'v1');
    await settle();
    // Nothing of it is prepared, so nothing downloads; another language's server starts.
    expect(prepared).toEqual(['ts']);
    expect(pool.shown('a/x', 'php')).toBeUndefined();

    yes = true;
    pool.sync(views, 'v1');
    await settle();
    expect(prepared).toEqual(['ts', 'php']);
    const server = started.find((each) => each.spec.name === 'PHP');
    // What Lo never asks it goes with it, and its messages come to the pool.
    expect(server?.spec.never).toEqual(['textDocument/inlayHint']);
    expect(server?.spec.messages).toBeDefined();
    expect(started.find((each) => each.spec.name === 'TypeScript')?.spec.messages).toBeUndefined();

    yes = false;
    await pool.stopAdapter('php');
    expect(server?.stopped).toBe(true);
    expect(pool.shown('a/x', 'php')).toBeUndefined();
    // And it doesn't start again while its license isn't accepted.
    pool.sync(views, 'v1');
    await settle();
    expect(prepared).toEqual(['ts', 'php']);
  });

  it('never starts one whose license was withdrawn while it downloaded', async () => {
    let yes = true;
    let finish: ((prepared: Prepared) => void) | undefined;
    const PHP = php(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { pool, started } = licensedPool(() => yes);
    pool.sync([view('v1', 'a/x', 1, [PHP])], 'v1');
    await settle();
    yes = false;
    finish?.({ kind: 'ready', launch: { program: '/bin/x', args: [] } });
    await settle();
    expect(started).toHaveLength(0);
  });
});

/** PHP's server, running on `a/x`, and where its messages go. */
async function runningPhp() {
  const { pool, started, changed } = licensedPool(() => true);
  pool.sync([view('v1', 'a/x', 1, [php()])], 'v1');
  await settle();
  const messages = started[0]?.spec.messages;
  if (!messages) throw new Error('its messages go nowhere');
  return { pool, server: started[0], messages, changed };
}

describe('what a server says to the reader', () => {
  it('keeps each message as it was sent until the reader dismisses it', async () => {
    const { pool, messages, changed } = await runningPhp();
    const text = '  Licence required.\n\tSee https://intelephense.com  ';
    messages.show({ type: 'error', text });
    expect(pool.notices('a/x', 'php')).toEqual([{ id: 1, kind: 'message', type: 'error', text }]);
    expect(changed.at(-1)).toBe('a/x');
    expect(() => pool.act('a/x', 'php', 1, { action: 0 })).toThrow('asks nothing');
    expect(() => pool.act('a/x', 'php', 1, 'open')).toThrow('no page');
    pool.act('a/x', 'php', 1, 'dismiss');
    expect(pool.notices('a/x', 'php')).toEqual([]);
    expect(() => pool.act('a/x', 'php', 1, 'dismiss')).toThrow('gone');
  });

  it('answers a question with the action the reader chose, or none once they dismiss it', async () => {
    const { pool, messages } = await runningPhp();
    const signal = new AbortController().signal;
    const chosen = messages.ask({ type: 'warning', text: 'Index vendor?' }, ['Yes', 'No'], signal);
    const dismissed = messages.ask({ type: 'info', text: 'Carry on?' }, ['Go'], signal);
    expect(pool.notices('a/x', 'php')).toEqual([
      { id: 1, kind: 'question', type: 'warning', text: 'Index vendor?', actions: ['Yes', 'No'] },
      { id: 2, kind: 'question', type: 'info', text: 'Carry on?', actions: ['Go'] },
    ]);
    expect(() => pool.act('a/x', 'php', 1, { action: 2 })).toThrow('no such action');
    pool.act('a/x', 'php', 1, { action: 1 });
    pool.act('a/x', 'php', 2, 'dismiss');
    expect(await chosen).toBe('No');
    expect(await dismissed).toBeUndefined();
    expect(pool.notices('a/x', 'php')).toEqual([]);
  });

  it('keeps a question its server stopped waiting on as a message, and its notices past its stop', async () => {
    const { pool, messages } = await runningPhp();
    const asking = new AbortController();
    const asked = messages.ask({ type: 'info', text: 'Wait?' }, ['Yes'], asking.signal);
    asking.abort();
    expect(await asked).toBeUndefined();
    expect(pool.notices('a/x', 'php')).toEqual([
      { id: 1, kind: 'message', type: 'info', text: 'Wait?' },
    ]);
    await pool.stopAdapter('php');
    // Its server has gone, and what it said stays for the reader.
    expect(pool.notices('a/x', 'php')).toHaveLength(1);
  });

  it('gives a web page it names as a link, which only the reader opens', async () => {
    const { pool, messages } = await runningPhp();
    messages.link('https://intelephense.com/');
    expect(pool.notices('a/x', 'php')).toEqual([
      { id: 1, kind: 'link', type: 'info', text: 'https://intelephense.com/' },
    ]);
    expect(pool.act('a/x', 'php', 1, 'open')).toBe('https://intelephense.com/');
    // Opening it leaves it until it's dismissed.
    expect(pool.notices('a/x', 'php')).toHaveLength(1);
  });
});
