/**
 * The poller on Vitest's fake clock, replaying `poll_playground` (two polls of
 * `rozed-dev/playground`, recorded in the poller's order) and edited copies of its answers.
 *
 * Every request is logged at the whole second it was sent, from when the test started.
 */

import {
  cassette,
  isObject,
  MemoryAccountRows,
  MemoryPollCache,
  MemorySecrets,
  Replay,
  replayFetch,
  type Interaction,
  type Json,
  type SeenRequest,
} from '@lo/testing';
import { onTestFinished, vi } from 'vitest';

import { Accounts, type Account, type AccountSource } from '../../src/accounts.ts';
import { GithubClient } from '../../src/client.ts';
import { GithubError } from '../../src/errors.ts';
import { RenewalError, type Grant } from '../../src/grant.ts';
import {
  Poller,
  type LookUpMerged,
  type PollEvent,
  type PollStatus,
} from '../../src/poll/poller.ts';
import { pullRequest, type PullRequest } from '../../src/queries.ts';
import { PullRef, RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';
import type { AuthenticatedUser } from '../../src/user.ts';

/**
 * The wall clock when each test starts, in seconds since the Unix epoch: after every recorded
 * rate-limit window has reset, so only the windows a test sets count.
 */
export const START = 1_794_100_000;
export const LOGIN = 'rozed-bot';

/** The wall-clock time `secs` after the start, in milliseconds. */
export function wall(secs: number): number {
  return (START + secs) * 1000;
}

export function pr(number: number): PullRef {
  return new PullRef('rozed-dev', 'playground', number);
}

export const PLAYGROUND = new RepoRef('rozed-dev', 'playground');

/** The status while nothing is wrong. */
export const QUIET: PollStatus = {
  rateLimit: { kind: 'normal' },
  offline: undefined,
  signedOut: false,
};

/** The clock each test runs on: Vitest's fake timers, from {@link START}. */
export function useFakeClock(): void {
  vi.useFakeTimers({ now: START * 1000 });
}

/** A request as logged: the second it was sent, and what it was. */
export type Logged = [secs: number, what: string];

/**
 * `GET /pulls?state=open&per_page=100 (etag)` for a request that sent an ETag, `GET /pulls/1
 * (since)` for one that asked about changes since a time, or a GraphQL operation's name.
 */
export function describeRequest(request: Request, body: string): string {
  const url = new URL(request.url);
  if (url.pathname === '/graphql') {
    const json: unknown = JSON.parse(body);
    const name: unknown =
      typeof json === 'object' && json !== null ? Reflect.get(json, 'operationName') : undefined;
    return typeof name === 'string' ? name : 'GraphQL';
  }
  const path = url.pathname.replace(/^\/repos\/rozed-dev\/playground/, '');
  const condition = request.headers.has('if-none-match')
    ? ' (etag)'
    : request.headers.has('if-modified-since')
      ? ' (since)'
      : '';
  return `${request.method} ${path}${url.search}${condition}`;
}

/** `json`, if it's JSON. */
function asJson(json: unknown): Json | undefined {
  return isJson(json) ? json : undefined;
}

function isJson(value: unknown): value is Json {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === 'object' && Object.values(value).every(isJson);
}

function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return '';
}

/**
 * Replays a cassette, logging when each request was sent and what it was. It can pretend the
 * network is down, and make every request take a while.
 */
export class Network {
  readonly replay: Replay;
  /** When the test started, by the monotonic clock. */
  readonly start: number;
  readonly log: Logged[] = [];
  /** While set, every request fails as `fetch` does without a network. */
  offline = false;
  readonly #delay: Delay | undefined;
  readonly #replayed: typeof globalThis.fetch;

  constructor(replay: Replay, delay: Delay | undefined) {
    this.replay = replay;
    this.start = performance.now();
    this.#delay = delay;
    this.#replayed = replayFetch(replay);
  }

  /** Every request the cassette was asked, in order. */
  get seen(): readonly SeenRequest[] {
    return this.replay.seen;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const sent = Math.floor((performance.now() - this.start) / 1000);
    const what = describeRequest(request, bodyText(init?.body));
    this.log.push([sent, what]);
    const offline = this.offline;
    const delay = typeof this.#delay === 'function' ? this.#delay(what) : this.#delay;
    if (delay !== undefined) await wait(delay, init?.signal ?? undefined);
    if (offline) {
      const down = Object.assign(new Error('the network is down'), { code: 'ENETDOWN' });
      throw new TypeError('fetch failed', { cause: down });
    }
    return this.#replayed(input, init);
  };
}

/** Waits `delay` milliseconds, as a request takes them, or fails as `fetch` does once `signal` gives up. */
function wait(delay: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', giveUp);
      resolve();
    }, delay);
    const giveUp = () => {
      clearTimeout(timer);
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new Error('given up', { cause: reason }));
    };
    signal?.addEventListener('abort', giveUp, { once: true });
  });
}

