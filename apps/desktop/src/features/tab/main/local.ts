// A pull request's local copy, as its tab keeps it: the clone opened with the tab's account's token,
// the pull request fetched into it with what git is doing, failures said and tried again, and the
// head on screen with the base branch's tip it was fetched with, and where its changes start: where
// it branched off the base branch, or, for a stack's layer, where it meets the commit it's compared
// with. Nothing here calls Electron.

import {
  type Activity,
  describeProgress,
  GitError,
  type GitStatus,
  type Oid,
  type OpenOptions,
  parseOid,
  type PullRequestRefs,
  type Repo,
  type TokenSource,
} from '@lo/git';

import type { Compared, FetchFailure, LocalState } from '../contract.ts';

/** The first wait before trying a failed fetch again, in milliseconds. */
export const FIRST_RETRY = 5_000;
/** The longest wait between tries. */
export const LAST_RETRY = 5 * 60_000;

/** How long to wait after the `failures`th failure in a row: 5 s, doubling, 5 minutes at most. */
export function retryWait(failures: number): number {
  return Math.min(FIRST_RETRY * 2 ** Math.max(0, failures - 1), LAST_RETRY);
}

/**
 * How often, at most, the local copy says what git is doing while it fetches, in milliseconds. Git
 * reports each percent of each stage, which a fast fetch passes through dozens of times in a few
 * frames, and the window draws the tab again for each it hears.
 */
export const PROGRESS_EVERY = 100;

/**
 * Calls `say` once for a run of calls, at most once every `every` milliseconds: once the code
 * making them is done, so calls made together are said once, or, within `every` of when it last
 * said, once that's up. It keeps time by a clock that never steps back, as the wall clock can.
 */
export function paced(every: number, say: () => void): () => void {
  let saidAt = -Infinity;
  let waiting = false;
  const sayNow = (): void => {
    waiting = false;
    saidAt = performance.now();
    say();
  };
  return () => {
    if (waiting) return;
    waiting = true;
    const wait = saidAt + every - performance.now();
    if (wait <= 0) queueMicrotask(sayNow);
    else setTimeout(sayNow, wait);
  };
}

/** Whether `a` and `b` ask for the same fetch. */
function sameRefs(a: PullRequestRefs | undefined, b: PullRequestRefs): boolean {
  return (
    a !== undefined &&
    a.number === b.number &&
    a.head === b.head &&
    a.base === b.base &&
    a.baseBranch === b.baseBranch
  );
}

/** What a failure was, for the tab, and whether Lo tries again by itself. */
export interface Failure {
  readonly failure: FetchFailure;
  readonly message: string;
  readonly retry: boolean;
}

/**
 * What went wrong fetching, in the tab's words. A fetch that failed tries again when `@lo/git`
 * says waiting may fix it; a full disk, a commit GitHub no longer has, a name git refuses and a
 * fetch past its size never do. Anything else, such as a clone another fetch holds, does.
 */
export function failureOf(error: unknown): Failure {
  if (!(error instanceof GitError)) {
    return {
      failure: 'other',
      message: error instanceof Error ? error.message : String(error),
      retry: true,
    };
  }
  const { detail, message } = error;
  switch (detail.kind) {
    case 'fetch':
      return { failure: detail.failure, message, retry: error.isRetryable() };
    case 'diskFull':
      return { failure: 'diskFull', message, retry: false };
    case 'unavailable':
      return { failure: 'unavailable', message, retry: false };
    case 'invalid':
    case 'tooLarge':
      return { failure: 'other', message, retry: false };
    case 'notFetched':
    case 'notDownloaded':
    case 'tooManyAttributeFiles':
    case 'baseNotAncestor':
    case 'tooSlow':
    case 'busy':
    case 'readOnly':
    case 'git':
    case 'io':
      return { failure: 'other', message, retry: true };
    default:
      detail satisfies never;
      return { failure: 'other', message, retry: true };
  }
}

