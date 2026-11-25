/**
 * One request queue per account. GitHub asks integrations to make requests serially rather than
 * concurrently, and to wait at least a second between mutations.
 */

import type { RequestGate } from '../client.ts';

/**
 * A request waiting for its turn: starting it, or leaving the queue when it's given up on; when it
 * came, by the queue's count; for a read that may be a foreground one, its priority now; and, for a
 * read, whether it gives way while it's a background one ({@link RequestQueue.giveWayWhile}), and
 * what it waits behind, if anything ({@link RequestQueue.gate}).
 */
interface Waiter {
  start: (release: () => void) => void;
  came: number;
  priority?: (() => ReadPriority) | undefined;
  givesWay: boolean;
  holds?: (() => boolean) | undefined;
}

/**
 * Who waits on a read: someone looking at the screen, as a pull request's tab opening on its
 * overview does (`foreground`); someone looking at the screen once what they wait on first is in,
 * as the Files panel's list beside a tab's timeline (`next`); or nobody in particular, as for polls
 * (`background`).
 */
export type ReadPriority = 'foreground' | 'next' | 'background';

/**
 * A read's priority: fixed, or as it stands whenever its turn could come, for a read that stops
 * being waited on as the screen changes.
 */
export type ReadPriorityNow = ReadPriority | (() => ReadPriority);

/**
 * Runs an account's requests one at a time, spacing its writes. Waiting requests take their turns
 * first in, first out, except that a waiting write goes before every waiting read, and a waiting
 * foreground read before every waiting background read: a comment or a merge the user is waiting
 * on doesn't queue behind polls, and nor does what a tab needs to open on. A `next` read goes
 * before the other background reads, polls included. A read's priority may change while it waits,
 * as its tab is hidden or shown again: it's taken as it stands whenever the queue comes free, and a
 * read that's a background one then waits in the order it came. A request already under way always
 * finishes first.
 *
 * A foreground read of many requests, or one of several the poller makes in a row, frees the queue
 * between them, so a background read could take the turn there and hold the rest up. A background
 * read, or a `next` one, gives way instead while the poller says one of those is under way or next
 * ({@link RequestQueue.giveWayWhile}), except the poller's own, which it makes in its turn.
 */
export class RequestQueue {
  readonly #spacing: number;
  readonly #clock: () => number;
  /** Whether a request holds the queue. */
  #busy = false;
  /** When the last write finished, by `#clock`. */
  #lastWrite: number | undefined;
  /** How many requests have waited, which orders them by when they came. */
  #came = 0;
  readonly #writes: Waiter[] = [];
  /** Reads that are foreground or `next` ones, or may be by the time the queue comes free. */
  readonly #leading: Waiter[] = [];
  readonly #reads: Waiter[] = [];
  /** Whether a foreground read is under way or next, which background reads give way to. */
  #ahead: () => boolean = () => false;

  /**
   * A queue whose writes start at least `spacing` milliseconds after the previous write finished,
   * by `clock`, which only moves forward.
   */
  constructor(spacing: number, clock: () => number = () => performance.now()) {
    this.#spacing = spacing;
    this.#clock = clock;
  }

