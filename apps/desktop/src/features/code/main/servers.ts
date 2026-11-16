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
//
// Nothing here calls Electron, so it runs under unit tests.

import { failureMessage, type Server, type ServerSpec, type State } from '@lo/lsp';

import type { ServerState } from '../contract.ts';
import type { Adapter, Prepared } from './adapters.ts';

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
  /** Finds or downloads what `adapter`'s server starts as, reporting a download's progress. */
  readonly prepare: (
    adapter: Adapter,
    progress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<Prepared>;
  /** Starts a server: `@lo/lsp`'s `startServer`. */
  readonly start: (spec: ServerSpec) => Running;
  /**
   * The rest of a server's spec, for `repo`: a `HOME` of its own, git's variables, and the folder of
   * Lo's git, put first on its `PATH`. Nothing without git.
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
  /** A server of `repo` changed what its views show. */
  readonly changed: (repo: string) => void;
  readonly log: (line: string) => void;
  readonly limits?: Partial<PoolLimits> | undefined;
}

/** What a question finds of a view's server for a language. */
export type Found =
  | { readonly kind: 'ready'; readonly server: Running }
  /** It's on its way: downloading, starting, or moving to this head. */
  | { readonly kind: 'starting' }
  /** It failed, or can't run here, and waits for "Restart". */
  | { readonly kind: 'failed' };

type Phase =
  /** Getting what it starts as, or waiting for an earlier server to stop. */
  | 'preparing'
  | 'running'
  /** It failed before its process started, or there's no room for it: `problem` says why. */
  | 'failed'
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
  root: Root | undefined;
  /** Whether it's moving to `root`, so asks nothing meanwhile. */
  moving: boolean;
  /** Its download's progress, while there's one. */
  progress: { done: number; total: number } | undefined;
  /** What the window is told while it has failed, or can't start. */
  problem: ServerState | undefined;
  /** Whether it failed for want of room, so starts once there's room. */
  full: boolean;
  version: string | undefined;
  /** When it was last on screen, or asked something. */
  used: number;
  idle: ReturnType<typeof setTimeout> | undefined;
  /** Whether a crash has started it again by itself already. */
  restarted: boolean;
  /** Each start's number, so what an earlier one finds out late is dropped. */
  run: number;
  controller: AbortController;
  /** Its server before this one, while it stops for this one to start. */
  stopping: Promise<void> | undefined;
  ended: Promise<void> | undefined;
}

/** What the window is told when a server has no room to run in. */
export function noRoom(count: number): string {
  return `Lo runs ${count} language servers at once at most, and they're all in use on screen.`;
}

