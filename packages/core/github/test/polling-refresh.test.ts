// A refresh of the open pull request, as the reader asks for one, on a fake clock: its poll goes
// at once, ahead of the interval and the offline backoff, fetches its details, and runs its reads
// again, and the refresh settles once they're in, or once they can't be.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  at,
  log,
  LOGIN,
  Polling,
  pr,
  recorded,
  repoAnswers,
  useFakeClock,
  type Delay,
} from './support/polling.ts';
import { GithubError } from '../src/errors.ts';
import { PUSH_HISTORY_WATCHED } from '../src/push-history.ts';
import type { ReadKind } from '../src/poll/reads.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

/** A made-up read that sends nothing: it counts its runs, and fails while told to. */
const COUNTED: ReadKind<number> = { name: 'Counted', watched: PUSH_HISTORY_WATCHED };

/** Another, watching the same fields. */
const LATER: ReadKind<number> = { name: 'Later', watched: PUSH_HISTORY_WATCHED };

class Runs {
  count = 0;
  failing = false;
  /** How long each run takes, in milliseconds. */
  takes = 0;

  readonly request = async (): Promise<number> => {
    this.count += 1;
    if (this.takes > 0) await new Promise((resolve) => setTimeout(resolve, this.takes));
    if (this.failing) throw new GithubError({ kind: 'decode', message: 'not a count' });
    return this.count;
  };
}

/** Whether `promise` has settled, as the test reads it. */
function settling(promise: Promise<void>): { done: boolean } {
  const state = { done: false };
  void promise.then(() => {
    state.done = true;
  });
  return state;
}

/**
 * #1 open, with a {@link COUNTED} read, polled every 20 s: its first poll, its read and its
 * repository's are in, and the requests so far are cleared.
 */
async function opened(delay?: Delay): Promise<{ t: Polling; runs: Runs }> {
  const r = recorded();
  const interactions = [at(r, 0), at(r, 6), at(r, 1), at(r, 2), at(r, 3), at(r, 8)];
  const t = await Polling.start('refresh', [...interactions, ...repoAnswers(r)], {
    delay,
    config: { openInterval: 20_000 },
  });
  const runs = new Runs();
  void t.poller.setOpen(pr(1));
  void t.poller.readCached(pr(1), COUNTED, runs.request);
  await t.run();
  await t.runUntil(5);
  expect(runs.count).toBe(1);
  t.requests();
  return { t, runs };
}

test('a refresh polls the open pull request at once, with its details and reads, and settles once they’re in', async () => {
  const { t, runs } = await opened();
  const refresh = t.poller.refresh(pr(1));
  // Asked again while it's under way, it waits on the same one.
  expect(t.poller.refresh(pr(1))).toBe(refresh);
  const state = settling(refresh);
  await t.run();
  expect(t.requests()).toEqual(
    log([5, 'GET /pulls/1 (since)'], [5, 'PullRequestCheck'], [5, 'PullRequest']),
  );
  expect(runs.count).toBe(2);
  expect(state.done).toBe(true);
  // It was the open pull request's poll: the next is due 20 s after it.
  await t.runUntil(24);
  expect(t.requests()).toEqual([]);
  await t.runUntil(25);
  expect(t.requests()).toEqual(log([25, 'GET /pulls/1 (since)'], [25, 'PullRequestCheck']));
});

test('a refresh runs the reads of what’s on screen first, in the order it’s given, then the rest by name', async () => {
  const { t } = await opened();
  const order: string[] = [];
  const read = (name: string) =>
    t.poller.readCached(pr(1), { name, watched: PUSH_HISTORY_WATCHED }, () => {
      order.push(name);
      return Promise.resolve(1);
    });
  void read('Alpha');
  void read('Zulu');
  await t.run();
  expect(order).toEqual(['Alpha', 'Zulu']);
  order.length = 0;
  const refresh = t.poller.refresh(pr(1), { first: ['Zulu', 'Counted'] });
  await t.run();
  await refresh;
  expect(order).toEqual(['Zulu', 'Alpha']);
  // The next is in the order of their names again.
  order.length = 0;
  await t.finish(t.poller.refresh(pr(1)));
  expect(order).toEqual(['Alpha', 'Zulu']);
});

test('a refresh reads the repository’s open pull requests too once its reads are in, when asked', async () => {
  const { t, runs } = await opened();
  const state = settling(t.poller.refresh(pr(1), { list: true }));
  await t.run();
  expect(t.requests()).toEqual(
    log(
      [5, 'GET /pulls/1 (since)'],
      [5, 'PullRequestCheck'],
      [5, 'PullRequest'],
      [5, 'GET /pulls?state=open&per_page=100 (etag)'],
    ),
  );
  expect(runs.count).toBe(2);
  expect(state.done).toBe(true);
});

