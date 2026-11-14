// The poller on a fake clock when GitHub's rate limit runs low or is used up, when the network is
// down, and when the account's token is refused or can't be read.

import { cassette, type Interaction } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  answer,
  at,
  decodedDetails,
  detailsTitled,
  forPull,
  log,
  LOGIN,
  outcome,
  Polling,
  postComment,
  pr,
  QUIET,
  rateLimit,
  recorded,
  START,
  useFakeClock,
  user,
  wall,
  withHeaders,
  type Logged,
  type Network,
} from './support/polling.ts';
import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { Token } from '../src/token.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

/** The recorded poll, with `low` as GitHub's answer to PR #1's second conditional GET. */
function withSecondAnswer(low: Interaction): Interaction[] {
  const interactions = recorded();
  interactions.splice(6, 0, low);
  return interactions;
}

test('a low rate limit doubles every interval', async () => {
  const low = withHeaders(at(recorded(), 6), rateLimit('core', 900, 3600));
  const t = await Polling.start('slowed', withSecondAnswer(low));
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'slowed',
    low: { resource: 'core', remaining: 900, limit: 5000, reset: wall(3600) },
  });
  t.requests();
  await t.runUntil(240);
  expect(t.requests()).toEqual(
    log(
      [60, 'GET /pulls/1 (since)'],
      [60, 'PullRequestCheck'],
      [100, 'GET /pulls/1 (since)'],
      [100, 'PullRequestCheck'],
      [140, 'GET /pulls/1 (since)'],
      [140, 'PullRequestCheck'],
      [180, 'GET /pulls/1 (since)'],
      [180, 'PullRequestCheck'],
      [220, 'GET /pulls/1 (since)'],
      [220, 'PullRequestCheck'],
      [240, 'GET /pulls/2 (since)'],
      [240, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
});

test('a very low rate limit polls only the open pr', async () => {
  const low = withHeaders(at(recorded(), 6), rateLimit('core', 100, 3600));
  const t = await Polling.start('open_only', withSecondAnswer(low));
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toMatchObject({ kind: 'openOnly', low: { remaining: 100 } });
  t.requests();
  await t.runUntil(600);
  const expected: Logged[] = [];
  for (const secs of [140, 260, 380, 500]) {
    expected.push([secs, 'GET /pulls/1 (since)'], [secs, 'PullRequestCheck']);
  }
  expect(t.requests()).toEqual(expected);
});

test('a very low rate limit says repositories arent listed', async () => {
  const low = withHeaders(at(recorded(), 6), rateLimit('core', 100, 3600));
  const t = await Polling.start('open_only_lists', withSecondAnswer(low));
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  const every = 2 * 60_000;
  expect(t.poller.listSchedule()).toEqual({ every, listing: true });
  await t.runUntil(20);
  expect(t.status().rateLimit.kind).toBe('openOnly');
  // Lo lists them again at the reset, as often as before.
  expect(t.poller.listSchedule()).toEqual({ every, listing: false });
});

test('a used up rate limit pauses polling until the reset', async () => {
  const r = recorded();
  const usedUp = withHeaders(at(r, 6), rateLimit('core', 0, 600));
  const nextWindow = withHeaders(at(r, 6), rateLimit('core', 4999, 4200));
  const interactions = recorded();
  interactions.splice(6, 0, usedUp, nextWindow);
  const t = await Polling.start('paused', interactions);
  void t.poller.watch(pr(2));
  await t.run();
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(600),
    reason: { kind: 'usedUp', resource: 'core' },
  });
  t.requests();
  await t.runUntil(599);
  expect(t.requests()).toEqual([]);
  // At the reset, everything that's due is polled.
  await t.runUntil(620);
  expect(t.requests()).toEqual(
    log(
      [600, 'GET /pulls/1 (since)'],
      [600, 'PullRequestCheck'],
      // Its details are older than 5 minutes.
      [600, 'PullRequest'],
      [600, 'GET /pulls/2 (since)'],
      [600, 'GET /pulls?state=open&per_page=100 (etag)'],
      [620, 'GET /pulls/1 (since)'],
      [620, 'PullRequestCheck'],
    ),
  );
  expect(t.status().rateLimit).toEqual({ kind: 'normal' });
});

/** `x-ratelimit-*` headers whose reset is too far off to be a time, as from a proxy. */
const NONSENSE_RESET: [string, string][] = [
  ['x-ratelimit-limit', '5000'],
  ['x-ratelimit-remaining', '0'],
  ['x-ratelimit-used', '5000'],
  ['x-ratelimit-reset', '18446744073709551615'],
  ['x-ratelimit-resource', 'core'],
];

