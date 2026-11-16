// The merge queues' tabs in main. Each open one has a watch, which reads its branch's queue as the
// tab's account while the tab is on screen. A queue opens as the account its pull request's tab
// acts as, and each pull request it lists opens as the queue's account. While an account is signed
// out, or once it's removed, its queues aren't read: a signed-out one's are read again once its
// poller is signed in again, and a removed one's once a pull request's tab acting as it opens the
// queue again. Nothing here calls Electron or reads GitHub itself.

import { IpcError } from '../../../ipc/contract.ts';
import type { GithubEvent } from '../../accounts/service.ts';
import type { QueueTab, Tabs } from '../../tab/contract.ts';
import type { PullTabInfo, TabService } from '../../tab/service.ts';
import type { QueueState } from '../contract.ts';
import { QueueWatch, type QueueSource } from './watch.ts';

/** What a merge queue's tab reads from, which can drop what it kept of its account. */
export interface TabSource extends QueueSource {
  /** The account was removed: what was kept of its poller goes. */
  forget(): void;
}

export interface QueuesOptions {
  readonly tabs: Pick<TabService, 'list' | 'open' | 'onTabs'> & {
    pull(id: string): Pick<PullTabInfo, 'repository' | 'acting'> | undefined;
  };
  readonly github: {
    onEvent(listener: (event: GithubEvent) => void): () => void;
    /** The account's poller, for whether it's signed out, and when that changes. */
    poller(login: string): Promise<{
      status(): { readonly signedOut: boolean };
      onChange(listener: () => void): () => void;
    }>;
  };
  /** What the merge queue's tab `tab` reads from. */
  readonly sourceFor: (tab: QueueTab) => TabSource;
  /** Tells the window a tab's state, each time it changes. */
  readonly publish: (state: QueueState) => void;
}

/** Why an account's queues aren't read: it's signed out, or it was removed. */
interface Away {
  readonly kind: 'signedOut' | 'removed';
  /** What the tab says. */
  readonly why: string;
  /** Stops waiting for it to come back. */
  readonly stop: () => void;
}

/** `login` as accounts are told apart, whatever its case. */
function keyOf(login: string): string {
  return login.toLowerCase();
}

/** The merge queues' tabs, and what's read of each. */
export class Queues {
  readonly #options: QueuesOptions;
  /** Each merge queue's tab, by its id, while it's open: its watch, and what it reads from. */
  readonly #followed = new Map<string, { watch: QueueWatch; source: TabSource }>();
  /** The accounts whose queues aren't read, by {@link keyOf}. */
  readonly #away = new Map<string, Away>();
  readonly #stops: (() => void)[] = [];

  constructor(options: QueuesOptions) {
    this.#options = options;
  }

