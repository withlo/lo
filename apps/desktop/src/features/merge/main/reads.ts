// Each view's merge status, in main: what decides whether its pull request can merge, read through
// the account's poller, which keeps it, once the view has been on screen, and followed as the
// poller reads it again, as the threads are. The poller reads again only for the pull request on
// screen, so a view off screen keeps its last status. Each read is mapped with the head on screen
// (the newer side of what the view compares), the method remembered for the repository, and, where
// the base branch's rules require the head up to date, whether the local copy's head holds the base
// branch's tip, which stays unknown until the copy has fetched it, and is asked again later when the
// copy couldn't tell. A status read before a read that failed, or while the poller can't read, says
// why it may be out of date. A view that acts as nobody, or shows a run of a stack's layers, reads
// nothing. Nothing here calls Electron.

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
import { requiresUpToDate, type Local } from '@lo/review';

import { githubCause, type Cause } from '../../../ipc/cause.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeStatusView, MergeView, Method, Off } from '../contract.ts';
import { explained, type Asker } from './causes.ts';
import { offOf } from './merging.ts';
import { pagesOf, stateOf } from './status.ts';

/** What the merge status uses of an account's poller. */
export interface MergePoller extends Pick<
  Poller,
  'mergeFacts' | 'onEvent' | 'onChange' | 'status' | 'readOnce' | 'writesHeldUntil'
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
  /** The time now, in milliseconds since the Unix epoch; `Date.now` unless a test says. */
  readonly now?: () => number;
}

/** How long to wait before asking again what failed `tries` times in a row: 10 s, doubling, to 5 min. */
export function backoff(tries: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, tries - 1), 5 * 60_000);
}

/** What the local copy said of whether a head holds the base's tip, for `<tip>:<head>`. */
interface Held {
  /** Its answer, once it gave one: nothing when it couldn't tell, or while it's asked. */
  answer: boolean | undefined;
  /** Whether it's being asked now. */
  asking: boolean;
  /** How many times in a row it couldn't tell. */
  tries: number;
  /** When it may be asked again, once it couldn't tell. */
  retryAt: number;
}

/** A view followed: whose and which pull request, and what's been read of it. */
interface Followed {
  readonly id: string;
  readonly pull: PullRef;
  /** The account it reads as, once it acts as one. */
  readonly login: string | undefined;
  readonly run: boolean;
  /**
   * Whether its read has been asked for: once, the first time it's on screen, and again after its
   * account's poller couldn't be had, no sooner than `retryAt` unless it's shown again.
   */
  started: boolean;
  /** How many times in a row its account's poller couldn't be had. */
  tries: number;
  retryAt: number;
  poller: MergePoller | undefined;
  stop: (() => void) | undefined;
  /** What the poller last gave. */
  facts: Cached<MergeFacts> | undefined;
  /** Why the last read after `facts` failed, until one doesn't. */
  failedAgain: string | undefined;
  /** Why the poller can't read now, as its status says, once `facts` are in. */
  stall: Cause | undefined;
  /** Why Lo merges nothing now, as the poller last said, once `facts` are in. */
  off: Off | null;
  /** What GitHub doesn't say, as `facts` were last mapped with. */
  local: Local | undefined;
  held: Map<string, Held>;
  view: MergeView;
  /** The view as last sent, to send nothing that didn't change. */
  sent: string | undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Who reads `followed`'s pull request, as `login`, as the causes of a failed read name them. */
function askerOf(followed: Followed, login = followed.login ?? ''): Asker {
  return { login, owner: followed.pull.repo.owner };
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

/**
 * Why no read can be answered now for `login`, as `status` says, for the window to word: GitHub
 * gives no answer, by why, the account is signed out, or the rate limit holds every read. Nothing
 * when reads go on.
 */
export function stallOf(status: PollStatus, login: string): Cause | undefined {
  if (status.signedOut) return { kind: 'signedOut', login };
  if (status.offline) return githubCause(status.offline.cause);
  if (status.rateLimit.kind === 'paused') {
    return { kind: 'rateLimit', resets: Math.round(status.rateLimit.until) };
  }
  return undefined;
}

/**
 * Why a view shows no merge status, when it shows none: nothing for a closed view, where the command
 * isn't offered.
 */
export const NO_STATUS = {
  anonymous: 'Sign in to merge',
  run: 'Show a single layer first',
  closed: '',
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
      this.#options.onScreen() === id &&
      this.#now() >= followed.retryAt
    ) {
      followed.started = true;
      void this.#watch(followed, login);
    }
  }