/** What git is doing, as the tab says it: "receiving objects, 44% of 1234". */
export function describeActivity(activity: Activity): string {
  switch (activity.kind) {
    case 'waitingForLock':
      return activity.holder === undefined
        ? 'waiting for the local copy'
        : `waiting while Lo is ${activity.holder}`;
    case 'connecting':
      return 'connecting to GitHub';
    case 'preparing':
      return activity.progress === undefined
        ? 'GitHub is preparing it'
        : describeProgress(activity.progress);
    case 'transferring':
      return describeProgress(activity.progress);
    default:
      activity satisfies never;
      throw new Error(`Lo doesn't know what git is doing: ${JSON.stringify(activity)}.`);
  }
}

/** What a local copy uses of a clone. */
export type Clone = Pick<
  Repo,
  | 'fetchPull'
  | 'fetchCommit'
  | 'fetchCommits'
  | 'branchBase'
  | 'hasCommit'
  | 'mergeBase'
  | 'isAncestor'
  | 'offline'
  | 'close'
>;

/** What a local copy opens its clone with: Lo's cache, which opens clones as `R`. */
export interface CloneCache<R extends Clone> {
  open(owner: string, name: string, options: OpenOptions): Promise<R>;
}

/** What a local copy uses of git: what Lo found, and its cache. */
export interface CopyGit<R extends Clone> {
  readonly status: GitStatus | undefined;
  readonly cache: CloneCache<R> | undefined;
}

export interface LocalCopyOptions<R extends Clone = Repo> {
  readonly git: CopyGit<R>;
  /** The repository by the name GitHub gives it now, which names its clone. */
  readonly repository: { readonly owner: string; readonly name: string };
  readonly number: number;
  /** The tab's account's token, read as each fetch starts, or none for a public repository. */
  readonly token?: TokenSource | undefined;
  /** The commit a stack's layer is compared with, as {@link LocalCopy.compareFrom} sets it. */
  readonly from?: string | undefined;
  /**
   * Hears the state each time it changes, but for what git is doing, which it hears at most every
   * {@link PROGRESS_EVERY} milliseconds, with the latest.
   */
  readonly changed: (state: LocalState) => void;
  readonly log: (line: string) => void;
}

/**
 * The head on screen, ready to read: with the base branch's tip it was fetched with, and where its
 * changes start, worked out with the commit it's compared with, if any.
 */
interface Ready {
  readonly head: Oid;
  readonly base: Oid;
  readonly mergeBase: Oid | undefined;
  readonly from: Compared | undefined;
}

/** What fetching is doing, while the head on screen isn't ready. */
type Fetching =
  | { readonly kind: 'idle' }
  | { readonly kind: 'fetching'; readonly progress: string | undefined }
  | { readonly kind: 'retrying'; readonly failure: Failure; readonly retryAt: number }
  | { readonly kind: 'failed'; readonly failure: Failure };

/**
 * One pull request's local copy. It waits for git and its cache, then fetches what it's asked to
 * want, one fetch at a time, and says the head on screen is ready once the clone has it. A fetch
 * that fails is tried again after 5 s, doubling to 5 minutes, unless waiting won't help; while
 * GitHub can't be reached, the head on screen is still ready if an earlier fetch brought it.
 */
