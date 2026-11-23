// The language servers that run: one per repository and language, on the checkout of the head on
// screen, moving with it. Only main runs them, only for views the reader trusts, and each starts
// only once a file of its language shows on the new side of the view on screen.
//
// - Nothing starts, starts again or moves unless, then and there, the view on screen is trusted and
//   shows the head of the checkout it's for: each start, restart, crash's restart and move checks,
//   after whatever it waited for.
// - Each server stopping is kept until it has, so a stop, and Lo's quitting, waits for all of them.
// - A server moves to another head of its repository when that comes on screen: by
//   `workspace/didChangeWorkspaceFolders` where it says it takes that, else by starting again.
// - It stops 10 minutes after the pull request whose checkout it runs on was last on screen, as
//   soon as no tab of its repository is open, when trust goes, and as Lo quits.
// - After a crash it starts again by itself once, if it had run for a minute; otherwise it waits
//   for "Restart".
// - At most 4 run, holding 8 GB in all. Past either, the one used longest ago that isn't on screen
//   stops; one on screen is never stopped for another. Each server's own cap, 4 GB, is `@lo/lsp`'s.
// - One on screen with no room waits in line, and the first in line starts as soon as a server
//   stops, fails or is refused. "Restart" starts one if there's room, else puts it first in line.
//   Room is held from the moment it's found until the server fails or stops, so one that waits,
//   failed or was refused never holds any, and one started again keeps only the room it held. A
//   failed server's process holds none while it's stopped either, though the server starts again
//   only once it's gone.
// - Each is looked at as it's first wanted on a checkout, before it waits in line, and again just
//   before it starts or moves there. One refused on a checkout, as its toolchain's files there
//   would steer it, holds and waits for no room, and is looked at again on its own once another
//   head of its repository is on screen. A look that fails refuses nothing: the server fails, and
//   waits for "Restart".
// - Each holds its repository in the cache from just before it starts until it has stopped, so
//   cleanup removes nothing of it meanwhile: not the checkout it runs on, nor its home.
//
// Nothing here calls Electron, so it runs under unit tests.

import { join } from 'node:path';

import {
  failureMessage,
  type InstallProgress,
  type InstallStage,
  type Server,
  type ServerSpec,
  type State,
} from '@lo/lsp';

import type { ServerState } from '../contract.ts';
import type { Adapter, Launch, Prepared } from './adapters.ts';

/**
 * Where Lo installs language servers: `servers` in the cache at `root`. tsserver looks for a plugin
 * a `tsconfig.json` names in each `node_modules` above its install (`@lo/lsp`'s
 * `test/plugins.test.ts`), so which folders those are follows from this and from where the cache
 * is.
 */
export function serversFolder(root: string): string {
  return join(root, 'servers');
}

/** What the pool uses of a running server: `@lo/lsp`'s. */
export type Running = Pick<
  Server,
  | 'capabilities'
  | 'state'
  | 'onState'
  | 'uptime'
  | 'memory'
  | 'log'
  | 'open'
  | 'request'
  | 'pathOf'
  | 'moveTo'
  | 'stop'
>;

export interface PoolLimits {
  /**
   * How long a server runs on once the pull request whose checkout it runs on isn't on screen, in
   * milliseconds.
   */
  readonly idle: number;
  /** The most servers that run at once. */
  readonly count: number;
  /** The most resident memory they hold in all, in bytes. */
  readonly memory: number;
  /** How often their memory is added up. */
  readonly every: number;
  /** How long a server must have run for a crash to start it again by itself. */
  readonly restartAfter: number;
}

export const POOL_LIMITS: PoolLimits = {
  idle: 10 * 60_000,
  count: 4,
  memory: 8 * 1024 ** 3,
  every: 5_000,
  restartAfter: 60_000,
};

/** The checkout a server runs on: a pull request's head. */
export interface Root {
  readonly folder: string;
  readonly pull: number;
}

/** A view of a pull request's tab, as the servers follow it. */
export interface PoolView {
  readonly id: string;
  /** Its repository, as servers are kept by it: `owner/name`, in lowercase. */
  readonly repo: string;
  /** Its pull request's number. */
  readonly pull: number;
  /**
   * `trusted`: a server may start for it and move to it. `held`: it was trusted, and is checked
   * again, as after a push: what runs for its repository keeps running, and nothing new starts.
   */
  readonly trust: 'trusted' | 'held';
  /**
   * The checkout of its head on screen, once it's made, while it's trusted: what a server may start
   * on, or move to, while the view is on screen.
   */
  readonly root: Root | undefined;
  /** The servers it needs: those that read the files its new side shows. */
  readonly wants: readonly Adapter[];
}