/**
 * A successful answer whose reset is too far off to be a time neither crashes Lo nor pauses it: it
 * isn't a reset Lo waits for.
 */
test('a nonsense reset on an answer doesnt pause polling', async () => {
  const r = recorded();
  const interactions = recorded();
  interactions.splice(6, 0, withHeaders(at(r, 6), NONSENSE_RESET));
  const t = await Polling.start('nonsense_reset_answer', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({ kind: 'normal' });
});

/**
 * A request GitHub refuses as rate limited, with a reset too far off to be a time, pauses polling
 * for an hour at most, without crashing Lo.
 */
test('a nonsense reset on a refusal pauses polling an hour at most', async () => {
  const r = recorded();
  const message = '{"message":"API rate limit exceeded for user ID 1."}';
  const interactions = recorded();
  interactions.splice(6, 0, answer(at(r, 6), 403, NONSENSE_RESET, message));
  const t = await Polling.start('nonsense_reset_refused', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  const state = t.status().rateLimit;
  if (state.kind !== 'paused') throw new Error(`not paused: ${JSON.stringify(state)}`);
  expect(state.until).toBeGreaterThan(wall(0));
  expect(state.until).toBeLessThanOrEqual(wall(20 + 3600));
  // The pause ends within the hour.
  t.requests();
  await t.runUntil(3700);
  expect(t.requests()).not.toEqual([]);
});

test('a pause ends on time after the mac sleeps', async () => {
  const r = recorded();
  const interactions = recorded();
  interactions.splice(6, 0, withHeaders(at(r, 6), rateLimit('core', 0, 600)));
  const t = await Polling.start('sleep', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(30);
  expect(t.status().rateLimit.kind).toBe('paused');
  t.requests();
  // Asleep from 30 s for 1,000 s, well past the reset.
  t.sleep(1000);
  await t.runUntil(100);
  const requests = t.requests();
  expect(requests, 'still paused').not.toEqual([]);
  expect(requests[0]?.[0]).toBeLessThanOrEqual(80);
  expect(t.status().rateLimit).toEqual({ kind: 'normal' });
});

test('an open only limit with nothing open wakes at the reset', async () => {
  const low = withHeaders(at(recorded(), 6), rateLimit('core', 100, 3600));
  const t = await Polling.start('open_only_reset', withSecondAnswer(low));
  void t.poller.watch(pr(2));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  void t.poller.setOpen(undefined);
  await t.run();
  t.requests();
  await t.runUntil(3599);
  expect(t.requests()).toEqual([]);
  expect(t.status().rateLimit.kind).toBe('openOnly');
  // The window resets at 3,600 s: everything is polled, and the banner goes.
  await t.runUntil(3600);
  expect(t.requests()).toEqual(
    log(
      [3600, 'GET /pulls/2 (since)'],
      [3600, 'GET /pulls?state=open&per_page=100 (etag)'],
      // Half an hour since the rulesets were read.
      [3600, 'TrunkRules'],
      [3600, 'GET /pulls/1 (since)'],
    ),
  );
  expect(t.status().rateLimit).toEqual({ kind: 'normal' });
});

test('a secondary limit waits as long as github asks then backs off', async () => {
  const r = recorded();
  const message =
    '{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.","documentation_url":"https://docs.github.com/rest"}';
  const interactions = recorded();
  interactions.splice(
    6,
    0,
    answer(at(r, 6), 403, [['retry-after', '90']], message),
    answer(at(r, 6), 429, [], message),
    answer(at(r, 6), 429, [], message),
  );
  const t = await Polling.start('secondary', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(110),
    reason: { kind: 'secondary' },
  });
  t.requests();
  await t.runUntil(500);
  const pullOne = t.requests().filter(([, what]) => !what.includes('/pulls?'));
  expect(pullOne).toEqual(
    log(
      // retry-after: 90.
      [110, 'GET /pulls/1 (since)'],
      // No retry-after: a minute, doubling with each secondary limit in a row, the one with a
      // retry-after included. This is the second, so 2 minutes, then 4.
      [230, 'GET /pulls/1 (since)'],
      [470, 'GET /pulls/1 (since)'],
      [470, 'PullRequestCheck'],
      // Its details are older than 5 minutes.
      [470, 'PullRequest'],
      [490, 'GET /pulls/1 (since)'],
      [490, 'PullRequestCheck'],
    ),
  );
});

test('a secondary limits wait is timed from the refusal whatever the wall clock says', async () => {
  const r = recorded();
  const message = '{"message":"You have exceeded a secondary rate limit."}';
  const interactions = recorded();
  interactions.splice(6, 0, answer(at(r, 6), 403, [['retry-after', '90']], message));
  const t = await Polling.start('secondary_clock_set', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(110),
    reason: { kind: 'secondary' },
  });
  t.requests();
  const left = () => (t.poller.writesHeldUntil() ?? 0) - Date.now();
  // At 30 s the wall clock is set forward an hour: the pause still has 80 s to go.
  await t.runUntil(30);
  t.sleep(3600);
  expect(left()).toBe(80_000);
  // At 50 s it's set back two hours: 60 s to go, no more.
  await t.runUntil(50);
  t.sleep(-7200);
  expect(left()).toBe(60_000);
  await t.runUntil(109);
  expect(t.requests()).toEqual([]);
  await t.runUntil(110);
  expect(t.requests()[0]).toEqual([110, 'GET /pulls/1 (since)']);
});

test('a used up limit with no reset to come waits a minute whatever the wall clock says', async () => {
  const r = recorded();
  const message = '{"message":"API rate limit exceeded for user ID 1."}';
  const interactions = recorded();
  // Refused for a used up limit whose reset, 10 s before the start, has already passed.
  interactions.splice(6, 0, answer(at(r, 6), 403, rateLimit('core', 0, -10), message));
  const t = await Polling.start('used_up_reset_passed', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(80),
    reason: { kind: 'usedUp', resource: 'core' },
  });
  t.requests();
  const left = () => (t.poller.writesHeldUntil() ?? 0) - Date.now();
  // At 30 s the wall clock is set forward an hour: the minute still has 50 s to go, and a comment
  // asked for then isn't sent.
  await t.runUntil(30);
  t.sleep(3600);
  expect(left()).toBe(50_000);
  expect(await t.poller.addConversationComment(pr(1), 'PR_1', 'hi')).toMatchObject({
    refusal: 'paused',
  });
  await t.runUntil(79);
  expect(t.requests()).toEqual([]);
  await t.runUntil(80);
  expect(t.requests()[0]).toEqual([80, 'GET /pulls/1 (since)']);
});