export function user(): AuthenticatedUser {
  return {
    user: { login: LOGIN, id: 353226052, name: null, avatar_url: null },
    scopes: ['read:org', 'repo', 'workflow'],
  };
}

/** No token here expires, so nothing renews one. */
function renew(): Promise<Grant> {
  return Promise.reject(new RenewalError('refused', 'the token has no refresh token'));
}

/** How long each request takes, in milliseconds: all alike, or by what it is, as the log says. */
export type Delay = number | ((what: string) => number | undefined);

export interface PollingOptions {
  /** How long each request takes, in milliseconds. */
  delay?: Delay | undefined;
  /** How the account signed in. */
  source?: AccountSource | undefined;
  /** Reads an account imported from `gh` from `gh` again, given the network. */
  reread?: ((network: Network, login: string) => Promise<Token | undefined>) | undefined;
  lookUpMerged?: LookUpMerged | undefined;
}

/** One poller for rozed-bot, its accounts and its cache, and what it sends and says. */
export class Polling {
  poller!: Poller;
  accounts: Accounts;
  readonly http: Network;
  readonly rows: MemoryAccountRows<Account>;
  readonly secrets: MemorySecrets<Grant>;
  readonly cache = new MemoryPollCache();
  /** Each head the poller noted it saw, by pull request, with when it was first seen. */
  readonly heads = new Map<string, [head: string, firstSeen: number][]>();
  /** What the poller logged. */
  readonly logs: string[] = [];
  readonly #options: PollingOptions;
  readonly #events: string[] = [];
  #unsubscribe: () => void = () => {};

  private constructor(
    http: Network,
    rows: MemoryAccountRows<Account>,
    secrets: MemorySecrets<Grant>,
    accounts: Accounts,
    options: PollingOptions,
  ) {
    this.http = http;
    this.rows = rows;
    this.secrets = secrets;
    this.accounts = accounts;
    this.#options = options;
    this.#makePoller();
    onTestFinished(() => {
      this.poller.stop();
    });
  }

  /** A poller for rozed-bot, signed in with `gho_FAKE`, replaying `interactions`. */
  static async start(
    name: string,
    interactions: readonly Interaction[],
    options: PollingOptions = {},
  ): Promise<Polling> {
    const http = new Network(new Replay(name, interactions), options.delay);
    const rows = new MemoryAccountRows<Account>();
    const secrets = new MemorySecrets<Grant>();
    const accounts = await Polling.#accounts(http, rows, secrets, options);
    await accounts.add(user(), { token: new Token('gho_FAKE') }, options.source ?? 'deviceFlow');
    return new Polling(http, rows, secrets, accounts, options);
  }

  static #accounts(
    http: Network,
    rows: MemoryAccountRows<Account>,
    secrets: MemorySecrets<Grant>,
    options: PollingOptions,
  ): Promise<Accounts> {
    const { reread } = options;
    return Accounts.load({
      rows,
      secrets,
      renew,
      fetch: http.fetch,
      reread: reread && ((login) => reread(http, login)),
    });
  }

  #makePoller(): void {
    this.poller = new Poller({
      accounts: this.accounts,
      login: LOGIN,
      cache: this.cache,
      config: { jitter: 0 },
      log: (message) => this.logs.push(message),
      lookUpMerged: this.#options.lookUpMerged,
      seen: (_login, pull, heads, when) => {
        const seen = this.heads.get(pull.key) ?? [];
        for (const head of heads) {
          if (!seen.some(([known]) => known === head)) seen.push([head, when]);
        }
        this.heads.set(pull.key, seen);
        return Promise.resolve();
      },
    });
    this.#unsubscribe = this.poller.onEvent((event) => this.#events.push(describeEvent(event)));
  }

  /** Replaces the poller with a new one on the same accounts and cache, as after a restart. */
  async restart(): Promise<void> {
    this.poller.stop();
    this.#unsubscribe();
    this.#makePoller();
    await this.run();
  }

  /** Replaces the accounts and the poller, as when Lo starts again: no token has been read. */
  async restartLo(): Promise<void> {
    this.accounts = await Polling.#accounts(this.http, this.rows, this.secrets, this.#options);
    await this.restart();
  }

  status(): PollStatus {
    return this.poller.status();
  }

  /** The computer sleeps for `secs`: the wall clock moves on, the monotonic clock and its timers don't. */
  sleep(secs: number): void {
    vi.setSystemTime(Date.now() + secs * 1000);
  }

  /** Runs what's ready at the current second. */
  async run(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  /** Moves the clock to `secs` after the start. */
  async runUntil(secs: number): Promise<void> {
    const left = secs * 1000 - (performance.now() - this.http.start);
    if (left > 0) await vi.advanceTimersByTimeAsync(left);
  }

  /** The whole seconds since the start. */
  now(): number {
    return Math.floor((performance.now() - this.http.start) / 1000);
  }

  /**
   * Waits for `promise` as a test waiting on a task does: what's ready runs, and while nothing
   * else can, the clock moves on to the next timer.
   */
  async finish<T>(promise: Promise<T>): Promise<T> {
    const state = { done: false };
    const watched = promise.finally(() => {
      state.done = true;
    });
    watched.catch(() => {});
    await this.run();
    for (let steps = 0; !state.done; steps++) {
      if (steps > 10_000 || vi.getTimerCount() === 0) throw new Error('it never finishes');
      await vi.advanceTimersToNextTimerAsync();
    }
    return watched;
  }

  /** The requests sent since the last call. */
  requests(): Logged[] {
    return this.http.log.splice(0);
  }

  /** The events sent since the last call, briefly. */
  events(): string[] {
    return this.#events.splice(0);
  }
}