export interface PoolOptions {
  /**
   * Finds or downloads what `adapter`'s server starts as, reporting a download's progress, and
   * whether what came is being unpacked or built.
   */
  readonly prepare: (
    adapter: Adapter,
    progress: InstallProgress,
    signal: AbortSignal,
  ) => Promise<Prepared>;
  /** Starts a server: `@lo/lsp`'s `startServer`. */
  readonly start: (spec: ServerSpec) => Running;
  /**
   * The rest of a server's spec, for `repo`: a `HOME` of its own, git's variables, and the folder of
   * Lo's git, put on its `PATH` after the toolchain's folders. Nothing without git.
   */
  readonly base: (
    repo: string,
    adapter: Adapter,
  ) =>
    | {
        readonly home: string;
        readonly git: Readonly<Record<string, string>>;
        readonly path: readonly string[];
      }
    | undefined;
  /**
   * Holds `repo` in the cache for `adapter`'s server, the cache's `useForServer`, until the release,
   * which comes once the server has stopped or, if it never started, once it won't: cleanup
   * removes nothing of the repository meanwhile, its home included. It waits for cleanup that's
   * removing any of it, and stops waiting once `signal` aborts. Nothing is held without it.
   */
  readonly hold?:
    ((repo: string, adapter: Adapter, signal: AbortSignal) => Promise<() => void>) | undefined;
  /**
   * Why `adapter`'s server mustn't run on the checkout at `folder`, such as a `global.json` there
   * that could choose a .NET SDK other than Lo's, or `undefined` when it may. It's the reason
   * alone: the status says first that Lo won't run the server ({@link whyRefused}). Asked as the
   * server is first wanted there, before it waits in line, and again before it starts there and
   * before it moves there. One that throws couldn't look, which refuses nothing.
   */
  readonly checkout?:
    ((adapter: Adapter, folder: string) => Promise<string | undefined>) | undefined;
  /** A server of `repo` changed what its views show. */
  readonly changed: (repo: string) => void;
  readonly log: (line: string) => void;
  readonly limits?: Partial<PoolLimits> | undefined;
}

/** What a question finds of a view's server for a language: ready, or where it is instead. */
export type Found =
  | { readonly kind: 'ready'; readonly server: Running }
  /**
   * It's on its way: its checkout looked at, downloading, unpacking, building, starting, or moving
   * to this head.
   */
  | { readonly kind: 'starting' }
  /** It waits in line for room, as Lo runs `count` at once at most. */
  | { readonly kind: 'waiting'; readonly count: number }
  /** Lo won't run it on this checkout: `why` says so, and why, as its status does. */
  | { readonly kind: 'refused'; readonly why: string }
  /** The toolchain it needs isn't installed: `needs` names it, as its status does. */
  | { readonly kind: 'missing'; readonly needs: string }
  /** It failed, and waits for "Restart". */
  | { readonly kind: 'failed' }
  /** It stopped, or is stopping. */
  | { readonly kind: 'stopped' };

type Phase =
  /** Its checkout is looked at, before it waits in line there: it holds no room. */
  | 'checking'
  /** Waiting in line for room: it holds none. */
  | 'waiting'
  /** Holding room while it gets what it starts as, or while an earlier server stops. */
  | 'preparing'
  | 'running'
  /** It failed before its process started: `problem` says why. */
  | 'failed'
  /** Lo won't run it on its checkout: `refused` says why. It holds and waits for no room. */
  | 'refused'
  /** It's stopping for good, and goes once it has. */
  | 'ending';

interface Entry {
  readonly key: string;
  readonly repo: string;
  readonly adapter: Adapter;
  phase: Phase;
  server: Running | undefined;
  stopListening: (() => void) | undefined;
  /** The checkout it runs on, or will. */
  root: Root;
  /** The folder of the last checkout a look found it may run on: none once a look doesn't. */
  checked: string | undefined;
  /** The checkout it's moving to, while it is, so it's asked nothing meanwhile. */
  moving: Root | undefined;
  /** Its download's progress, while there's one, and what's being done with what came. */
  progress: { done: number; total: number; stage: InstallStage } | undefined;
  /** What the window is told while it has failed, or can't start. */
  problem: ServerState | undefined;
  /** What the window is told while Lo won't run it on its checkout: that it won't, and why. */
  refused: string | undefined;
  /**
   * Its place in line for room, the lowest first, from when it first waits for room until it has
   * some: those asked for later go after it, and one restarted goes before them all.
   */
  line: number | undefined;
  version: string | undefined;
  /** When it was last on screen, or asked something. */
  used: number;
  idle: ReturnType<typeof setTimeout> | undefined;
  /** Whether a crash has started it again by itself already. */
  restarted: boolean;
  /** Each start's number, so what an earlier one finds out late is dropped. */
  run: number;
  controller: AbortController;
  /** Its server before this one, while it stops for this one to start, or to wait in line. */
  stopping: Promise<void> | undefined;
  ended: Promise<void> | undefined;
}

/**
 * What a server's status says when Lo won't run it on a checkout: that it won't, then why, as
 * `reason`. What refused it gives the reason alone, so the first sentence is always said once.
 */
export function whyRefused(name: string, reason: string): string {
  return clip(`Lo won’t run ${name} on this checkout. ${reason}`);
}

/** What a failed server's status says when Lo couldn't look at its checkout. */
function lookFailed(error: unknown): ServerState {
  return {
    kind: 'failed',
    why: { kind: 'error', message: clip(`Lo couldn’t check this checkout (${describe(error)}).`) },
  };
}

/** What a look at a checkout found: that the server may run there, why it mustn't, or neither. */
type Look =
  | { readonly kind: 'may' }
  | { readonly kind: 'refused'; readonly reason: string }
  /** Lo couldn't look, as for a read that failed: that refuses nothing. */
  | { readonly kind: 'failed'; readonly error: unknown };