/**
 * The recorded poll with the open PR's second check answered by a GraphQL rate-limit error, with
 * `remaining` of GraphQL's limit left in a window that resets at 600 s.
 */
function withGraphqlRateLimit(remaining: number): Interaction[] {
  const r = recorded();
  const limited = answer(
    at(r, 7),
    200,
    [],
    '{"data":null,"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded for user ID 1."}]}',
  );
  const interactions = recorded();
  interactions.splice(7, 0, withHeaders(limited, rateLimit('graphql', remaining, 600)));
  return interactions;
}

test('a used up graphql limit is named', async () => {
  const t = await Polling.start('graphql_used_up', withGraphqlRateLimit(0));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(600),
    reason: { kind: 'usedUp', resource: 'graphql' },
  });
});

test('a graphql rate limit with some left is a secondary limit', async () => {
  const t = await Polling.start('graphql_secondary', withGraphqlRateLimit(4000));
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  // A minute, not until the window resets, and not "core used up".
  expect(t.status().rateLimit).toEqual({
    kind: 'paused',
    until: wall(80),
    reason: { kind: 'secondary' },
  });
});

/** What a request fails with while the network is down. */
const NETWORK_DOWN = "couldn't reach GitHub: fetch failed: the network is down";

test('offline it backs off and answers from the cache with its age', async () => {
  const r = recorded();
  const t = await Polling.start('offline', recorded());
  const threeHoursAgo = (START - 3 * 3600) * 1000;
  await t.cache.put(LOGIN, pr(1).key, [
    { name: 'PullRequest', entry: { value: await decodedDetails(r), fetchedAt: threeHoursAgo } },
  ]);
  t.http.offline = true;

  // Opening shows the cached copy at once.
  const opened = t.poller.setOpen(pr(1));
  await t.run();
  const answered = await opened;
  expect(answered?.details.title).toBe('feat: stack layer A');
  expect(answered?.fetchedAt).toBe(threeHoursAgo);

  // The refresh fails: the copy is now known to be offline, 3 hours old.
  expect(t.status().offline).toEqual({
    since: wall(0),
    retryAt: wall(20),
    error: NETWORK_DOWN,
  });
  expect(t.poller.pullRequest(pr(1))?.offlineAge).toBe(3 * 3600 * 1000);
  await t.runUntil(10);
  expect(t.poller.pullRequest(pr(1))?.offlineAge).toBe((3 * 3600 + 10) * 1000);

  // Retries back off from 20 s, doubling up to 5 minutes.
  await t.runUntil(900);
  expect(t.requests()).toEqual(
    log(
      [0, 'GET /pulls/1'],
      [20, 'GET /pulls/1'],
      [60, 'GET /pulls/1'],
      [140, 'GET /pulls/1'],
      [300, 'GET /pulls/1'],
      [600, 'GET /pulls/1'],
      [900, 'GET /pulls/1'],
    ),
  );
  expect(t.status().offline?.retryAt).toBe(wall(1200));

  // Back online, the next retry succeeds and everything is current again.
  t.http.offline = false;
  await t.runUntil(1200);
  expect(t.requests()).toEqual(
    log(
      [1200, 'GET /pulls/1'],
      [1200, 'PullRequestCheck'],
      [1200, 'PullRequest'],
      [1200, 'GET /pulls?state=open&per_page=100'],
      [1200, 'OpenPullRequests'],
      [1200, 'TrunkRules'],
    ),
  );
  expect(t.status()).toEqual(QUIET);
  const current = t.poller.pullRequest(pr(1));
  expect([current?.fetchedAt, current?.offlineAge]).toEqual([wall(1200), undefined]);
});