  /**
   * Follows view `id` as it comes on screen: one whose account's poller couldn't be had tries again
   * now, without waiting.
   */
  shown(id: string): void {
    const followed = this.#views.get(id);
    if (followed && !followed.started) followed.retryAt = 0;
    this.follow(id);
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
  reader(
    id: string,
  ): { pull: PullRef; login: string; poller: MergePoller; head: string } | undefined {
    const followed = this.#views.get(id);
    if (!followed?.poller || followed.view.kind === 'none') return undefined;
    return {
      pull: followed.pull,
      login: followed.login ?? '',
      poller: followed.poller,
      head: followed.facts?.value.pullRequest.head ?? '',
    };
  }

  /**
   * Whether view `id`'s head holds its base branch's tip, as its status was last mapped with:
   * nothing where the rules don't ask, or the local copy couldn't tell.
   */
  headContainsBase(id: string): boolean | undefined {
    return this.#views.get(id)?.local?.headContainsBase;
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
      tries: 0,
      retryAt: 0,
      poller: undefined,
      stop: undefined,
      facts: undefined,
      failedAgain: undefined,
      stall: undefined,
      off: null,
      local: undefined,
      held: new Map(),
      view: { kind: 'loading' },
      sent: undefined,
    };
  }

  #drop(id: string): void {
    this.#views.get(id)?.stop?.();
    this.#views.delete(id);
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
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
      if (!this.#current(followed)) return;
      // As when the account isn't signed in: it starts again once it's shown, or later.
      followed.started = false;
      followed.tries += 1;
      followed.retryAt = this.#now() + backoff(followed.tries);
      // Lo's own words, as why the account can't read.
      this.#fail(followed, describe(error), describe(error));
      return;
    }
    if (!this.#current(followed)) return;
    followed.tries = 0;
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
      if (this.#current(followed)) {
        this.#fail(followed, explained(error, askerOf(followed, login)), describe(error));
      }
      return;
    }
    this.#stalled(followed, poller);
  }

  /**
   * Ends the wait for a view's first read when the poller can't answer it now: it fails with why,
   * and the status comes once a read does. A status already read says why it may be out of date,
   * for as long as the poller can't read.
   */
  #stalled(followed: Followed, poller: MergePoller): void {
    if (!this.#current(followed) || followed.poller !== poller) return;
    const stall = stallOf(poller.status(), followed.login ?? '');
    if (followed.facts) this.#stale(followed, stall, followed.failedAgain, offOf(poller));
    else if (stall !== undefined) this.#failStalled(followed, stall);
  }

  /**
   * Notes why a status already read may be out of date, and why Lo merges nothing now, and maps it
   * again if either changed.
   */
  #stale(
    followed: Followed,
    stall: Cause | undefined,
    failedAgain: string | undefined,
    off = followed.off,
  ): void {
    if (
      JSON.stringify(followed.stall) === JSON.stringify(stall) &&
      followed.failedAgain === failedAgain &&
      JSON.stringify(followed.off) === JSON.stringify(off)
    ) {
      return;
    }
    followed.stall = stall;
    followed.failedAgain = failedAgain;
    followed.off = off;
    const info = this.#options.view(followed.id);
    if (info) this.#map(followed, info);
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
      case 'readFailed': {
        if (!event.pull.equals(followed.pull) || event.name !== MERGE_FACTS.name) return;
        const why = explained(new GithubError(event.error), askerOf(followed));
        // What was read before stays, saying it may be out of date.
        if (followed.facts) this.#stale(followed, followed.stall, why);
        else this.#fail(followed, why, new GithubError(event.error).message);
        return;
      }
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
    const again = followed.failedAgain !== undefined;
    followed.failedAgain = undefined;
    if (
      !again &&
      followed.facts?.value === cached.value &&
      followed.facts.fetchedAt === cached.fetchedAt
    ) {
      return;
    }
    followed.facts = cached;
    if (followed.poller) followed.off = offOf(followed.poller);
    const info = this.#options.view(followed.id);
    if (info) this.#map(followed, info);
  }

  /** Maps what was read into the view's status, with what the window and the local copy say. */
  #map(followed: Followed, info: PullTabInfo): void {
    const cached = followed.facts;
    if (!cached) return;
    const facts = cached.value;
    const local: Local = {
      headOnScreen: this.#options.headOnScreen(followed.id) ?? '',
      preferredMethod: this.#options.method(followed.pull.repo),
      headContainsBase: this.#holds(followed, info, facts),
    };
    followed.local = local;
    const state = stateOf({
      facts,
      local,
      readAt: cached.fetchedAt,
      stale: followed.failedAgain,
      stall: followed.stall,
      off: followed.off,
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
   * to date: nothing elsewhere, and nothing until the local copy, once it's ready, has said. It's
   * asked once for each tip and head, and again at a later read, backing off, while it can't tell,
   * as when it lacks GitHub's head or the fetch of the tip failed.
   */
  #holds(followed: Followed, info: PullTabInfo, facts: MergeFacts): boolean | undefined {
    if (!requiresUpToDate(facts)) return undefined;
    const tip = facts.pullRequest.baseTip;
    const head = facts.pullRequest.head;
    if (tip === undefined || head === '') return undefined;
    if (info.local.kind !== 'ready') return undefined;
    const key = `${tip}:${head}`;
    const known = followed.held.get(key);
    if (known && (known.asking || known.answer !== undefined || this.#now() < known.retryAt)) {
      return known.answer;
    }
    const asked: Held = known ?? { answer: undefined, asking: false, tries: 0, retryAt: 0 };
    asked.asking = true;
    followed.held.set(key, asked);
    this.#options
      .holds(followed.id, tip, head)
      .catch((error: unknown) => {
        this.#options.log(`${followed.pull.toString()}: ${describe(error)}`);
        return undefined;
      })
      .then((answer) => {
        asked.asking = false;
        asked.answer = answer;
        if (answer === undefined) {
          asked.tries += 1;
          asked.retryAt = this.#now() + backoff(asked.tries);
        }
        if (!this.#current(followed) || followed.held.get(key) !== asked) return;
        const now = this.#options.view(followed.id);
        if (now && answer !== undefined) this.#map(followed, now);
      })
      .catch((error: unknown) => this.#options.log(describe(error)));
    return undefined;
  }

  /** Fails the first read for `stall`, which the window words, as the poller can't read now. */
  #failStalled(followed: Followed, stall: Cause): void {
    this.#options.log(`${followed.pull.toString()}: can't read now (${stall.kind})`);
    this.#set(followed, { kind: 'failed', why: '', stall });
  }

  /** The first read failed, for `why`, the reader's words; `raw` is what failed, for the log. */
  #fail(followed: Followed, why: string, raw: string): void {
    this.#options.log(`${followed.pull.toString()}: ${raw}`);
    // What it said goes behind Details, unless it's only the reason again.
    const details = raw === why ? undefined : raw.slice(0, 4096);
    this.#set(followed, {
      kind: 'failed',
      why: why.slice(0, 4096),
      ...(details === undefined ? {} : { details }),
    });
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
