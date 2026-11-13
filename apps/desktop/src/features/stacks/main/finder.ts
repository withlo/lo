// The stacks pull requests' tabs show, as main follows them: for each repository a tab is in, the
// stacks among its open pull requests, worked out again when its account's poller lists them anew,
// reads its rulesets, or reads the merged pull requests below layers GitHub moved; each tab's stack
// in it; and the state of the layers of the stack on screen, and which of them have an overview,
// which only its tab reads. Nothing here calls Electron.

import {
  openPullRequest,
  overviewRefNumbers,
  STACK_LAYERS,
  type Cached,
  type OpenPullRequestList,
  type OverviewRefNumbers,
  type Poller,
  type PullRef,
  type ReadKind,
  type RepoRef,
  type StackLayerList,
  type TrunkRuleList,
} from '@lo/github';
import { stacksOf, type Stacks } from '@lo/stacks';

import type { PullState } from '../../tab/contract.ts';
import type { StackState } from '../contract.ts';
import type { Found } from './conversion.ts';
import { viewOf, type Shown } from './view.ts';

/** A pull request's tab, as the finder follows it. */
export interface FinderTab {
  readonly id: string;
  /** Its pull request, as its account's poller watches it. */
  readonly pull: PullRef;
  /** Its repository's name, by the name GitHub gives it now, as the notes name it. */
  readonly repository: string;
  /** The account it acts as, or nothing while that isn't known, or when it acts as nobody. */
  readonly login: string | undefined;
  /** Its pull request's state, as the tab has it. */
  readonly state: PullState | undefined;
  /** Whether it's the tab on screen. */
  readonly onScreen: boolean;
}

/** What the finder uses of an account's poller. */
export type FinderPoller = Pick<
  Poller,
  | 'login'
  | 'openPullRequests'
  | 'trunkRules'
  | 'stackLayers'
  | 'readCached'
  | 'cachedRead'
  | 'readStackLayersAgain'
  | 'forgetStackLayers'
  | 'onChange'
>;

/**
 * The pull requests in a repository that have an overview, from one read of every overview's ref
 * there, which the poller keeps with its ETag for the pull request on screen: read once its stack
 * shows, and again on the 5-minute refresh, when an unchanged answer costs nothing. Nothing in the
 * pull request's check says when it's out of date.
 */
export const OVERVIEW_REFS: ReadKind<OverviewRefNumbers> = { name: 'OverviewRefs', watched: [] };

export interface FinderOptions {
  /** An account's poller. Throws for an account Lo doesn't have. */
  poller(login: string): Promise<FinderPoller>;
  /** Sends a tab's stack to the window. */
  publish(state: StackState): void;
  log(line: string): void;
}

/** A tab the finder follows, and what it showed and asked for. */
interface Followed {
  tab: FinderTab;
  /** What was last sent for it, as JSON. */
  sent: string | undefined;
  state: StackState | undefined;
  /** The stack it showed last. */
  shown: Shown | undefined;
  /** The layers whose state it asked its poller for, while it still reads them. */
  asked: Asked | undefined;
  /** The layers at newer heads than their state, as `<number>:<head>`, read again for. */
  newer: ReadonlySet<string>;
  /** The poller it asked to read its repository's overviews with, once it has. */
  overviews: FinderPoller | undefined;
}

/** The layers a tab asked a poller to read the state of. */
interface Asked {
  readonly poller: FinderPoller;
  /** Their node IDs, one a line. */
  readonly ids: string;
  /** Whether to ask again before it reads them, since the tab left the screen after asking. */
  again: boolean;
}

/** A repository's stacks, and what they were worked out from. */
interface Forest {
  readonly list: OpenPullRequestList;
  readonly rules: TrunkRuleList;
  readonly more: readonly StackLayerList[];
  readonly stacks: Stacks;
}

/** An account's poller, once it's been got, or that it couldn't be. */
type PollerEntry =
  | { kind: 'loading' }
  | { kind: 'ready'; poller: FinderPoller; unsubscribe: () => void }
  | { kind: 'failed' };

export class StackFinder {
  readonly #options: FinderOptions;
  readonly #followed = new Map<string, Followed>();
  /** Each account's poller, by lowercased login. */
  readonly #pollers = new Map<string, PollerEntry>();
  /** Each repository's stacks, by lowercased login and repository. */
  readonly #forests = new Map<string, Forest>();
  /**
   * The newest read of each repository's overviews, by lowercased login and repository, whichever
   * of its tabs' layers it was read for, so a layer shown for the first time has them at once.
   */
  readonly #overviews = new Map<string, Cached<OverviewRefNumbers>>();
  /** The accounts whose poller couldn't be got, by lowercased login, so each is logged once. */
  readonly #unavailable = new Set<string>();
  #scheduled = false;
  #stopped = false;

  constructor(options: FinderOptions) {
    this.#options = options;
  }

