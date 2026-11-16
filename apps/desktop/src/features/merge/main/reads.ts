// Each view's merge status, in main: what decides whether its pull request can merge, read through
// the account's poller, which keeps it, once the view has been on screen, and followed as the
// poller reads it again, as the threads are. The poller reads again only for the pull request on
// screen, so a view off screen keeps its last status. Each read is mapped with the head on screen
// (the newer side of what the view compares), the method remembered for the repository, and, where
// the base branch's rules require the head up to date, whether the local copy's head holds the base
// branch's tip, which stays unknown until the copy has fetched it. A view that acts as nobody, or
// shows a run of a stack's layers, reads nothing. Nothing here calls Electron.

import {
  type Cached,
  GithubError,
  MERGE_FACTS,
  type MergeFacts,
  type PollEvent,
  type Poller,
  type PollStatus,
  PullRef,
  type ReadKind,
  type RepoRef,
} from '@lo/github';
import { requiresUpToDate } from '@lo/review';

import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeStatusView, MergeView, Method } from '../contract.ts';
import { pagesOf, stateOf } from './status.ts';

/** What the merge status uses of an account's poller. */
export interface MergePoller extends Pick<
  Poller,
  'mergeFacts' | 'onEvent' | 'onChange' | 'status' | 'readOnce'
> {
  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined;
}

export interface MergeReadsOptions {
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<MergePoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /** The view on screen, if a pull request's is. */
  readonly onScreen: () => string | undefined;
  /**
   * The head on screen in view `id`: the newer side of the revisions it compares, or the head it
   * shows, once there is one.
   */
  readonly headOnScreen: (id: string) => string | undefined;
  /** The merge method last used in `repo`, if Lo remembers one. */
  readonly method: (repo: RepoRef) => Method | undefined;
  /**
   * Whether `head` holds `tip`, from view `id`'s local copy, which fetches `tip` first when it
   * lacks it: nothing when it can't tell, as before the copy is there.
   */
  readonly holds: (id: string, tip: string, head: string) => Promise<boolean | undefined>;
  readonly publish: (status: MergeStatusView) => void;
  readonly log: (line: string) => void;
}

/** What the local copy said of whether a head holds the base's tip, for `<tip>:<head>`. */
interface Held {
  /** Its answer, once it gave one: nothing when it couldn't tell, or while it's asked. */
  answer: boolean | undefined;
}

/** A view followed: whose and which pull request, and what's been read of it. */
interface Followed {
  readonly id: string;
  readonly pull: PullRef;
  /** The account it reads as, once it acts as one. */
  readonly login: string | undefined;
  readonly run: boolean;
  /** Whether its read has been asked for: once, the first time it's on screen. */
  started: boolean;
  poller: MergePoller | undefined;
  stop: (() => void) | undefined;
  /** What the poller last gave. */
  facts: Cached<MergeFacts> | undefined;
  held: Map<string, Held>;
  view: MergeView;
  /** The view as last sent, to send nothing that didn't change. */
  sent: string | undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

/**
 * Why no read can be answered now, as `status` says: GitHub can't be reached, the account is signed
 * out, or the rate limit holds every read. Nothing when reads go on.
 */
function stallOf(status: PollStatus): string | undefined {
  if (status.signedOut) return 'The account is signed out of GitHub.';
  if (status.offline) return `GitHub can’t be reached: ${status.offline.error}`;
  if (status.rateLimit.kind === 'paused') {
    return `GitHub’s rate limit holds every read until ${new Date(status.rateLimit.until).toISOString()}.`;
  }
  return undefined;
}

/** Why a view shows no merge status, when it shows none. */
export const NO_STATUS = {
  anonymous: 'Sign in to see whether it can merge.',
  run: 'Show a layer to see whether it can merge.',
  closed: 'There’s no pull request in that tab.',
} as const;

export class MergeReads {
  readonly #options: MergeReadsOptions;
  readonly #views = new Map<string, Followed>();
  #stopped = false;

  constructor(options: MergeReadsOptions) {
    this.#options = options;
  }