test('offline says when the next try really is', async () => {
  const t = await Polling.start('offline_retry_at', recorded());
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(10);
  t.http.offline = true;
  await t.runUntil(20);
  expect(t.status().offline?.retryAt).toBe(wall(40));
  // In the background the open PR is next polled 5 minutes after it last answered.
  t.poller.setForeground(false);
  await t.run();
  expect(t.status().offline?.retryAt).toBe(wall(300));
});

test('any answer from github ends offline', async () => {
  const r = recorded();
  const message =
    '{"message":"You have exceeded a secondary rate limit.","documentation_url":"https://docs.github.com/rest"}';
  const interactions = recorded();
  interactions.splice(0, 0, answer(at(r, 0), 403, [['retry-after', '90']], message));
  const t = await Polling.start('offline_ends', interactions);
  t.http.offline = true;
  void t.poller.setOpen(pr(1));
  await t.run();
  expect(t.status().offline).toBeDefined();
  // Back online, GitHub answers, if only to say to wait.
  t.http.offline = false;
  await t.runUntil(20);
  const status = t.status();
  expect(status.offline).toBeUndefined();
  expect(status.rateLimit.kind).toBe('paused');
});

test('opening a pr while offline tries at once', async () => {
  const r = recorded();
  const interactions = [
    ...recorded(),
    forPull(at(r, 1), 2),
    forPull(detailsTitled(r, 'layer B'), 2),
  ];
  const t = await Polling.start('offline_open', interactions);
  t.http.offline = true;
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(70);
  expect(t.status().offline?.retryAt).toBe(wall(140));
  t.requests();
  // The network is back, and the user opens another PR: it's tried now, not at 140 s, and then
  // everything else that's due.
  t.http.offline = false;
  void t.poller.setOpen(pr(2));
  await t.run();
  expect(t.requests()).toEqual(
    log(
      [70, 'GET /pulls/2'],
      [70, 'PullRequestCheck'],
      [70, 'PullRequest'],
      [70, 'GET /pulls/1'],
      [70, 'GET /pulls?state=open&per_page=100'],
      [70, 'OpenPullRequests'],
      [70, 'TrunkRules'],
    ),
  );
  expect(t.status().offline).toBeUndefined();
});

/**
 * A read someone on screen waits on goes ahead of what's due, but never of a poll that's tried at
 * once, as coming back to the foreground forces one, whatever the backoff: it waits for that poll.
 */
test('coming back to the foreground while offline tries at once, a read waited on or not', async () => {
  const t = await Polling.start('offline_waited', recorded());
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(10);
  t.http.offline = true;
  await t.runUntil(20);
  expect(t.status().offline?.retryAt).toBe(wall(40));
  t.poller.setForeground(false);
  let runs = 0;
  const waited = { name: 'Waited', watched: ['/headRefOid'] };
  void t.poller.readCached(
    pr(1),
    waited,
    () => {
      runs += 1;
      return Promise.resolve(1);
    },
    'foreground',
  );
  await t.runUntil(25);
  t.requests();
  // The network is back, and Lo comes to the foreground: the open PR is polled now, not at 40 s,
  // and the read goes once it has.
  t.http.offline = false;
  t.poller.setForeground(true);
  await t.run();
  expect(t.requests()[0]).toEqual([25, 'GET /pulls/1 (since)']);
  expect(t.status().offline).toBeUndefined();
  expect(runs).toBe(1);
});

