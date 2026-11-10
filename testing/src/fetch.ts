import { onTestFinished } from 'vitest';

import { Replay, ReplayError, type SeenRequest } from './replay.ts';

/** A `fetch` that answers from a cassette, with what it was asked. */
export type ReplayFetch = typeof globalThis.fetch & {
  readonly replay: Replay;
  /** Every request received so far, in order. */
  readonly seen: readonly SeenRequest[];
};

/**
 * A `fetch` that answers from the cassette `cassette` in `testing/fixtures/github`, or from a
 * {@link Replay}, for code that takes `fetch` as a parameter.
 *
 * A request the cassette can't answer rejects, and it also fails the test that made it once the
 * test ends, even when the code under test catches the rejection as it would a network error.
 */
export function replayFetch(cassette: string | Replay): ReplayFetch {
  const replay = typeof cassette === 'string' ? Replay.cassette(cassette) : cassette;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    try {
      return await replay.respond(new Request(input, init));
    } catch (error) {
      if (error instanceof ReplayError) failTheTest(error);
      throw error;
    }
  };
  return Object.assign(fetch, { replay, seen: replay.seen });
}

/** Fails the running test once it ends, if a test is running. */
function failTheTest(error: ReplayError): void {
  try {
    onTestFinished(() => {
      throw error;
    });
  } catch {
    // Not inside a test, such as in a `beforeAll`: the rejected request is all there is.
  }
}
