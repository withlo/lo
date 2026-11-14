/** A client for one account: GitHub's REST and GraphQL APIs with that account's token. */

import type { TypedDocumentString } from './generated/graphql.ts';
import {
  classifyNetworkError,
  GithubError,
  parseSsoHeader,
  type GithubErrorDetail,
  type NetworkFailure,
  type SsoHeader,
} from './errors.ts';
import { decodeGraphQL, isBelow, type GraphQLError, type GraphQLResponse } from './graphql.ts';
import { unchecked, type Read } from './json.ts';
import { abandoned } from './poll/queue.ts';
import { RateLimits } from './rate-limit.ts';
import type { Token } from './token.ts';
import { parseScopes, type AuthenticatedUser, type User } from './user.ts';

/** Where GitHub's API, its website (for signing in) and its uploads are. */
export interface GitHubUrls {
  api: string;
  web: string;
  uploads: string;
}

/** GitHub's own addresses. */
export const GITHUB_URLS: GitHubUrls = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};

/** The REST API version Lo is written against. Responses echo it in `x-github-api-version-selected`. */
export const API_VERSION = '2022-11-28';

/** The `User-Agent` a client sends unless told otherwise. GitHub requires one. */
export const USER_AGENT = 'lo';

/** GitHub gives up on a request after 10 s; this leaves room for a slow network. */
const TIMEOUT_MS = 30_000;

/** The REST API answers a renamed repository with a redirect to the same host. */
const MAX_REDIRECTS = 3;

/** What an account's client keeps between requests: each URL's ETag and the answer it came with. */
export interface Store {
  /** The answer kept for `url`, if any. */
  get(url: string): Promise<StoredAnswer | undefined>;
  /** Keeps `answer` for `url`, in place of what was kept. */
  set(url: string, answer: StoredAnswer): Promise<void>;
  /** Forgets what was kept for `url`. */
  delete(url: string): Promise<void>;
}

/** An answer kept with its ETag, so a `304` can be answered from it. */
export interface StoredAnswer {
  etag: string;
  body: string;
}

/**
 * What a client does when GitHub refuses its token (a `401`). It's given the refused token, and
 * returns a token to retry the request with once, or nothing to fail it.
 */
export type OnUnauthorized = (refused: Token) => Promise<Token | undefined>;

/**
 * What a client waits for before each request, and holds until its answer is read: a turn in the
 * account's request queue. It returns the function that ends the turn.
 */
export type RequestGate = () => Promise<() => void>;

/**
 * Hears how much of a request's body has been sent: `sent` bytes of `total`. A `fetch` that can
 * tell calls it every so often while the body goes.
 */
export type UploadProgress = (sent: number, total: number) => void;

/**
 * What a client hands its `fetch`: a `RequestInit`, how to report how much of the body has been
 * sent, which a `fetch` that can't tell, such as the platform's own, ignores, and whether it's a
 * write.
 */
export interface FetchInit extends RequestInit {
  uploadProgress?: UploadProgress | undefined;
  /**
   * Whether the request is a write, which GitHub may do twice if it's sent twice, so the `fetch`
   * must send it at most once, whatever the network does: never again by itself, as Chromium's
   * network stack does a request whose reused connection drops before any of the answer came. A
   * write that gets no answer fails, and the client counts its answer as lost
   * ({@link GithubError.mayHavePosted}).
   */
  once?: boolean | undefined;
}

export interface ClientOptions {
  /**
   * The `fetch` requests go through. It's given a {@link FetchInit}, and may report an upload's
   * progress through it.
   */
  fetch: typeof globalThis.fetch;
  /** The account's token. Without one, the client signs in as nobody, for public repositories. */
  token?: Token | undefined;
  /** GitHub's addresses, if not github.com's. */
  urls?: Partial<GitHubUrls> | undefined;
  /** Where ETags and the answers they came with are kept, for {@link GithubClient.getStored}. */
  store?: Store | undefined;
  /** Asked for a new token when GitHub refuses this one. */
  onUnauthorized?: OnUnauthorized | undefined;
  /** Tells why `fetch` failed, from what it threw ({@link classifyNetworkError} by default). */
  classify?: ((error: unknown) => NetworkFailure) | undefined;
  /** The `User-Agent` to send, such as `lo/1.2.0`. */
  userAgent?: string | undefined;
}

