// Reading one merge queue's tab while it's on screen. The queue of the branch it shows is read
// every 20 s, backing off to every 2 minutes while reads fail. The pull requests waiting to join it
// are read every 2 minutes, backing off to every 10. The queues of the other branches it can switch
// to are counted on a schedule of their own, each once its count is 2 minutes old, backing off the
// same way. Nothing is read while the tab isn't on screen, or while its account is signed out or
// gone, and what was read last is kept for when it's back. An entry a read no longer lists, when it
// lists every entry, left the queue: why is read, once more after a short wait when GitHub's
// timeline hasn't caught up. A queue is a branch's, and read only while shown, so none of it goes
// through the poller's cache. What a change to the queue acts on is read afresh when the last read
// is too old or failed, on screen or not, and so is what settles a change whose answer was lost.
// Nothing here calls Electron.

import {
  queueViewCutShort,
  type OpenPullRequestList,
  type QueueRemoval,
  type QueueView,
  type QueueWaiting,
  type TrunkRuleList,
} from '@lo/github';
import { leftSince } from '@lo/review';
import type { Stacks } from '@lo/stacks';

import { QUEUE_EVERY, type LeftEntry, type QueueState } from '../contract.ts';
import { causeOf } from './causes.ts';
import { countOf, leftOf, readOf, stacksOf, switchBranches, timeOf, type Leaver } from './read.ts';

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
/** How many of those Lo saw leave a branch's queue the tab lists, the latest first. */
export const LEFT_MOST = 20;
/** How long to wait before reading why one left once more, when GitHub's timeline hasn't caught up. */
export const LEFT_AGAIN = 15_000;

/** Waits `ms`, or until `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Where a merge queue's tab reads from: GitHub, as the tab's account, through its poller. */
export interface QueueSource {
  /** `branch`'s merge queue. */
  view(branch: string, signal: AbortSignal): Promise<QueueView>;
  /** The open pull requests into `branch`, with their auto-merge. */
  waiting(branch: string, signal: AbortSignal): Promise<QueueWaiting>;
  /** Why pull request `number` last left its merge queue. */
  removal(number: number, signal: AbortSignal): Promise<QueueRemoval>;
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
  /**
   * Hears each read of the branch shown that answered: of its queue, or of those waiting to join
   * it, with what it read and when it was asked for.
   */
  readonly heard?: (read: Heard) => void;
  readonly now?: () => number;
}

/** A read of the branch a merge queue's tab shows that answered, and when it was asked for. */
export type Heard =
  | { readonly kind: 'queue'; readonly view: QueueView; readonly from: number }
  | { readonly kind: 'waiting'; readonly waiting: QueueWaiting; readonly from: number };

/** A read under way: what answers once it's done, and when it was asked for. */
interface Run {
  readonly done: Promise<void>;
  readonly from: number;
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
  /** When the read that gave {@link #view} was asked for. */
  #viewFrom: number | undefined;
  /** The read of the queue under way, while one is, and when it was asked for. */
  #queueRun: Run | undefined;
  /** Why the last read of the queue failed, while reads of it fail. */
  #failure: string | undefined;
  /** Why the last read failed, in the reader's words, where its cause is known. */
  #failureReason: string | undefined;
  #waiting: QueueWaiting | undefined;
  #waitingFailed = false;
  /** When the read that gave {@link #waiting} was asked for. */
  #waitingFrom: number | undefined;
  /** Why the last read of those waiting failed, while reads of them fail. */
  #waitingFailure: string | undefined;
  /** The read of those waiting under way, while one is, and when it was asked for. */
  #waitingRun: Run | undefined;
  /** Those Lo saw leave each branch's queue, by branch, the latest first. */
  readonly #left = new Map<string, LeftEntry[]>();
  /** The pull requests whose leaving is being read, as `<branch>#<number>`. */
  readonly #leaving = new Set<string>();
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

  /** The branch the tab shows. */
  get branch(): string {
    return this.#branch;
  }

