// The stacks pull requests' tabs show, as main follows them: for each repository a tab is in, the
// stacks among its open pull requests, worked out again when its account's poller lists them anew,
// reads its rulesets, or reads the merged pull requests below layers GitHub moved; each tab's stack
// in it, and where its layer's diff starts; and the state of the layers of the stack on screen,
// which only its tab reads. Nothing here calls Electron.

import {
  openPullRequest,
  STACK_LAYERS,
  type OpenPullRequestList,
  type Poller,
  type PullRef,
  type RepoRef,
  type StackLayerList,
  type TrunkRuleList,
} from '@lo/github';
import {
  stackPullRequests,
  stacksOf,
  type LayerStart,
  type PullRequest,
  type Stacks,
} from '@lo/stacks';

import type { PullState } from '../../tab/contract.ts';
import type { Offer, StackState } from '../contract.ts';
import type { Found } from './conversion.ts';
import { planStart, type StartForest } from './starts.ts';
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
  /** The head on screen, once known. */
  readonly head: string | undefined;
  /** The commit its diff starts from now, unless it starts at its base branch. */
  readonly compareFrom: string | undefined;
  /** Whether its diff has been drawn since it was last told where to start. */
  readonly drawn: boolean;
  /** Whether its local copy couldn't get `compareFrom`, so its diff starts at its base branch. */
  readonly missing: boolean;
}

/** What the finder uses of an account's poller. */
export type FinderPoller = Pick<
  Poller,
  | 'login'
  | 'openPullRequests'
  | 'trunkRules'
  | 'stackLayers'
  | 'cachedRead'
  | 'readStackLayersAgain'
  | 'forgetStackLayers'
  | 'onChange'
>;

export interface FinderOptions {
  /** An account's poller. Throws for an account Lo doesn't have. */
  poller(login: string): Promise<FinderPoller>;
  /** Sends a tab's stack to the window. */
  publish(state: StackState): void;
  /**
   * Has tab `id`'s diff start from `commit`, or its base branch for nothing, and start again: before
   * it's drawn, or when the reader asks.
   */
  compareFrom(id: string, commit: string | undefined): void;
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
  /** The start it set last, which names the layer the diff was compared with. */
  start: LayerStart | undefined;
  /** The start its banner offers, if any, and the start the stack says it is. */
  offered: { readonly offer: Offer; readonly start: LayerStart | undefined } | undefined;
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
  /** The pull requests they were found among, as `@lo/stacks` takes them. */
  readonly prs: readonly PullRequest[];
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
          start: undefined,
          offered: undefined,
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
   * Has tab `id`'s layer compared with `commit`, `null` for its base branch, as its banner offers.
   * Returns false, and does nothing, when that's no longer what's offered.
   */
  useStart(id: string, commit: string | null): boolean {
    const followed = this.#followed.get(id);
    const offered = followed?.offered;
    if (!followed || offered?.offer.commit !== commit) return false;
    followed.offered = undefined;
    followed.start = commit === null ? undefined : offered.start;
    // The tab changes, and the stacks are worked out again.
    this.#options.compareFrom(id, commit ?? undefined);
    return true;
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
    const forest = this.#forest(poller, repo)?.stacks;
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
    for (const key of this.#forests.keys()) {
      if (key.startsWith(`${lower}\n`)) this.#forests.delete(key);
    }
    for (const followed of this.#followed.values()) {
      if (followed.asked && sameLogin(followed.asked.poller.login, login)) {
        followed.asked = undefined;
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

  /**
   * Works every tab's stack out again, sends those that changed, and reads the one on screen's.
   * Where each tab's layer starts is set once every stack is worked out: setting it changes the
   * tab, which works them out again.
   */
  #refresh(): void {
    if (this.#stopped) return;
    const used = new Set<string>();
    const starts: [string, string | undefined][] = [];
    for (const followed of this.#followed.values()) {
      const { tab } = followed;
      const poller = tab.login === undefined ? undefined : this.#poller(tab.login);
      const repo = tab.pull.repo;
      if (poller) used.add(forestKey(poller, repo));
      const listed = poller?.openPullRequests(repo);
      const list = listed?.value;
      const read = poller?.cachedRead(tab.pull, STACK_LAYERS);
      const layers = read?.value;
      const forest = poller ? this.#forest(poller, repo) : undefined;
      const out = viewOf({
        number: tab.pull.number,
        repository: tab.repository,
        forest: forest?.stacks,
        list,
        layers,
        state: tab.state,
        shown: followed.shown,
      });
      followed.shown = out.shown;
      const plan = planStart({ ...tab, number: tab.pull.number }, forest, followed.start);
      if (plan.set !== undefined) {
        followed.start = plan.set === null ? undefined : plan.start;
        starts.push([tab.id, plan.set ?? undefined]);
      }
      followed.offered = plan.offer && { offer: plan.offer, start: plan.start };
      const view =
        plan.note && out.view.kind === 'stack'
          ? { ...out.view, notes: [...out.view.notes, plan.note] }
          : out.view;
      const state: StackState = { id: tab.id, stack: view, offer: plan.offer ?? null };
      const sent = JSON.stringify(state);
      followed.state = state;
      if (sent !== followed.sent) {
        followed.sent = sent;
        this.#options.publish(state);
      }
      this.#read(followed, poller, out.ids, list, layers, listed?.fetchedAt, read?.fetchedAt);
    }
    for (const key of this.#forests.keys()) if (!used.has(key)) this.#forests.delete(key);
    for (const [id, commit] of starts) this.#options.compareFrom(id, commit);
  }

  /**
   * Has tab `followed`'s poller read the state of the layers whose node IDs are `ids` while it's on
   * screen, and again when a list fetched after it, at `listedAt`, shows a layer at another head
   * than the state, read at `readAt`. A tab whose pull request is no longer in a stack stops reading
   * them.
   */
  #read(
    followed: Followed,
    poller: FinderPoller | undefined,
    ids: readonly string[],
    list: OpenPullRequestList | undefined,
    layers: StackLayerList | undefined,
    listedAt: number | undefined,
    readAt: number | undefined,
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
    const key = ids.join('\n');
    const asked = followed.asked;
    if (!asked || asked.poller !== poller || asked.ids !== key || asked.again) {
      if (asked && asked.poller !== poller) this.#forget(followed);
      followed.asked = { poller, ids: key, again: false };
      poller.stackLayers(tab.pull, ids).catch((error: unknown) => {
        this.#options.log(`reading ${tab.pull.toString()}'s layers: ${String(error)}`);
      });
    }
    if (!list || !layers || listedAt === undefined || readAt === undefined) return;
    // A list from before the state may show a head the state has moved on from.
    if (listedAt <= readAt) return;
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
  #forest(poller: FinderPoller, repo: RepoRef): (StartForest & Forest) | undefined {
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
      return kept;
    }
    const merged = more.flatMap((read) => read.merged);
    const forest = {
      list,
      rules,
      more,
      stacks: stacksOf(list, rules, merged),
      prs: stackPullRequests(list, merged),
    };
    this.#forests.set(key, forest);
    return forest;
  }
}

/** The key a repository's stacks are kept under, for the account whose poller lists them. */
function forestKey(poller: FinderPoller, repo: RepoRef): string {
  return `${poller.login.toLowerCase()}\n${repo.key}`;
}

function sameLogin(a: string, b: string | undefined): boolean {
  return b !== undefined && a.toLowerCase() === b.toLowerCase();
}