  /**
   * Waits for the queue: at once when it's free and nothing is waiting, else behind the requests
   * already waiting, writes ahead of foreground reads, and those ahead of background reads, as
   * their priorities stand when the queue comes free.
   * Resolves with the function that ends the turn, which does so once however often it's called. A
   * request given up on through `signal` while it waits leaves the queue, and the wait rejects with
   * the signal's reason.
   */
  #turn(
    kind: 'write' | ReadPriorityNow,
    signal?: AbortSignal,
    givesWay = false,
    holds?: () => boolean,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abandoned(signal));
    const priority = priorityOf(kind);
    const waits = this.#writes.length + this.#leading.length + this.#reads.length > 0;
    const held = holds?.() === true || (givesWay && priority?.() !== 'foreground' && this.#ahead());
    if (!this.#busy && !waits && !held) {
      this.#busy = true;
      return Promise.resolve(this.#release());
    }
    return new Promise((resolve, reject) => {
      const waiting = kind === 'write' ? this.#writes : priority ? this.#leading : this.#reads;
      this.#came += 1;
      const waiter: Waiter = {
        start: (release) => {
          signal?.removeEventListener('abort', abandon);
          resolve(release);
        },
        came: this.#came,
        priority,
        givesWay,
        holds,
      };
      const abandon = () => {
        const at = waiting.indexOf(waiter);
        if (at >= 0) waiting.splice(at, 1);
        reject(abandoned(signal));
      };
      signal?.addEventListener('abort', abandon, { once: true });
      waiting.push(waiter);
      // The queue is free while reads give way: this one may go now, or one before it.
      this.recheck();
    });
  }

  /** The function that ends the current turn, handing the queue on. */
  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#writes.shift() ?? this.#nextRead();
      if (next) next.start(this.#release());
      else this.#busy = false;
    };
  }

  /**
   * The read to go next: the first to come of those that are foreground ones now, else of those
   * that are `next` ones, else of the rest; but for those that give way while a foreground read is
   * under way or next, and those held behind another read.
   */
  #nextRead(): Waiter | undefined {
    const free = (waiter: Waiter) => waiter.holds?.() !== true;
    const lead = this.#leading.findIndex(
      (waiter) => waiter.priority?.() === 'foreground' && free(waiter),
    );
    if (lead >= 0) return this.#leading.splice(lead, 1)[0];
    const ahead = this.#ahead();
    const goes = (waiter: Waiter) => (!ahead || !waiter.givesWay) && free(waiter);
    const soon = this.#leading.findIndex(
      (waiter) => waiter.priority?.() === 'next' && goes(waiter),
    );
    if (soon >= 0) return this.#leading.splice(soon, 1)[0];
    const read = this.#reads.findIndex(goes);
    const other = this.#leading.findIndex(goes);
    const readCame = this.#reads[read]?.came;
    const otherCame = this.#leading[other]?.came;
    if (otherCame !== undefined && (readCame === undefined || otherCame < readCame)) {
      return this.#leading.splice(other, 1)[0];
    }
    return read >= 0 ? this.#reads.splice(read, 1)[0] : undefined;
  }

  /**
   * Has background reads give way while `ahead` says a foreground read is under way or next: the
   * poller's, which frees the queue between its requests. Whoever says so calls
   * {@link RequestQueue.recheck} once it may no longer be, so a read that gave way takes the queue
   * if it's free.
   */
  giveWayWhile(ahead: () => boolean): void {
    this.#ahead = ahead;
  }

  /** Starts the read to go next, if the queue is free and one may go now. */
  recheck(): void {
    if (this.#busy) return;
    const next = this.#writes.shift() ?? this.#nextRead();
    if (!next) return;
    this.#busy = true;
    next.start(this.#release());
  }

  /**
   * Makes and runs a read once it's the read's turn, which comes before waiting background reads
   * while it's a `foreground` one. `request` is called only then, so a request that starts work when
   * it's made still waits its turn. One given up on through `signal` while it waits is never made.
   * While it's a background one, it gives way as {@link RequestQueue.giveWayWhile} says, unless
   * `givesWay` is false, as for the poller's own.
   */
  async read<T>(
    request: () => Promise<T>,
    signal?: AbortSignal,
    priority: ReadPriorityNow = 'background',
    givesWay = true,
  ): Promise<T> {
    const release = await this.#turn(priority, signal, givesWay);
    try {
      return await request();
    } finally {
      release();
    }
  }

  /**
   * A gate that waits for a read's turn before each of a client's requests, and holds it until the
   * answer is read ({@link GithubClient.gated}). A read made of many requests through it lets a
   * waiting write go between them. Each request takes its turn at `priority`, giving way as
   * {@link RequestQueue.read} says; one given up on through `signal` while it waits is never made.
   * While `holds` says so, a request waits behind other reads whatever its priority, as the rest of
   * a timeline does behind a pull request's files: whoever it waits behind calls
   * {@link RequestQueue.recheck} once it may no longer.
   */
  gate(
    priority: ReadPriorityNow = 'background',
    signal?: AbortSignal,
    givesWay = true,
    holds?: () => boolean,
  ): RequestGate {
    return () => this.#turn(priority, signal, givesWay, holds);
  }

  /**
   * Makes and runs a write (a mutation) once it's the write's turn, and at least the spacing after
   * the previous write finished. One given up on through `signal` while it waits, for its turn or
   * through the spacing, is never made.
   */
  async write<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#turn('write', signal);
    try {
      const last = this.#lastWrite;
      const wait = last === undefined ? 0 : last + this.#spacing - this.#clock();
      if (wait > 0) await pause(wait, signal);
      if (signal?.aborted) throw abandoned(signal);
      try {
        return await request();
      } finally {
        this.#lastWrite = this.#clock();
      }
    } finally {
      release();
    }
  }
}

/** Waits `wait` milliseconds, or until `signal` aborts. */
function pause(wait: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, wait);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * How a read's priority stands as the queue comes free, for one that is or may become a foreground
 * or a `next` one; none for a write or a background read.
 */
function priorityOf(kind: 'write' | ReadPriorityNow): (() => ReadPriority) | undefined {
  if (typeof kind === 'function') return kind;
  if (kind === 'write' || kind === 'background') return undefined;
  return () => kind;
}

/** The error a request given up on through `signal` fails with: the signal's reason, if it's an error. */
export function abandoned(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new Error('the request was given up on', { cause: reason });
}
