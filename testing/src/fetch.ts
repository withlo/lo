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
  onTestFinished(fn: () => void): void;
}

/**
 * A `fetch` that answers from the cassette `cassette` in `testing/fixtures/github`, or from a
 * {@link Replay}, for code that takes `fetch` as a parameter.
 *
 * A request the cassette can't answer rejects, and it also fails the test once the test ends,
 * even when the code under test catches the rejection as it would a network error. Made inside a
 * test, it belongs to that test; under `test.concurrent`, pass the test's context as `test`, so
 * each test checks its own requests. One that fails after its test ended fails the run instead.
 * Made outside any test, such as in a `beforeAll`, nothing checks it: look at `replay.failures`.
 */
export function replayFetch(cassette: string | Replay, test?: TestHooks): ReplayFetch {
  const replay = typeof cassette === 'string' ? Replay.cassette(cassette) : cassette;
  let ended = false;
  const check = (): void => {
    ended = true;
    const [first, ...rest] = replay.failures;
    if (first === undefined) return;
    if (rest.length === 0) throw first;
    throw new AggregateError(
      replay.failures,
      replay.failures.map((error) => error.message).join('\n\n'),
    );
  };
  if (test) {
    test.onTestFinished(check);
  } else {
    try {
      onTestFinished(check);
    } catch {
      // Not inside a test: nothing to fail but the request.
    }
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    try {
      return await replay.respond(new Request(input, init));
    } catch (error) {
      if (ended && error instanceof ReplayError) {
        // Its test already ended, so there's no test to fail: fail the run, rather than lose it.
        setTimeout(() => {
          throw error;
        });
      }
      throw error;
    }
  };
  return Object.assign(fetch, { replay, seen: replay.seen });
}
