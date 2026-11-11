/**
 * A harness for `MergeJobs` on Vitest's fake clock, sending through a real `Poller` and replaying
 * what `rozed-bot` recorded merging pull requests on `rozed-dev/e2e`, and the scenarios' answers
 * and requests read from those recordings.
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
} from '@lo/testing';
import { vi } from 'vitest';

import { Accounts, type Account } from '../../src/accounts.ts';
import { RenewalError, type Grant } from '../../src/grant.ts';
import { unchecked } from '../../src/json.ts';
import { MergeJobs, type Job, type JobChanged, type JobState } from '../../src/merge-jobs.ts';
import { directMerge, isRefusal, withCommit, type MergeRequest } from '../../src/merge-writes.ts';
import { Poller } from '../../src/poll/poller.ts';
import { PullRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';

export const LOGIN = 'rozed-bot';

/** How a merge's stack lookup shows in the log, which leaves out queries. */
export const LOOKUP = 'GET /stacks';

/** When the test's wall clock starts, in milliseconds since the Unix epoch. */
export const START = 1_794_100_000_000;

/**
 * What the network does to a request instead of answering it: `unreachable`, nothing answers, as
 * when the Mac is offline, so the request never left; `reset`, the connection is reset after the
 * request was sent, so its answer is lost.
 */
export type Failure = 'unreachable' | 'reset';

/** What Node's `fetch` throws for `failure`. */
function thrown(failure: Failure): TypeError {
  const [code, message] =
    failure === 'unreachable'
      ? ['ECONNREFUSED', 'connect ECONNREFUSED 140.82.112.6:443']
      : ['ECONNRESET', 'read ECONNRESET'];
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
}

/** The pollers the harnesses started, stopped by {@link stopPollers}. */
const pollers: Poller[] = [];

/** Stops every poller a harness started. */
export function stopPollers(): void {
  for (const poller of pollers.splice(0)) poller.stop();
}

/** Lets everything that's ready run, without the clock moving. */
export async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * The accounts holding `rozed-bot`, a real `Poller` for it, and the app's jobs, sending through a
 * replay of `interactions` and the recorded stack lookups. Each request is logged at the whole
 * second it was sent, by the monotonic clock, as its method and its path under the repository. The
 * next requests can be made to fail instead: the next stack lookups, or the next other requests.
 */
export class Harness {
  readonly jobs: MergeJobs;
  readonly poller: Poller;
  readonly accounts: Accounts;
  /** When the harness was made, by the monotonic clock. */
  readonly start: number;
  readonly #log: [number, string][];
  readonly #failures: Failure[];
  readonly #lookupFailures: Failure[];
  readonly #events: JobChanged[] = [];

  private constructor(
    parts: Pick<Harness, 'jobs' | 'poller' | 'accounts' | 'start'>,
    net: { log: [number, string][]; failures: Failure[]; lookupFailures: Failure[] },
  ) {
    this.jobs = parts.jobs;
    this.poller = parts.poller;
    this.accounts = parts.accounts;
    this.start = parts.start;
    this.#log = net.log;
    this.#failures = net.failures;
    this.#lookupFailures = net.lookupFailures;
    this.jobs.onChange((changed) => {
      this.#events.push(changed);
    });
  }

