/**
 * A server's requests: one queue, at most {@link IN_FLIGHT} at the server at a time, each answered
 * by its deadline one way or another. A request is cancelled with `$/cancelRequest` once its
 * deadline passes, its asker gives up or a newer request replaces it, and the server's answer is
 * then dropped. `ContentModified` and `ServerCancelled` count as no answer.
 *
 * A request given up on keeps its place among those at the server until the server answers it, as
 * the protocol says it must, or for {@link GIVEN_UP} at most. However long a server takes, no more
 * than {@link UNANSWERED} requests are ever waiting on it, so one that stops answering is never
 * sent more and more.
 */

import {
  type CancellationToken,
  CancellationTokenSource,
  ErrorCodes,
  ResponseError,
} from 'vscode-jsonrpc';
import { LSPErrorCodes } from 'vscode-languageserver-protocol';

/** How many requests a server has at once. */
export const IN_FLIGHT = 8;

/** How many requests may wait for one of those, past which a new one is answered `busy`. */
export const WAITING = 64;

/** How long a request given up on holds its place at the server, waiting for its answer. */
export const GIVEN_UP = 30_000;

/** The most requests a server may have unanswered, those given up on included. */
export const UNANSWERED = 32;

/** The longest deadline a request may have: a day, well within what a timer can wait. */
const LONGEST_DEADLINE = 24 * 60 * 60 * 1000;

/** The longest message kept from a server's error, in characters. */
const MESSAGE_LENGTH = 500;

/** Why a request has no answer. */
export type NoAnswer =
  /** The server is still starting. */
  | 'notReady'
  /** The server is stopping, has stopped, or failed. */
  | 'stopped'
  /** The file isn't open on the server. */
  | 'notOpen'
  /** Too many requests were waiting. */
  | 'busy'
  /** The deadline passed first. */
  | 'deadline'
  /** The asker gave up. */
  | 'cancelled'
  /** A newer request with the same key replaced it. */
  | 'replaced'
  /** The server declined: what it was asked about changed (`ContentModified`), or it cancelled. */
  | 'declined'
  /** The server answered with an error. */
  | 'failed'
  /** Lo never asks this server this, as its spec says: it was never sent. */
  | 'unasked';

/** A request's answer: the server's result, unchecked, or why there's none. */
export type Answer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly why: NoAnswer; readonly message?: string };

export interface Ask {
  readonly method: string;
  readonly params: unknown;
  /** How long the server has to answer, in milliseconds, from now. */
  readonly deadline: number;
  /** Gives up on the request when it aborts. */
  readonly signal?: AbortSignal | undefined;
  /** A key for what the request is for: a newer request with the same key replaces it. */
  readonly key?: string | undefined;
}

/** Sends a request to the server; the token, once cancelled, sends `$/cancelRequest`. */
export type Send = (method: string, params: unknown, token: CancellationToken) => Promise<unknown>;

export interface QueueEvents {
  /** A request's deadline passed. */
  readonly missed: () => void;
  /** The server answered a request in time. */
  readonly answered: () => void;
}

interface Entry {
  readonly ask: Ask;
  readonly resolve: (answer: Answer) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly abort: () => void;
  /** Set once it's sent. */
  cancel?: CancellationTokenSource;
  /** Whether it holds one of the places at the server. */
  holds: boolean;
  /** Frees its place once it's been given up on for a while. */
  release?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

/** The queue's limits, which tests can make smaller. */
export interface QueueLimits {
  readonly inFlight: number;
  readonly waiting: number;
  readonly givenUp: number;
  readonly unanswered: number;
}

export class Queue {
  readonly #send: Send;
  readonly #events: QueueEvents;
  readonly #limits: QueueLimits;
  readonly #waiting: Entry[] = [];
  /** Requests at the server that it hasn't answered, given up on or not. */
  readonly #sent = new Set<Entry>();
  #closed: NoAnswer | undefined;
  /** Whether {@link #pump} is running, so a request settled while it sends doesn't start another. */
  #pumping = false;

  constructor(send: Send, events: QueueEvents, limits: Partial<QueueLimits> = {}) {
    this.#send = send;
    this.#events = events;
    this.#limits = {
      inFlight: IN_FLIGHT,
      waiting: WAITING,
      givenUp: GIVEN_UP,
      unanswered: UNANSWERED,
      ...limits,
    };
  }