/** What the account's responses have said about it. */
export interface ClientState {
  rateLimits: RateLimits;
  /** The last `X-GitHub-SSO` header seen. */
  sso: SsoHeader | undefined;
}

/** A successful REST response, or a `304 Not Modified`. */
export class RestResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;

  constructor(status: number, headers: Headers, body: Uint8Array) {
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  header(name: string): string | undefined {
    return this.headers.get(name) ?? undefined;
  }

  get etag(): string | undefined {
    return this.header('etag');
  }

  text(): string {
    return new TextDecoder().decode(this.body);
  }

  /** The body as JSON, read by `read`. */
  json<T>(read: Read<T>): T {
    return parseJson(this.text(), read);
  }
}

/** The answer to a conditional request: `304` when nothing changed, or the new value with its ETag. */
export type Conditional<T> =
  { notModified: true } | { notModified: false; value: T; etag: string | undefined };

/** What a conditional request asks about: changes since an ETag, or since a time. */
type Condition = { ifNoneMatch: string } | { ifModifiedSince: string } | undefined;

export interface SendOptions {
  /** The request's body, sent as is. JSON writes are compared byte for byte, so build it with care. */
  body?: string | Uint8Array | undefined;
  /** The body's type, when it isn't JSON. */
  contentType?: string | undefined;
  /**
   * The media type to ask for, when it isn't GitHub's JSON: `application/vnd.github.raw+json` for
   * a file's bytes as they are.
   */
  accept?: string | undefined;
  condition?: Condition;
  /** Statuses answered rather than thrown, for a request whose refusals carry a body Lo reads. */
  answers?: readonly number[] | undefined;
  /** How long to wait for the whole answer, in milliseconds: 30 s unless said otherwise. */
  timeoutMs?: number | undefined;
  /** Whether to follow a redirect to where the token may go. On unless turned off. */
  followRedirects?: boolean | undefined;
  /**
   * Gives the request up: one that waits at the client's gate or hasn't been sent isn't sent, and
   * one under way is cancelled. Either fails with the signal's reason. One cancelled under way may
   * still have reached GitHub.
   */
  signal?: AbortSignal | undefined;
  /**
   * Whether the request is a write, sent at most once ({@link FetchInit.once}): every method but
   * `GET` and `HEAD` is unless it says otherwise, as a GraphQL query, which is a `POST`, does.
   */
  once?: boolean | undefined;
  /** Hears how much of the body has been sent, when the client's `fetch` can tell. */
  uploadProgress?: UploadProgress | undefined;
  /**
   * Sends this request alone as `token`, not the client's. It's never kept, and GitHub refusing it
   * isn't the client's token refused: `onUnauthorized` isn't asked, and nothing is sent again.
   * The rate limit its answer's headers report is that token's, so they aren't recorded. A refusal
   * for the rate limit is recorded, as any request's is ({@link GithubClient.rateLimited}), and
   * pauses the account: the token is for the same login, and GitHub counts a limit by account, so
   * the account's own requests would be refused alike.
   */
  token?: Token | undefined;
}

interface Shared {
  token: Token | undefined;
  state: ClientState;
  /** GitHub's latest refusals for the rate limit, oldest first ({@link GithubClient.rateLimited}). */
  limited: HeardLimit[];
  /** GitHub's latest run of writes turned away as content sent too fast ({@link GithubClient.tooFast}). */
  tooFast: TooFast | undefined;
  /** How far GitHub's clock is ahead of this computer's ({@link GithubClient.githubAhead}). */
  githubAhead: number | undefined;
}

