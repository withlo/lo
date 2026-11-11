// The pull requests in the window's tabs, as main follows them: a PullTab for each tab of a pull
// request, made as the tab opens or comes back after a restart, shown as the tab is, and closed with
// it. Nothing here calls Electron.

import type { Repo } from '@lo/git';

import type { LocalGit } from '../../../main/git.ts';
import type { GithubEvent } from '../../accounts/service.ts';
import type { Tabs } from '../contract.ts';
import type { PullTabInfo } from '../service.ts';
import { PullTab, type Kept, type Snapshot, type TabGithub, type TabPublish } from './pull.ts';

/** What the watcher keeps with each tab, and reads back as it restores one. */
export interface TabStore {
  /** What was kept with a tab: its account and repository's name, if any. */
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
   * Follows the tabs as they are now: a PullTab for each new tab of a pull request, which starts
   * watching with the account it last acted as; the tab on screen shown, and the one before it
   * hidden; and those closed, closed.
   */
  follow({ tabs, active }: Tabs): void {
    if (this.#stopped) return;
    const open = new Set<string>();
    for (const tab of tabs) {
      if (tab.kind !== 'pull') continue;
      open.add(tab.id);
      if (this.#tabs.has(tab.id)) continue;
      const kept = this.#options.store.kept(tab.id);
      const pull = new PullTab({
        id: tab.id,
        link: { owner: tab.owner, repo: tab.repo, number: tab.number },
        login: kept.login,
        repository: kept.repository,
        github: this.#options.github,
        git: this.#options.git,
        publish: this.#options.publish,
        keep: (change) => this.#options.store.keep(tab.id, change),
        changed: () => this.#changed(tab.id),
        log: (line) => this.#options.log(`${tab.owner}/${tab.repo}#${tab.number}: ${line}`),
      });
      this.#tabs.set(tab.id, pull);
      void pull.watch();
    }
    for (const [id, pull] of this.#tabs) {
      if (open.has(id)) continue;
      pull.close();
      this.#tabs.delete(id);
      this.#changed(id);
    }
    if (active !== this.#active) {
      const before = this.#active === undefined ? undefined : this.#tabs.get(this.#active);
      before?.hide();
      this.#active = active;
      this.#tabs.get(active)?.show();
    }
  }

  /** What other features follow of a pull request's tab, or nothing for a tab that isn't one. */
  info(id: string): PullTabInfo | undefined {
    return this.#tabs.get(id)?.info();
  }

  /** A pull request's tab's local copy's clone, once it's opened. */
  clone(id: string): Promise<Repo> | undefined {
    return this.#tabs.get(id)?.clone();
  }

  /**
   * Calls `listener` with a pull request's tab's id each time what {@link Watcher.info} says of it
   * may have changed, and as it closes. Returns a function that stops it.
   */
  onChange(listener: (id: string) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** What a pull request's tab has now, or nothing for a tab that isn't one. */
  snapshot(id: string): Snapshot | undefined {
    return this.#tabs.get(id)?.snapshot();
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

  /** Whether `id` is a pull request's tab. */
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