  static async create(name: string, interactions: Iterable<Interaction>): Promise<Harness> {
    const start = performance.now();
    const replayed = replayFetch(new Replay(name, [...interactions, ...lookups()]));
    const net = {
      log: [] as [number, string][],
      failures: [] as Failure[],
      lookupFailures: [] as Failure[],
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const sent = Math.floor((performance.now() - start) / 1000);
      const url = new URL(request.url);
      const what = `${request.method} ${url.pathname.replace(/^\/repos\/rozed-dev\/e2e/, '')}`;
      const failure = what === LOOKUP ? net.lookupFailures.shift() : net.failures.shift();
      net.log.push([sent, what]);
      if (failure !== undefined) throw thrown(failure);
      return replayed(request);
    };
    const accounts = await Accounts.load({
      rows: new MemoryAccountRows<Account>(),
      secrets: new MemorySecrets<Grant>(),
      renew: () => Promise.reject(new RenewalError('refused', 'bad_refresh_token')),
      fetch,
    });
    await accounts.add(
      {
        user: { login: LOGIN, id: 353226052, name: null, avatar_url: null },
        scopes: ['read:org', 'repo', 'workflow'],
      },
      { token: new Token('gho_FAKE') },
      'deviceFlow',
    );
    const poller = new Poller({
      accounts,
      login: LOGIN,
      cache: new MemoryPollCache(),
      config: { jitter: 0 },
    });
    pollers.push(poller);
    return new Harness({ jobs: new MergeJobs(), poller, accounts, start }, net);
  }

  /** Merges `pull` as `request` says, and lets what's ready run. */
  async merge(
    pull: PullRef,
    request: MergeRequest,
  ): Promise<undefined | { refusal: 'alreadyMerging' }> {
    const merging = this.jobs.merge(this.poller, pull, request);
    await settle();
    return merging;
  }

  /** Moves the clock to `secs` after the start, a second at a time. */
  async runUntil(secs: number): Promise<void> {
    await settle();
    while (this.now() < secs) await vi.advanceTimersByTimeAsync(1000);
  }

  /** The whole seconds since the start. */
  now(): number {
    return Math.floor((performance.now() - this.start) / 1000);
  }

  /** The requests sent since the last call, as `[second, request]`. */
  requests(): [number, string][] {
    return this.#log.splice(0);
  }

  /** Fails the next request that isn't a stack lookup. */
  failNext(failure: Failure): void {
    this.#failures.push(failure);
  }

  /** Fails the next stack lookup. */
  failNextLookup(failure: Failure): void {
    this.#lookupFailures.push(failure);
  }

  job(pull: PullRef): Job {
    const job = this.jobs.job(pull);
    if (!job) throw new Error(`there's no job for ${pull.toString()}`);
    return job;
  }

  state(pull: PullRef): JobState {
    return this.job(pull).state;
  }

  polls(pull: PullRef): number {
    return this.job(pull).polls;
  }

  /** The changes heard since the last call, as `[pull request, done]`. */
  events(): [number, boolean][] {
    return this.#events.splice(0).map((changed) => [changed.pull.number, changed.done]);
  }
}

/** A pull request a scenario uses, as it was when the recorder set the scenario up. */
export interface Pr {
  number: number;
  node_id: string;
  branch: string;
  head: string;
}

/** What the recorder made or found for the scenarios: kept in each cassette as its setup. */
export interface Setup {
  run: number;
  merged?: Pr | null;
  moved?: Pr | null;
  /** A commit that's no pull request's head. */
  stale: string;
  open: Pr;
  /** A stack's layers, bottom to top. */
  stack: Pr[];
  draft: Pr;
  passing: Pr;
  queue_fail: Pr;
}

export function pullOf(pr: Pr): PullRef {
  return new PullRef('rozed-dev', 'e2e', pr.number);
}

/** The layers below a stack's top, bottom to top, at their heads, as a merge of the top names them. */
export function layersBelow(stack: readonly Pr[]): { pr: number; head: string }[] {
  return stack.slice(0, -1).map((pr) => ({ pr: pr.number, head: pr.head }));
}

/** `value`, which a recording must have. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('the recording has nothing here');
  return value;
}

/** `request`, which can't be a refusal for the full SHAs the recordings hold. */
export function made(request: MergeRequest | { refusal: string }): MergeRequest {
  if (isRefusal(request)) throw new Error(`refused: ${JSON.stringify(request)}`);
  return request;
}