/** A refusal for the rate limit, used up or secondary. */
export type RateLimited = Extract<GithubErrorDetail, { kind: 'rateLimited' }>;

/**
 * A refusal for the rate limit as a client heard it: what GitHub said, and when, in milliseconds:
 * `at` since the Unix epoch, and `monotonic` by `performance.now()`, a clock that only moves
 * forward, which times the waits GitHub asks for.
 */
export interface HeardLimit {
  readonly detail: RateLimited;
  readonly at: number;
  readonly monotonic: number;
}

/**
 * A run of writes GitHub turned away as content sent too fast ("was submitted too quickly"), as the
 * account's poller heard it: how many in a row, and until when writes wait after the last, in
 * milliseconds by the monotonic clock.
 */
export interface TooFast {
  readonly inARow: number;
  readonly until: number;
}

/** How many of GitHub's latest refusals for the rate limit a client keeps. */
const LIMITED_KEPT = 8;

/**
 * One account's client, or one without an account. Clients made from it with
 * {@link GithubClient.gated} share its token and rate limits.
 */
export class GithubClient {
  readonly urls: GitHubUrls;
  readonly #fetch: typeof globalThis.fetch;
  readonly #shared: Shared;
  readonly #store: Store | undefined;
  readonly #onUnauthorized: OnUnauthorized | undefined;
  readonly #classify: (error: unknown) => NetworkFailure;
  readonly #userAgent: string;
  readonly #gate: RequestGate | undefined;

