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
  recordedResource,
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
 * once only one is left it's repeated, the steady state of a poll. A conditional read the recording
 * has no answer for, but that polls a resource the recording polled the same way, with the
 * validator of the last state it recorded, gets a `304`, as GitHub answers a poll of a state that
 * hasn't changed. A request with no recorded response, or a GraphQL query that changed since it
 * was recorded, throws a {@link ReplayError}.
 */
export class Replay {
  /** The cassette's name, for messages. */
  readonly name: string;
  /** Every request received so far, in order. */
  readonly seen: SeenRequest[] = [];
  /** Every request it couldn't answer, in order: each also threw. */
  readonly failures: ReplayError[] = [];
  readonly #byKey = new Map<string, Interaction[]>();
  /** Every answer recorded for a resource, whatever conditions the request sent, as recorded. */
  readonly #byResource = new Map<string, Interaction[]>();

  constructor(name: string, interactions: Iterable<Interaction>) {
    this.name = name;
    for (const interaction of interactions) {
      const key = recordedKey(interaction.request);
      const queue = this.#byKey.get(key);
      if (queue) queue.push(interaction);
      else this.#byKey.set(key, [interaction]);
      const resource = recordedResource(interaction.request);
      const answers = this.#byResource.get(resource);
      if (answers) answers.push(interaction);
      else this.#byResource.set(resource, [interaction]);
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
    if (!queue) {
      const answer = this.#unrecorded(request);
      if (answer) return answer;
      throw new ReplayError(this.#unknown(key, request));
    }
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

  /**
   * The `304` for a poll the recording ended before. How many times an app polls depends on how
   * long it runs, so a poll may come after the last one recorded, carrying the ETag or time of the
   * last answer it got, which no recorded request sent back. It's answered when the recording
   * polled the resource with the same kind of condition, an ETag or a time, and the validator is
   * the last recorded state's: that's what GitHub says of a state that hasn't changed. Anything
   * else is a request the cassette has no answer for.
   */
  #unrecorded(request: SeenRequest): Response | undefined {
    const ifNoneMatch = request.headers.get('if-none-match');
    const ifModifiedSince = request.headers.get('if-modified-since');
    if (request.method !== 'GET' || (ifNoneMatch === null && ifModifiedSince === null)) {
      return undefined;
    }
    const answers = this.#byResource.get(requestKey(request.method, request.url, request.body));
    const latest = answers?.findLast(({ response }) => response.status === 200);
    if (!answers || !latest) return undefined;
    // Like GitHub, the ETags decide when the request has any, and the time only when it hasn't.
    let current: boolean;
    if (ifNoneMatch !== null) {
      if (!answers.some(({ request: asked }) => asked.if_none_match != null)) return undefined;
      current = shares(etags(latest.response.headers.etag), etags(ifNoneMatch));
    } else {
      if (!answers.some(({ request: asked }) => asked.if_modified_since != null)) return undefined;
      const since = Date.parse(ifModifiedSince ?? '');
      current = since === Date.parse(latest.response.headers['last-modified'] ?? '');
    }
    if (!current) return undefined;
    // What GitHub says of a state that hasn't changed: its validators and limits, and no content.
    const headers = Object.fromEntries(
      Object.entries(latest.response.headers).filter(([name]) => NOT_MODIFIED_HEADERS.test(name)),
    );
    return toResponse({ status: 304, headers });
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

/** The headers of a `304` GitHub sends: the validators, and the API's version and limits. */
const NOT_MODIFIED_HEADERS = /^(etag|last-modified|x-poll-interval|x-github-.*|x-ratelimit-.*)$/;

/** The ETags in an `If-None-Match` or `ETag` header, weak or strong alike: without any `W/`. */
function etags(header: string | null | undefined): Set<string> {
  return new Set(
    (header ?? '')
      .split(',')
      .map((tag) => tag.trim().replace(/^W\//, ''))
      .filter((tag) => tag !== ''),
  );
}

/** Whether two sets of ETags have one in common. */
function shares(a: Set<string>, b: Set<string>): boolean {
  return [...a].some((tag) => b.has(tag));
}

/** A response as recorded. */
export function toResponse(recorded: RecordedResponse): Response {
  const headers = new Headers(recorded.headers);
  if (NULL_BODY.has(recorded.status))
    return new Response(null, { status: recorded.status, headers });
  // Bytes rather than a string, so `Response` adds no content type the recording didn't have.
  return new Response(responseBody(recorded), { status: recorded.status, headers });
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