  /** Asks the server, and resolves with its answer or why there's none, never later than the deadline. */
  ask(ask: Ask): Promise<Answer> {
    if (this.#closed !== undefined) return Promise.resolve({ ok: false, why: this.#closed });
    if (ask.signal?.aborted) return Promise.resolve({ ok: false, why: 'cancelled' });
    if (!(ask.deadline > 0 && ask.deadline <= LONGEST_DEADLINE)) {
      throw new Error(`a request's deadline must be 1 ms to a day: ${ask.deadline}`);
    }
    if (ask.key !== undefined) {
      for (const entry of [...this.#waiting, ...this.#sent]) {
        if (entry.ask.key === ask.key) this.#settle(entry, { ok: false, why: 'replaced' });
      }
    }
    if (this.#waiting.length >= this.#limits.waiting) {
      return Promise.resolve({ ok: false, why: 'busy' });
    }
    return new Promise<Answer>((resolve) => {
      const entry: Entry = {
        ask,
        resolve,
        timer: setTimeout(() => {
          if (this.#settle(entry, { ok: false, why: 'deadline' })) this.#events.missed();
        }, ask.deadline),
        abort: () => this.#settle(entry, { ok: false, why: 'cancelled' }),
        holds: false,
        settled: false,
      };
      ask.signal?.addEventListener('abort', entry.abort, { once: true });
      this.#waiting.push(entry);
      this.#pump();
    });
  }

  /** Answers every request with `why`, now and from now on, and sends nothing more. */
  close(why: NoAnswer): void {
    this.#closed ??= why;
    for (const entry of [...this.#waiting, ...this.#sent]) {
      this.#settle(entry, { ok: false, why }, { cancel: false });
      clearTimeout(entry.release);
    }
    this.#sent.clear();
  }

  /** Sends what's waiting while there's room. */
  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      this.#sendWaiting();
    } finally {
      this.#pumping = false;
    }
  }

  /** How many places at the server are taken. */
  #held(): number {
    let held = 0;
    for (const entry of this.#sent) if (entry.holds) held += 1;
    return held;
  }

  #sendWaiting(): void {
    const { inFlight, unanswered } = this.#limits;
    while (this.#closed === undefined && this.#held() < inFlight && this.#sent.size < unanswered) {
      const entry = this.#waiting.shift();
      if (entry === undefined) return;
      const cancel = new CancellationTokenSource();
      entry.cancel = cancel;
      entry.holds = true;
      this.#sent.add(entry);
      let sent: Promise<unknown>;
      try {
        sent = this.#send(entry.ask.method, entry.ask.params, cancel.token);
      } catch {
        // The connection has closed.
        this.#sent.delete(entry);
        this.#settle(entry, { ok: false, why: 'stopped' }, { cancel: false });
        continue;
      }
      sent.then(
        (value) => {
          this.#answered(entry);
          if (this.#settle(entry, { ok: true, value })) this.#events.answered();
        },
        (error: unknown) => {
          this.#answered(entry);
          const answer = refusal(error);
          if (this.#settle(entry, answer, { cancel: false }) && answer.why !== 'stopped') {
            this.#events.answered();
          }
        },
      );
    }
  }

  /** The server answered `entry`, or its connection ended: its place is free. */
  #answered(entry: Entry): void {
    clearTimeout(entry.release);
    if (this.#sent.delete(entry)) this.#pump();
  }

  /**
   * Answers `entry` once, and says whether this was the time. One the server has, given up on, is
   * cancelled there, and keeps its place until the server answers it or for a while.
   */
  #settle(entry: Entry, answer: Answer, options: { cancel: boolean } = { cancel: true }): boolean {
    if (entry.settled) return false;
    entry.settled = true;
    clearTimeout(entry.timer);
    entry.ask.signal?.removeEventListener('abort', entry.abort);
    const waiting = this.#waiting.indexOf(entry);
    if (waiting !== -1) this.#waiting.splice(waiting, 1);
    if (this.#sent.has(entry) && !answer.ok && options.cancel) {
      entry.cancel?.cancel();
      entry.release = setTimeout(() => {
        entry.holds = false;
        this.#pump();
      }, this.#limits.givenUp);
      entry.release.unref();
    }
    entry.cancel?.dispose();
    entry.resolve(answer);
    this.#pump();
    return true;
  }
}

/** What a server's error means for its request. */
function refusal(error: unknown): Answer & { ok: false } {
  if (!(error instanceof ResponseError)) return { ok: false, why: 'stopped' };
  switch (error.code) {
    case ErrorCodes.PendingResponseRejected:
    case ErrorCodes.ConnectionInactive:
      return { ok: false, why: 'stopped' };
    case LSPErrorCodes.ContentModified:
    case LSPErrorCodes.ServerCancelled:
    case LSPErrorCodes.RequestCancelled:
      return { ok: false, why: 'declined' };
    default:
      return { ok: false, why: 'failed', message: error.message.slice(0, MESSAGE_LENGTH) };
  }
}