export class ServerPool {
  readonly #options: PoolOptions;
  readonly #limits: PoolLimits;
  readonly #entries = new Map<string, Entry>();
  #views: readonly PoolView[] = [];
  #screen: string | undefined;
  #budget: ReturnType<typeof setInterval> | undefined;
  /** Every server stopping, with the checkout it ran on, until it has stopped. */
  readonly #stopping = new Set<Stopping>();
  /** What lets go of each server's hold on its repository, once it has stopped. */
  readonly #holds = new Map<Running, () => void>();
  /** The places in line last given: at its end, and, for a restart, at its start. */
  readonly #ends = { last: 0, first: 0 };
  #stopped = false;

  constructor(options: PoolOptions) {
    this.#options = options;
    this.#limits = { ...POOL_LIMITS, ...options.limits };
  }

  /**
   * Follows the views the servers are for, and the view on screen: starts and moves what the view on
   * screen needs, and stops what no view needs any longer, or soon.
   */
  sync(views: readonly PoolView[], screen: string | undefined): void {
    if (this.#stopped) return;
    this.#views = views;
    this.#screen = screen;
    this.#apply();
  }

  /** Where `repo`'s server `adapter` is, for the window, or nothing when none is on its way. */
  shown(repo: string, adapter: string): { state: ServerState; version?: string } | undefined {
    const entry = this.#entries.get(keyOf(repo, adapter));
    if (!entry || entry.phase === 'ending') return undefined;
    const version = entry.version === undefined ? {} : { version: entry.version };
    const waiting = (): ServerState => ({
      kind: 'waiting',
      count: this.#limits.count,
      next: this.#inLine()[0] === entry,
    });
    return { state: stateOf(entry, waiting), ...version };
  }

  /**
   * `repo`'s server `adapter`, for a question about a file of the checkout `folder`: ready, or
   * where it is instead. Nothing when there's none, or it runs on another head.
   */
  find(repo: string, adapter: string, folder: string): Found | undefined {
    const entry = this.#entries.get(keyOf(repo, adapter));
    if (!entry || entry.phase === 'ending') return undefined;
    // One that failed waits for "Restart" whichever head is on screen, as its status says.
    const failed =
      entry.phase === 'failed' ||
      (entry.phase === 'running' && entry.server?.state.kind === 'failed');
    if (entry.root.folder !== folder && !failed) return undefined;
    entry.used = Date.now();
    switch (entry.phase) {
      case 'waiting':
        return { kind: 'waiting', count: this.#limits.count };
      case 'refused':
        return { kind: 'refused', why: entry.refused ?? '' };
      case 'failed':
        return entry.problem?.kind === 'missing'
          ? { kind: 'missing', needs: entry.problem.needs }
          : { kind: 'failed' };
      case 'checking':
      case 'preparing':
        return { kind: 'starting' };
      case 'running':
        break;
      default:
        entry.phase satisfies never;
        throw new Error(`a server’s phase Lo doesn’t know: ${String(entry.phase)}`);
    }
    const { server } = entry;
    if (entry.moving !== undefined || !server) return { kind: 'starting' };
    switch (server.state.kind) {
      case 'ready':
      case 'indexing':
      case 'notAnswering':
        return { kind: 'ready', server };
      case 'starting':
        return { kind: 'starting' };
      case 'stopping':
      case 'stopped':
        return { kind: 'stopped' };
      case 'failed':
        return { kind: 'failed' };
      default:
        server.state satisfies never;
        return { kind: 'failed' };
    }
  }

  /** `repo`'s server `adapter`'s log, if it has one. */
  log(repo: string, adapter: string): readonly string[] | undefined {
    const entry = this.#entries.get(keyOf(repo, adapter));
    return entry?.server?.log;
  }

  /**
   * Starts `repo`'s server `adapter` again, on `root`, as "Restart" asks: stopped first if it
   * runs, and able to start again by itself after a crash once more. Without room, it goes first in
   * line. One refused, or not yet looked at there, is looked at first, and goes first in line only
   * if it may run there.
   */
  async restart(repo: string, adapter: Adapter, root: Root): Promise<void> {
    if (!this.#allowed(repo, root)) return;
    const key = keyOf(repo, adapter.id);
    const before = this.#entries.get(key);
    if (before?.phase === 'ending') await before.ended;
    // Trust may have gone while it stopped.
    if (!this.#allowed(repo, root)) return;
    const entry = this.#entries.get(key) ?? this.#added(repo, adapter, root);
    if (entry.phase === 'ending') return;
    entry.restarted = false;
    if (entry.phase === 'checking' || entry.phase === 'refused') {
      await this.#queue(entry, root, true);
      return;
    }
    this.#ends.first -= 1;
    entry.line = this.#ends.first;
    await this.#again(entry, root);
  }

  /**
   * Stops the servers of `repo` on the pull requests `stops` picks, by the pull request each runs
   * on (`undefined` for one with no checkout yet), as when trust goes, and resolves once they have.
   */
  async stopWhere(repo: string, stops: (pull: number | undefined) => boolean): Promise<void> {
    const ending = [...this.#entries.values()]
      .filter((entry) => entry.repo === repo && stops(entry.root.pull))
      .map((entry) => this.#end(entry, 'trust in it went'));
    // And those still stopping on them, as one stopped for a restart elsewhere may be.
    const stopping = [...this.#stopping].filter((each) => each.repo === repo && stops(each.pull));
    await Promise.all([...ending, ...stopping.map((each) => each.done)]);
  }

  /**
   * Stops every server whose adapter `uses` picks, as when the toolchain it runs on is removed, and
   * marks each failed with `message`, to wait for "Restart", which gets it again. One getting ready
   * stops waiting for its download. Resolves once they've stopped.
   */
  async halt(uses: (adapter: Adapter) => boolean, message: string): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const entry of this.#entries.values()) {
      // One refused has nothing to stop, and stays refused.
      if (entry.phase === 'ending' || entry.phase === 'refused' || !uses(entry.adapter)) continue;
      // What the start before finds out late is dropped.
      entry.run += 1;
      entry.controller.abort();
      entry.controller = new AbortController();
      entry.stopListening?.();
      entry.stopListening = undefined;
      const { server, stopping } = entry;
      entry.server = undefined;
      entry.moving = undefined;
      if (stopping) stops.push(stopping);
      if (server) {
        // Kept, so "Restart" starts it again only once it has stopped.
        entry.stopping = this.#stopServer(entry, server, entry.root);
        stops.push(entry.stopping);
      }
      entry.phase = 'failed';
      entry.progress = undefined;
      entry.problem = { kind: 'failed', why: { kind: 'error', message: clip(message) } };
      this.#changed(entry);
    }
    // What held room and had no server to stop leaves it at once.
    this.#handOn();
    await Promise.all(stops);
  }

  /**
   * Stops every server, as Lo quits, within `@lo/lsp`'s limit for a stop, and resolves once every
   * one has, those stopping already included.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#budget);
    this.#budget = undefined;
    await Promise.all(
      [...this.#entries.values()].map((entry) => this.#end(entry, 'Lo is quitting')),
    );
    while (this.#stopping.size > 0) {
      await Promise.all([...this.#stopping].map((each) => each.done));
    }
  }

  /** What the views need now. */
  #apply(): void {
    if (this.#stopped) return;
    const views = this.#views;
    const repos = new Set(views.map((view) => view.repo));
    for (const entry of this.#entries.values()) {
      if (!repos.has(entry.repo)) void this.#end(entry, `no trusted tab of ${entry.repo} is open`);
    }
    const screen = this.#screenView();
    const root = screen?.root;
    if (screen?.trust === 'trusted' && root) {
      for (const adapter of screen.wants) {
        const entry = this.#entries.get(keyOf(screen.repo, adapter.id));
        // One new is looked at, then joins the line, where it was put as it was first wanted, and
        // starts if it's its turn.
        if (!entry) void this.#queue(this.#added(screen.repo, adapter, root), root);
        else if (entry.phase !== 'ending' && entry.root.folder !== root.folder) {
          void this.#move(entry, root);
        }
      }
      // Those waiting start in turn while there's room, as there may be now.
      this.#handOn();
    }
    // Once what's on screen has started or is moving there, the rest count down.
    for (const entry of this.#entries.values()) {
      if (entry.phase === 'ending') continue;
      if (this.#onScreen(entry)) {
        clearTimeout(entry.idle);
        entry.idle = undefined;
        entry.used = Date.now();
      } else if (entry.idle === undefined) {
        entry.idle = setTimeout(
          () => void this.#end(entry, `its pull request wasn’t on screen for a while`),
          this.#limits.idle,
        );
      }
    }
  }

  /**
   * Whether `entry` runs on the pull request on screen, or is moving there: a move to another, even
   * one that never ends, doesn't count.
   */
  #onScreen(entry: Entry): boolean {
    const screen = this.#screenView();
    return (
      screen !== undefined &&
      entry.repo === screen.repo &&
      (entry.root.pull === screen.pull || entry.moving?.pull === screen.pull)
    );
  }

  /** The view on screen, if the servers follow it. */
  #screenView(): PoolView | undefined {
    return this.#views.find((view) => view.id === this.#screen);
  }

  /**
   * Those waiting for room that may start now, first in line first: those the view on screen
   * needs, on its head, while it's trusted.
   */
  #inLine(): Entry[] {
    const screen = this.#screenView();
    if (screen?.trust !== 'trusted' || !screen.root) return [];
    const wanted = new Set(screen.wants.map((adapter) => adapter.id));
    return [...this.#entries.values()]
      .filter(
        (entry) =>
          entry.phase === 'waiting' && entry.repo === screen.repo && wanted.has(entry.adapter.id),
      )
      .toSorted((one, other) => (one.line ?? 0) - (other.line ?? 0));
  }

  /**
   * Starts those waiting for room on screen, first in line first, while there's room: once one
   * finds none, nor would any after it. Each starts on the head on screen. One whose old server is
   * still stopping takes its turn all the same, and starts once that one has.
   */
  #handOn(): void {
    if (this.#stopped) return;
    const root = this.#screenView()?.root;
    if (!root) return;
    for (const entry of this.#inLine()) {
      entry.root = root;
      this.#launch(entry);
      if (entry.phase === 'waiting') return;
    }
  }

  /**
   * A server for `repo`'s `adapter`, on `root`, given its place at the end of the line for room,
   * which it takes once its checkout has been looked at.
   */
  #added(repo: string, adapter: Adapter, root: Root): Entry {
    this.#ends.last += 1;
    const entry: Entry = {
      key: keyOf(repo, adapter.id),
      repo,
      adapter,
      phase: 'checking',
      server: undefined,
      stopListening: undefined,
      root,
      checked: undefined,
      moving: undefined,
      progress: undefined,
      problem: undefined,
      refused: undefined,
      line: this.#ends.last,
      version: undefined,
      used: Date.now(),
      idle: undefined,
      restarted: false,
      run: 0,
      controller: new AbortController(),
      stopping: undefined,
      ended: undefined,
    };
    this.#entries.set(entry.key, entry);
    this.#watchBudget();
    return entry;
  }

  /**
   * Whether a server of `repo` may start, start again or move to `root` now: the view on screen is
   * of `repo`, trusted, and shows the head `root` checks out. Each start and move asks, after
   * whatever it waited for.
   */
  #allowed(repo: string, root: Root | undefined): root is Root {
    if (this.#stopped || !root) return false;
    const screen = this.#screenView();
    return (
      screen?.trust === 'trusted' && screen.repo === repo && screen.root?.folder === root.folder
    );
  }

  /**
   * Stops `entry`'s `server`, on `root`, kept among those stopping until it has, and lets go of its
   * hold on its repository then, and of its room.
   */
  #stopServer(entry: Entry, server: Running, root: Root): Promise<void> {
    // One that failed let its room go then.
    const failed = server.state.kind === 'failed';
    const done = server.stop().catch((error: unknown) => {
      this.#options.log(`a language server's stop failed: ${describe(error)}`);
    });
    const stopping: Stopping = { repo: entry.repo, pull: root.pull, failed, done };
    this.#stopping.add(stopping);
    void done.finally(() => {
      this.#stopping.delete(stopping);
      this.#holds.get(server)?.();
      this.#holds.delete(server);
      // One waiting in line for this to stop may take its turn now.
      if (entry.stopping === done) entry.stopping = undefined;
      this.#handOn();
    });
    return done;
  }

  /** Whether `entry` is the one kept for its key, and not stopping for good. */
  #current(entry: Entry, run: number): boolean {
    return (
      !this.#stopped &&
      this.#entries.get(entry.key) === entry &&
      entry.phase !== 'ending' &&
      entry.run === run
    );
  }

