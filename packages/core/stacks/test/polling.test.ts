// The poller looking up the merged pull requests a repository's stacks link through, on a fake
// clock, replaying `poll_playground` with the lookups' answers added.

import {
  Accounts,
  Poller,
  PullRef,
  RenewalError,
  Token,
  type Account,
  type Grant,
} from '@lo/github';
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
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';

import { lookUpMerged } from '../src/github.ts';

/** The wall clock when each test starts, in seconds: after every recorded rate-limit window. */
const START = 1_794_100_000;
const LOGIN = 'rozed-bot';
const PULL = new PullRef('rozed-dev', 'playground', 1);

beforeEach(() => {
  vi.useFakeTimers({ now: START * 1000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A GraphQL request's operation, or a REST request's method and path in the playground. */
function describe(request: Request, body: string): string {
  const url = new URL(request.url);
  if (url.pathname === '/graphql') {
    const json: unknown = JSON.parse(body);
    const name: unknown =
      typeof json === 'object' && json !== null ? Reflect.get(json, 'operationName') : undefined;
    return String(name);
  }
  return `${request.method} ${url.pathname.replace(/^\/repos\/rozed-dev\/playground/, '')}`;
}

/**
 * The poller for rozed-bot replaying `interactions`, each request taking `delay` milliseconds,
 * with the requests it sent, each with the second it was sent.
 */
async function polling(name: string, interactions: readonly Interaction[], delay?: number) {
  const replayed = replayFetch(new Replay(name, interactions));
  const start = performance.now();
  const sent: [number, string][] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    sent.push([
      Math.floor((performance.now() - start) / 1000),
      describe(new Request(input, init), body),
    ]);
    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
    return replayed(input, init);
  };
  const accounts = await Accounts.load({
    rows: new MemoryAccountRows<Account>(),
    secrets: new MemorySecrets<Grant>(),
    renew: () => Promise.reject(new RenewalError('refused', 'the token has no refresh token')),
    fetch,
  });
  await accounts.add(
    { user: { login: LOGIN, id: 353226052 }, scopes: ['read:org', 'repo', 'workflow'] },
    { token: new Token('gho_FAKE') },
    'deviceFlow',
  );
  const poller = new Poller({
    accounts,
    login: LOGIN,
    cache: new MemoryPollCache(),
    config: { jitter: 0 },
    lookUpMerged,
  });
  onTestFinished(() => {
    poller.stop();
  });
  return {
    poller,
    /** The requests sent since the last call. */
    requests: () => sent.splice(0),
    /** Runs what's ready at the current second. */
    run: () => vi.advanceTimersByTimeAsync(0),
    /** Moves the clock to `secs` after the start. */
    runUntil: async (secs: number) => {
      const left = secs * 1000 - (performance.now() - start);
      if (left > 0) await vi.advanceTimersByTimeAsync(left);
    },
    /** Waits for `promise`, moving the clock on to the next timer while nothing else can run. */
    finish: async <T>(promise: Promise<T>): Promise<T> => {
      const state = { done: false };
      const watched = promise.finally(() => {
        state.done = true;
      });
      watched.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      for (let steps = 0; !state.done; steps++) {
        if (steps > 10_000 || vi.getTimerCount() === 0) throw new Error('it never finishes');
        await vi.advanceTimersToNextTimerAsync();
      }
      return watched;
    },
  };
}

function recorded(): Interaction[] {
  return cassette('poll_playground').interactions.map(({ interaction }) => interaction);
}

/** The recorded interaction at `index`, copied. */
function at(interactions: readonly Interaction[], index: number): Interaction {
  const interaction = interactions[index];
  if (!interaction) throw new Error(`no interaction ${index}`);
  return structuredClone(interaction);
}

function object(json: Json | undefined, ...path: (string | number)[]): Record<string, Json> {
  let value = json;
  for (const key of path) {
    if (typeof key === 'number') value = Array.isArray(value) ? value[key] : undefined;
    else value = isObject(value) ? value[key] : undefined;
  }
  if (!isObject(value)) throw new Error(`no object at /${path.join('/')}`);
  return value;
}

/** The recorded open pull requests, with PR #1 on `base`. */
function openOn(r: readonly Interaction[], base: string): Interaction {
  const open = at(r, 5);
  const nodes = object(open.response.body, 'data', 'repository', 'pullRequests')['nodes'];
  object(nodes, 1)['baseRefName'] = base;
  return open;
}

/**
 * GitHub's answer to a lookup of the merged pull requests from `branch`, which finds `found`, with
 * `status`, for the recorded open pull requests' request `like`.
 */
function lookedUp(like: Interaction, branch: string, found: Json[], status = 200): Interaction {
  const variables: Record<string, Json> = { owner: 'rozed-dev', name: 'playground', first: 5 };
  const repository: Record<string, Json> = {};
  for (let index = 0; index < 10; index++) {
    variables[`b${index}`] = branch;
    repository[`b${index}`] = { nodes: index === 0 ? found : [] };
  }
  const answer = structuredClone(like);
  answer.request.operation = 'MergedPullRequests';
  answer.request.variables = variables;
  delete answer.request.query_sha256;
  answer.response.status = status;
  answer.response.body = { data: { rateLimit: null, repository } };
  return answer;
}

/** A pull request merged from `head` into `base`. */
function merged(base: string, head: string, number: number): Json {
  return {
    number,
    createdAt: '2026-11-06T07:00:00Z',
    baseRefName: base,
    baseRef: null,
    headRefName: head,
    headRefOid: String(number).padStart(40, '0'),
    isCrossRepository: false,
    commits: { nodes: [] },
    mergeCommit: null,
    stackEntry: null,
  };
}

test('each lookup takes a turn in the queue', async () => {
  // PR #1 targets `b`, which merged into `a`, which merged into `main`: two lookups.
  const r = recorded();
  const interactions = recorded();
  interactions[5] = openOn(r, 'b');
  const like = at(r, 5);
  const comment: Interaction = {
    request: {
      method: 'POST',
      url: 'https://api.github.com/repos/rozed-dev/playground/issues/1/comments',
      body: '{"body":"hi"}',
    },
    response: { status: 201, headers: {}, body: { id: 1 } },
  };
  interactions.push(
    lookedUp(like, 'b', [merged('a', 'b', 902)]),
    lookedUp(like, 'a', [merged('main', 'a', 901)]),
    comment,
  );
  const t = await polling('lookups_yield', interactions, 1000);
  void t.poller.setOpen(PULL);
  await t.run();
  // The open PR's poll takes 0–3 s, the repository's 3–5 s, its rulesets 5–6 s, and the first
  // lookup 6–7 s. A comment sent then goes before the second lookup.
  await t.runUntil(6);
  const write = t.poller.write(PULL, (client) =>
    client.write(
      'POST',
      '/repos/rozed-dev/playground/issues/1/comments',
      JSON.stringify({ body: 'hi' }),
      (json: unknown) => json,
    ),
  );
  await t.run();
  await t.runUntil(12);
  await t.finish(write);
  const requests = t
    .requests()
    .map(([, what]) => what)
    .filter((what) => what === 'MergedPullRequests' || what.startsWith('POST'));
  expect(requests).toEqual(['MergedPullRequests', 'POST /issues/1/comments', 'MergedPullRequests']);
  const list = t.poller.openPullRequests(PULL.repo);
  expect(list?.value.merged.map((pr) => pr.number)).toEqual([902, 901]);
});

test('lookups that stop short run again while the list stays the same', async () => {
  // PR #1 targets `gone`, and GitHub fails to look it up at first.
  const r = recorded();
  const interactions = recorded();
  interactions[5] = openOn(r, 'gone');
  const like = at(r, 5);
  interactions.push(lookedUp(like, 'gone', [], 502), lookedUp(like, 'gone', []));
  const t = await polling('lookups_retried', interactions);
  void t.poller.setOpen(PULL);
  await t.run();
  expect(t.poller.openPullRequests(PULL.repo)?.value.mergedTruncated).toBe(true);
  const lookups = () =>
    t
      .requests()
      .filter(([, what]) => what === 'MergedPullRequests')
      .map(([secs]) => secs);
  expect(lookups()).toEqual([0]);
  // The PRs don't change, but the lookups run again at the repository's next poll.
  await t.runUntil(130);
  expect(lookups()).toEqual([120]);
  const list = t.poller.openPullRequests(PULL.repo)?.value;
  expect(list?.mergedTruncated).toBe(false);
  expect(list?.lookups[0]?.branch).toBe('gone');
  await t.runUntil(400);
  expect(lookups()).toEqual([]);
});