/** A recording's setup and interactions. */
export function recording(name: string): { setup: Setup; interactions: Interaction[] } {
  const recorded = cassette(name);
  return {
    setup: unchecked<Setup>(recorded.info.setup),
    interactions: recorded.interactions.map(({ interaction }) => structuredClone(interaction)),
  };
}

/** The GitHub stacks holding each pull request the scenarios merge, as recorded before any merge. */
export function lookups(): Interaction[] {
  return recording('merge_writes_e2e_lookups').interactions;
}

/** An object in a recorded body, to read or edit. */
export function object(value: Json | undefined): { [key: string]: Json } {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

/** A list in a recorded body, to read or edit. */
export function list(value: Json | undefined): Json[] {
  if (!Array.isArray(value)) throw new Error(`expected a list, got ${JSON.stringify(value)}`);
  return value;
}

export function text(value: Json | undefined): string {
  if (typeof value !== 'string') throw new Error(`expected a string, got ${JSON.stringify(value)}`);
  return value;
}

/** `interaction`, answered with `status` and `body` instead. */
export function answered(interaction: Interaction, status: number, body: Json): Interaction {
  const copy = structuredClone(interaction);
  copy.response.status = status;
  copy.response.body = body;
  delete copy.response.body_text;
  return copy;
}

/**
 * The recording of rozed-bot merging its own pull request: its setup, the merge sent, the answer
 * that it's pending and the answer that it merged.
 */
export class Recorded {
  readonly setup: Setup;
  readonly sent: Interaction;
  readonly pending: Interaction;
  readonly merged: Interaction;

  constructor() {
    const { setup, interactions } = recording('merge_writes_e2e_merged');
    const find = (method: string, status: string): Interaction => {
      const found = interactions.find(
        ({ request, response }) =>
          request.method === method &&
          request.url.includes('/merge-async') &&
          isObject(response.body) &&
          response.body['status'] === status,
      );
      if (!found) throw new Error(`no ${method} answering ${status}`);
      return found;
    };
    this.setup = setup;
    this.sent = find('PUT', 'pending');
    this.pending = find('GET', 'pending');
    this.merged = find('GET', 'merged');
  }

  mergedPr(): Pr {
    const { merged } = this.setup;
    if (!merged) throw new Error('the recording merged nothing');
    return merged;
  }

  pull(): PullRef {
    return pullOf(this.mergedPr());
  }

  /** The merge the recording sent. */
  request(): MergeRequest {
    const title = `Fixture 9b: merge run ${this.setup.run}`;
    return withCommit(made(directMerge(this.mergedPr().head, 'SQUASH')), title, undefined);
  }

  /** The UUID GitHub gave the merge. */
  uuid(): string {
    return text(object(object(this.sent.response.body)['details'])['uuid']);
  }

  put(): string {
    return `PUT /pulls/${this.mergedPr().number}/merge-async`;
  }

  get(): string {
    return `GET /pulls/${this.mergedPr().number}/merge-async/${this.uuid()}`;
  }

  /** The commit the merge made, as GitHub's answer that it merged names it. */
  sha(): string {
    return text(object(object(this.merged.response.body)['details'])['sha']);
  }
}

/**
 * GitHub's answer to `GET /pulls/{number}`, from the recording of rozed-bot's merged pull request,
 * saying whether it's merged.
 */
export function pullAnswer(number: number, merged: boolean): Interaction {
  const { interactions } = recording('merge_writes_e2e_merged');
  const pull = interactions.find(
    ({ request }) => request.method === 'GET' && !request.url.includes('merge-async'),
  );
  if (!pull) throw new Error('the recording reads the pull request');
  pull.request.url = `https://api.github.com/repos/rozed-dev/e2e/pulls/${number}`;
  const body = object(pull.response.body);
  body['number'] = number;
  body['merged'] = merged;
  if (!merged) {
    body['merged_at'] = null;
    body['state'] = 'open';
  }
  return pull;
}
