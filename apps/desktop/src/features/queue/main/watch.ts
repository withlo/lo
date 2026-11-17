// Reading one merge queue's tab while it's on screen. The queue of the branch it shows is read
// every 20 s, backing off to every 2 minutes while reads fail. The pull requests waiting to join it
// are read every 2 minutes, backing off to every 10. The queues of the other branches it can switch
// to are counted on a schedule of their own, each once its count is 2 minutes old, backing off the
// same way. Nothing is read while the tab isn't on screen, or while its account is signed out or
// gone, and what was read last is kept for when it's back. A queue is a branch's, and read only
// while shown, so none of it goes through the poller's cache. Nothing here calls Electron.

import type { OpenPullRequestList, QueueView, QueueWaiting, TrunkRuleList } from '@lo/github';
import type { Stacks } from '@lo/stacks';

import type { QueueState } from '../contract.ts';
import { countOf, readOf, stacksOf, switchBranches } from './read.ts';

/** How often the queue on screen is read while reads succeed. */
export const QUEUE_EVERY = 20_000;
/** The longest wait between reads of the queue on screen, while they fail. */
export const QUEUE_MOST = 120_000;
/**
 * How often the pull requests waiting to join are read while reads succeed, and how old another
 * branch's count gets before it's read again.
 */
export const WAITING_EVERY = 120_000;
/**
 * The longest wait between reads of those waiting to join, or of the other branches' counts, while
 * they fail.
 */
export const WAITING_MOST = 600_000;

/** Where a merge queue's tab reads from: GitHub, as the tab's account, through its poller. */
export interface QueueSource {
  /** `branch`'s merge queue. */
  view(branch: string, signal: AbortSignal): Promise<QueueView>;
  /** The open pull requests into `branch`, with their auto-merge. */
  waiting(branch: string, signal: AbortSignal): Promise<QueueWaiting>;
  /**
   * The repository's open pull requests and rulesets, as the account's poller last read them, and
   * the stacks found among them.
   */
  repository(): {
    list: OpenPullRequestList | undefined;
    rules: TrunkRuleList | undefined;
    stacks?: Stacks | undefined;
  };
}

export interface QueueWatchOptions {
  /** The tab's id. */
  readonly id: string;
  /** The account it reads as. */
  readonly login: string;
  /** The branch it shows at first. */
  readonly branch: string;
  readonly source: QueueSource;
  /** Hears the tab's state each time it changes. */
  readonly publish: (state: QueueState) => void;
  readonly now?: () => number;
}

/** Why `error` failed a read, in words. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * When one kind of read is due: every `every` while it succeeds, and after each failure in a row,
 * twice as long as after the one before, from `every` up to `most`.
 */
class Cadence {
  readonly #every: number;
  readonly #most: number;
  #backoff: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** When it last succeeded or failed, once it has. */
  #doneAt: number | undefined;
  /** When it's due again after a failure, while it's failing. */
  retryAt: number | undefined;
  /** The generation of the read in flight, while one is. */
  inFlight: number | undefined;

  constructor(every: number, most: number) {
    this.#every = every;
    this.#most = most;
    this.#backoff = every;
  }

  /** It succeeded at `now`: it's due again in `every`, which it returns. */
  succeeded(now: number): number {
    this.#backoff = this.#every;
    this.#doneAt = now;
    this.retryAt = undefined;
    return this.#every;
  }

  /** It failed at `now`: it's due again after twice the wait before, up to `most`; it returns it. */
  failed(now: number): number {
    const wait = this.#backoff;
    this.#backoff = Math.min(wait * 2, this.#most);
    this.#doneAt = now;
    this.retryAt = now + wait;
    return wait;
  }

  /** As if it had never run: due at once, and its first failure waits `every`. */
  reset(): void {
    this.#backoff = this.#every;
    this.#doneAt = undefined;
    this.retryAt = undefined;
  }

  /** How long from `now` until it's due: none if it's never run. */
  dueIn(now: number): number {
    if (this.retryAt !== undefined) return this.retryAt - now;
    return this.#doneAt === undefined ? 0 : this.#doneAt + this.#every - now;
  }

