// The syntax index for each view of a pull request's tab: the new side's tree first, then the old
// side's, each built once however many views show it, one at a time, and the view on screen's
// first. A view says how far its index has got, counting its trees' blobs once each, and the
// window hears each time that changes. A build that fails is tried again after 5 s, doubling to
// 5 minutes, while a view still shows its tree; one left partial for want of the network is built
// again once the view is back online. A tree with more files than git lists for Lo is left
// partial, unread. Nothing here calls Electron.

import { GitError, type Oid, type Repo, type TreeEntry } from '@lo/git';

import { IpcError } from '../../../ipc/contract.ts';
import type { IndexState } from '../contract.ts';
import {
  buildTree,
  type Built,
  type ReadSymbols,
  type TreeProgress,
  type TreeRepo,
  type TreeStore,
} from './build.ts';
import { changedPaths } from './select.ts';

/** What the index and its answers read of a view's local copy. */
export type CodeRepo = TreeRepo &
  Pick<Repo, 'fileVersion' | 'fileVersions' | 'readBlob' | 'downloadFiles'>;

/** A view, as the index follows it. */
export type ViewInput =
  | { readonly kind: 'noGit' }
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'ready';
      /** The view's local copy, opened. */
      readonly clone: () => Promise<CodeRepo> | undefined;
      /** The commits its two sides show: the new side's, and the old side's if it has one. */
      readonly new: Oid;
      readonly old: Oid | undefined;
      /** Whether the local copy was read offline, the last time it was fetched. */
      readonly offline: boolean;
    };

export interface IndexStore extends TreeStore {
  trim(open: readonly string[]): Promise<unknown>;
  clear(): Promise<void>;
}

export interface IndexOptions {
  readonly store: IndexStore;
  readonly read: ReadSymbols;
  /** Tells the window where a view's index stands, each time that changes. */
  readonly publish: (view: string, state: IndexState) => void;
  /** The view on screen, whose trees are built first. */
  readonly onScreen?: (() => string | undefined) | undefined;
  readonly log: (line: string) => void;
  readonly retryFirst?: number;
}

/** A side of a view, as its answers need it. */
export interface Side {
  readonly commit: Oid;
  /** The tree's ID, which the store keeps its files by, once it's known. */
  readonly tree: string | undefined;
}

/** A view's trees, as its answers need them. */
export interface ViewSides {
  readonly clone: () => Promise<CodeRepo> | undefined;
  readonly new: Side;
  readonly old: Side | undefined;
}

export const RETRY_FIRST = 5_000;
export const RETRY_MAX = 5 * 60_000;

interface TreeBuild {
  readonly commit: Oid;
  /** The views that show it. */
  readonly views: Set<string>;
  state: 'queued' | 'running' | 'built' | 'failed';
  progress: TreeProgress;
  tree: string | undefined;
  built: Built | undefined;
  failure: string | undefined;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | undefined;
  /** When it's built again after it failed, by itself. */
  retryAt: number | undefined;
  controller: AbortController;
}

interface Followed {
  input: ViewInput;
  sent: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The files of `commit`, or `undefined` when it has more than git lists for Lo. */
async function listed(repo: CodeRepo, commit: Oid): Promise<TreeEntry[] | undefined> {
  try {
    return await repo.tree(commit);
  } catch (error) {
    if (error instanceof GitError && error.detail.kind === 'tooLarge') return undefined;
    throw error;
  }
}

export class CodeIndex {
  readonly #options: IndexOptions;
  readonly #views = new Map<string, Followed>();
  readonly #builds = new Map<Oid, TreeBuild>();
  readonly #queue: Oid[] = [];
  #running = false;
  #stopped = false;
  /** How many clears are under way, which no build starts during. */
  #clearing = 0;
  #version: Promise<string> | undefined;

  constructor(options: IndexOptions) {
    this.#options = options;
  }

  /** The version readings are stamped with now, which the first job tells. */
  version(): Promise<string> {
    this.#version ??= this.#options.read([]).then(
      (reply) => reply.version,
      (error: unknown) => {
        this.#version = undefined;
        throw error;
      },
    );
    return this.#version;
  }

