/**
 * The device flow on synthetic cassettes, one per way it can end. The poll timers run on Vitest's
 * fake clock, so the tests also check when each poll was sent.
 */

import { replayFetch, type SeenRequest } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  checkToken,
  DeviceFlowError,
  requestCodes,
  waitForToken,
  type DeviceFlowFailure,
} from '../src/device-flow.ts';
import type { AuthenticatedUser } from '../src/user.ts';

const POLL_PATH = '/login/oauth/access_token';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A request as it was sent, with when on the fake clock. */
interface Sent {
  path: string;
  at: number;
}

/**
 * A `fetch` replaying `cassette` that notes when each request was sent. The polls numbered in
 * `unreachable` (from 1) fail as if the network were down, without reaching the cassette.
 */
function timed(cassette: string, unreachable: readonly number[]) {
  const replay = replayFetch(cassette);
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    sent.push({ path, at: Date.now() });
    const polls = sent.filter((request) => request.path === POLL_PATH).length;
    if (path === POLL_PATH && unreachable.includes(polls)) {
      throw new TypeError('fetch failed', { cause: new Error('the network is down') });
    }
    return replay(input, init);
  };
  return { fetch, sent, seen: replay.seen };
}

interface Run {
  user?: AuthenticatedUser | undefined;
  error?: unknown;
  userCode: string | undefined;
  /** Seconds after the codes were issued that each poll was sent. */
  pollTimes: number[];
  /** What reached the cassette, in order. */
  seen: readonly SeenRequest[];
}

/** Runs the fake clock until `promise` settles. */
async function settle(promise: Promise<unknown>): Promise<void> {
  const state = { done: false };
  const finish = () => {
    state.done = true;
  };
  void promise.then(finish, finish);
  while (!state.done) await vi.advanceTimersToNextTimerAsync();
}

async function signIn(cassette: string, unreachable: readonly number[] = []): Promise<Run> {
  const { fetch, sent, seen } = timed(cassette, unreachable);
  const run: Run = { userCode: undefined, pollTimes: [], seen };
  const flow = (async () => {
    const codes = await requestCodes({ fetch });
    run.userCode = codes.userCode;
    const grant = await waitForToken({ fetch }, codes);
    return checkToken({ fetch }, grant.token);
  })().then(
    (user) => {
      run.user = user;
    },
    (error: unknown) => {
      run.error = error;
    },
  );
  await settle(flow);
  const start = sent[0]?.at ?? 0;
  run.pollTimes = sent
    .filter((request) => request.path === POLL_PATH)
    .map((request) => Math.floor((request.at - start) / 1000));
  return run;
}

/** Why the sign-in ended without an account. */
function failure(run: Run): DeviceFlowFailure {
  if (!(run.error instanceof DeviceFlowError)) {
    throw new Error(`the sign-in didn't fail as a sign-in: ${String(run.error)}`);
  }
  return run.error.detail;
}

const header = (request: SeenRequest | undefined, name: string) => request?.headers.get(name);

test('signs in once the code is entered', async () => {
  const run = await signIn('device_flow_success');
  expect(run.error).toBeUndefined();
  expect(run.user?.user.login).toBe('rozed-bot');
  expect(run.user?.scopes).toEqual(['read:org', 'repo', 'workflow']);
  expect(run.userCode).toBe('FAKE-1234');
  // Every 5 s × 1.2.
  expect(run.pollTimes).toEqual([6, 12, 18]);

  const { seen } = run;
  const codes = seen[0];
  expect(codes?.url).toBe('https://github.com/login/device/code');
  expect(header(codes, 'accept')).toBe('application/json');
  expect(new TextDecoder().decode(codes?.body)).toBe(
    'client_id=Ov23liBORqwRdiPzqsPP&scope=repo+read%3Aorg+workflow',
  );
  // The token goes only to the API, after the flow.
  const userRequest = seen.at(-1);
  expect(userRequest?.url).toBe('https://api.github.com/user');
  expect(header(userRequest, 'authorization')).toBe('token gho_FAKE_SIGNED_IN');
  expect(seen.slice(0, -1).map((request) => header(request, 'authorization'))).toEqual(
    seen.slice(0, -1).map(() => null),
  );
});

test('slow down adopts githubs interval', async () => {
  const run = await signIn('device_flow_slow_down');
  expect(run.error).toBeUndefined();
  // 6 s; slow_down to 10 s, so 12 s later; slow_down without an interval adds 5 s, so 18 s
  // later; then 18 s again.
  expect(run.pollTimes).toEqual([6, 18, 36, 54]);
});

test('an expired code ends the flow', async () => {
  const run = await signIn('device_flow_expired');
  expect(failure(run)).toEqual({ kind: 'expired' });
  expect(run.pollTimes).toEqual([6, 12]);
});

test('polling stops at the deadline', async () => {
  const run = await signIn('device_flow_deadline');
  expect(failure(run)).toEqual({ kind: 'expired' });
  // The code lasts 20 s: a fourth poll at 24 s would be too late, so it isn't sent.
  expect(run.pollTimes).toEqual([6, 12, 18]);
});

test('a code entered in its last seconds still signs in', async () => {
  const run = await signIn('device_flow_last_poll');
  expect(run.error).toBeUndefined();
  // The code lasts 24 s. A fourth poll at 24 s would be too late, so it goes a second before the
  // end instead, still at least an interval after the third.
  expect(run.pollTimes).toEqual([6, 12, 18, 23]);
});

test('polling goes on through server and network errors', async () => {
  // The first poll gets GitHub's 502 page and the second no answer at all; each failure in a row
  // doubles the wait, and an answer resets it.
  const run = await signIn('device_flow_transient', [2]);
  expect(run.error).toBeUndefined();
  expect(run.user?.user.login).toBe('rozed-bot');
  expect(run.pollTimes).toEqual([6, 18, 42, 48]);
});

test('cancelling on github ends the flow', async () => {
  const run = await signIn('device_flow_denied');
  expect(failure(run)).toEqual({ kind: 'denied' });
});

test('a refused poll shows githubs message', async () => {
  const run = await signIn('device_flow_refused');
  expect(failure(run)).toEqual({
    kind: 'refused',
    message: 'The client_id and/or client_secret passed are incorrect.',
  });
});

test('an unknown client id is refused', async () => {
  const run = await signIn('device_flow_unknown_client');
  const why = failure(run);
  expect(why.kind).toBe('refused');
  expect(why.kind === 'refused' ? why.message : '').toContain('404');
  expect(run.userCode).toBeUndefined();
});

test('a token without every scope is rejected', async () => {
  const run = await signIn('device_flow_missing_scope');
  expect(failure(run)).toEqual({ kind: 'missingScopes', scopes: ['workflow'] });
});

test('dropping the wait cancels it', async () => {
  const fetch = replayFetch('device_flow_deadline');
  const codes = await requestCodes({ fetch });
  const controller = new AbortController();
  const stopped = waitForToken({ fetch, signal: controller.signal }, codes).then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(7000);
  controller.abort();
  const polls = fetch.seen.length;
  // The codes, and the poll at 6 s.
  expect(polls).toBe(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch.seen.length).toBe(polls);
  expect(await stopped).toBe(controller.signal.reason);
});