export class ServerPool {
  readonly #options: PoolOptions;
  readonly #limits: PoolLimits;
  readonly #entries = new Map<string, Entry>();
  #views: readonly PoolView[] = [];
  #screen: string | undefined;
  #budget: ReturnType<typeof setInterval> | undefined;
  /** Every server stopping, with the checkout it ran on, until it has stopped. */
  readonly #stopping = new Set<Stopping>();
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
    return { state: stateOf(entry), ...version };
  }

  /**
   * `repo`'s server `adapter`, for a question about a file of the checkout `folder`: ready, or why
   * it isn't. Nothing when there's none, or it runs on another head.
   */
  find(repo: string, adapter: string, folder: string): Found | undefined {
    const entry = this.#entries.get(keyOf(repo, adapter));
    if (!entry || entry.phase === 'ending' || entry.root?.folder !== folder) return undefined;
    entry.used = Date.now();
    if (entry.phase === 'failed') return { kind: 'failed' };
    const { server } = entry;
    if (entry.phase === 'preparing' || entry.moving || !server) return { kind: 'starting' };
    switch (server.state.kind) {
      case 'ready':
      case 'indexing':
      case 'notAnswering':
        return { kind: 'ready', server };
      case 'starting':
      case 'stopping':
      case 'stopped':
        return { kind: 'starting' };
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
   * runs, and able to start again by itself after a crash once more.
   */
  async restart(repo: string, adapter: Adapter, root: Root): Promise<void> {
    if (!this.#allowed(repo, root)) return;
    const key = keyOf(repo, adapter.id);
    const before = this.#entries.get(key);
    if (before?.phase === 'ending') await before.ended;
    // Trust may have gone while it stopped.
    if (!this.#allowed(repo, root)) return;
    const entry = this.#entries.get(key);
    if (!entry) {
      this.#launch(this.#added(repo, adapter, root));
      return;
    }
    if (entry.phase === 'ending') return;
    entry.restarted = false;
    await this.#again(entry, root);
  }

  /**
   * Stops the servers of `repo` on the pull requests `stops` picks, by the pull request each runs
   * on (`undefined` for one with no checkout yet), as when trust goes, and resolves once they have.
   */
  async stopWhere(repo: string, stops: (pull: number | undefined) => boolean): Promise<void> {
    const ending = [...this.#entries.values()]
      .filter((entry) => entry.repo === repo && stops(entry.root?.pull))
      .map((entry) => this.#end(entry, 'trust in it went'));
    // And those still stopping on them, as one stopped for a restart elsewhere may be.
    const stopping = [...this.#stopping].filter((each) => each.repo === repo && stops(each.pull));
    await Promise.all([...ending, ...stopping.map((each) => each.done)]);
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
    const screen = views.find((view) => view.id === this.#screen);
    const root = screen?.root;
    if (screen?.trust === 'trusted' && root) {
      for (const adapter of screen.wants) {
        const entry = this.#entries.get(keyOf(screen.repo, adapter.id));
        if (!entry) {
          this.#launch(this.#added(screen.repo, adapter, root));
        } else if (entry.phase === 'failed' && entry.full) {
          // There was no room for it: there may be now.
          this.#launch(entry);
        } else if (entry.phase !== 'ending' && entry.root?.folder !== root.folder) {
          void this.#move(entry, root);
        }
      }
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
          () => void this.#end(entry, `its pull request wasn't on screen for a while`),
          this.#limits.idle,
        );
      }
    }
  }

  /** Whether `entry` runs, or is moving, on the pull request on screen. */
  #onScreen(entry: Entry): boolean {
    const screen = this.#views.find((view) => view.id === this.#screen);
    return (
      screen !== undefined &&
      entry.repo === screen.repo &&
      (entry.moving || entry.root?.pull === screen.pull)
    );
  }

  #added(repo: string, adapter: Adapter, root: Root): Entry {
    const entry: Entry = {
      key: keyOf(repo, adapter.id),
      repo,
      adapter,
      phase: 'preparing',
      server: undefined,
      stopListening: undefined,
      root,
      moving: false,
      progress: undefined,
      problem: undefined,
      full: false,
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
    const screen = this.#views.find((view) => view.id === this.#screen);
    return (
      screen?.trust === 'trusted' && screen.repo === repo && screen.root?.folder === root.folder
    );
  }

  /** Stops `entry`'s `server`, on `root`, kept among those stopping until it has. */
  #stopServer(entry: Entry, server: Running, root: Root | undefined): Promise<void> {
    const done = server.stop().catch((error: unknown) => {
      this.#options.log(`a language server's stop failed: ${describe(error)}`);
    });
    const stopping: Stopping = { repo: entry.repo, pull: root?.pull, done };
    this.#stopping.add(stopping);
    void done.finally(() => this.#stopping.delete(stopping));
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

  /** Starts `entry`'s server, on its root, once it has what it starts as and there's room. */
  #launch(entry: Entry): void {
    entry.run += 1;
    const { run } = entry;
    entry.phase = 'preparing';
    entry.problem = undefined;
    entry.full = false;
    entry.progress = undefined;
    this.#changed(entry);
    void this.#prepareAndStart(entry, run);
  }

  async #prepareAndStart(entry: Entry, run: number): Promise<void> {
    const { adapter } = entry;
    // Nothing is downloaded for what may not run.
    if (!this.#allowed(entry.repo, entry.root)) {
      void this.#end(entry, 'no trusted view on screen shows its head');
      return;
    }
    if (!(await this.#room(entry, run))) {
      if (this.#current(entry, run)) this.#refuse(entry, undefined);
      return;
    }
    let prepared: Prepared;
    try {
      prepared = await this.#options.prepare(
        adapter,
        (done, total) => {
          if (!this.#current(entry, run)) return;
          entry.progress = { done, total };
          this.#changed(entry);
        },
        entry.controller.signal,
      );
    } catch (error) {
      if (!this.#current(entry, run)) return;
      this.#options.log(`${adapter.name} for ${entry.repo}: ${describe(error)}`);
      this.#refuse(entry, {
        kind: 'failed',
        why: { kind: 'download', message: clip(describe(error)) },
      });
      return;
    }
    if (!this.#current(entry, run)) return;
    entry.progress = undefined;
    if (prepared.kind === 'missing') {
      const install = prepared.install === undefined ? {} : { install: prepared.install };
      this.#refuse(entry, { kind: 'missing', needs: prepared.needs, ...install });
      return;
    }
    const base = this.#options.base(entry.repo, adapter);
    if (!base) {
      this.#refuse(entry, {
        kind: 'failed',
        why: { kind: 'error', message: 'Code features need git.' },
      });
      return;
    }
    // Another may have started while this one got ready.
    if (!(await this.#room(entry, run))) {
      if (this.#current(entry, run)) this.#refuse(entry, undefined);
      return;
    }
    if (!this.#current(entry, run)) return;
    // Trust, or the view on screen, may have changed while it got ready.
    const root = entry.root;
    if (!this.#allowed(entry.repo, root)) {
      void this.#end(entry, 'no trusted view on screen shows its head');
      return;
    }
    const { launch } = prepared;
    let server: Running;
    try {
      server = this.#options.start({
        name: adapter.name,
        program: launch.program,
        args: launch.args,
        root: root.folder,
        home: base.home,
        // Lo's git first, before the toolchain's folders.
        path: [...base.path, ...(launch.path ?? [])],
        variables: launch.variables,
        allowed: launch.allowed,
        git: base.git,
        settings: launch.settings,
        initializationOptions: launch.initializationOptions,
      });
    } catch (error) {
      this.#refuse(entry, {
        kind: 'failed',
        why: { kind: 'error', message: clip(describe(error)) },
      });
      return;
    }
    entry.server = server;
    entry.version = launch.version;
    entry.phase = 'running';
    entry.stopListening = server.onState((state) => this.#heard(entry, server, state));
    this.#changed(entry);
  }

  /** Marks `entry` failed with `problem`, or, without one, for want of room. */
  #refuse(entry: Entry, problem: ServerState | undefined): void {
    entry.phase = 'failed';
    entry.full = problem === undefined;
    entry.problem = problem ?? {
      kind: 'failed',
      why: { kind: 'error', message: noRoom(this.#limits.count) },
    };
    entry.progress = undefined;
    this.#changed(entry);
  }

  /** A server's new state: a crash may start it again. */
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
      void this.#again(entry, entry.root);
      return;
    }
    this.#changed(entry);
  }

  /**
   * Stops `entry`'s server, if it runs, and starts it again on `root`, if it may run there once the
   * old one has stopped.
   */
  async #again(entry: Entry, root: Root | undefined): Promise<void> {
    const old = entry.server;
    const was = entry.root;
    entry.stopListening?.();
    entry.stopListening = undefined;
    entry.server = undefined;
    entry.moving = false;
    if (root) entry.root = root;
    entry.controller.abort();
    entry.controller = new AbortController();
    entry.run += 1;
    const { run } = entry;
    entry.phase = 'preparing';
    entry.problem = undefined;
    this.#changed(entry);
    // The server before, or the one an earlier restart is still stopping.
    const stopping = old ? this.#stopServer(entry, old, was) : entry.stopping;
    if (stopping) {
      entry.stopping = stopping;
      await stopping;
      if (entry.stopping === stopping) entry.stopping = undefined;
    }
    if (this.#current(entry, run)) this.#launch(entry);
  }

  /** Moves `entry`'s server to `root`, another head of its repository. */
  async #move(entry: Entry, root: Root): Promise<void> {
    const { server } = entry;
    if (entry.phase !== 'running' || !server) {
      // It starts there, once it's ready to; one that failed starts there on "Restart".
      if (entry.phase === 'preparing') entry.root = root;
      return;
    }
    const kind = server.state.kind;
    if (kind === 'failed' || kind === 'stopping' || kind === 'stopped') return;
    // Asked again just before the server is told, after whatever moving it waited for.
    const still = () =>
      entry.server === server && entry.phase === 'running' && this.#allowed(entry.repo, root);
    if (!still()) return;
    entry.moving = true;
    this.#changed(entry);
    const moved =
      kind === 'starting' ? false : await server.moveTo(root.folder, still).catch(() => false);
    if (entry.server !== server || entry.phase !== 'running') return;
    entry.moving = false;
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
   * Whether there's room for `entry` to run, once the server used longest ago off screen has
   * stopped if need be: those still stopping count until they have.
   */
  async #room(entry: Entry, run: number): Promise<boolean> {
    for (;;) {
      if (!this.#current(entry, run)) return false;
      // One starting again counts by its old server, until that has stopped.
      const others = this.#live().filter((each) => each !== entry && each.stopping === undefined);
      const { count } = this.#limits;
      if (others.length + this.#stopping.size < count) return true;
      if (others.length < count) {
        await Promise.race([...this.#stopping].map((each) => each.done));
        continue;
      }
      const victim = this.#leastUsedOffScreen(others);
      if (!victim) return false;
      await this.#end(victim, `Lo runs ${count} language servers at most`);
    }
  }

  /** The servers running or about to. */
  #live(): Entry[] {
    return [...this.#entries.values()].filter(
      (entry) =>
        entry.phase === 'preparing' ||
        (entry.phase === 'running' && entry.server?.state.kind !== 'failed'),
    );
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
      void this.#end(
        victim,
        `Lo's language servers held more than ${gigabytes(this.#limits.memory)}`,
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
  readonly pull: number | undefined;
  readonly done: Promise<void>;
}

function keyOf(repo: string, adapter: string): string {
  return `${repo}\n${adapter}`;
}

/** What the window is told of `entry`. */
function stateOf(entry: Entry): ServerState {
  if (entry.moving) return { kind: 'starting' };
  switch (entry.phase) {
    case 'preparing':
      return entry.progress
        ? { kind: 'downloading', done: entry.progress.done, total: entry.progress.total }
        : { kind: 'starting' };
    case 'failed':
      return entry.problem ?? { kind: 'failed', why: { kind: 'error', message: 'It stopped.' } };
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

function gigabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}
