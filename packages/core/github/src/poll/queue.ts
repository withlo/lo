/**
 * One request queue per account. GitHub asks integrations to make requests serially rather than
 * concurrently, and to wait at least a second between mutations.
 */

import type { RequestGate } from '../client.ts';

/**
 * A request waiting for its turn: starting it, or leaving the queue when it's given up on; and, for
 * a foreground read, its priority as it stands now.
 */
interface Waiter {
  start: (release: () => void) => void;
  priority?: (() => ReadPriority) | undefined;
}

/**
 * Who waits on a read: someone looking at the screen, as a pull request's tab opening on its
 * overview does (`foreground`), or nobody in particular, as for polls (`background`).
 */
export type ReadPriority = 'foreground' | 'background';

/**
 * A read's priority: fixed, or as it stands whenever its turn could come, for a read that stops
 * being waited on as the screen changes.
 */
export type ReadPriorityNow = ReadPriority | (() => ReadPriority);

/**
 * Runs an account's requests one at a time, spacing its writes. Waiting requests take their turns
 * first in, first out, except that a waiting write goes before every waiting read, and a waiting
 * foreground read before every waiting background read: a comment or a merge the user is waiting
 * on doesn't queue behind polls, and nor does what a tab needs to open on. A foreground read no
 * longer waited on as one, as its tab was hidden, waits behind the background reads waiting then.
 * A request already under way always finishes first.
 */
export class RequestQueue {
  readonly #spacing: number;
  readonly #clock: () => number;
  /** Whether a request holds the queue. */
  #busy = false;
  /** When the last write finished, by `#clock`. */
  #lastWrite: number | undefined;
  readonly #writes: Waiter[] = [];
  readonly #foreground: Waiter[] = [];
  readonly #reads: Waiter[] = [];

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
   * already waiting, writes ahead of foreground reads, and those ahead of background reads.
   * Resolves with the function that ends the turn, which does so once however often it's called. A
   * request given up on through `signal` while it waits leaves the queue, and the wait rejects with
   * the signal's reason.
   */
  #turn(kind: 'write' | ReadPriorityNow, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abandoned(signal));
    if (!this.#busy) {
      this.#busy = true;
      return Promise.resolve(this.#release());
    }
    return new Promise((resolve, reject) => {
      const priority = typeof kind === 'function' ? kind : undefined;
      const waiting = this.#waiting(typeof kind === 'function' ? kind() : kind);
      const waiter: Waiter = {
        start: (release) => {
          signal?.removeEventListener('abort', abandon);
          resolve(release);
        },
        priority,
      };
      const abandon = () => {
        // Where it waits: where it started, or with the background reads.
        for (const list of [waiting, this.#reads]) {
          const at = list.indexOf(waiter);
          if (at >= 0) list.splice(at, 1);
        }
        reject(abandoned(signal));
      };
      signal?.addEventListener('abort', abandon, { once: true });
      waiting.push(waiter);
    });
  }

  /** Where requests of `kind` wait their turns. */
  #waiting(kind: 'write' | ReadPriority): Waiter[] {
    switch (kind) {
      case 'write':
        return this.#writes;
      case 'foreground':
        return this.#foreground;
      case 'background':
        return this.#reads;
      default:
        kind satisfies never;
        throw new Error(`A kind of request Lo doesn't know: ${String(kind)}.`);
    }
  }

  /** The function that ends the current turn, handing the queue on. */
  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#writes.shift() ?? this.#nextForeground() ?? this.#reads.shift();
      if (next) next.start(this.#release());
      else this.#busy = false;
    };
  }

  /**
   * The first foreground read waiting that's still one; those that aren't go to wait behind the
   * background reads waiting.
   */
  #nextForeground(): Waiter | undefined {
    let next = this.#foreground.shift();
    while (next?.priority?.() === 'background') {
      this.#reads.push(next);
      next = this.#foreground.shift();
    }
    return next;
  }

  /**
   * Makes and runs a read once it's the read's turn, which comes before waiting background reads
   * while it's a `foreground` one. `request` is called only then, so a request that starts work when
   * it's made still waits its turn. One given up on through `signal` while it waits is never made.
   */
  async read<T>(
    request: () => Promise<T>,
    signal?: AbortSignal,
    priority: ReadPriorityNow = 'background',
  ): Promise<T> {
    const release = await this.#turn(priority, signal);
    try {
      return await request();
    } finally {
      release();
    }
  }

  /**
   * A gate that waits for a read's turn before each of a client's requests, and holds it until the
   * answer is read ({@link GithubClient.gated}). A read made of many requests through it lets a
   * waiting write go between them.
   */
  gate(): RequestGate {
    return () => this.#turn('background');
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

/** The error a request given up on through `signal` fails with: the signal's reason, if it's an error. */
export function abandoned(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new Error('the request was given up on', { cause: reason });
}