/** An event, briefly. */
export function describeEvent(event: PollEvent): string {
  switch (event.kind) {
    case 'summary':
      return `summary #${event.pull.number}: ${event.summary.title}`;
    case 'details':
      return `details #${event.pull.number}: ${event.details.title}`;
    case 'check':
      return `check #${event.pull.number}`;
    case 'openPullRequests':
      return `open PRs of ${event.repo.toString()}: ${event.list.pullRequests.length}`;
    case 'trunkRules':
      return `rulesets of ${event.repo.toString()}`;
    case 'failed':
      return `failed ${event.target.toString()}: ${new GithubError(event.error).message}`;
    case 'read':
      return `read ${event.name} #${event.pull.number}`;
    case 'confirmed':
      return `confirmed ${event.name} #${event.pull.number}`;
    case 'readFailed':
      return `failed to read ${event.name} #${event.pull.number}: ${new GithubError(event.error).message}`;
    default:
      throw new Error(`a poll event Lo doesn't know: ${JSON.stringify(event satisfies never)}`);
  }
}

/** What a promise came to: its value, or what it threw. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** `promise`'s outcome, caught as soon as it settles, so a failure the test reads later isn't unhandled. */
export function outcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

/** `entries`, as the requests log holds them. */
export function log(...entries: Logged[]): Logged[] {
  return entries;
}

/**
 * The recorded poll: `[0]` GET /pulls/1, `[1]` its check, `[2]` its details, `[3]` GET /pulls/2,
 * `[4]` GET of the open PRs, `[5]` OpenPullRequests, then the second poll: `[6]` a 304 for
 * /pulls/1, `[7]` its check, `[8]` a 304 for /pulls/2, `[9]` a 304 for the open PRs. Last, `[10]`
 * TrunkRules, which the first poll reads after OpenPullRequests.
 */
export function recorded(): Interaction[] {
  return cassette('poll_playground').interactions.map(({ interaction }) => interaction);
}

/** The recorded interaction at `index`, copied. */
export function at(interactions: readonly Interaction[], index: number): Interaction {
  const interaction = interactions[index];
  if (!interaction) throw new Error(`no interaction ${index}`);
  return structuredClone(interaction);
}

/** The recorded poll's answers for the repository's open PRs, and its rulesets. */
export function repoAnswers(r: readonly Interaction[]): Interaction[] {
  return [at(r, 4), at(r, 5), at(r, 9), at(r, 10)];
}

/** The object at `path` in `json`, to read or edit in place. */
export function object(json: Json | undefined, ...path: (string | number)[]): Record<string, Json> {
  const found = walk(json, path);
  if (!isObject(found)) throw new Error(`no object at /${path.join('/')}`);
  return found;
}

/** The array at `path` in `json`, to read or edit in place. */
export function array(json: Json | undefined, ...path: (string | number)[]): Json[] {
  const found = walk(json, path);
  if (!Array.isArray(found)) throw new Error(`no array at /${path.join('/')}`);
  return found;
}

function walk(json: Json | undefined, path: readonly (string | number)[]): Json | undefined {
  let value = json;
  for (const key of path) {
    if (typeof key === 'number') value = Array.isArray(value) ? value[key] : undefined;
    else value = isObject(value) ? value[key] : undefined;
  }
  return value;
}

export function withHeaders(
  interaction: Interaction,
  headers: readonly [string, string][],
): Interaction {
  const edited = structuredClone(interaction);
  for (const [name, value] of headers) edited.response.headers[name] = value;
  return edited;
}

/** `x-ratelimit-*` headers for a window that resets `reset` seconds after the start. */
export function rateLimit(resource: string, remaining: number, reset: number): [string, string][] {
  return [
    ['x-ratelimit-limit', '5000'],
    ['x-ratelimit-remaining', String(remaining)],
    ['x-ratelimit-used', String(5000 - remaining)],
    ['x-ratelimit-reset', String(START + reset)],
    ['x-ratelimit-resource', resource],
  ];
}

