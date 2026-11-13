// The pull requests in the window's tabs, as main follows them: a PullTab for each view of a pull
// request's tab, one for each layer it has shown, made as the tab opens, comes back after a
// restart, or shows another layer, and one for the run of layers it shows as one diff, while it
// does; the view on screen shown, and the rest hidden; and all of them closed with their tab.
// Nothing here calls Electron.

import type { Repo } from '@lo/git';
import type { Poller, PullRef } from '@lo/github';

import type { LocalGit } from '../../../main/git.ts';
import type { GithubEvent } from '../../accounts/service.ts';
import {
  layerOf,
  layersOf,
  runViewId,
  topOf,
  viewId,
  type Run,
  type Tab,
  type Tabs,
} from '../contract.ts';
import type { PullTabInfo } from '../service.ts';
import { PullTab, type Kept, type Snapshot, type TabGithub, type TabPublish } from './pull.ts';

/**
 * What the watcher keeps with each tab, and reads back as it restores one, by the id of the view
 * it's kept from: a view's tab keeps what its views share.
 */
export interface TabStore {
  /** What was kept with a view's tab: its account and repository's name, if any. */
  kept(id: string): { login?: string | undefined; repository?: string | undefined };
  keep(id: string, kept: Kept): void;
}

export interface WatcherOptions {
  readonly github: TabGithub & {
    onEvent(listener: (event: GithubEvent) => void): () => void;
  };
  readonly git: LocalGit;
  readonly publish: TabPublish;
  readonly store: TabStore;
  readonly log: (line: string) => void;
  /** How long GitHub must be out of reach before a tab says so, if not the tab's own wait. */
  readonly offlineAfter?: number | undefined;
}

export class Watcher {
  readonly #options: WatcherOptions;
  readonly #tabs = new Map<string, PullTab>();
  #active: string | undefined;
  readonly #stop: (() => void)[] = [];
  readonly #listeners = new Set<(id: string) => void>();
  #stopped = false;

  constructor(options: WatcherOptions) {
    this.#options = options;
    const { github, git } = options;
    this.#stop.push(
      github.onEvent((event) => {
        if (event.kind !== 'removed') return;
        for (const tab of this.#tabs.values()) tab.accountGone(event.login);
      }),
      git.onCache(() => this.#gitChanged()),
    );
    git.onStatus(() => this.#gitChanged());
  }

  /**
   * Follows the tabs as they are now: a PullTab for each new view of a pull request's tab, which
   * starts watching with the account its tab last acted as, a run of layers' of its top layer, from
   * the run's start; the view on screen shown, and the one before it hidden; and the views of tabs
   * closed, and of runs left, closed.
   */
  follow({ tabs, active }: Tabs): void {
    if (this.#stopped) return;
    const open = new Set<string>();
    let onScreen: string | undefined;
    for (const tab of tabs) {
      if (tab.kind !== 'pull') {
        if (tab.id === active) onScreen = tab.id;
        continue;
      }
      for (const layer of layersOf(tab)) {
        const id = viewId(tab, layer);
        open.add(id);
        if (!this.#tabs.has(id)) this.#make(tab, id, layer);
      }
      const { run } = tab;
      const runView = run && runViewId(tab, run.layers);
      if (run && runView !== undefined) {
        open.add(runView);
        const made = this.#tabs.get(runView);
        // The same run, chosen again from a start worked out since.
        if (made) made.compareFrom(run.start);
        else this.#make(tab, runView, topOf(run), run);
      }
      if (tab.id === active) onScreen = runView ?? viewId(tab, layerOf(tab));
    }
    for (const [id, pull] of this.#tabs) {
      if (open.has(id)) continue;
      pull.close();
      this.#tabs.delete(id);
      this.#changed(id);
    }
    if (onScreen !== this.#active) {
      const before = this.#active === undefined ? undefined : this.#tabs.get(this.#active);
      before?.hide();
      this.#active = onScreen;
      if (onScreen !== undefined) this.#tabs.get(onScreen)?.show();
    }
  }

  /**
   * Makes `tab`'s view `id` of `layer`, which starts watching it: for a run of layers, its top layer,
   * compared with the run's start.
   */
  #make(tab: Extract<Tab, { kind: 'pull' }>, id: string, layer: number, run?: Run): void {
    const kept = this.#options.store.kept(id);
    const name = `${tab.owner}/${tab.repo}#${layer}`;
    const pull = new PullTab({
      id,
      link: { owner: tab.owner, repo: tab.repo, number: layer },
      login: kept.login,
      repository: kept.repository,
      github: this.#options.github,
      git: this.#options.git,
      publish: this.#options.publish,
      keep: (change) => this.#options.store.keep(id, change),
      changed: () => this.#changed(id),
      sharing: (ref, poller) => this.#sharing(id, ref, poller),
      log: (line) => this.#options.log(`${name}: ${line}`),
      offlineAfter: this.#options.offlineAfter,
      run: run && { layers: run.layers, start: run.start },
    });
    this.#tabs.set(id, pull);
    void pull.watch();
  }

  /**
   * Whether views besides `id` watch `pull` with `poller`, as a layer of one tab and a pull request
   * another tab opened on can, and whether one of them is on screen.
   */
  #sharing(id: string, pull: PullRef, poller: Poller): { watched: boolean; shown: boolean } {
    let watched = false;
    let shown = false;
    for (const [other, view] of this.#tabs) {
      if (other === id || !view.watches(pull, poller)) continue;
      watched = true;
      if (other === this.#active) shown = true;
    }
    return { watched, shown };
  }

  /** What other features follow of a view of a pull request's tab, or nothing for no such view. */
  info(id: string): PullTabInfo | undefined {
    return this.#tabs.get(id)?.info();
  }

  /** A view's local copy's clone, once it's opened. */
  clone(id: string): Promise<Repo> | undefined {
    return this.#tabs.get(id)?.clone();
  }

  /**
   * Calls `listener` with a view's id each time what {@link Watcher.info} says of it may have
   * changed, and as it closes. Returns a function that stops it.
   */
  onChange(listener: (id: string) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** What a view of a pull request's tab has now, or nothing for no such view. */
  snapshot(id: string): Snapshot | undefined {
    return this.#tabs.get(id)?.snapshot();
  }

  /** A view's diff is drawn at `head`, which stays on screen if it's there now. */
  drawn(id: string, head: string): void {
    this.#tabs.get(id)?.drawn(head);
  }

  /**
   * Compares view `id` with `commit`, a stack's layer's start, or with its base branch. A run of
   * layers starts where its tab says.
   */
  compareFrom(id: string, commit: string | undefined): void {
    const pull = this.#tabs.get(id);
    if (pull?.info().run === undefined) pull?.compareFrom(commit);
  }

  reload(id: string): void {
    this.#tabs.get(id)?.reload();
  }

  retry(id: string): void {
    this.#tabs.get(id)?.retry();
  }

  async choose(id: string, login: string): Promise<void> {
    await this.#tabs.get(id)?.choose(login);
  }

  /** Whether `id` is a view of a pull request's tab. */
  has(id: string): boolean {
    return this.#tabs.has(id);
  }

  /** Stops every tab, as Lo quits. */
  stop(): void {
    this.#stopped = true;
    this.#listeners.clear();
    for (const stop of this.#stop.splice(0)) stop();
    for (const pull of this.#tabs.values()) pull.close();
    this.#tabs.clear();
  }

  #changed(id: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(id);
      } catch (error) {
        this.#options.log(
          `a listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  #gitChanged(): void {
    if (this.#stopped) return;
    for (const pull of this.#tabs.values()) pull.gitChanged();
  }
}