  constructor(options: ClientOptions, shared?: Shared, gate?: RequestGate) {
    this.urls = { ...GITHUB_URLS, ...options.urls };
    this.#fetch = options.fetch;
    this.#shared = shared ?? {
      token: options.token,
      state: { rateLimits: new RateLimits(), sso: undefined },
      limited: [],
      tooFast: undefined,
      githubAhead: undefined,
    };
    this.#store = options.store;
    this.#onUnauthorized = options.onUnauthorized;
    this.#classify = options.classify ?? classifyNetworkError;
    this.#userAgent = options.userAgent ?? USER_AGENT;
    this.#gate = gate;
  }

  /**
   * This client, waiting at `gate` before each request. It shares the token and rate limits.
   * Never use one gated by an account's queue inside that queue's turn: its requests would wait
   * for the turn being held, forever.
   */
  gated(gate: RequestGate): GithubClient {
    return new GithubClient(
      {
        fetch: this.#fetch,
        urls: this.urls,
        store: this.#store,
        onUnauthorized: this.#onUnauthorized,
        classify: this.#classify,
        userAgent: this.#userAgent,
      },
      this.#shared,
      gate,
    );
  }

  /** The client's token, or nothing for a client without an account. */
  get token(): Token | undefined {
    return this.#shared.token;
  }

  /** Replaces the token for this client and every client sharing it. */
  setToken(token: Token): void {
    this.#shared.token = token;
  }

  /** A copy of what the account's responses have said about it. */
  state(): ClientState {
    const { rateLimits, sso } = this.#shared.state;
    return { rateLimits: rateLimits.clone(), sso: sso && { ...sso } };
  }

  rateLimits(): RateLimits {
    return this.#shared.state.rateLimits.clone();
  }

  /**
   * GitHub's latest refusals for the rate limit, to this client and those sharing its state, oldest
   * first: the last few, each the same object every time it's asked for. Each is recorded before the
   * request's gate lets the next request go, so whatever waits for its turn behind the request can
   * see that GitHub asked to wait before it sends anything.
   */
  rateLimited(): readonly HeardLimit[] {
    return [...this.#shared.limited];
  }

  /**
   * GitHub's latest run of writes it turned away as content sent too fast, to this client and those
   * sharing its state, as {@link GithubClient.setTooFast} last recorded it. It's kept here with the
   * refusals for the rate limit, so a poller that replaces another holds writes as long.
   */
  tooFast(): TooFast | undefined {
    return this.#shared.tooFast;
  }

  /** Records GitHub's latest run of writes turned away as content sent too fast ({@link GithubClient.tooFast}). */
  setTooFast(tooFast: TooFast | undefined): void {
    this.#shared.tooFast = tooFast;
  }

  /**
   * How far GitHub's clock is ahead of this computer's, in milliseconds, by the `Date` of the last
   * answer to this client or those sharing its state: nothing before one gave it. `Date` is to the
   * second, so this is too, give or take the time the answer took.
   */
  githubAhead(): number | undefined {
    return this.#shared.githubAhead;
  }

  /** Records `error`, if it's a refusal for the rate limit ({@link GithubClient.rateLimited}). */
  #heard(error: GithubError): void {
    const { detail } = error;
    if (detail.kind !== 'rateLimited') return;
    const { limited } = this.#shared;
    limited.push({ detail, at: Date.now(), monotonic: performance.now() });
    if (limited.length > LIMITED_KEPT) limited.splice(0, limited.length - LIMITED_KEPT);
  }

  /**
   * The URL for `path`, which is either relative to the API or a full URL under the API's or
   * the uploads' address. Anything else is refused, so the token goes nowhere else.
   */
  url(path: string): string {
    let url: URL;
    try {
      url = URL.canParse(path)
        ? new URL(path)
        : new URL(`${this.urls.api}/${path.replace(/^\/+/, '')}`);
    } catch {
      throw new GithubError({ kind: 'refusedUrl', host: 'a malformed URL' });
    }
    const allowed =
      url.username === '' &&
      url.password === '' &&
      [this.urls.api, this.urls.uploads].some((base) => within(url, new URL(base)));
    if (!allowed) {
      throw new GithubError({
        kind: 'refusedUrl',
        host: url.host || url.protocol.replace(/:$/, ''),
      });
    }
    return url.href;
  }

  /**
   * Sends a request. Any status other than 2xx or `304` (or one of `answers`) throws. When GitHub
   * refuses the token, the client's `onUnauthorized` may hand it a new one, and the request is
   * sent again once with it.
   */
  async send(method: string, path: string, options: SendOptions = {}): Promise<RestResponse> {
    return this.#request(method, path, options, (response) => response);
  }

  /** {@link GithubClient.send}, with `inspect` run on a successful answer before the gate lets the next request go. */
  async #request<T>(
    method: string,
    path: string,
    options: SendOptions,
    inspect: (response: RestResponse) => T,
  ): Promise<T> {
    const token = options.token ?? this.token;
    try {
      return await this.#sendWith(token, method, path, options, inspect);
    } catch (error) {
      if (!(error instanceof GithubError) || !error.isUnauthorized() || token === undefined)
        throw error;
      if (options.token !== undefined) throw error;
      const renewed = await this.tokenAfterRefusal(token);
      if (renewed === undefined) throw error;
      return this.#sendWith(renewed, method, path, options, inspect);
    }
  }

  /**
   * GitHub refused `token`: the client's `onUnauthorized` answer, a token it then uses, or
   * nothing, for a request that sends itself again only once it knows the token was refused
   * before anything was done, as an upload does.
   */
  async tokenAfterRefusal(token: Token): Promise<Token | undefined> {
    if (!this.#onUnauthorized) return undefined;
    const renewed = await this.#onUnauthorized(token);
    if (renewed !== undefined) this.setToken(renewed);
    return renewed;
  }

  async #sendWith<T>(
    token: Token | undefined,
    method: string,
    path: string,
    options: SendOptions,
    inspect: (response: RestResponse) => T,
  ): Promise<T> {
    return this.#held(token, method, path, options, (response) => {
      const ok =
        (response.status >= 200 && response.status < 300) ||
        response.status === 304 ||
        (options.answers ?? []).includes(response.status);
      if (ok) return inspect(response);
      const error = GithubError.fromResponse(response.status, response.headers, response.text());
      this.#heard(error);
      throw error;
    });
  }

  /**
   * Sends a request and reads the whole answer, whatever its status, recording its rate limit and
   * single sign-on header. Redirects are followed only to where the token may go.
   */
  async sendUnchecked(
    token: Token | undefined,
    method: string,
    path: string,
    options: SendOptions = {},
  ): Promise<RestResponse> {
    return this.#held(token, method, path, options, (response) => response);
  }

  /**
   * {@link GithubClient.sendUnchecked}, running `inspect` on the answer while the request still
   * holds its gate, so what the answer says about the rate limit is recorded before the next
   * request goes.
   */
  async #held<T>(
    token: Token | undefined,
    method: string,
    path: string,
    options: SendOptions,
    inspect: (response: RestResponse) => T,
  ): Promise<T> {
    let url = this.url(path);
    let currentMethod = method;
    let body = options.body;
    const { signal } = options;
    if (signal?.aborted) throw abandoned(signal);
    const release = this.#gate ? await this.#gate() : undefined;
    try {
      for (let redirects = 0; ; redirects++) {
        if (signal?.aborted) throw abandoned(signal);
        const response = await this.#exchange(token, currentMethod, url, body, options);
        const location = response.header('location');
        const redirected = [301, 302, 303, 307, 308].includes(response.status);
        const follow = options.followRedirects ?? true;
        if (!follow || !redirected || location === undefined || redirects === MAX_REDIRECTS) {
          return inspect(response);
        }
        url = this.url(new URL(location, url).href);
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
        ) {
          currentMethod = 'GET';
          body = undefined;
        }
      }
    } finally {
      release?.();
    }
  }

  async #exchange(
    token: Token | undefined,
    method: string,
    url: string,
    body: string | Uint8Array | undefined,
    options: SendOptions,
  ): Promise<RestResponse> {
    let headers: Headers;
    try {
      headers = new Headers({
        accept: options.accept ?? 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
        'user-agent': this.#userAgent,
      });
      // A client without an account sends no token; one with an account always sends it, even an
      // empty one, so GitHub refuses it and the account is signed out rather than read as nobody.
      if (token !== undefined) headers.set('authorization', `token ${token.expose()}`);
      if (body !== undefined) {
        headers.set('content-type', options.contentType ?? 'application/json');
      }
      if (options.condition && 'ifNoneMatch' in options.condition) {
        headers.set('if-none-match', options.condition.ifNoneMatch);
      } else if (options.condition && 'ifModifiedSince' in options.condition) {
        headers.set('if-modified-since', options.condition.ifModifiedSince);
      }
    } catch {
      // What the header said would be in the error, and it may be the token, so the error is
      // left behind: nothing of it is kept.
      throw new GithubError({
        kind: 'decode',
        message: "a request's headers held something a header can't, so it wasn't sent",
      });
    }
    let response: Response;
    let bytes: Uint8Array;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
    const given = options.signal;
    const init: FetchInit = {
      method,
      headers,
      body: body === undefined || typeof body === 'string' ? body : new Uint8Array(body),
      redirect: 'manual',
      signal: given ? AbortSignal.any([timeout, given]) : timeout,
      uploadProgress: options.uploadProgress,
      once: method !== 'GET' && method !== 'HEAD' && (options.once ?? true),
    };
    try {
      response = await this.#fetch(url, init);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof GithubError) throw error;
      // Given up on by whoever sent it, which isn't the network failing.
      if (given?.aborted) throw abandoned(given);
      throw new GithubError(
        { kind: 'network', failure: this.#classify(error), message: describeThrown(error) },
        { cause: error },
      );
    }
    if (options.token === undefined) {
      const state = this.#shared.state;
      state.rateLimits.recordHeaders(response.headers);
      const sso = parseSsoHeader(response.headers.get('x-github-sso'));
      if (sso) state.sso = sso;
      const date = Date.parse(response.headers.get('date') ?? '');
      if (!Number.isNaN(date)) this.#shared.githubAhead = date - Date.now();
    }
    return new RestResponse(response.status, response.headers, bytes);
  }

  /** A GET of JSON, read by `read`. */
  async get<T>(path: string, read: Read<T>): Promise<T> {
    return (await this.send('GET', path)).json(read);
  }

  /**
   * A GET whose answer comes back whatever its status, for a caller that explains GitHub's errors
   * itself. Its rate limit is recorded as any answer's is; no token renewal is asked for.
   */
  getAnswer(path: string): Promise<RestResponse> {
    return this.sendUnchecked(this.token, 'GET', path);
  }

  /** A GET that's free when nothing changed: sends `etag` as `If-None-Match`, and answers `notModified` on a `304`. */
  getConditional<T>(
    path: string,
    etag: string | undefined,
    read: Read<T>,
  ): Promise<Conditional<T>> {
    return this.#getIf(path, etag === undefined ? undefined : { ifNoneMatch: etag }, read);
  }

  /**
   * A GET that's free when nothing changed since `since`, an HTTP date such as an earlier
   * answer's `Last-Modified`. Unlike an ETag, which changes with anything in the body, this asks
   * only whether the resource itself was updated.
   */
  getModifiedSince<T>(
    path: string,
    since: string | undefined,
    read: Read<T>,
  ): Promise<Conditional<T>> {
    return this.#getIf(path, since === undefined ? undefined : { ifModifiedSince: since }, read);
  }

  async #getIf<T>(path: string, condition: Condition, read: Read<T>): Promise<Conditional<T>> {
    const response = await this.send('GET', path, { condition });
    if (response.status === 304) return { notModified: true };
    return { notModified: false, value: response.json(read), etag: response.etag };
  }

  /**
   * A GET answered from the client's store when nothing changed: sends the ETag kept for the URL,
   * and on a `304`, which costs no rate limit, answers with the body kept with it. A new answer
   * is kept with its ETag. A store that fails is gone around: the read still works, at full price.
   */
  async getStored<T>(path: string, read: Read<T>): Promise<{ value: T; changed: boolean }> {
    const url = this.url(path);
    const store = this.#store;
    let kept = await attempt(() => store?.get(url));
    if (kept && !isHeaderValue(kept.etag)) {
      // An ETag that can't go in a header would fail every read the same way: it's dropped, and
      // the read made in full.
      await attempt(() => store?.delete(url));
      kept = undefined;
    }
    if (kept) {
      const response = await this.send('GET', url, { condition: { ifNoneMatch: kept.etag } });
      if (response.status !== 304)
        return { value: await this.#keep(url, response, read), changed: true };
      try {
        return { value: parseJson(kept.body, read), changed: false };
      } catch {
        // GitHub keeps answering 304 to that ETag, so a kept answer that no longer reads would
        // fail every read until the resource changed: it's dropped, and the read made in full.
        await attempt(() => store?.delete(url));
      }
    }
    const response = await this.send('GET', url);
    return { value: await this.#keep(url, response, read), changed: true };
  }

  /** `response`'s value, kept with its ETag in the store, if it has one. */
  async #keep<T>(url: string, response: RestResponse, read: Read<T>): Promise<T> {
    const value = response.json(read);
    const { etag } = response;
    const store = this.#store;
    if (etag !== undefined) await attempt(() => store?.set(url, { etag, body: response.text() }));
    return value;
  }

  /** A POST, PUT or PATCH of `body`, already serialized, answered with JSON read by `read`. */
  async write<T>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: string,
    read: Read<T>,
  ): Promise<T> {
    return (await this.send(method, path, { body })).json(read);
  }

  async delete(path: string): Promise<void> {
    await this.send('DELETE', path);
  }

  /** Runs a GraphQL operation, answering with partial data along with any errors, and the answer's headers. */
  async graphqlPartial<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    variables: TVariables,
  ): Promise<GraphQLResponse<TResult> & { headers: Headers }> {
    const { response } = await this.#graphqlAnswer(document, variables);
    return response;
  }

  /**
   * A GraphQL operation's answer, and the error its errors make, if any, built and recorded while
   * the request still holds its gate, as a rate limit GitHub reports in them must be.
   */
  async #graphqlAnswer<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    variables: TVariables,
  ): Promise<{
    response: GraphQLResponse<TResult> & { headers: Headers };
    error: GithubError | undefined;
  }> {
    const query = String(document);
    const operationName = /\b(?:query|mutation|subscription)\s+(\w+)/.exec(query)?.[1];
    const body = JSON.stringify({ query, operationName, variables });
    // A document that starts as a query is a read, though it's a `POST`. Anything else, a mutation
    // above all, is sent at most once.
    const once = !/^\s*query\b/.test(query);
    return this.#request('POST', '/graphql', { body, once }, (answer) => {
      let decoded: GraphQLResponse;
      try {
        decoded = decodeGraphQL(answer.text());
      } catch (error) {
        throw new GithubError({ kind: 'decode', message: String(error) }, { cause: error });
      }
      if (decoded.rateLimit) this.#shared.state.rateLimits.recordGraphQLField(decoded.rateLimit);
      const error =
        decoded.errors.length > 0
          ? GithubError.fromGraphQL(decoded.errors, answer.headers)
          : undefined;
      if (error) this.#heard(error);
      // The generated types follow GitHub's schema, and the data is taken as they describe it.
      const data = decoded.data === undefined ? undefined : unchecked<TResult>(decoded.data);
      return { response: { ...decoded, data, headers: answer.headers }, error };
    });
  }

  /**
   * Runs a GraphQL operation. Any error in the response fails it, typed where GitHub's error is one
   * Lo handles (not found, single sign-on, an organization's OAuth restriction, the rate limit).
   */
  async graphql<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    variables: TVariables,
  ): Promise<TResult> {
    const { response, error } = await this.#graphqlAnswer(document, variables);
    if (error) throw error;
    const { data } = response;
    if (data === undefined)
      throw new GithubError({ kind: 'decode', message: 'the response had no data' });
    return data;
  }

  /**
   * Runs a GraphQL operation whose answer is still useful when GitHub left out a field it couldn't
   * show, such as a fork's repository in an organization that restricts OAuth apps. Errors about
   * fields deeper than `depth` from the root come back with the rest of the data; any other error
   * fails the operation, as in {@link GithubClient.graphql}.
   */
  async graphqlWithErrors<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    variables: TVariables,
    depth: number,
  ): Promise<{ data: TResult; errors: GraphQLError[] }> {
    const { response, error } = await this.#graphqlAnswer(document, variables);
    const { data, errors } = response;
    if (data !== undefined && errors.every((found) => isBelow(found, depth))) {
      return { data, errors };
    }
    if (error === undefined)
      throw new GithubError({ kind: 'decode', message: 'the response had no data' });
    throw error;
  }

  /** The signed-in user and the token's scopes (`GET /user`). */
  async user(): Promise<AuthenticatedUser> {
    const response = await this.send('GET', '/user');
    return {
      user: response.json(unchecked<User>),
      scopes: parseScopes(response.header('x-oauth-scopes')),
    };
  }
}

/** Whether `value` can be a header's value: no line breaks, no NUL, and nothing past Latin-1. */
function isHeaderValue(value: string): boolean {
  return /^[\t\x20-\x7e\x80-\xff]*$/.test(value);
}

/** What `call` answers, or nothing when it fails, whether it throws or rejects. */
async function attempt<T>(call: () => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    return undefined;
  }
}

/** Whether `url` is at `base`: the same origin, and under its path. */
function within(url: URL, base: URL): boolean {
  if (url.origin !== base.origin) return false;
  const prefix = base.pathname.replace(/\/+$/, '');
  return prefix === '' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

/** `text` parsed as JSON and read by `read`. A failure to do either is GitHub's answer not being what Lo expected. */
function parseJson<T>(text: string, read: Read<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new GithubError({ kind: 'decode', message: String(error) }, { cause: error });
  }
  return read(json);
}

/** What `fetch` threw, in a few words, with its cause's. */
function describeThrown(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}