  /** Why nothing is read, while the account is signed out or gone. */
  get away(): string | undefined {
    return this.#held;
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
      read: readOf(
        this.#view,
        this.#waiting,
        this.#waitingFailed,
        login,
        stacksOf(stacks),
        this.#left.get(this.#branch),
      ),
      readAt: this.#readAt ?? null,
      failure:
        this.#held !== undefined
          ? { message: this.#held, retryAt: null }
          : this.#failure === undefined
            ? null
            : {
                message: this.#failure,
                retryAt: this.#queue.retryAt ?? null,
                ...(this.#failureReason !== undefined && { reason: this.#failureReason }),
              },
      away: this.#held !== undefined,
    };
  }

  /**
   * The branch's queue, as read no longer than `within` ago, and after `since` when it's given: the
   * last read when it answered then, else a read made now, on screen or not; or why there's none,
   * as when that read fails, the account is away, or the tab shows another branch by the time it
   * answers.
   */
  async fresh(within: number, since?: number): Promise<QueueView | string> {
    const branch = this.#branch;
    for (let tries = 0; tries < 2; tries++) {
      const why = this.#unreadable(branch);
      if (why !== undefined) return why;
      const from = this.#viewFrom;
      const now = this.#now();
      if (
        this.#view !== undefined &&
        this.#failure === undefined &&
        from !== undefined &&
        now - from <= within &&
        (since === undefined || from > since)
      ) {
        return this.#view;
      }
      const awaited = this.#queueRunAfter(since);
      await awaited?.done;
      const after = this.#unreadable(branch);
      if (after !== undefined) return after;
      if (this.#failure !== undefined) return this.#failure;
      // The read awaited answered, however long it took: no other is needed.
      const read = this.#viewFrom;
      if (
        this.#view !== undefined &&
        read !== undefined &&
        awaited !== undefined &&
        read >= awaited.from &&
        (since === undefined || read > since)
      ) {
        return this.#view;
      }
    }
    return this.#view ?? 'Lo hasn’t read the queue yet.';
  }

  /**
   * Those waiting to join the branch's queue, as {@link fresh} reads the queue: read no longer than
   * `within` ago and after `since`, else read now; or why there's none.
   */
  async freshWaiting(within: number, since?: number): Promise<QueueWaiting | string> {
    const branch = this.#branch;
    for (let tries = 0; tries < 2; tries++) {
      const why = this.#unreadable(branch);
      if (why !== undefined) return why;
      const from = this.#waitingFrom;
      const now = this.#now();
      if (
        this.#waiting !== undefined &&
        !this.#waitingFailed &&
        from !== undefined &&
        now - from <= within &&
        (since === undefined || from > since)
      ) {
        return this.#waiting;
      }
      const awaited = this.#waitingRunAfter(since);
      await awaited?.done;
      const after = this.#unreadable(branch);
      if (after !== undefined) return after;
      if (this.#waitingFailed) return this.#waitingFailure ?? 'GitHub didn’t respond.';
      const read = this.#waitingFrom;
      if (
        this.#waiting !== undefined &&
        read !== undefined &&
        awaited !== undefined &&
        read >= awaited.from &&
        (since === undefined || read > since)
      ) {
        return this.#waiting;
      }
    }
    return this.#waiting ?? 'Lo hasn’t read those waiting to join yet.';
  }

  /**
   * The read of the queue to wait for: the one under way when it began after `since`, else one begun
   * now, or, while an older one is under way, that one, after which one is begun.
   */
  #queueRunAfter(since: number | undefined): Run | undefined {
    const run = this.#queueRun;
    if (run !== undefined && (since === undefined || run.from > since)) return run;
    void this.#readQueue();
    return this.#queueRun;
  }

  /** The read of those waiting to join to wait for, as {@link #queueRunAfter} picks the queue's. */
  #waitingRunAfter(since: number | undefined): Run | undefined {
    const run = this.#waitingRun;
    if (run !== undefined && (since === undefined || run.from > since)) return run;
    void this.#readWaiting();
    return this.#waitingRun;
  }

  /** Why nothing of `branch` can be read now: the tab closed, the account is away, or it moved on. */
  #unreadable(branch: string): string | undefined {
    if (this.#stopped) return 'The merge queue’s tab is closed.';
    if (this.#held !== undefined) return this.#held;
    if (branch !== this.#branch) return `The tab shows ${this.#branch}’s queue now.`;
    return undefined;
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
    this.#viewFrom = undefined;
    this.#failure = undefined;
    this.#waiting = undefined;
    this.#waitingFailed = false;
    this.#waitingFrom = undefined;
    this.#waitingFailure = undefined;
    // A read of the branch before that's under way is dropped as it answers.
    this.#queueRun = undefined;
    this.#waitingRun = undefined;
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

  /** Reads the queue now, or waits for the read of it under way, for the branch shown. */
  #readQueue(): Promise<void> {
    const run = this.#queueRun;
    if (run !== undefined) return run.done;
    const from = this.#now();
    const done = this.#runQueueRead(from).finally(() => {
      if (this.#queueRun?.done === done) this.#queueRun = undefined;
    });
    this.#queueRun = { done, from };
    return done;
  }

  async #runQueueRead(from: number): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    // Read now: the one that was due goes, and the next is due from this one.
    this.#queue.cancel();
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
      this.#saw(branch, this.#view, read.view, now);
      this.#view = read.view;
      this.#readAt = now;
      this.#viewFrom = from;
      this.#failure = undefined;
      this.#counts.set(branch, { count: countOf(read.view), at: now });
      wait = this.#queue.succeeded(now);
    } else {
      this.#failure = messageOf(read.error);
      const { why } = causeOf(read.error, this.#options.login);
      this.#failureReason = why === '' ? undefined : why;
      wait = this.#queue.failed(now);
    }
    this.#publish();
    if ('view' in read) this.#options.heard?.({ kind: 'queue', view: read.view, from });
    this.#again(this.#queue, wait, () => this.#readQueue());
  }

  /**
   * Notes what left `branch`'s queue between `before` and `after`, two reads of it: each entry
   * `before` listed that `after` doesn't, when `after` lists every entry, left, and why is read, for
   * as many as the tab lists, those nearest the front first. Those `after` lists are in the queue
   * again, and are no longer listed as having left.
   */
  #saw(branch: string, before: QueueView | undefined, after: QueueView, now: number): void {
    const listed = new Set(
      (after.queue?.entries ?? []).flatMap((entry) =>
        entry.pullRequest ? [entry.pullRequest.number] : [],
      ),
    );
    const left = this.#left.get(branch);
    if (left?.some((each) => listed.has(each.number))) {
      this.#left.set(
        branch,
        left.filter((each) => !listed.has(each.number)),
      );
    }
    // A read that may not list every entry says nothing of what left.
    if (before === undefined || queueViewCutShort(after)) return;
    const leavers = (before.queue?.entries ?? []).flatMap((entry) => {
      const pull = entry.pullRequest;
      if (!pull || listed.has(pull.number)) return [];
      return [
        {
          number: pull.number,
          title: pull.title,
          url: pull.url,
          enqueuedAt: timeOf(entry.enqueuedAt),
        },
      ];
    });
    // Only as many as the tab lists: a long hide can see the whole queue go.
    for (const leaver of leavers.slice(0, LEFT_MOST)) void this.#readLeft(branch, leaver, now);
  }

  /** Why `number` left, as GitHub says, or nothing when it couldn't be read. */
  async #removal(number: number): Promise<QueueRemoval | undefined> {
    try {
      return await this.#options.source.removal(number, this.#abort.signal);
    } catch {
      // Lo can't tell why it left, which the row says.
      return undefined;
    }
  }

  /**
   * Reads why `leaver` left `branch`'s queue, which Lo saw at `seenAt`, and lists it. A removal
   * from before it joined is an earlier entry's, and none at all, or GitHub saying it's in the
   * queue still, a timeline that hasn't caught up: it's read once more after a short wait, and then
   * Lo can't tell why, unless GitHub says it's in the queue again.
   */
  async #readLeft(branch: string, leaver: Leaver, seenAt: number): Promise<void> {
    const key = `${branch}#${leaver.number}`;
    if (this.#leaving.has(key)) return;
    this.#leaving.add(key);
    const joined = leaver.enqueuedAt ?? undefined;
    let removal = await this.#removal(leaver.number);
    if (removal && !leftSince(removal, joined) && !this.#stopped) {
      await pause(LEFT_AGAIN, this.#abort.signal);
      const again = this.#stopped ? undefined : await this.#removal(leaver.number);
      removal = again && (leftSince(again, joined) || again.inQueue) ? again : undefined;
    }
    this.#leaving.delete(key);
    if (this.#stopped) return;
    const left = leftOf(leaver, removal, seenAt);
    if (left === undefined) return;
    const others = (this.#left.get(branch) ?? []).filter((each) => each.number !== left.number);
    this.#left.set(branch, [left, ...others].slice(0, LEFT_MOST));
    if (branch === this.#branch) this.#publish();
  }

  /** Reads those waiting to join now, or waits for the read of them under way. */
  #readWaiting(): Promise<void> {
    const run = this.#waitingRun;
    if (run !== undefined) return run.done;
    const from = this.#now();
    const done = this.#runWaitingRead(from).finally(() => {
      if (this.#waitingRun?.done === done) this.#waitingRun = undefined;
    });
    this.#waitingRun = { done, from };
    return done;
  }

  async #runWaitingRead(from: number): Promise<void> {
    const generation = this.#generation;
    const branch = this.#branch;
    this.#joining.cancel();
    this.#joining.inFlight = generation;
    let read: { waiting: QueueWaiting } | { error: unknown };
    try {
      read = { waiting: await this.#options.source.waiting(branch, this.#abort.signal) };
    } catch (error) {
      read = { error };
    }
    if (this.#joining.inFlight === generation) this.#joining.inFlight = undefined;
    if (!this.#current(generation)) return;
    const now = this.#now();
    let wait: number;
    if ('error' in read) {
      this.#waitingFailed = true;
      this.#waitingFailure = messageOf(read.error);
      wait = this.#joining.failed(now);
    } else {
      this.#waiting = read.waiting;
      this.#waitingFailed = false;
      this.#waitingFailure = undefined;
      this.#waitingFrom = from;
      wait = this.#joining.succeeded(now);
    }
    this.#publish();
    if ('waiting' in read) this.#options.heard?.({ kind: 'waiting', waiting: read.waiting, from });
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
