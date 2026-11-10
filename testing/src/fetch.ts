import { onTestFinished } from 'vitest';

import { Replay, ReplayError, type SeenRequest } from './replay.ts';

/** A `fetch` that answers from a cassette, with what it was asked. */
export type ReplayFetch = typeof globalThis.fetch & {
  readonly replay: Replay;
  /** Every request received so far, in order. */
  readonly seen: readonly SeenRequest[];
};

/** A test's own hooks: the context Vitest passes a test function. */
export interface TestHooks {
  onTestFinished(fn: () => void | Promise<void>): void;
}

/**
 * A `fetch` that answers from the cassette `cassette` in `testing/fixtures/github`, or from a
 * {@link Replay}, for code that takes `fetch` as a parameter.
 *
 * A request the cassette can't answer rejects, and it also fails a test, even when the code under
 * test catches the rejection as it would a network error:
 *
 * - Made inside a test, it belongs to that test, which checks its requests when it ends, waiting
 *   for any still being answered. Under `test.concurrent`, pass the test's context as `test`, so
 *   each test checks its own.
 * - Made outside any test, at a module's top or in a `beforeAll`, each failure fails the test
 *   running when it happens.
 * - A failure with no test to fail, such as one after its test ended, fails the run instead.
 */
export function replayFetch(cassette: string | Replay, test?: TestHooks): ReplayFetch {
  const replay = typeof cassette === 'string' ? Replay.cassette(cassette) : cassette;
  const pending = new Set<Promise<unknown>>();
  let ended = false;

  const check = async (): Promise<void> => {
    await Promise.allSettled(pending);
    ended = true;
    const [first, ...rest] = replay.failures;
    if (first === undefined) return;
    if (rest.length === 0) throw first;
    throw new AggregateError(
      replay.failures,
      replay.failures.map((error) => error.message).join('\n\n'),
    );
  };
  let owned: boolean;
  if (test) {
    test.onTestFinished(check);
    owned = true;
  } else {
    owned = whenTestFinishes(check);
  }

  /** Makes sure a test, or else the run, fails for `error`. */
  const fail = (error: ReplayError): void => {
    // A replay made in a test is checked when its test ends.
    if (owned && !ended) return;
    if (!owned && whenTestFinishes(() => Promise.reject(error))) return;
    // No test is left to fail: fail the run, rather than lose it.
    setTimeout(() => {
      throw error;
    });
  };

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const answer = replay.respond(new Request(input, init));
    pending.add(answer);
    try {
      return await answer;
    } catch (error) {
      if (error instanceof ReplayError) fail(error);
      throw error;
    } finally {
      pending.delete(answer);
    }
  };
  return Object.assign(fetch, { replay, seen: replay.seen });
}

/** Runs `check` when the running test finishes. Says whether a test was running. */
function whenTestFinishes(check: () => Promise<void>): boolean {
  try {
    onTestFinished(check);
    return true;
  } catch {
    return false;
  }
}