  /** Follows view `id` as it is now, or lets it go once it's closed (`undefined`). */
  follow(id: string, input: ViewInput | undefined): void {
    if (this.#stopped) return;
    const before = this.#views.get(id);
    const was = before?.input;
    const commits = (view: ViewInput | undefined) =>
      view?.kind === 'ready' ? [view.new, ...(view.old ? [view.old] : [])] : [];
    const had = commits(was);
    const has = commits(input);
    if (!input) this.#views.delete(id);
    else if (before) before.input = input;
    else this.#views.set(id, { input, sent: '' });
    for (const commit of had) if (!has.includes(commit)) this.#release(commit, id);
    for (const commit of has) this.#hold(commit, id);
    // Back online: what was left for want of the network is built again.
    if (input?.kind === 'ready' && !input.offline && was?.kind === 'ready' && was.offline) {
      for (const commit of has) {
        const build = this.#builds.get(commit);
        if (build?.built?.partial.includes('offline')) this.#requeue(build);
      }
    }
    if (input) this.#publish(id);
    this.#pump();
  }

  /** Where view `id`'s index stands, if it's followed. */
  state(id: string): IndexState | undefined {
    const view = this.#views.get(id);
    return view && this.#stateOf(view.input);
  }

  /** View `id`'s sides, once its local copy is ready. */
  sides(id: string): ViewSides | undefined {
    const input = this.#views.get(id)?.input;
    if (input?.kind !== 'ready') return undefined;
    const side = (commit: Oid): Side => ({ commit, tree: this.#builds.get(commit)?.tree });
    return {
      clone: input.clone,
      new: side(input.new),
      old: input.old === undefined ? undefined : side(input.old),
    };
  }

  /**
   * Lets go of everything read, as clearing the cache does, and builds what's shown again. Its
   * views say they're building from the start, while the store is let go of.
   */
  async clear(): Promise<void> {
    this.#clearing += 1;
    try {
      for (const build of this.#builds.values()) {
        build.controller.abort();
        clearTimeout(build.retry);
        this.#requeue(build);
      }
      await this.#options.store.clear();
    } finally {
      this.#clearing -= 1;
      this.#pump();
    }
  }

  stop(): void {
    this.#stopped = true;
    for (const build of this.#builds.values()) {
      build.controller.abort();
      clearTimeout(build.retry);
    }
    this.#builds.clear();
    this.#queue.length = 0;
  }

  #hold(commit: Oid, view: string): void {
    const build = this.#builds.get(commit);
    if (build) {
      build.views.add(view);
      return;
    }
    this.#builds.set(commit, this.#fresh(commit, new Set([view])));
    this.#queue.push(commit);
  }

  #fresh(commit: Oid, views: Set<string>): TreeBuild {
    return {
      commit,
      views,
      state: 'queued',
      progress: { all: new Set(), done: new Set() },
      tree: undefined,
      built: undefined,
      failure: undefined,
      attempt: 0,
      retry: undefined,
      retryAt: undefined,
      controller: new AbortController(),
    };
  }

  #release(commit: Oid, view: string): void {
    const build = this.#builds.get(commit);
    if (!build) return;
    build.views.delete(view);
    if (build.views.size > 0) return;
    build.controller.abort();
    clearTimeout(build.retry);
    this.#builds.delete(commit);
    const at = this.#queue.indexOf(commit);
    if (at >= 0) this.#queue.splice(at, 1);
  }

