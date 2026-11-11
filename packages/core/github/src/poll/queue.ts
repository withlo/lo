/**
 * One request queue per account. GitHub asks integrations to make requests serially rather than
 * concurrently, and to wait at least a second between mutations.
 */

import type { RequestGate } from '../client.ts';

/** A request waiting for its turn: starting it, or leaving the queue when it's given up on. */
interface Waiter {
  start: (release: () => void) => void;
}

/**
 * Runs an account's requests one at a time, spacing its writes. Waiting requests take their turns
 * first in, first out, except that a waiting write goes before every waiting read: a comment or a
 * merge the user is waiting on doesn't queue behind polls.
 */
export class RequestQueue {
  readonly #spacing: number;
  readonly #clock: () => number;
  /** Whether a request holds the queue. */
  #busy = false;
  /** When the last write finished, by `#clock`. */
  #lastWrite: number | undefined;
  readonly #writes: Waiter[] = [];
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
   * already waiting, writes ahead of reads. Resolves with the function that ends the turn, which
   * does so once however often it's called. A request given up on through `signal` while it waits
   * leaves the queue, and the wait rejects with the signal's reason.
   */
  #turn(write: boolean, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abandoned(signal));
    if (!this.#busy) {
      this.#busy = true;
      return Promise.resolve(this.#release());
    }
    return new Promise((resolve, reject) => {
      const waiting = write ? this.#writes : this.#reads;
      const waiter: Waiter = {
        start: (release) => {
          signal?.removeEventListener('abort', abandon);
          resolve(release);
        },
      };
      const abandon = () => {
        const at = waiting.indexOf(waiter);
        if (at >= 0) waiting.splice(at, 1);
        reject(abandoned(signal));
      };
      signal?.addEventListener('abort', abandon, { once: true });
      waiting.push(waiter);
    });
  }

  /** The function that ends the current turn, handing the queue on. */
  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#writes.shift() ?? this.#reads.shift();
      if (next) next.start(this.#release());
      else this.#busy = false;
    };
  }

  /**
   * Makes and runs a read once it's the read's turn. `request` is called only then, so a request
   * that starts work when it's made still waits its turn. One given up on through `signal` while
   * it waits is never made.
   */
  async read<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#turn(false, signal);
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
    return () => this.#turn(false);
  }

  /**
   * Makes and runs a write (a mutation) once it's the write's turn, and at least the spacing after
   * the previous write finished. One given up on through `signal` while it waits, for its turn or
   * through the spacing, is never made.
   */
  async write<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#turn(true, signal);
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