export class LocalCopy<R extends Clone = Repo> {
  readonly #options: LocalCopyOptions<R>;
  /** What to fetch: the pull request as GitHub has it now. */
  #wanted: PullRequestRefs | undefined;
  /** What the last fetch that worked fetched. */
  #fetched: PullRequestRefs | undefined;
  /** The head on screen. */
  #shown: Oid | undefined;
  /** The commit a stack's layer is compared with, if it isn't compared with its base branch. */
  #from: Oid | undefined;
  /** The base branch's tip each head was fetched with, while Lo runs. */
  readonly #bases = new Map<Oid, Oid>();
  #ready: Ready | undefined;
  #fetching: Fetching = { kind: 'idle' };
  /** How many fetches in a row have failed: while any have, what's ready is an earlier fetch's. */
  #failures = 0;
  #repo: Promise<R> | undefined;
  /** The fetch under way, if any. */
  #running: Promise<void> | undefined;
  /** Whether to fetch again once the fetch under way ends. */
  #again = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  /** Aborted as the tab closes, which stops waiting for the clone. */
  readonly #closing = new AbortController();
  /** The state last said, or the one it started in until it has said one. */
  #state: LocalState;
  /** The state last said, as JSON, so the same one isn't said twice. */
  #said: string | undefined;
  /**
   * Says what git is doing, paced to {@link PROGRESS_EVERY}: only while it's still fetching, since
   * a fetch that's over says what comes next itself, once it knows.
   */
  readonly #sayProgress = paced(PROGRESS_EVERY, () => {
    if (this.#fetching.kind === 'fetching') this.#changed();
  });

  constructor(options: LocalCopyOptions<R>) {
    this.#options = options;
    if (options.from !== undefined) this.#from = parseOid(options.from);
    this.#state = this.#current();
  }

  /**
   * The local copy as the tab shows it: the state it last said, so the tab, sending it for reasons
   * of its own, never sends what git is doing before it's said.
   */
  get state(): LocalState {
    return this.#state;
  }

  /** The local copy as it is now. */
  #current(): LocalState {
    const ready = this.#ready;
    if (ready) {
      return {
        kind: 'ready',
        head: ready.head,
        base: ready.base,
        mergeBase: ready.mergeBase ?? null,
        ...(ready.from === undefined ? {} : { from: ready.from }),
        // What an earlier fetch brought, since the last fetch failed.
        offline: this.#failures > 0,
      };
    }
    const { status } = this.#options.git;
    if (status !== undefined && status.status !== 'found') {
      return { kind: 'noGit', message: status.message, install: status.install };
    }
    const fetching = this.#fetching;
    switch (fetching.kind) {
      case 'idle':
        return { kind: 'waiting' };
      case 'fetching':
        return {
          kind: 'fetching',
          progress: fetching.progress ?? null,
          attempt: this.#failures + 1,
        };
      case 'retrying':
        return {
          kind: 'retrying',
          failure: fetching.failure.failure,
          message: fetching.failure.message,
          attempt: this.#failures,
          retryAt: fetching.retryAt,
        };
      case 'failed':
        return {
          kind: 'failed',
          failure: fetching.failure.failure,
          message: fetching.failure.message,
        };
      default:
        fetching satisfies never;
        throw new Error(`A local copy in a state Lo doesn't know: ${JSON.stringify(fetching)}.`);
    }
  }

  /**
   * Fetches the pull request as GitHub has it now, once there's a cache: at once, or once the
   * fetch under way ends. The head on screen stays until {@link LocalCopy.show} moves it.
   */
  want(refs: PullRequestRefs): void {
    if (this.#closed) return;
    const wanted = sameRefs(this.#wanted, refs);
    this.#wanted = refs;
    // Already fetching it, or waiting to try it again, or fetched.
    if (wanted && (this.#fetching.kind !== 'idle' || sameRefs(this.#fetched, refs))) return;
    this.#fetch();
  }

  /** Puts `head` on screen: ready once the clone has it. */
  show(head: string): void {
    const oid = parseOid(head);
    if (this.#closed || this.#shown === oid) return;
    this.#shown = oid;
    this.#ready = undefined;
    this.#changed();
    void this.#settle();
  }

  /**
   * Compares the head on screen with `commit`, a stack's layer's start, or with its base branch for
   * nothing: its changes start where the head and the commit meet, never before where it branched
   * off its base branch. The commit is fetched by its ID if the copy lacks it. The head stays ready
   * meanwhile, said with what it was compared with until then.
   */
  compareFrom(commit: string | undefined): void {
    const oid = commit === undefined ? undefined : parseOid(commit);
    if (this.#closed || this.#from === oid) return;
    this.#from = oid;
    void this.#settle();
  }

  /** Tries again now, after a failure or while waiting to. */
  retry(): void {
    if (this.#closed) return;
    this.#failures = 0;
    this.#fetch();
  }

  /** Git or its cache changed: Lo found git, or opened the cache. */
  gitChanged(): void {
    if (this.#closed) return;
    this.#changed();
    if (this.#fetching.kind === 'idle' && this.#ready === undefined) this.#fetch();
  }

  /**
   * The clone, opened, once a fetch has opened it: for reading what's fetched, while the copy is
   * open. It closes with the copy, so a reader never closes it.
   */
  get clone(): Promise<R> | undefined {
    return this.#closed ? undefined : this.#repo;
  }

  /** Stops fetching and lets go of the clone, once the fetch under way, if any, ends. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#closing.abort(new Error('the tab closed'));
    const repo = this.#repo;
    if (!repo) return;
    void (this.#running ?? Promise.resolve())
      .then(() => repo)
      .then((opened) => opened.close())
      .catch(() => undefined);
  }

  /** Fetches now, or once the fetch under way ends. */
  #fetch(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#running) {
      this.#again = true;
      return;
    }
    const cache = this.#options.git.cache;
    if (!cache || this.#wanted === undefined) {
      this.#changed();
      return;
    }
    this.#running = this.#run(cache).finally(() => {
      this.#running = undefined;
      if (this.#again && !this.#closed) {
        this.#again = false;
        this.#fetch();
      }
    });
  }

  async #run(cache: CloneCache<R>): Promise<void> {
    const wanted = this.#wanted;
    if (wanted === undefined) return;
    this.#again = false;
    this.#fetching = { kind: 'fetching', progress: undefined };
    this.#changed();
    try {
      const repo = await this.#open(cache);
      const fetched = await repo.fetchPull(wanted);
      if (this.#closed) return;
      this.#bases.set(fetched.head, fetched.baseTip);
      if (wanted.head !== undefined && !this.#bases.has(wanted.head)) {
        this.#bases.set(wanted.head, fetched.baseTip);
      }
      // The head on screen, if GitHub has moved on from it since, by its ID.
      const shown = this.#shown;
      if (shown !== undefined && !(await repo.hasCommit(shown))) {
        const lost = await repo.fetchCommits(wanted.number, [shown]);
        if (lost.includes(shown)) throw new GitError({ kind: 'unavailable', oid: shown });
      }
      if (shown !== undefined && !this.#bases.has(shown)) this.#bases.set(shown, fetched.baseTip);
      if (this.#closed) return;
      this.#fetched = wanted;
      this.#failures = 0;
      this.#fetching = { kind: 'idle' };
      await this.#settle();
    } catch (error) {
      if (this.#closed) return;
      const failure = failureOf(error);
      this.#failures += 1;
      this.#options.log(
        `fetching ${this.#name()}: ${failure.message}${failure.retry ? '' : " (Lo won't try again by itself)"}`,
      );
      if (failure.retry) {
        const wait = retryWait(this.#failures);
        this.#fetching = { kind: 'retrying', failure, retryAt: Date.now() + wait };
        this.#timer = setTimeout(() => this.#fetch(), wait);
      } else {
        this.#fetching = { kind: 'failed', failure };
      }
      // What an earlier fetch brought is still there to read.
      if (this.#ready === undefined) await this.#settle();
      else this.#changed();
    }
  }

  /** The clone, opened once. One that couldn't be opened is opened again next time. */
  #open(cache: CloneCache<R>): Promise<R> {
    const { repository, token } = this.#options;
    this.#repo ??= cache
      .open(repository.owner, repository.name, {
        token,
        progress: (activity) => this.#progress(activity),
        signal: this.#closing.signal,
      })
      .catch((error: unknown) => {
        this.#repo = undefined;
        throw error;
      });
    return this.#repo;
  }

  #progress(activity: Activity): void {
    if (this.#closed || this.#fetching.kind !== 'fetching') return;
    this.#fetching = { kind: 'fetching', progress: describeActivity(activity) };
    this.#sayProgress();
  }

  /**
   * Works out whether the head on screen is ready: in the clone, with a base branch tip, whether
   * this fetch brought it or an earlier one did.
   */
  async #settle(): Promise<void> {
    const head = this.#shown;
    const wanted = this.#wanted;
    const repo = this.#repo;
    if (head === undefined || wanted === undefined || repo === undefined) {
      this.#changed();
      return;
    }
    try {
      const opened = await repo;
      const base =
        this.#bases.get(head) ?? (await opened.branchBase(wanted.number, wanted.baseBranch));
      if (
        base === undefined ||
        !(await opened.hasCommit(head)) ||
        !(await opened.hasCommit(base))
      ) {
        this.#changed();
        return;
      }
      let mergeBase = await opened.mergeBase(head, base);
      // A pull request merged into its base branch is in the branch's tip, which can't say where
      // it branched: GitHub's base, from before it merged, can, fetched by its ID if the branch
      // no longer holds it.
      const githubBase = wanted.base;
      if (mergeBase === head && githubBase !== undefined && githubBase !== base) {
        if (!(await opened.hasCommit(githubBase)) && !opened.offline) {
          await opened.fetchCommit(githubBase).catch((error: unknown) => {
            this.#options.log(`fetching GitHub's base ${githubBase}: ${failureOf(error).message}`);
          });
        }
        if (await opened.hasCommit(githubBase)) {
          mergeBase = await opened.mergeBase(head, githubBase);
        }
      }
      const from = this.#from;
      let compared: Compared | undefined;
      if (from !== undefined) {
        const branched = mergeBase;
        try {
          const has = await this.#have(opened, from);
          compared = { commit: from, missing: !has };
          if (has) mergeBase = await this.#meet(opened, head, from, branched);
        } catch (error) {
          // Ready all the same, from where the head branched, so what waits for it doesn't wait on.
          this.#options.log(`comparing ${this.#name()} with ${from}: ${failureOf(error).message}`);
          compared = { commit: from, missing: true };
          mergeBase = branched;
        }
      }
      if (this.#closed || this.#shown !== head || this.#from !== from) return;
      this.#ready = { head, base, mergeBase, from: compared };
    } catch (error) {
      this.#options.log(`reading ${this.#name()}: ${failureOf(error).message}`);
    }
    this.#changed();
  }

  /** Whether the clone has commit `oid`, fetched by its ID if it lacked it. */
  async #have(opened: R, oid: Oid): Promise<boolean> {
    if (await opened.hasCommit(oid)) return true;
    if (opened.offline) return false;
    try {
      await opened.fetchCommit(oid);
    } catch (error) {
      this.#options.log(`fetching ${oid}, which it's compared with: ${failureOf(error).message}`);
    }
    return opened.hasCommit(oid);
  }

  /**
   * Where `head` meets `from`, the commit its stack's layer is compared with: `from` itself when the
   * head holds it. A meeting before `branched`, where the head branched off its base branch, would
   * show what the base branch had then as the layer's own, so the changes start at `branched`
   * instead.
   */
  async #meet(
    opened: R,
    head: Oid,
    from: Oid,
    branched: Oid | undefined,
  ): Promise<Oid | undefined> {
    const met = await opened.mergeBase(head, from);
    if (met === undefined) return branched;
    if (branched === undefined || met === branched) return met;
    return (await opened.isAncestor(met, branched)) ? branched : met;
  }

  #name(): string {
    const { repository, number } = this.#options;
    return `${repository.owner}/${repository.name}#${number}`;
  }

  /** Says the state, if it changed. */
  #changed(): void {
    if (this.#closed) return;
    const state = this.#current();
    const said = JSON.stringify(state);
    if (said === this.#said) return;
    this.#state = state;
    this.#said = said;
    this.#options.changed(state);
  }
}