test('a refresh asked for during a poll polls again once that one is done', async () => {
  // Each check takes 2 s, so the first poll ended at 2, and the next is at 22.
  const { t, runs } = await opened((what) => (what === 'PullRequestCheck' ? 2000 : undefined));
  await t.runUntil(23);
  expect(t.requests()).toEqual(log([22, 'GET /pulls/1 (since)'], [22, 'PullRequestCheck']));
  // The poll under way began before the refresh was asked for.
  const state = settling(t.poller.refresh(pr(1)));
  await t.runUntil(25);
  expect(state.done).toBe(false);
  expect(t.requests()).toEqual(log([24, 'GET /pulls/1 (since)'], [24, 'PullRequestCheck']));
  await t.runUntil(27);
  expect(t.requests()).toEqual(log([26, 'PullRequest']));
  expect(runs.count).toBe(2);
  expect(state.done).toBe(true);
});

test('a refresh settles once a read that fails has been tried', async () => {
  const { t, runs } = await opened();
  runs.failing = true;
  const state = settling(t.poller.refresh(pr(1)));
  await t.run();
  expect(runs.count).toBe(2);
  expect(state.done).toBe(true);
});

test('a refresh tries at once while GitHub is out of reach, and settles as that fails', async () => {
  const { t, runs } = await opened();
  t.http.offline = true;
  await t.runUntil(20);
  expect(t.requests()).toEqual(log([20, 'GET /pulls/1 (since)']));
  expect(t.status().offline).toBeDefined();
  // The backoff is still to run.
  await t.runUntil(21);
  expect(t.requests()).toEqual([]);
  const state = settling(t.poller.refresh(pr(1)));
  await t.run();
  expect(t.requests()).toEqual(log([21, 'GET /pulls/1 (since)']));
  // The reads wait out the backoff.
  expect(runs.count).toBe(1);
  expect(state.done).toBe(true);
});

test('a refresh that fails while GitHub is out of reach doesn’t put Lo’s own next try off', async () => {
  const { t } = await opened();
  t.http.offline = true;
  await t.runUntil(20);
  expect(t.requests()).toEqual(log([20, 'GET /pulls/1 (since)']));
  const retryAt = t.status().offline?.retryAt;
  for (const second of [21, 22, 23, 24]) {
    await t.runUntil(second);
    const state = settling(t.poller.refresh(pr(1)));
    await t.run();
    expect(state.done).toBe(true);
  }
  expect(t.requests()).toEqual(
    log(
      [21, 'GET /pulls/1 (since)'],
      [22, 'GET /pulls/1 (since)'],
      [23, 'GET /pulls/1 (since)'],
      [24, 'GET /pulls/1 (since)'],
    ),
  );
  expect(t.status().offline?.retryAt).toBe(retryAt);
  // Lo's own next try is still 20 s after the first failure.
  await t.runUntil(39);
  expect(t.requests()).toEqual([]);
  await t.runUntil(40);
  expect(t.requests()).toEqual(log([40, 'GET /pulls/1 (since)']));
});

test('a refresh asked for while a read loads from the cache runs it once that’s loaded', async () => {
  const { t } = await opened();
  // What the cache holds for it was read at the check the pull request still has.
  const counted = await t.cache.get(LOGIN, pr(1).key, COUNTED.name);
  if (counted?.stamp === undefined) throw new Error('the count was kept without its stamp');
  await t.cache.put(LOGIN, pr(1).key, [{ name: LATER.name, entry: counted }]);
  const loading = Promise.withResolvers<void>();
  const get = t.cache.get.bind(t.cache);
  vi.spyOn(t.cache, 'get').mockImplementation(async (login, target, name) => {
    if (name === LATER.name) await loading.promise;
    return get(login, target, name);
  });
  const later = new Runs();
  void t.poller.readCached(pr(1), LATER, later.request);
  await t.run();
  const state = settling(t.poller.refresh(pr(1)));
  await t.run();
  expect(later.count).toBe(0);
  expect(state.done).toBe(false);
  loading.resolve();
  await t.run();
  expect(later.count).toBe(1);
  expect(state.done).toBe(true);
});

test('a refresh asked for while a read runs that fails tries it again at once', async () => {
  const { t } = await opened();
  const later = new Runs();
  later.failing = true;
  later.takes = 2000;
  void t.poller.readCached(pr(1), LATER, later.request);
  await t.runUntil(6);
  expect(later.count).toBe(1);
  const state = settling(t.poller.refresh(pr(1)));
  // The run under way fails at 7, and the refresh's own fails at 9.
  await t.runUntil(8);
  expect(later.count).toBe(2);
  expect(state.done).toBe(false);
  await t.runUntil(10);
  expect(state.done).toBe(true);
});

test('a refresh of a pull request that isn’t open asks nothing', async () => {
  const { t } = await opened();
  await t.poller.watch(pr(2));
  await t.run();
  expect(t.requests()).toEqual(log([5, 'GET /pulls/2']));
  const state = settling(t.poller.refresh(pr(2)));
  await t.run();
  expect(state.done).toBe(true);
  expect(t.requests()).toEqual([]);
});

test('a refresh under way settles as the poller stops', async () => {
  const { t } = await opened((what) => (what === 'PullRequestCheck' ? 2000 : undefined));
  const state = settling(t.poller.refresh(pr(1)));
  await t.run();
  expect(state.done).toBe(false);
  t.poller.stop();
  await t.run();
  expect(state.done).toBe(true);
});