const BAD_CREDENTIALS =
  '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}';

test('a refused token signs the account out until it signs in again', async () => {
  const r = recorded();
  const interactions = recorded();
  interactions.splice(6, 0, answer(at(r, 6), 401, [], BAD_CREDENTIALS));
  const t = await Polling.start('signed_out', interactions);
  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(20);
  expect(t.status().signedOut).toBe(true);
  expect(t.accounts.isSignedOut(LOGIN)).toBe(true);
  t.requests();
  await t.runUntil(300);
  expect(t.requests()).toEqual([]);

  // Signing in again resumes polling at once.
  const added = t.accounts.add(user(), { token: new Token('gho_NEW') }, 'deviceFlow');
  await t.run();
  await t.finish(added);
  await t.run();
  expect(t.status().signedOut).toBe(false);
  expect(t.requests()).toEqual(
    log(
      [300, 'GET /pulls/1 (since)'],
      [300, 'PullRequestCheck'],
      // Its details are older than 5 minutes.
      [300, 'PullRequest'],
      [300, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
  expect(t.http.seen.at(-1)?.headers.get('authorization')).toBe('token gho_NEW');
});

test('a token that cant be read is tried again', async () => {
  const t = await Polling.start('token_unreadable', recorded());
  // The Keychain is locked when Lo starts, or its prompt was dismissed.
  t.secrets.failingReads = true;
  await t.restartLo();
  void t.poller.setOpen(pr(1));
  await t.run();
  const status = t.status();
  expect(status.signedOut).toBe(false);
  expect(status.offline?.retryAt).toBe(wall(20));
  expect(status.offline?.error).toContain('token');
  // A write says so, rather than that GitHub refused the token.
  const write = outcome(postComment(t.poller));
  await t.run();
  const written = await t.finish(write);
  expect(written.ok).toBe(false);
  const error = written.ok ? undefined : written.error;
  expect(error instanceof GithubError && error.isUnauthorized()).toBe(false);

  // Once it can be read, polling goes on.
  t.secrets.failingReads = false;
  await t.runUntil(20);
  expect(t.requests()).toEqual(
    log(
      [20, 'GET /pulls/1'],
      [20, 'PullRequestCheck'],
      [20, 'PullRequest'],
      [20, 'GET /pulls?state=open&per_page=100'],
      [20, 'OpenPullRequests'],
      [20, 'TrunkRules'],
    ),
  );
  expect(t.status()).toEqual(QUIET);
});

/**
 * Reads an account's token from a `gh` that has a newer one for rozed-bot, and checks with GitHub
 * that it's that account's, as Lo does when it imports an account from `gh`.
 */
async function rereadFromGh(network: Network, login: string): Promise<Token | undefined> {
  if (login !== LOGIN) return undefined;
  const token = new Token('gho_FAKE_FROM_GH');
  const { user: found } = await new GithubClient({ fetch: network.fetch, token }).user();
  if (found.login.toLowerCase() !== login.toLowerCase()) {
    throw new Error(`gh's token for ${login} belongs to ${found.login}`);
  }
  return token;
}

test('a refused gh token is read from gh again and polling goes on', async () => {
  const r = recorded();
  const interactions = recorded();
  interactions.splice(6, 0, answer(at(r, 6), 401, [], BAD_CREDENTIALS));
  // GitHub says the token gh hands over is rozed-bot's.
  interactions.push(...cassette('user').interactions.map(({ interaction }) => interaction));
  const t = await Polling.start('gh_reread', interactions, {
    source: 'gh',
    reread: rereadFromGh,
  });

  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(5);
  t.requests();
  await t.runUntil(40);
  expect(t.requests()).toEqual(
    log(
      // Refused, read from gh again and checked, then sent again with gh's token.
      [20, 'GET /pulls/1 (since)'],
      [20, 'GET /user'],
      [20, 'GET /pulls/1 (since)'],
      [20, 'PullRequestCheck'],
      [40, 'GET /pulls/1 (since)'],
      [40, 'PullRequestCheck'],
    ),
  );
  expect(t.status().signedOut).toBe(false);
  expect(t.http.seen.at(-1)?.headers.get('authorization')).toBe('token gho_FAKE_FROM_GH');
});