  /**
   * Follows view `id` as it is now: a new pull request or account starts it afresh, and once it's
   * on screen with the head GitHub gave, its read is asked for. A closed view is let go. A view
   * already read is mapped again, as its head on screen or local copy may have moved.
   */
  follow(id: string): void {
    if (this.#stopped) return;
    const info = this.#options.view(id);
    if (!info) {
      this.#drop(id);
      return;
    }
    const login = info.acting?.kind === 'account' ? info.acting.login : undefined;
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    const run = info.run !== undefined;
    let followed = this.#views.get(id);
    if (
      !followed ||
      followed.pull.key !== pull.key ||
      !sameLogin(followed.login, login) ||
      followed.run !== run
    ) {
      followed?.stop?.();
      followed = this.#fresh(id, pull, login, run);
      this.#views.set(id, followed);
    }
    if (run) {
      this.#set(followed, { kind: 'none', why: NO_STATUS.run });
      return;
    }
    if (info.acting?.kind === 'anonymous') {
      this.#set(followed, { kind: 'none', why: NO_STATUS.anonymous });
      return;
    }
    if (followed.facts) this.#map(followed, info);
    else this.#send(followed);
    // Read for the first time once it's on screen at the head GitHub gave: a pull request GitHub
    // never answered for has nothing to read.
    if (
      login !== undefined &&
      !followed.started &&
      info.shown !== undefined &&
      this.#options.onScreen() === id
    ) {
      followed.started = true;
      void this.#watch(followed, login);
    }
  }

  /** View `id`'s status now: loading for one not followed yet, nothing for no view. */
  current(id: string): MergeView {
    const followed = this.#views.get(id);
    if (followed) return followed.view;
    return this.#options.view(id) ? { kind: 'loading' } : { kind: 'none', why: NO_STATUS.closed };
  }

  /**
   * The account and pull request view `id` reads as, with its poller, once it reads: for the merge
   * panel's own reads. Nothing for a view that reads nothing.
   */
  reader(id: string): { pull: PullRef; poller: MergePoller; head: string } | undefined {
    const followed = this.#views.get(id);
    if (!followed?.poller || followed.view.kind === 'none') return undefined;
    return {
      pull: followed.pull,
      poller: followed.poller,
      head: followed.facts?.value.pullRequest.head ?? '',
    };
  }

  /** Whether view `id`'s status links `url`: only such a page opens. */
  links(id: string, url: string): boolean {
    const view = this.#views.get(id)?.view;
    return view?.kind === 'known' && pagesOf(view.state).has(url);
  }

  /** Follows nothing more, and sends nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const followed of this.#views.values()) followed.stop?.();
    this.#views.clear();
  }

  #fresh(id: string, pull: PullRef, login: string | undefined, run: boolean): Followed {
    return {
      id,
      pull,
      login,
      run,
      started: false,
      poller: undefined,
      stop: undefined,
      facts: undefined,
      held: new Map(),
      view: { kind: 'loading' },
      sent: undefined,
    };
  }

  #drop(id: string): void {
    this.#views.get(id)?.stop?.();
    this.#views.delete(id);
  }

  /** Whether `followed` is still what view `id` is followed as. */
  #current(followed: Followed): boolean {
    return !this.#stopped && this.#views.get(followed.id) === followed;
  }