  /** Runs `read` in `delay`, instead of when it was to run. */
  schedule(delay: number, read: () => Promise<void>): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void read(), Math.max(0, delay));
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/** One merge queue's tab, read while it's on screen. */
export class QueueWatch {
  readonly #options: QueueWatchOptions;
  readonly #now: () => number;
  readonly #abort = new AbortController();
  #branch: string;
  /** The branches shown before, oldest first, which the switch keeps offering. */
  readonly #before: string[] = [];
  /** How many entries each branch's queue held, and when that was read. */
  readonly #counts = new Map<string, { count: number | null; at: number }>();
  #view: QueueView | undefined;
  #readAt: number | undefined;
  /** Why the last read of the queue failed, while reads of it fail. */
  #failure: string | undefined;
  #waiting: QueueWaiting | undefined;
  #waitingFailed = false;
  /** Bumped as the branch changes, so a read of the one before is dropped as it answers. */
  #generation = 0;
  readonly #queue = new Cadence(QUEUE_EVERY, QUEUE_MOST);
  readonly #joining = new Cadence(WAITING_EVERY, WAITING_MOST);
  readonly #others = new Cadence(WAITING_EVERY, WAITING_MOST);
  /** Why nothing is read, while the account is signed out or gone. */
  #held: string | undefined;
  #shown = false;
  #stopped = false;

  constructor(options: QueueWatchOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#branch = options.branch;
  }

  /** The account the tab reads as. */
  get login(): string {
    return this.#options.login;
  }