  /** Follows the tabs and the accounts from now on. */
  start(): void {
    const { tabs, github } = this.#options;
    this.#stops.push(
      tabs.onTabs((value) => this.#follow(value)),
      github.onEvent((event) => this.#heard(event)),
    );
    this.#follow(tabs.list());
  }

  /** Lo quits: nothing more is read. */
  stop(): void {
    for (const stop of this.#stops.splice(0)) stop();
    for (const away of this.#away.values()) away.stop();
    this.#away.clear();
    for (const { watch } of this.#followed.values()) watch.stop();
    this.#followed.clear();
  }

  /** What the merge queue's tab `id` shows now, while it's open. */
  state(id: string): QueueState | undefined {
    return this.#followed.get(id)?.watch.state();
  }

  /**
   * Shows `branch`'s merge queue: in the merge queue's tab `id`, as its account, or from the pull
   * request's tab `id`, as the account it acts as. Returns the id of the tab that shows it.
   */
  show(id: string, branch: string): string {
    const { tabs } = this.#options;
    const shown = this.#queueTab(id);
    if (shown) {
      const { owner, repo, login } = shown;
      return tabs.open({ kind: 'queue', owner, repo, branch, login });
    }
    const pull = tabs.pull(id);
    if (!pull) throw new IpcError('missing', "There's no pull request's tab with that id.");
    const { acting, repository } = pull;
    if (acting === undefined) {
      throw new IpcError('unavailable', 'Lo is still working out which account this tab uses.');
    }
    if (acting.kind !== 'account') {
      throw new IpcError(
        'refused',
        'Lo reads a merge queue as a signed-in account. This tab reads without signing in.',
      );
    }
    // A pull request's tab acts only as an account Lo has: one removed is back.
    const key = keyOf(acting.login);
    if (this.#away.get(key)?.kind === 'removed') this.#back(key);
    return tabs.open({
      kind: 'queue',
      owner: repository.owner,
      repo: repository.name,
      branch,
      login: acting.login,
    });
  }

  /** Opens pull request `number` of the merge queue's tab `id` in a tab, as the queue's account. */
  open(id: string, number: number): string {
    const shown = this.#queueTab(id);
    if (!shown) throw new IpcError('missing', "There's no merge queue's tab with that id.");
    const { owner, repo, login } = shown;
    return this.#options.tabs.open({ kind: 'pull', owner, repo, number }, { login });
  }

  /** The merge queue's tab `id`, if it's open. */
  #queueTab(id: string): QueueTab | undefined {
    const found = this.#options.tabs.list().tabs.find((tab) => tab.id === id);
    return found?.kind === 'queue' ? found : undefined;
  }

  /**
   * Keeps a watch for each merge queue's tab in `value`, at the branch it shows, reading only the
   * one on screen, and drops those of tabs that closed.
   */
  #follow(value: Tabs): void {
    const open = new Set<string>();
    for (const tab of value.tabs) {
      if (tab.kind !== 'queue') continue;
      open.add(tab.id);
      const followed = this.#followed.get(tab.id);
      if (followed) {
        followed.watch.setBranch(tab.branch);
        continue;
      }
      const source = this.#options.sourceFor(tab);
      const watch = new QueueWatch({
        id: tab.id,
        login: tab.login,
        branch: tab.branch,
        source,
        publish: this.#options.publish,
      });
      const away = this.#away.get(keyOf(tab.login));
      if (away) watch.hold(away.why);
      this.#followed.set(tab.id, { watch, source });
    }
    for (const [id, { watch }] of this.#followed) {
      if (!open.has(id)) {
        watch.stop();
        this.#followed.delete(id);
      } else if (id === value.active) watch.show();
      else watch.hide();
    }
  }

  #heard(event: GithubEvent): void {
    if (event.kind === 'signedOut') this.#signedOut(event.login);
    else if (event.kind === 'removed') this.#removed(event.login);
  }

  /** The tabs that read as account `key`. */
  *#of(key: string): Iterable<{ watch: QueueWatch; source: TabSource }> {
    for (const followed of this.#followed.values()) {
      if (keyOf(followed.watch.login) === key) yield followed;
    }
  }

  /**
   * `login` is signed out: its queues aren't read until its poller, having said it's signed out,
   * says it's signed in again.
   */
  #signedOut(login: string): void {
    const key = keyOf(login);
    if (this.#away.has(key)) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    this.#hold(key, {
      kind: 'signedOut',
      why: `${login} is signed out. Lo reads the queue again once you sign in to it.`,
      stop: () => {
        stopped = true;
        unsubscribe?.();
      },
    });
    this.#options.github.poller(login).then(
      (poller) => {
        if (stopped) return;
        let saidOut = poller.status().signedOut;
        unsubscribe = poller.onChange(() => {
          if (poller.status().signedOut) saidOut = true;
          else if (saidOut) this.#back(key);
        });
      },
      // Lo has no such account any more, which `removed` says.
      () => undefined,
    );
  }

  /** `login` was removed: what was kept of its poller goes, and its queues aren't read. */
  #removed(login: string): void {
    const key = keyOf(login);
    for (const { source } of this.#of(key)) source.forget();
    this.#hold(key, {
      kind: 'removed',
      why: `You signed out of ${login}. Open the queue again from a pull request’s tab.`,
      stop: () => undefined,
    });
  }

  #hold(key: string, away: Away): void {
    this.#away.get(key)?.stop();
    this.#away.set(key, away);
    for (const { watch } of this.#of(key)) watch.hold(away.why);
  }

  /** Account `key` is back: its queues are read again. */
  #back(key: string): void {
    const away = this.#away.get(key);
    if (!away) return;
    away.stop();
    this.#away.delete(key);
    for (const { watch } of this.#of(key)) watch.release();
  }
}