  /**
   * Starts `entry`'s server, on its root, once there's room and it has what it starts as. Whether
   * there's room is settled before this returns: it holds room from then on, or waits in line.
   */
  #launch(entry: Entry): void {
    entry.run += 1;
    const { run } = entry;
    entry.phase = 'preparing';
    entry.problem = undefined;
    entry.refused = undefined;
    entry.progress = undefined;
    void this.#prepareAndStart(entry, run);
    // Told once room is settled, so the window never sees one start that only waits.
    this.#changed(entry);
  }

  async #prepareAndStart(entry: Entry, run: number): Promise<void> {
    const { adapter } = entry;
    // Nothing is downloaded for what may not run.
    if (!this.#allowed(entry.repo, entry.root)) {
      void this.#end(entry, 'no trusted view on screen shows its head');
      return;
    }
    if (!(await this.#room(entry, run))) return;
    // It starts once its server before has stopped, so two never run at once.
    const { stopping } = entry;
    if (stopping !== undefined) {
      await stopping;
      if (!this.#current(entry, run)) return;
    }
    let prepared: Prepared;
    try {
      prepared = await this.#options.prepare(
        adapter,
        (done, total, stage) => {
          if (!this.#current(entry, run)) return;
          entry.progress = { done, total, stage };
          this.#changed(entry);
        },
        entry.controller.signal,
      );
    } catch (error) {
      if (!this.#current(entry, run)) return;
      this.#options.log(`${adapter.name} for ${entry.repo}: ${describe(error)}`);
      this.#fail(entry, {
        kind: 'failed',
        why: { kind: 'download', message: clip(describe(error)) },
      });
      return;
    }
    if (!this.#current(entry, run)) return;
    entry.progress = undefined;
    if (prepared.kind === 'missing') {
      const install = prepared.install === undefined ? {} : { install: prepared.install };
      const plural = prepared.plural === true ? { plural: true } : {};
      this.#fail(entry, { kind: 'missing', needs: prepared.needs, ...install, ...plural });
      return;
    }
    const base = this.#options.base(entry.repo, adapter);
    if (!base) {
      this.#fail(entry, {
        kind: 'failed',
        why: { kind: 'error', message: 'Git wasn’t found.' },
      });
      return;
    }
    // Held from before every check that follows, so cleanup takes nothing the server would find.
    let release: () => void;
    try {
      release =
        (await this.#options.hold?.(entry.repo, adapter, entry.controller.signal)) ??
        (() => undefined);
    } catch (error) {
      if (!this.#current(entry, run)) return;
      this.#fail(entry, {
        kind: 'failed',
        why: { kind: 'error', message: clip(describe(error)) },
      });
      return;
    }
    let held = false;
    try {
      held = await this.#startHeld(entry, run, prepared.launch, base, release);
    } finally {
      if (!held) release();
    }
  }

  /**
   * The rest of starting `entry`'s server, once its repository is held: whether the server
   * started, and took the hold, which it lets go of once it has stopped.
   */
  async #startHeld(
    entry: Entry,
    run: number,
    launch: Launch,
    base: NonNullable<ReturnType<PoolOptions['base']>>,
    release: () => void,
  ): Promise<boolean> {
    const { adapter } = entry;
    // It has held its room since it found it, so none of it went to another meanwhile.
    if (!this.#current(entry, run)) return false;
    // Trust, the view on screen or the head it's on may have changed while it got ready, and again
    // while its checkout was looked at.
    let root = entry.root;
    for (;;) {
      if (!this.#allowed(entry.repo, root)) {
        void this.#end(entry, 'no trusted view on screen shows its head');
        return false;
      }
      const look = await this.#look(adapter, root);
      if (!this.#current(entry, run)) return false;
      if (look.kind === 'refused') {
        this.#refuse(entry, look.reason);
        return false;
      }
      if (look.kind === 'failed') {
        this.#couldNotLook(entry, root, look.error);
        return false;
      }
      entry.checked = root.folder;
      if (entry.root === root && this.#allowed(entry.repo, root)) break;
      root = entry.root;
    }
    let server: Running;
    try {
      server = this.#options.start({
        name: adapter.name,
        program: launch.program,
        args: launch.args,
        root: root.folder,
        home: base.home,
        // The toolchain's folders first, then Lo's git's, so a git from a folder that holds other
        // programs, as Homebrew's does, can't bring that folder's `go` or `cargo` ahead of Lo's.
        path: [...(launch.path ?? []), ...base.path],
        variables: launch.variables,
        allowed: launch.allowed,
        homeFolders: launch.homeFolders,
        git: base.git,
        settings: launch.settings,
        initializationOptions: launch.initializationOptions,
        place: launch.place,
        stays: launch.stays,
        rootless: launch.rootless,
        services: launch.services,
        workspace: launch.workspace,
      });
    } catch (error) {
      this.#fail(entry, {
        kind: 'failed',
        why: { kind: 'error', message: clip(describe(error)) },
      });
      return false;
    }
    this.#holds.set(server, release);
    entry.server = server;
    entry.version = launch.version;
    entry.phase = 'running';
    entry.stopListening = server.onState((state) => this.#heard(entry, server, state));
    this.#changed(entry);
    return true;
  }

  /** Marks `entry` failed with `problem`. It holds no room, so the next in line may start. */
  #fail(entry: Entry, problem: ServerState): void {
    entry.phase = 'failed';
    entry.problem = problem;
    entry.refused = undefined;
    entry.progress = undefined;
    this.#changed(entry);
    this.#handOn();
  }

  /**
   * Marks `entry` refused on its checkout, for `reason`. It holds no room, so the next in line may
   * start, and it gives up its place in line.
   */
  #refuse(entry: Entry, reason: string): void {
    entry.phase = 'refused';
    entry.problem = undefined;
    entry.refused = whyRefused(entry.adapter.name, reason);
    entry.progress = undefined;
    entry.checked = undefined;
    entry.line = undefined;
    this.#changed(entry);
    this.#handOn();
  }

  /**
   * Marks `entry` failed, as Lo couldn't look at whether it may run on `root`, for `error`, which
   * may pass, as a read that failed while the checkout was being cleaned up. That refuses nothing:
   * it waits for "Restart".
   */
  #couldNotLook(entry: Entry, root: Root, error: unknown): void {
    this.#options.log(
      `${entry.adapter.name} for ${entry.repo}: couldn't check ${root.folder}: ${describe(error)}`,
    );
    entry.checked = undefined;
    this.#fail(entry, lookFailed(error));
  }

  /**
   * Puts `entry` in line for room on `root`, `first` for a restart, else where it was if it had a
   * place, else at the end: at once when a look there found it may run there, else once one has,
   * and then it starts if it's its turn. Meanwhile it holds no room and isn't in line, so one
   * refused there never waits; one refused before stays so, to say why, until the look ends. A
   * look that fails leaves it failed.
   */
  async #queue(entry: Entry, root: Root, first = false): Promise<void> {
    entry.root = root;
    if (first) {
      this.#ends.first -= 1;
      entry.line = this.#ends.first;
    }
    if (entry.checked === root.folder) {
      this.#wait(entry);
      return;
    }
    entry.run += 1;
    const { run } = entry;
    if (entry.phase !== 'refused') {
      entry.phase = 'checking';
      entry.problem = undefined;
      entry.progress = undefined;
      this.#changed(entry);
    }
    const look = await this.#look(entry.adapter, root);
    if (!this.#current(entry, run) || entry.root !== root) return;
    switch (look.kind) {
      case 'refused':
        this.#refuse(entry, look.reason);
        return;
      case 'failed':
        this.#couldNotLook(entry, root, look.error);
        return;
      case 'may':
        entry.checked = root.folder;
        this.#wait(entry);
        this.#handOn();
        return;
      default:
        look satisfies never;
        throw new Error(`a look Lo doesn’t know: ${JSON.stringify(look)}`);
    }
  }

  /** Puts `entry` in line for room, where it was if it had a place, else at the end. */
  #wait(entry: Entry): void {
    entry.phase = 'waiting';
    entry.problem = undefined;
    entry.refused = undefined;
    entry.progress = undefined;
    if (entry.line === undefined) {
      this.#ends.last += 1;
      entry.line = this.#ends.last;
    }
    this.#changed(entry);
  }

  /** A server's new state: a crash may start it again, and one that failed leaves its room. */
  #heard(entry: Entry, server: Running, state: State): void {
    if (entry.server !== server || entry.phase !== 'running') return;
    if (
      state.kind === 'failed' &&
      state.failure.kind === 'exited' &&
      server.uptime >= this.#limits.restartAfter &&
      !entry.restarted
    ) {
      entry.restarted = true;
      this.#options.log(
        `${entry.adapter.name} for ${entry.repo} ${failureMessage(state.failure)} Lo starts it again.`,
      );
      // It held room until now, and keeps it.
      void this.#again(entry, entry.root, true);
      return;
    }
    this.#changed(entry);
    if (state.kind === 'failed') this.#handOn();
  }

  /**
   * Stops `entry`'s server, if it runs, and starts it again on `root`, if it may run there once the
   * old one has stopped. One that `held` room keeps it meanwhile, in the old one's place, and so
   * does one that finds room free; any other, such as one whose crash let its room go to the next
   * in line, waits its turn, and takes it only once the old one has stopped. One that held none and
   * wasn't looked at on `root` yet, as one whose look failed, is looked at first, before it gets
   * ready or takes room, and waits its turn only if it may run there.
   */
  async #again(
    entry: Entry,
    root: Root | undefined,
    held = this.#live().includes(entry),
  ): Promise<void> {
    const keeps = held || this.#held(entry) < this.#limits.count;
    const old = entry.server;
    const was = entry.root;
    entry.stopListening?.();
    entry.stopListening = undefined;
    entry.server = undefined;
    entry.moving = undefined;
    if (root) entry.root = root;
    entry.controller.abort();
    entry.controller = new AbortController();
    // The server before, or the one an earlier restart or a halt is still stopping.
    const stopping = old ? this.#stopServer(entry, old, was) : entry.stopping;
    const looks = !held && entry.checked !== entry.root.folder;
    if (!stopping) {
      if (looks) await this.#queue(entry, entry.root);
      else this.#launch(entry);
      return;
    }
    entry.run += 1;
    const { run } = entry;
    entry.stopping = stopping;
    if (keeps && !looks) {
      entry.phase = 'preparing';
      entry.problem = undefined;
      entry.refused = undefined;
      entry.progress = undefined;
      entry.line = undefined;
      this.#changed(entry);
    } else {
      void this.#queue(entry, entry.root);
    }
    await stopping;
    if (entry.stopping === stopping) entry.stopping = undefined;
    if (!this.#current(entry, run)) return;
    // One waiting took its turn as the old one stopped, if it was its turn.
    if (entry.phase === 'preparing') this.#launch(entry);
    else this.#handOn();
  }

  /** Moves `entry`'s server to `root`, another head of its repository. */
  async #move(entry: Entry, root: Root): Promise<void> {
    const { server } = entry;
    if (entry.phase !== 'running' || !server) {
      // One getting ready starts there, once it's looked at there; one that failed starts there on
      // "Restart"; and any other is looked at there, then waits in line there.
      if (entry.phase === 'preparing') entry.root = root;
      else if (entry.phase !== 'failed' && entry.phase !== 'ending') {
        await this.#queue(entry, root);
      }
      return;
    }
    const kind = server.state.kind;
    if (kind === 'failed' || kind === 'stopping' || kind === 'stopped') return;
    // Asked again just before the server is told, after whatever moving it waited for.
    const still = () =>
      entry.server === server && entry.phase === 'running' && this.#allowed(entry.repo, root);
    if (!still()) return;
    // One whose checkout it mustn't run on, or that couldn't be looked at, starts there again
    // instead, and says why it can't.
    const look = await this.#look(entry.adapter, root);
    if (!still()) return;
    if (look.kind !== 'may') {
      await this.#again(entry, root);
      return;
    }
    entry.checked = root.folder;
    entry.moving = root;
    this.#changed(entry);
    const moved =
      kind === 'starting' ? false : await server.moveTo(root.folder, still).catch(() => false);
    if (entry.server !== server || entry.phase !== 'running') return;
    entry.moving = undefined;
    if (moved) {
      entry.root = root;
      this.#changed(entry);
      return;
    }
    // It stays where it was when it's no longer wanted there.
    if (!this.#allowed(entry.repo, root)) {
      this.#changed(entry);
      return;
    }
    await this.#again(entry, root);
  }

  /**
   * Whether `adapter`'s server may run on `root`, why it mustn't, or that Lo couldn't look, which
   * refuses nothing.
   */
  async #look(adapter: Adapter, root: Root): Promise<Look> {
    try {
      const reason = await this.#options.checkout?.(adapter, root.folder);
      return reason === undefined ? { kind: 'may' } : { kind: 'refused', reason };
    } catch (error) {
      return { kind: 'failed', error };
    }
  }

  /**
   * Whether there's room for `entry` to run, once the server used longest ago off screen has
   * stopped if need be: those still stopping count until they have. It holds room from the moment
   * it's found, or the moment the server it stops for is chosen, and with none, nor any to stop, it
   * waits in line then and there: either way, before anything else can count it.
   */
  async #room(entry: Entry, run: number): Promise<boolean> {
    for (;;) {
      if (!this.#current(entry, run)) return false;
      const { count } = this.#limits;
      if (this.#held(entry) < count) {
        entry.line = undefined;
        return true;
      }
      const others = this.#live().filter((each) => each !== entry);
      if (others.length < count) {
        await Promise.race(this.#holding().map((each) => each.done));
        continue;
      }
      const victim = this.#leastUsedOffScreen(others);
      if (!victim) {
        void this.#queue(entry, entry.root);
        return false;
      }
      await this.#end(victim, `Lo runs ${count} language servers at most`);
    }
  }

  /** The servers running or about to, each holding room: never one waiting, failed or refused. */
  #live(): Entry[] {
    return [...this.#entries.values()].filter(
      (entry) =>
        entry.phase === 'preparing' ||
        (entry.phase === 'running' && entry.server?.state.kind !== 'failed'),
    );
  }

  /**
   * How much room is held, `entry`'s aside: one for each server running or about to, and one for
   * each still stopping that holds room ({@link ServerPool.#holding}).
   */
  #held(entry: Entry): number {
    return this.#live().filter((each) => each !== entry).length + this.#holding().length;
  }

  /**
   * The servers still stopping that hold room: not one that failed, which let its room go then,
   * nor one stopping for a server to start again in its place, which holds that one's.
   */
  #holding(): Stopping[] {
    const replaced = new Set(this.#live().map((each) => each.stopping));
    return [...this.#stopping].filter((each) => !each.failed && !replaced.has(each.done));
  }

  #leastUsedOffScreen(entries: readonly Entry[]): Entry | undefined {
    return entries
      .filter((entry) => !this.#onScreen(entry))
      .toSorted((one, other) => one.used - other.used)[0];
  }

  /** Watches what the servers hold in all, while any is kept. */
  #watchBudget(): void {
    if (this.#budget !== undefined) return;
    this.#budget = setInterval(() => this.#holdBudget(), this.#limits.every);
    this.#budget.unref?.();
  }

  /** Stops servers off screen, used longest ago first, while all of them hold more than the cap. */
  #holdBudget(): void {
    if (this.#entries.size === 0) {
      clearInterval(this.#budget);
      this.#budget = undefined;
      return;
    }
    const live = this.#live();
    let total = live.reduce((sum, entry) => sum + (entry.server?.memory ?? 0), 0);
    let left = live;
    while (total > this.#limits.memory) {
      const victim = this.#leastUsedOffScreen(left);
      if (!victim) return;
      total -= victim.server?.memory ?? 0;
      left = left.filter((entry) => entry !== victim);
      // For the log, the cap itself: the window words it from the state's `cap`.
      void this.#end(
        victim,
        `Lo’s language servers held more than ${this.#limits.memory.toLocaleString('en-US')} bytes`,
      );
    }
  }

  /** Stops `entry` for good, and resolves once its server has. */
  #end(entry: Entry, why: string): Promise<void> {
    if (entry.ended) return entry.ended;
    entry.phase = 'ending';
    clearTimeout(entry.idle);
    entry.idle = undefined;
    entry.controller.abort();
    entry.stopListening?.();
    entry.stopListening = undefined;
    const { server, stopping } = entry;
    if (server) this.#options.log(`stopping ${entry.adapter.name} for ${entry.repo}: ${why}.`);
    entry.ended = (async () => {
      try {
        // And the one before it, if it's still stopping for this one to start.
        await Promise.all([server && this.#stopServer(entry, server, entry.root), stopping]);
      } finally {
        if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
        this.#options.changed(entry.repo);
        // What's wanted may start now: on another head, or in the room this one leaves.
        this.#apply();
      }
    })();
    this.#changed(entry);
    return entry.ended;
  }

  #changed(entry: Entry): void {
    this.#options.changed(entry.repo);
  }
}

