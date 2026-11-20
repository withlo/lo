// The merge queues' tabs in main. Each open one has a watch, which reads its branch's queue as the
// tab's account while the tab is on screen. A queue opens as the account its pull request's tab
// acts as, and each pull request it lists opens as the queue's account. While an account is signed
// out, or Lo doesn't have it, its queues aren't read; they're read again as soon as Lo's accounts
// say it's signed in, whatever its poller saw. Nothing here calls Electron or reads GitHub itself.

import { IpcError } from '../../../ipc/contract.ts';
import type { AccountState, GithubEvent } from '../../accounts/service.ts';
import type { QueueTab, Tabs } from '../../tab/contract.ts';
import type { PullTabInfo, TabService } from '../../tab/service.ts';
import type { QueueState } from '../contract.ts';
import { QueueWatch, type Heard, type QueueSource } from './watch.ts';

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
    /** Lo's accounts, and which are signed out. */
    accounts(): Promise<readonly Pick<AccountState, 'account' | 'signedOut'>[]>;
    onEvent(listener: (event: GithubEvent) => void): () => void;
    /** Hears each change to the accounts: one added, removed, signed out or signed in again. */
    onChange(listener: () => void): () => void;
  };
  /** What the merge queue's tab `tab` reads from. */
  readonly sourceFor: (tab: QueueTab) => TabSource;
  /** Tells the window a tab's state, each time it changes. */
  readonly publish: (state: QueueState) => void;
  /** Hears each read of the branch tab `id` shows that answered. */
  readonly heard?: (id: string, read: Heard) => void;
  /**
   * Tab `id` closed, shows another branch, or its account went: what was asked of its queue no
   * longer stands.
   */
  readonly moved?: (id: string) => void;
}

/** `login` as accounts are told apart, whatever its case. */
function keyOf(login: string): string {
  return login.toLowerCase();
}

/** Why a signed-out account's queues aren't read. */
function signedOutWhy(login: string): string {
  return `${login} is signed out. Lo reads the queue again once you sign in to it.`;
}

/** Why the queues of an account Lo doesn't have aren't read. */
function goneWhy(login: string): string {
  return `Lo isn’t signed in to ${login}, and reads the queue again once you sign in to it.`;
}

/** The merge queues' tabs, and what's read of each. */
export class Queues {
  readonly #options: QueuesOptions;
  /** Each merge queue's tab, by its id, while it's open: its watch, and what it reads from. */
  readonly #followed = new Map<string, { watch: QueueWatch; source: TabSource }>();
  /** Why the queues of each account that's away aren't read, by {@link keyOf}. */
  readonly #away = new Map<string, string>();
  /**
   * Bumped as an account is signed out or removed, so a check of the accounts begun before then
   * is dropped.
   */
  #heardAway = 0;
  readonly #stops: (() => void)[] = [];
  #stopped = false;

  constructor(options: QueuesOptions) {
    this.#options = options;
  }

  /** Follows the tabs and the accounts from now on. */
  start(): void {
    const { tabs, github } = this.#options;
    this.#stops.push(
      tabs.onTabs((value) => this.#follow(value)),
      github.onEvent((event) => this.#heard(event)),
      github.onChange(() => void this.#check()),
    );
    this.#follow(tabs.list());
    void this.#check();
  }

  /** Lo quits: nothing more is read. */
  stop(): void {
    this.#stopped = true;
    for (const stop of this.#stops.splice(0)) stop();
    this.#away.clear();
    for (const { watch } of this.#followed.values()) watch.stop();
    this.#followed.clear();
  }

  /** What the merge queue's tab `id` shows now, while it's open. */
  state(id: string): QueueState | undefined {
    return this.#followed.get(id)?.watch.state();
  }

  /** The merge queue's tab `id`, while it's open, and what reads its queue. */
  found(id: string): { tab: QueueTab; watch: QueueWatch } | undefined {
    const tab = this.#queueTab(id);
    const followed = this.#followed.get(id);
    return tab && followed && { tab, watch: followed.watch };
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
        if (followed.watch.branch !== tab.branch) this.#options.moved?.(tab.id);
        followed.watch.setBranch(tab.branch);
        continue;
      }
      const source = this.#options.sourceFor(tab);
      const { id } = tab;
      const watch = new QueueWatch({
        id,
        login: tab.login,
        branch: tab.branch,
        source,
        publish: this.#options.publish,
        heard: (read) => this.#options.heard?.(id, read),
      });
      const why = this.#away.get(keyOf(tab.login));
      if (why !== undefined) watch.hold(why);
      this.#followed.set(tab.id, { watch, source });
    }
    for (const [id, { watch }] of this.#followed) {
      if (!open.has(id)) {
        watch.stop();
        this.#followed.delete(id);
        this.#options.moved?.(id);
      } else if (id === value.active) watch.show();
      else watch.hide();
    }
  }

  /** An account was signed out or removed: its queues stop being read at once. */
  #heard(event: GithubEvent): void {
    if (event.kind !== 'signedOut' && event.kind !== 'removed') return;
    this.#heardAway += 1;
    const key = keyOf(event.login);
    if (event.kind === 'removed') {
      for (const { source } of this.#of(key)) source.forget();
      this.#hold(key, goneWhy(event.login));
    } else {
      this.#hold(key, signedOutWhy(event.login));
    }
  }

  /**
   * Checks Lo's accounts: the queues of one signed out, or of one Lo doesn't have, aren't read,
   * and those of one signed in again are, at once.
   */
  async #check(): Promise<void> {
    const heard = this.#heardAway;
    let accounts: readonly Pick<AccountState, 'account' | 'signedOut'>[];
    try {
      accounts = await this.#options.github.accounts();
    } catch {
      // Lo couldn't read its accounts, which it logs: the next change checks again.
      return;
    }
    // One was signed out or removed meanwhile, and the change that follows checks again.
    if (this.#stopped || heard !== this.#heardAway) return;
    const byKey = new Map(accounts.map((state) => [keyOf(state.account.login), state]));
    for (const { account, signedOut } of accounts) {
      if (signedOut !== undefined) this.#hold(keyOf(account.login), signedOutWhy(account.login));
    }
    for (const key of this.#away.keys()) {
      const state = byKey.get(key);
      if (state !== undefined && state.signedOut === undefined) this.#back(key);
    }
    for (const { watch } of this.#followed.values()) {
      const key = keyOf(watch.login);
      if (!byKey.has(key) && !this.#away.has(key)) this.#hold(key, goneWhy(watch.login));
    }
  }

  /** The tabs that read as account `key`. */
  *#of(key: string): Iterable<{ watch: QueueWatch; source: TabSource }> {
    for (const followed of this.#followed.values()) {
      if (keyOf(followed.watch.login) === key) yield followed;
    }
  }

  /** Account `key` is away for `why`: its queues aren't read, and say why. */
  #hold(key: string, why: string): void {
    if (this.#away.get(key) === why) return;
    this.#away.set(key, why);
    for (const { watch } of this.#of(key)) watch.hold(why);
    for (const [id, { watch }] of this.#followed) {
      if (keyOf(watch.login) === key) this.#options.moved?.(id);
    }
  }

  /** Account `key` is back: its queues are read again. */
  #back(key: string): void {
    if (!this.#away.delete(key)) return;
    for (const { watch } of this.#of(key)) watch.release();
  }
}