  /** What the tab shows now. */
  state(): QueueState {
    const { list, rules, stacks } = this.#options.source.repository();
    const { login } = this.#options;
    return {
      id: this.#options.id,
      branch: this.#branch,
      branches: switchBranches(this.#branch, this.#before, list, rules).map((name) => ({
        name,
        count: this.#counts.get(name)?.count ?? null,
      })),
      read: readOf(this.#view, this.#waiting, this.#waitingFailed, login, stacksOf(stacks)),
      readAt: this.#readAt ?? null,
      failure:
        this.#held !== undefined
          ? { message: this.#held, retryAt: null }
          : this.#failure === undefined
            ? null
            : { message: this.#failure, retryAt: this.#queue.retryAt ?? null },
    };
  }

  /**
   * The tab is on screen: its reads start, each when it's due, at once for what hasn't been read
   * or was read longer ago than it's read every.
   */
  show(): void {
    if (this.#shown || this.#stopped) return;
    this.#shown = true;
    this.#start();
  }

  /**
   * The tab is off screen: nothing more is read until it's back, the other branches' counts
   * included. A read in flight still lands.
   */
  hide(): void {
    this.#shown = false;
    this.#cancel();
  }

  /**
   * The account is signed out or gone: nothing is read until {@link release}, and the tab says
   * `why`. What's in flight is dropped as it answers.
   */
  hold(why: string): void {
    if (this.#stopped) return;
    this.#held = why;
    this.#cancel();
    this.#publish();
  }

  /** The account is back: while the tab's on screen, everything is read again at once. */
  release(): void {
    if (this.#held === undefined || this.#stopped) return;
    this.#held = undefined;
    this.#failure = undefined;
    this.#queue.reset();
    this.#joining.reset();
    this.#others.reset();
    this.#publish();
    this.#start();
  }

  /**
   * The tab shows `branch` now: what was read of the one before is dropped, and, while it's on
   * screen, the new one is read at once.
   */
  setBranch(branch: string): void {
    if (branch === this.#branch || this.#stopped) return;
    if (!this.#before.includes(this.#branch)) this.#before.push(this.#branch);
    this.#branch = branch;
    this.#generation += 1;
    this.#view = undefined;
    this.#readAt = undefined;
    this.#failure = undefined;
    this.#waiting = undefined;
    this.#waitingFailed = false;
    this.#queue.reset();
    this.#joining.reset();
    this.#publish();
    this.#start();
  }

  /** The tab closed: nothing more is read, and what's waiting to be read is given up. */
  stop(): void {
    this.#stopped = true;
    this.hide();
    this.#abort.abort();
  }

  /** Whether anything may be read now: the tab's open and on screen, and its account is there. */
  #reading(): boolean {
    return this.#shown && this.#held === undefined && !this.#stopped;
  }

  /** Whether a read of generation `generation` that just answered still counts. */
  #current(generation: number): boolean {
    return generation === this.#generation && this.#held === undefined && !this.#stopped;
  }

  /** Each kind of read not in flight, when it's due. */
  #start(): void {
    if (!this.#reading()) return;
    const now = this.#now();
    if (this.#queue.inFlight !== this.#generation) {
      this.#queue.schedule(this.#queue.dueIn(now), () => this.#readQueue());
    }
    if (this.#joining.inFlight !== this.#generation) {
      this.#joining.schedule(this.#joining.dueIn(now), () => this.#readWaiting());
    }
    if (this.#others.inFlight === undefined) {
      this.#others.schedule(this.#others.dueIn(now), () => this.#countOthers());
    }
  }

  #cancel(): void {
    this.#queue.cancel();
    this.#joining.cancel();
    this.#others.cancel();
  }

  /** Runs `read` again in `wait`, while anything may be read. */
  #again(cadence: Cadence, wait: number, read: () => Promise<void>): void {
    if (this.#reading()) cadence.schedule(wait, read);
  }

  #publish(): void {
    if (!this.#stopped) this.#options.publish(this.state());
  }

  async #readQueue(): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    this.#queue.inFlight = generation;
    let read: { view: QueueView } | { error: unknown };
    try {
      read = { view: await this.#options.source.view(branch, this.#abort.signal) };
    } catch (error) {
      read = { error };
    }
    if (this.#queue.inFlight === generation) this.#queue.inFlight = undefined;
    // The branch changed meanwhile, and the new one's read is on its way; or the account went, or
    // the tab closed.
    if (!this.#current(generation)) return;
    const now = this.#now();
    let wait: number;
    if ('view' in read) {
      this.#view = read.view;
      this.#readAt = now;
      this.#failure = undefined;
      this.#counts.set(branch, { count: countOf(read.view), at: now });
      wait = this.#queue.succeeded(now);
    } else {
      this.#failure = messageOf(read.error);
      wait = this.#queue.failed(now);
    }
    this.#publish();
    this.#again(this.#queue, wait, () => this.#readQueue());
  }

  async #readWaiting(): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    this.#joining.inFlight = generation;
    let waiting: QueueWaiting | undefined;
    try {
      waiting = await this.#options.source.waiting(branch, this.#abort.signal);
    } catch {
      waiting = undefined;
    }
    if (this.#joining.inFlight === generation) this.#joining.inFlight = undefined;
    if (!this.#current(generation)) return;
    const now = this.#now();
    let wait: number;
    if (waiting === undefined) {
      this.#waitingFailed = true;
      wait = this.#joining.failed(now);
    } else {
      this.#waiting = waiting;
      this.#waitingFailed = false;
      wait = this.#joining.succeeded(now);
    }
    this.#publish();
    this.#again(this.#joining, wait, () => this.#readWaiting());
  }

  /**
   * Counts the entries of the queues of the other branches the switch offers, those whose count is
   * 2 minutes old or was never read, one at a time, stopping as the tab goes off screen.
   */
  async #countOthers(): Promise<void> {
    const { source } = this.#options;
    const { list, rules } = source.repository();
    const now = this.#now();
    const due = switchBranches(this.#branch, this.#before, list, rules).filter((each) => {
      const known = this.#counts.get(each);
      return each !== this.#branch && (known === undefined || now - known.at >= WAITING_EVERY);
    });
    this.#others.inFlight = this.#generation;
    let counted = false;
    let failed = false;
    for (const other of due) {
      if (!this.#reading()) break;
      try {
        const view = await source.view(other, this.#abort.signal);
        this.#counts.set(other, { count: countOf(view), at: this.#now() });
        counted = true;
      } catch {
        // Its count stays as last read.
        failed = true;
      }
    }
    this.#others.inFlight = undefined;
    if (this.#stopped) return;
    if (counted) this.#publish();
    // Off screen, or its account went: those left are counted once it's back, as they're due.
    if (!this.#reading()) return;
    const wait = failed ? this.#others.failed(this.#now()) : this.#others.succeeded(this.#now());
    this.#again(this.#others, wait, () => this.#countOthers());
  }
}
