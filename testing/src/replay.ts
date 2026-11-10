/**
 * Serves recorded GitHub responses, so tests run offline. One engine answers both an injected
 * `fetch` in unit tests ({@link replayFetch}) and a local HTTP server for the app's tests
 * (`./server.ts`).
 */

import {
  cassette as readNamedCassette,
  compare,
  graphqlBody,
  NULL_BODY,
  queryHash,
  readCassette,
  recordedKey,
  requestKey,
  responseBody,
  utf8,
  type Cassette,
  type Interaction,
  type RecordedResponse,
} from './cassette.ts';

/** A request the replayer received. */
export interface SeenRequest {
  method: string;
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** A request the cassette can't answer, or one that no longer matches what was recorded. */
export class ReplayError extends Error {
  override name = 'ReplayError';
}

/**
 * Serves a cassette's responses: each request gets the next response recorded for its key, and
 * once only one is left it's repeated, the steady state of a poll. A request with no recorded
 * response, or a GraphQL query that changed since it was recorded, throws a {@link ReplayError}.
 */
export class Replay {
  /** The cassette's name, for messages. */
  readonly name: string;
  /** Every request received so far, in order. */
  readonly seen: SeenRequest[] = [];
  /** Every request it couldn't answer, in order: each also threw. */
  readonly failures: ReplayError[] = [];
  readonly #byKey = new Map<string, Interaction[]>();

  constructor(name: string, interactions: Iterable<Interaction>) {
    this.name = name;
    for (const interaction of interactions) {
      const key = recordedKey(interaction.request);
      const queue = this.#byKey.get(key);
      if (queue) queue.push(interaction);
      else this.#byKey.set(key, [interaction]);
    }
  }

  /** Replays the cassette `name` from `testing/fixtures/github`. */
  static cassette(name: string): Replay {
    return Replay.from(readNamedCassette(name));
  }

  /** Replays the cassette in `dir`. */
  static fromDir(dir: string): Replay {
    return Replay.from(readCassette(dir));
  }

  static from(cassette: Cassette): Replay {
    return new Replay(
      cassette.name,
      cassette.interactions.map(({ interaction }) => interaction),
    );
  }

  /** Answers a `fetch` request. */
  async respond(request: Request): Promise<Response> {
    const body = new Uint8Array(await request.arrayBuffer());
    return this.answer({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
  }

  /** Answers a request with the next response recorded for it. */
  answer(request: SeenRequest): Response {
    try {
      return this.#answer(request);
    } catch (error) {
      if (error instanceof ReplayError) this.failures.push(error);
      throw error;
    }
  }

  #answer(request: SeenRequest): Response {
    this.seen.push(request);
    const key = requestKey(request.method, request.url, request.body, {
      ifNoneMatch: request.headers.get('if-none-match'),
      ifModifiedSince: request.headers.get('if-modified-since'),
    });
    const queue = this.#byKey.get(key);
    if (!queue) throw new ReplayError(this.#unknown(key, request));
    const interaction = queue.length > 1 ? queue.shift()! : queue[0]!;

    const recorded = interaction.request.query_sha256;
    const graphql = graphqlBody(new URL(request.url), () => utf8(request.body));
    if (graphql && recorded !== undefined) {
      let hash: string;
      try {
        hash = queryHash(graphql.query);
      } catch (error) {
        throw new ReplayError(
          `cassette ${this.name}: the ${graphql.operationName} query doesn't parse: ${String(error)}`,
        );
      }
      if (hash !== recorded) {
        throw new ReplayError(
          `re-record cassette ${this.name}: the ${graphql.operationName} query changed since it was recorded`,
        );
      }
    }
    return toResponse(interaction.response);
  }

  /** Why `request`, whose key is `key`, has no response: the nearest recorded request, and its body. */
  #unknown(key: string, request: SeenRequest): string {
    const lines = [`cassette ${this.name} has no response for`, `  ${key}`];
    const nearest = nearestKey(key, [...this.#byKey.keys()]);
    if (nearest === undefined) {
      lines.push('It has no recorded requests.');
    } else {
      lines.push('The nearest recorded request is', `  ${nearest}`);
    }
    const graphql = graphqlBody(new URL(request.url), () => utf8(request.body));
    if (!graphql && request.body.length > 0) {
      lines.push('The request sent the body', `  ${utf8(request.body)}`);
    }
    return lines.join('\n');
  }
}

/** A response as recorded. */
export function toResponse(recorded: RecordedResponse): Response {
  const headers = new Headers(recorded.headers);
  if (NULL_BODY.has(recorded.status))
    return new Response(null, { status: recorded.status, headers });
  // Bytes rather than a string, so `Response` adds no content type the recording didn't have.
  const body = new TextEncoder().encode(responseBody(recorded));
  return new Response(body, { status: recorded.status, headers });
}

/**
 * The recorded key nearest `key`: one for the same request line (method, URL and GraphQL
 * operation) if there is one, then the same method and path, and among those the fewest edits away.
 */
export function nearestKey(key: string, recorded: readonly string[]): string | undefined {
  const line = requestLine(key);
  const path = methodAndPath(key);
  const rank = (candidate: string): number =>
    requestLine(candidate) === line ? 0 : methodAndPath(candidate) === path ? 1 : 2;
  let best: { key: string; rank: number; distance: number } | undefined;
  for (const candidate of recorded.toSorted(compare)) {
    const candidateRank = rank(candidate);
    if (best && candidateRank > best.rank) continue;
    const distance = editDistance(key, candidate);
    if (!best || candidateRank < best.rank || distance < best.distance) {
      best = { key: candidate, rank: candidateRank, distance };
    }
  }
  return best?.key;
}

/** The method, the URL and, for GraphQL, the operation: a key without its variables, body or conditions. */
function requestLine(key: string): string {
  const [method = '', url = '', operation = ''] = key.split(' ');
  return operation.includes('=') ? `${method} ${url}` : `${method} ${url} ${operation}`;
}

function methodAndPath(key: string): string {
  const [method = '', url = ''] = key.split(' ');
  return `${method} ${url.replace(/[?#].*$/, '')}`;
}

/** Levenshtein distance. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}