/** A server stopping, and the checkout it ran on, by repository and pull request. */
interface Stopping {
  readonly repo: string;
  readonly pull: number;
  /** Whether it had failed already, its process gone or on its way out. */
  readonly failed: boolean;
  readonly done: Promise<void>;
}

function keyOf(repo: string, adapter: string): string {
  return `${repo}\n${adapter}`;
}

/** What the window is told of `entry`, `waiting` while it waits for room. */
function stateOf(entry: Entry, waiting: () => ServerState): ServerState {
  if (entry.moving !== undefined) return { kind: 'starting' };
  switch (entry.phase) {
    case 'checking':
      return { kind: 'starting' };
    case 'waiting':
      return waiting();
    case 'preparing': {
      const { progress } = entry;
      if (!progress) return { kind: 'starting' };
      switch (progress.stage) {
        case 'downloading':
          return { kind: 'downloading', done: progress.done, total: progress.total };
        case 'unpacking':
        case 'building':
          return { kind: progress.stage };
        default:
          progress.stage satisfies never;
          return { kind: 'starting' };
      }
    }
    case 'failed':
      return entry.problem ?? { kind: 'failed', why: { kind: 'error', message: 'It stopped.' } };
    case 'refused':
      return { kind: 'refused', why: entry.refused ?? '' };
    case 'ending':
      return { kind: 'starting' };
    case 'running':
      break;
    default:
      entry.phase satisfies never;
      return { kind: 'starting' };
  }
  const state = entry.server?.state ?? { kind: 'starting' };
  switch (state.kind) {
    case 'starting':
    case 'stopping':
    case 'stopped':
      return { kind: 'starting' };
    case 'indexing': {
      const { percentage } = state.progress;
      return percentage === undefined
        ? { kind: 'indexing' }
        : { kind: 'indexing', percent: percentage };
    }
    case 'ready':
      return { kind: 'ready' };
    case 'notAnswering':
      return { kind: 'notAnswering' };
    case 'failed':
      return state.failure.kind === 'memory'
        ? { kind: 'failed', why: { kind: 'memory', cap: state.failure.cap } }
        : { kind: 'failed', why: { kind: 'error', message: clip(failureMessage(state.failure)) } };
    default:
      state satisfies never;
      return { kind: 'starting' };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `text`, cut to what the contract carries. */
function clip(text: string): string {
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}