  /**
   * Follows the pull requests' tabs as they are now: a tab that's new is followed, one that's gone
   * stops reading its layers, and the tab on screen reads its stack's.
   */
  follow(tabs: readonly FinderTab[]): void {
    if (this.#stopped) return;
    const open = new Set(tabs.map((tab) => tab.id));
    for (const [id, followed] of this.#followed) {
      if (open.has(id)) continue;
      this.#forget(followed);
      this.#followed.delete(id);
    }
    for (const tab of tabs) {
      const followed = this.#followed.get(tab.id);
      if (!followed) {
        this.#followed.set(tab.id, {
          tab,
          sent: undefined,
          state: undefined,
          shown: undefined,
          asked: undefined,
          newer: new Set(),
          overviews: undefined,
        });
        continue;
      }
      // Another account reads it now.
      if (followed.asked && !sameLogin(followed.asked.poller.login, tab.login)) {
        this.#forget(followed);
      }
      followed.tab = tab;
    }
    // An account whose poller couldn't be got is asked again.
    for (const [login, entry] of this.#pollers) {
      if (entry.kind === 'failed') this.#pollers.delete(login);
    }
    this.#refresh();
  }

  /** What tab `id` shows now, or nothing for a tab that isn't a pull request's. */
  state(id: string): StackState | undefined {
    return this.#followed.get(id)?.state;
  }

  /**
   * What tab `id`'s stack is worked out from now, for making it a GitHub stack: its repository's
   * stacks, the open pull requests they were found among, and its layers' state as last read.
   * Nothing until they're known, and for a tab that acts as nobody.
   */
  found(id: string): Found | undefined {
    const tab = this.#followed.get(id)?.tab;
    if (tab?.login === undefined) return undefined;
    const entry = this.#pollers.get(tab.login.toLowerCase());
    if (entry?.kind !== 'ready') return undefined;
    const { poller } = entry;
    const repo = tab.pull.repo;
    const forest = this.#forest(poller, repo);
    const list = poller.openPullRequests(repo)?.value;
    if (!forest || !list) return undefined;
    const layers = poller.cachedRead(tab.pull, STACK_LAYERS)?.value;
    return { login: poller.login, forest, list, layers };
  }

  /** Forgets what was kept for an account that was removed, whose poller stopped. */
  forgetAccount(login: string): void {
    const lower = login.toLowerCase();
    const entry = this.#pollers.get(lower);
    if (entry?.kind === 'ready') entry.unsubscribe();
    this.#pollers.delete(lower);
    for (const kept of [this.#forests, this.#overviews]) {
      for (const key of kept.keys()) if (key.startsWith(`${lower}\n`)) kept.delete(key);
    }
    for (const followed of this.#followed.values()) {
      if (followed.asked && sameLogin(followed.asked.poller.login, login)) {
        followed.asked = undefined;
      }
      if (followed.overviews && sameLogin(followed.overviews.login, login)) {
        followed.overviews = undefined;
      }
    }
    this.#refresh();
  }

  /** Stops following, as Lo quits. */
  stop(): void {
    this.#stopped = true;
    for (const entry of this.#pollers.values()) if (entry.kind === 'ready') entry.unsubscribe();
    this.#pollers.clear();
    this.#followed.clear();
    this.#forests.clear();
    this.#overviews.clear();
  }

  /** Works every tab's stack out again soon, once for everything that changes meanwhile. */
  #schedule(): void {
    if (this.#scheduled || this.#stopped) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#refresh();
    });
  }

  /** Works every tab's stack out again, sends those that changed, and reads the one on screen's. */
  #refresh(): void {
    if (this.#stopped) return;
    const used = new Set<string>();
    const pollers = new Map<Followed, FinderPoller | undefined>();
    for (const followed of this.#followed.values()) {
      const { tab } = followed;
      const poller = tab.login === undefined ? undefined : this.#poller(tab.login);
      pollers.set(followed, poller);
      if (!poller) continue;
      const key = forestKey(poller, tab.pull.repo);
      used.add(key);
      const read = poller.cachedRead(tab.pull, OVERVIEW_REFS);
      const kept = this.#overviews.get(key);
      if (read && (!kept || read.fetchedAt >= kept.fetchedAt)) this.#overviews.set(key, read);
    }
    for (const followed of this.#followed.values()) {
      const { tab } = followed;
      const poller = pollers.get(followed);
      const repo = tab.pull.repo;
      const list = poller?.openPullRequests(repo)?.value;
      const layers = poller?.cachedRead(tab.pull, STACK_LAYERS)?.value;
      const out = viewOf({
        number: tab.pull.number,
        repository: tab.repository,
        forest: poller ? this.#forest(poller, repo) : undefined,
        list,
        layers,
        overviews: poller && this.#overviews.get(forestKey(poller, repo))?.value.numbers,
        state: tab.state,
        shown: followed.shown,
      });
      followed.shown = out.shown;
      const state: StackState = { id: tab.id, stack: out.view };
      const sent = JSON.stringify(state);
      followed.state = state;
      if (sent !== followed.sent) {
        followed.sent = sent;
        this.#options.publish(state);
      }
      this.#read(followed, poller, out.ids, list, layers);
    }
    for (const kept of [this.#forests, this.#overviews]) {
      for (const key of kept.keys()) if (!used.has(key)) kept.delete(key);
    }
  }

  /**
   * Has tab `followed`'s poller read the state of the layers whose node IDs are `ids` while it's on
   * screen, and again when the list shows a layer at a newer head than its state, and which pull
   * requests in its repository have an overview. A tab whose pull request is no longer in a stack
   * stops reading its layers.
   */
  #read(
    followed: Followed,
    poller: FinderPoller | undefined,
    ids: readonly string[],
    list: OpenPullRequestList | undefined,
    layers: StackLayerList | undefined,
  ): void {
    const { tab } = followed;
    if (ids.length === 0) {
      this.#forget(followed);
      return;
    }
    if (!tab.onScreen || !poller) {
      // Nothing reads them off screen; coming back asks again, to start from a newer read.
      if (followed.asked) followed.asked.again = true;
      return;
    }
    if (followed.overviews !== poller) {
      followed.overviews = poller;
      const repo = tab.pull.repo;
      poller
        .readCached(tab.pull, OVERVIEW_REFS, (client, known) =>
          overviewRefNumbers(client, repo, known),
        )
        .catch((error: unknown) => {
          this.#options.log(`reading ${repo.toString()}'s overviews: ${String(error)}`);
        });
    }
    const key = ids.join('\n');
    const asked = followed.asked;
    if (!asked || asked.poller !== poller || asked.ids !== key || asked.again) {
      if (asked && asked.poller !== poller) this.#forget(followed);
      followed.asked = { poller, ids: key, again: false };
      poller.stackLayers(tab.pull, ids).catch((error: unknown) => {
        this.#options.log(`reading ${tab.pull.toString()}'s layers: ${String(error)}`);
      });
    }
    if (!list || !layers) return;
    const newer = new Set<string>();
    for (const layer of layers.layers) {
      const pr = openPullRequest(list, layer.number);
      if (pr && ids.includes(pr.id) && pr.headRefOid !== layer.headRefOid) {
        newer.add(`${layer.number}:${pr.headRefOid}`);
      }
    }
    if ([...newer].some((mark) => !followed.newer.has(mark))) {
      poller.readStackLayersAgain(tab.pull);
    }
    followed.newer = newer;
  }

  /** Stops tab `followed`'s poller reading its layers' state. */
  #forget(followed: Followed): void {
    const asked = followed.asked;
    followed.asked = undefined;
    followed.newer = new Set();
    asked?.poller.forgetStackLayers(followed.tab.pull);
  }

  /** `login`'s poller, once it's been got: until then, it's asked for, and the tabs wait. */
  #poller(login: string): FinderPoller | undefined {
    const lower = login.toLowerCase();
    const entry = this.#pollers.get(lower);
    if (entry) return entry.kind === 'ready' ? entry.poller : undefined;
    this.#pollers.set(lower, { kind: 'loading' });
    this.#options.poller(login).then(
      (poller) => {
        if (this.#stopped || this.#pollers.get(lower)?.kind !== 'loading') return;
        const unsubscribe = poller.onChange(() => this.#schedule());
        this.#pollers.set(lower, { kind: 'ready', poller, unsubscribe });
        this.#unavailable.delete(lower);
        this.#schedule();
      },
      (error: unknown) => {
        if (this.#pollers.get(lower)?.kind !== 'loading') return;
        this.#pollers.set(lower, { kind: 'failed' });
        if (this.#unavailable.has(lower)) return;
        this.#unavailable.add(lower);
        this.#options.log(`no poller for ${login}: ${String(error)}`);
      },
    );
    return undefined;
  }

  /**
   * `repo`'s stacks as `poller` lists its pull requests, with the merged ones below the layers
   * GitHub moved that its tabs' reads of their layers found: worked out again only when any of them
   * changes, and nothing until its rulesets have been read once.
   */
  #forest(poller: FinderPoller, repo: RepoRef): Stacks | undefined {
    const list = poller.openPullRequests(repo)?.value;
    const rules = poller.trunkRules(repo)?.value;
    if (!list || !rules) return undefined;
    const more: StackLayerList[] = [];
    for (const { tab } of this.#followed.values()) {
      if (!sameLogin(poller.login, tab.login) || !tab.pull.repo.equals(repo)) continue;
      const read = poller.cachedRead(tab.pull, STACK_LAYERS)?.value;
      if (read && !more.includes(read)) more.push(read);
    }
    const key = forestKey(poller, repo);
    const kept = this.#forests.get(key);
    if (
      kept?.list === list &&
      kept.rules === rules &&
      kept.more.length === more.length &&
      kept.more.every((read, index) => read === more[index])
    ) {
      return kept.stacks;
    }
    const stacks = stacksOf(
      list,
      rules,
      more.flatMap((read) => read.merged),
    );
    this.#forests.set(key, { list, rules, more, stacks });
    return stacks;
  }
}

/** The key a repository's stacks are kept under, for the account whose poller lists them. */
function forestKey(poller: FinderPoller, repo: RepoRef): string {
  return `${poller.login.toLowerCase()}\n${repo.key}`;
}

function sameLogin(a: string, b: string | undefined): boolean {
  return b !== undefined && a.toLowerCase() === b.toLowerCase();
}