/** The answer to a conditional request that sent `etag`, now carrying `newEtag`. */
export function answering(interaction: Interaction, sent: string, newEtag: string): Interaction {
  const edited = structuredClone(interaction);
  edited.request.if_none_match = sent;
  edited.response.headers['etag'] = newEtag;
  return edited;
}

export function etag(interaction: Interaction): string {
  const found = interaction.response.headers['etag'];
  if (found === undefined) throw new Error('no ETag');
  return found;
}

/** The answer to a GET of a pull request that asked about changes since `since`. */
export function askedSince(interaction: Interaction, since: string): Interaction {
  const edited = structuredClone(interaction);
  delete edited.request.if_none_match;
  edited.request.if_modified_since = since;
  return edited;
}

/** When GitHub last updated a pull request, from its answer. */
export function lastModified(interaction: Interaction): string {
  const found = interaction.response.headers['last-modified'];
  if (found === undefined) throw new Error('no Last-Modified');
  return found;
}

/** The time a pull request edited by {@link updated} was updated at, and its HTTP date. */
export const NOON = ['2026-11-06T12:00:00Z', 'Fri, 06 Nov 2026 12:00:00 GMT'] as const;

/** A pull request's answer, updated at {@link NOON} with `edit`. */
export function updated(
  interaction: Interaction,
  edit: (body: Record<string, Json>) => void,
): Interaction {
  const edited = withBody(interaction, (body) => {
    const pull = object(body);
    pull['updated_at'] = NOON[0];
    edit(pull);
  });
  edited.response.headers['last-modified'] = NOON[1];
  return edited;
}

export function withBody(interaction: Interaction, edit: (body: Json) => void): Interaction {
  const edited = structuredClone(interaction);
  const body = edited.response.body;
  if (body === undefined) throw new Error('no body');
  edit(body);
  return edited;
}

/** An answer with a status and a JSON body, for the request `like` made. */
export function answer(
  like: Interaction,
  status: number,
  headers: readonly [string, string][],
  body: string,
): Interaction {
  const edited = structuredClone(like);
  edited.response = { status, headers: Object.fromEntries(headers) };
  const parsed = asJson(parseOrNothing(body));
  if (parsed !== undefined) edited.response.body = parsed;
  return edited;
}

function parseOrNothing(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The recorded details of PR #1, retitled. */
export function detailsTitled(r: readonly Interaction[], title: string): Interaction {
  return withBody(at(r, 2), (body) => {
    object(body, 'data', 'repository', 'pullRequest')['title'] = title;
  });
}

/** A recorded GraphQL request for PR #1, asked about PR `number` instead. */
export function forPull(interaction: Interaction, number: number): Interaction {
  const edited = structuredClone(interaction);
  object(edited.request.variables)['number'] = number;
  return edited;
}

/** PR #1's details as GitHub's recorded answer gives them. */
export async function decodedDetails(r: readonly Interaction[]): Promise<PullRequest> {
  const client = new GithubClient({
    fetch: replayFetch(new Replay('details', [at(r, 2)])),
    token: new Token('gho_FAKE'),
  });
  return pullRequest(client, 'rozed-dev', 'playground', 1);
}

/** `POST /issues/{number}/comments`, answered `201`. */
export function commentOn(r: readonly Interaction[], number: number): Interaction {
  return {
    request: {
      method: 'POST',
      url: `https://api.github.com/repos/rozed-dev/playground/issues/${number}/comments`,
      body: '{"body":"hi"}',
    },
    response: answer(at(r, 0), 201, [], '{"id":1}').response,
  };
}

/** `POST /issues/1/comments`, answered `201`. */
export function comment(r: readonly Interaction[]): Interaction {
  return commentOn(r, 1);
}

/** Comments on PR `number` with the poller's write. */
export function postCommentOn(poller: Poller, number: number): Promise<unknown> {
  return poller.write(pr(number), (client) =>
    client.write(
      'POST',
      `/repos/rozed-dev/playground/issues/${number}/comments`,
      JSON.stringify({ body: 'hi' }),
      (json: unknown) => json,
    ),
  );
}

/** Comments on PR #1 with the poller's write. */
export function postComment(poller: Poller): Promise<unknown> {
  return postCommentOn(poller, 1);
}

/** The `id` of what a write answered. */
export function idOf(answered: unknown): unknown {
  return typeof answered === 'object' && answered !== null
    ? Reflect.get(answered, 'id')
    : undefined;
}

/** Fails unless each request was sent after the one before it finished, when each takes a second. */
export function oneAtATime(requests: readonly Logged[]): boolean {
  return requests.every((request, index) => {
    const before = requests[index - 1];
    return before === undefined || request[0] > before[0];
  });
}