  async #watch(followed: Followed, login: string): Promise<void> {
    let poller: MergePoller;
    try {
      poller = await this.#options.poller(login);
    } catch (error) {
      if (this.#current(followed)) this.#fail(followed, describe(error));
      return;
    }
    if (!this.#current(followed)) return;
    followed.poller = poller;
    const events = poller.onEvent((event) => this.#heard(followed, poller, event));
    const changes = poller.onChange(() => this.#stalled(followed, poller));
    followed.stop = () => {
      events();
      changes();
    };
    try {
      const cached = await poller.mergeFacts(followed.pull);
      if (!this.#current(followed)) return;
      if (cached) this.#take(followed, cached);
    } catch (error) {
      if (this.#current(followed)) this.#fail(followed, describe(error));
      return;
    }
    this.#stalled(followed, poller);
  }

  /**
   * Ends the wait for a view's first read when the poller can't answer it now: it fails with why,
   * and the status comes once a read does.
   */
  #stalled(followed: Followed, poller: MergePoller): void {
    if (!this.#current(followed) || followed.poller !== poller || followed.facts) return;
    const why = stallOf(poller.status());
    if (why !== undefined) this.#fail(followed, why);
  }

  #heard(followed: Followed, poller: MergePoller, event: PollEvent): void {
    if (!this.#current(followed) || followed.poller !== poller) return;
    switch (event.kind) {
      case 'read':
      case 'confirmed': {
        if (!event.pull.equals(followed.pull) || event.name !== MERGE_FACTS.name) return;
        const cached = poller.cachedRead(followed.pull, MERGE_FACTS);
        if (cached) this.#take(followed, cached);
        return;
      }
      case 'readFailed':
        if (!event.pull.equals(followed.pull) || event.name !== MERGE_FACTS.name) return;
        // What was read before stays: it's only not current.
        if (!followed.facts) this.#fail(followed, new GithubError(event.error).message);
        return;
      case 'summary':
      case 'check':
      case 'details':
      case 'openPullRequests':
      case 'trunkRules':
      case 'failed':
        return;
      default:
        event satisfies never;
    }
  }

  #take(followed: Followed, cached: Cached<MergeFacts>): void {
    if (followed.facts?.value === cached.value && followed.facts.fetchedAt === cached.fetchedAt) {
      return;
    }
    followed.facts = cached;
    const info = this.#options.view(followed.id);
    if (info) this.#map(followed, info);
  }

  /** Maps what was read into the view's status, with what the window and the local copy say. */
  #map(followed: Followed, info: PullTabInfo): void {
    const cached = followed.facts;
    if (!cached) return;
    const facts = cached.value;
    const state = stateOf({
      facts,
      local: {
        headOnScreen: this.#options.headOnScreen(followed.id) ?? '',
        preferredMethod: this.#options.method(followed.pull.repo),
        headContainsBase: this.#holds(followed, info, facts),
      },
      readAt: cached.fetchedAt,
      pull: {
        owner: followed.pull.repo.owner,
        repo: followed.pull.repo.name,
        number: followed.pull.number,
      },
    });
    this.#set(followed, { kind: 'known', state });
  }

  /**
   * Whether GitHub's head holds the base branch's tip, where the base's rules require the head up
   * to date: nothing elsewhere, and nothing until the local copy, once it's ready, has said, which
   * it's asked once for each tip and head.
   */
  #holds(followed: Followed, info: PullTabInfo, facts: MergeFacts): boolean | undefined {
    if (!requiresUpToDate(facts)) return undefined;
    const tip = facts.pullRequest.baseTip;
    const head = facts.pullRequest.head;
    if (tip === undefined || head === '') return undefined;
    if (info.local.kind !== 'ready') return undefined;
    const key = `${tip}:${head}`;
    const known = followed.held.get(key);
    if (known) return known.answer;
    const asked: Held = { answer: undefined };
    followed.held.set(key, asked);
    this.#options
      .holds(followed.id, tip, head)
      .catch((error: unknown) => {
        this.#options.log(`${followed.pull.toString()}: ${describe(error)}`);
        return undefined;
      })
      .then((answer) => {
        asked.answer = answer;
        if (!this.#current(followed) || followed.held.get(key) !== asked) return;
        const now = this.#options.view(followed.id);
        if (now && answer !== undefined) this.#map(followed, now);
      })
      .catch((error: unknown) => this.#options.log(describe(error)));
    return undefined;
  }

  #fail(followed: Followed, why: string): void {
    this.#options.log(`${followed.pull.toString()}: ${why}`);
    this.#set(followed, { kind: 'failed', why: why.slice(0, 4096) });
  }

  #set(followed: Followed, view: MergeView): void {
    followed.view = view;
    this.#send(followed);
  }

  #send(followed: Followed): void {
    const said = JSON.stringify(followed.view);
    if (said === followed.sent) return;
    followed.sent = said;
    try {
      this.#options.publish({ id: followed.id, view: followed.view });
    } catch (error) {
      this.#options.log(`sending the merge status: ${describe(error)}`);
    }
  }
}