  /** Builds `build`'s tree again from the start, once its turn comes. */
  #requeue(build: TreeBuild): void {
    if (this.#builds.get(build.commit) !== build) return;
    const again = this.#fresh(build.commit, build.views);
    again.tree = build.tree;
    this.#builds.set(build.commit, again);
    if (!this.#queue.includes(build.commit)) this.#queue.push(build.commit);
    for (const view of again.views) this.#publish(view);
    this.#pump();
  }

  /** The next tree to build: the view on screen's first, then the order they came in. */
  #next(): TreeBuild | undefined {
    const screen = this.#options.onScreen?.();
    const view = screen === undefined ? undefined : this.#views.get(screen)?.input;
    const first =
      view?.kind === 'ready'
        ? [view.new, view.old].find((commit) => commit && this.#queue.includes(commit))
        : undefined;
    const commit = first ?? this.#queue[0];
    if (commit === undefined) return undefined;
    this.#queue.splice(this.#queue.indexOf(commit), 1);
    return this.#builds.get(commit);
  }

  #pump(): void {
    if (this.#running || this.#stopped || this.#clearing > 0) return;
    const build = this.#next();
    if (!build) return;
    this.#running = true;
    void this.#build(build).finally(() => {
      this.#running = false;
      this.#pump();
    });
  }

  /** The view and the other side a tree is built for: its first view's. */
  #shownBy(build: TreeBuild): (ViewInput & { kind: 'ready' }) | undefined {
    for (const id of build.views) {
      const input = this.#views.get(id)?.input;
      if (input?.kind === 'ready') return input;
    }
    return undefined;
  }

  async #build(build: TreeBuild): Promise<void> {
    const view = this.#shownBy(build);
    if (!view || build.controller.signal.aborted) return;
    build.state = 'running';
    this.#publishViews(build);
    const { signal } = build.controller;
    try {
      const repo = await view.clone();
      if (!repo) throw new Error('The pull request’s local copy isn’t open.');
      const tree = await repo.treeId(build.commit);
      build.tree = tree;
      const entries = await listed(repo, build.commit);
      const other = view.new === build.commit ? view.old : view.new;
      const theirs = entries && other !== undefined ? await listed(repo, other) : undefined;
      const built: Built = entries
        ? await buildTree({
            repo,
            commit: build.commit,
            entries,
            // Without the other side's listing, nothing is known to have changed.
            changed: other === undefined || theirs ? await changedPaths(entries, theirs) : [],
            store: this.#options.store,
            read: this.#options.read,
            version: await this.version(),
            progress: build.progress,
            moved: () => this.#publishViews(build),
            signal,
          })
        : { tree, total: 0, files: 0, indexed: 0, partial: ['listing'] };
      if (signal.aborted) return;
      build.built = built;
      build.state = 'built';
      build.attempt = 0;
      await this.#trim();
    } catch (error) {
      if (signal.aborted || (error instanceof IpcError && error.code === 'cancelled')) return;
      build.state = 'failed';
      build.failure = describe(error);
      this.#options.log(`indexing ${build.commit}: ${build.failure}`);
      const wait = Math.min(
        (this.#options.retryFirst ?? RETRY_FIRST) * 2 ** build.attempt,
        RETRY_MAX,
      );
      build.attempt += 1;
      build.retryAt = Date.now() + wait;
      build.retry = setTimeout(() => this.#again(build), wait);
    } finally {
      if (this.#builds.get(build.commit) === build) this.#publishViews(build);
    }
  }

  /** Builds `build`, which failed, again once its turn comes. */
  #again(build: TreeBuild): void {
    if (this.#builds.get(build.commit) !== build || build.state !== 'failed') return;
    clearTimeout(build.retry);
    build.retry = undefined;
    build.retryAt = undefined;
    build.state = 'queued';
    build.controller = new AbortController();
    if (!this.#queue.includes(build.commit)) this.#queue.push(build.commit);
    this.#publishViews(build);
    this.#pump();
  }

  /** Builds view `id`'s trees that failed again now, as "Try now" asks, not once their wait ends. */
  retryNow(id: string): void {
    const input = this.#views.get(id)?.input;
    if (input?.kind !== 'ready') return;
    for (const commit of [input.new, input.old]) {
      const build = commit === undefined ? undefined : this.#builds.get(commit);
      if (build) this.#again(build);
    }
  }

  /** Keeps the store under its cap, holding on to what an open view's trees hold. */
  async #trim(): Promise<void> {
    const open = [...this.#builds.values()].flatMap((build) => (build.tree ? [build.tree] : []));
    try {
      await this.#options.store.trim(open);
    } catch (error) {
      this.#options.log(`keeping the index under its cap: ${describe(error)}`);
    }
  }

  #publishViews(build: TreeBuild): void {
    for (const view of build.views) this.#publish(view);
  }

  #publish(id: string): void {
    const view = this.#views.get(id);
    if (!view) return;
    const state = this.#stateOf(view.input);
    const sent = JSON.stringify(state);
    if (sent === view.sent) return;
    view.sent = sent;
    this.#options.publish(id, state);
  }

  #stateOf(input: ViewInput): IndexState {
    switch (input.kind) {
      case 'noGit':
        return { kind: 'noGit' };
      case 'waiting':
        return { kind: 'waiting' };
      case 'ready':
        break;
      default:
        input satisfies never;
        return { kind: 'waiting' };
    }
    const builds = [input.new, input.old].flatMap((commit) => {
      const build = commit === undefined ? undefined : this.#builds.get(commit);
      return build ? [build] : [];
    });
    const all = new Set<string>();
    const done = new Set<string>();
    for (const build of builds) {
      for (const key of build.progress.all) all.add(key);
      for (const key of build.progress.done) done.add(key);
    }
    const failed = builds.find((build) => build.state === 'failed');
    if (builds.some((build) => build.state === 'queued' || build.state === 'running')) {
      return { kind: 'building', done: done.size, total: all.size };
    }
    if (failed) {
      return { kind: 'failed', message: failed.failure ?? '', retryAt: failed.retryAt ?? null };
    }
    const why = [...new Set(builds.flatMap((build) => build.built?.partial ?? []))];
    if (why.length === 0 && done.size === all.size) return { kind: 'ready', partial: null };
    const more = builds.reduce(
      (sum, build) => sum + (build.built ? build.built.total - build.built.files : 0),
      0,
    );
    return {
      kind: 'ready',
      partial: { indexed: done.size, total: all.size + more, why: why.toSorted() },
    };
  }
}
