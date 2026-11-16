// Reading one merge queue's tab while it's on screen: the queue of the branch it shows every 20 s,
// backing off to every 2 minutes while reads fail, and every 2 minutes the pull requests waiting to
// join it and how many entries the other branches' queues hold, or after 20 s when that failed. Nothing is read while the tab isn't
// on screen, and what was read last is kept for when it's back. A queue is a branch's, and read only
// while shown, so none of it goes through the poller's cache. Nothing here calls Electron.

import type { OpenPullRequestList, QueueView, QueueWaiting, TrunkRuleList } from '@lo/github';
import type { Stacks } from '@lo/stacks';

import type { QueueState } from '../contract.ts';
import { countOf, readOf, stacksOf, switchBranches } from './read.ts';

/** How often the queue on screen is read while reads succeed. */
export const QUEUE_EVERY = 20_000;
/** The longest wait between reads of the queue on screen, while they fail. */
export const QUEUE_MOST = 120_000;
/** How often the pull requests waiting to join, and the other branches' counts, are read. */
export const WAITING_EVERY = 120_000;

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

/** One merge queue's tab, read while it's on screen. */
export class QueueWatch {
  readonly #options: QueueWatchOptions;
  readonly #now: () => number;
  readonly #abort = new AbortController();
  #branch: string;
  /** The branches shown before, oldest first, which the switch keeps offering. */
  readonly #before: string[] = [];
  /** How many entries each branch's queue held, as last read. */
  readonly #counts = new Map<string, number | null>();
  #view: QueueView | undefined;
  #readAt: number | undefined;
  #failure: { message: string; retryAt: number } | undefined;
  /** How long to wait after the next failure. */
  #backoff = QUEUE_EVERY;
  #waiting: QueueWaiting | undefined;
  #waitingFailed = false;
  #waitingAt: number | undefined;
  /** Bumped as the branch changes, so a read of the one before is dropped as it answers. */
  #generation = 0;
  /** The generation each read in flight is of, while one is. */
  #queueInFlight: number | undefined;
  #waitingInFlight: number | undefined;
  #queueTimer: ReturnType<typeof setTimeout> | undefined;
  #waitingTimer: ReturnType<typeof setTimeout> | undefined;
  #shown = false;
  #stopped = false;

  constructor(options: QueueWatchOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#branch = options.branch;
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
        count: this.#counts.get(name) ?? null,
      })),
      read: readOf(this.#view, this.#waiting, this.#waitingFailed, login, stacksOf(stacks)),
      readAt: this.#readAt ?? null,
      failure: this.#failure ?? null,
    };
  }

  /**
   * The tab is on screen: its reads start, each when it's due, at once for what hasn't been read
   * or was read longer ago than it's read every.
   */
  show(): void {
    if (this.#shown || this.#stopped) return;
    this.#shown = true;
    const now = this.#now();
    if (this.#queueInFlight !== this.#generation) {
      const due =
        this.#failure?.retryAt ?? (this.#readAt === undefined ? now : this.#readAt + QUEUE_EVERY);
      this.#scheduleQueue(due - now);
    }
    if (this.#waitingInFlight !== this.#generation) {
      const due = this.#waitingAt === undefined ? now : this.#waitingAt + WAITING_EVERY;
      this.#scheduleWaiting(due - now);
    }
  }

  /** The tab is off screen: nothing more is read until it's back. A read in flight still lands. */
  hide(): void {
    this.#shown = false;
    clearTimeout(this.#queueTimer);
    clearTimeout(this.#waitingTimer);
  }

  /**
   * The tab shows `branch` now: what was read of the one before is dropped, and, while it's on
   * screen, the new one is read at once.
   */
  setBranch(branch: string): void {
    if (branch === this.#branch || this.#stopped) return;
    const before = this.#before.indexOf(this.#branch);
    if (before < 0) this.#before.push(this.#branch);
    this.#branch = branch;
    this.#generation += 1;
    this.#view = undefined;
    this.#readAt = undefined;
    this.#failure = undefined;
    this.#backoff = QUEUE_EVERY;
    this.#waiting = undefined;
    this.#waitingFailed = false;
    this.#waitingAt = undefined;
    this.#publish();
    if (this.#shown) {
      this.#scheduleQueue(0);
      this.#scheduleWaiting(0);
    }
  }

  /** The tab closed: nothing more is read, and what's waiting to be read is given up. */
  stop(): void {
    this.#stopped = true;
    this.hide();
    this.#abort.abort();
  }

  #publish(): void {
    if (!this.#stopped) this.#options.publish(this.state());
  }

  #scheduleQueue(delay: number): void {
    clearTimeout(this.#queueTimer);
    if (!this.#shown || this.#stopped) return;
    this.#queueTimer = setTimeout(() => void this.#readQueue(), Math.max(0, delay));
  }

  #scheduleWaiting(delay: number): void {
    clearTimeout(this.#waitingTimer);
    if (!this.#shown || this.#stopped) return;
    this.#waitingTimer = setTimeout(() => void this.#readWaiting(), Math.max(0, delay));
  }

  async #readQueue(): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    this.#queueInFlight = generation;
    let read: { view: QueueView } | { error: unknown };
    try {
      read = { view: await this.#options.source.view(branch, this.#abort.signal) };
    } catch (error) {
      read = { error };
    }
    if (this.#queueInFlight === generation) this.#queueInFlight = undefined;
    // The branch changed meanwhile, and the new one's read is on its way; or the tab closed.
    if (generation !== this.#generation || this.#stopped) return;
    const now = this.#now();
    if ('view' in read) {
      this.#view = read.view;
      this.#readAt = now;
      this.#failure = undefined;
      this.#backoff = QUEUE_EVERY;
      this.#counts.set(branch, countOf(read.view));
      this.#publish();
      this.#scheduleQueue(QUEUE_EVERY);
      return;
    }
    const wait = this.#backoff;
    this.#backoff = Math.min(wait * 2, QUEUE_MOST);
    this.#failure = { message: messageOf(read.error), retryAt: now + wait };
    this.#publish();
    this.#scheduleQueue(wait);
  }

  async #readWaiting(): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    const { source } = this.#options;
    this.#waitingInFlight = generation;
    let waiting: QueueWaiting | undefined;
    try {
      waiting = await source.waiting(branch, this.#abort.signal);
    } catch {
      waiting = undefined;
    }
    // The other branches the switch offers, for how many entries each queue holds.
    const { list, rules } = source.repository();
    const others = switchBranches(branch, this.#before, list, rules).filter(
      (each) => each !== branch,
    );
    const counts = new Map<string, number | null>();
    for (const other of others) {
      if (generation !== this.#generation || this.#stopped) break;
      try {
        counts.set(other, countOf(await source.view(other, this.#abort.signal)));
      } catch {
        // Its count stays as last read.
      }
    }
    if (this.#waitingInFlight === generation) this.#waitingInFlight = undefined;
    if (generation !== this.#generation || this.#stopped) return;
    if (waiting === undefined) this.#waitingFailed = true;
    else {
      this.#waiting = waiting;
      this.#waitingFailed = false;
    }
    for (const [other, count] of counts) this.#counts.set(other, count);
    this.#waitingAt = this.#now();
    this.#publish();
    // One that failed is read again as soon as the queue is, rather than in 2 minutes.
    this.#scheduleWaiting(waiting === undefined ? QUEUE_EVERY : WAITING_EVERY);
  }
}
