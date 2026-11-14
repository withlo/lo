import {
  type Cached,
  PENDING_REVIEW,
  type PendingReviewRead,
  type PollEvent,
  type PollStatus,
  PullRef,
  type ReadKind,
  type ReadPriorityNow,
  REVIEW_THREADS,
  type ReviewThread,
  type ReviewThreadList,
} from '@lo/github';
import { expect, test } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { Compared, ReviewView, ThreadsView } from '../contract.ts';
import { reviewRow, ThreadReads, type ThreadsPoller, threadRows } from './threads.ts';

const HEAD = 'a'.repeat(40);
const PULL = new PullRef('rozed-dev', 'e2e', 94);

/** A thread on `path`'s line 5 as GitHub gives it, with one comment by rozed-bot. */
function node(id: string, path = 'src/backoff.ts'): ReviewThread {
  return {
    id,
    path,
    subjectType: 'LINE',
    diffSide: 'RIGHT',
    startDiffSide: null,
    line: 5,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    isOutdated: false,
    isResolved: false,
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    comments: {
      totalCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: `${id}-c`,
          author: { __typename: 'User', login: 'rozed-bot' },
          body: 'Fixture C: a comment.',
          state: 'SUBMITTED',
          createdAt: '2026-11-13T12:00:00Z',
          url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
          isMinimized: false,
          minimizedReason: null,
          viewerCanUpdate: true,
          viewerCanDelete: true,
          commit: { oid: HEAD },
          originalCommit: { oid: HEAD },
        },
      ],
    },
  };
}

function list(...ids: string[]): ReviewThreadList {
  return { nodes: ids.map((id) => node(id)), missing: 0 };
}

/** #94's view `t1`, on screen at `HEAD` as rozed-bot. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 94,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: false,
    run: undefined,
    ...overrides,
  };
}

/** A poller holding `threads` and `review`, with events the test sends, and what it was asked. */
function fakePoller(threads: ReviewThreadList | Error, review: PendingReviewRead) {
  const listeners = new Set<(event: PollEvent) => void>();
  const watchers = new Set<() => void>();
  const asked: string[] = [];
  const held: {
    threads: ReviewThreadList | Error;
    review: PendingReviewRead;
    /** Who the threads' first read said waits on it. */
    first?: ReadPriorityNow | undefined;
  } = { threads, review };
  let status: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
  function cachedRead(
    pull: PullRef,
    kind: ReadKind<ReviewThreadList>,
  ): Cached<ReviewThreadList> | undefined;
  function cachedRead(
    pull: PullRef,
    kind: ReadKind<PendingReviewRead>,
  ): Cached<PendingReviewRead> | undefined;
  function cachedRead(_: PullRef, kind: { name: string }) {
    const value = kind.name === REVIEW_THREADS.name ? held.threads : held.review;
    return value instanceof Error ? undefined : { value, fetchedAt: 0 };
  }
  const poller: ThreadsPoller = {
    reviewThreads(pull, first) {
      asked.push(`threads ${pull.key}`);
      held.first = first;
      return held.threads instanceof Error
        ? Promise.reject(held.threads)
        : Promise.resolve({ value: held.threads, fetchedAt: 0 });
    },
    pendingReview(pull) {
      asked.push(`review ${pull.key}`);
      return Promise.resolve({ value: held.review, fetchedAt: 0 });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onChange(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    status: () => status,
    cachedRead,
  };
  const send = (event: PollEvent) => {
    for (const listener of listeners) listener(event);
  };
  /** The poller's status changes to `next`. */
  const change = (next: Partial<PollStatus>) => {
    status = { ...status, ...next };
    for (const watcher of watchers) watcher();
  };
  return { poller, asked, held, send, change, listeners, watchers };
}

/** Reads as `options` say, with what they publish and log. */
function reads(
  poller: ThreadsPoller,
  options: {
    view?: () => PullTabInfo | undefined;
    onScreen?: () => string | undefined;
    compared?: () => Compared | null;
  } = {},
) {
  const threads: ThreadsView[] = [];
  const reviews: ReviewView[] = [];
  const logged: string[] = [];
  const reading = new ThreadReads({
    poller: () => Promise.resolve(poller),
    view: options.view ?? (() => info()),
    onScreen: options.onScreen ?? (() => 't1'),
    compared: options.compared ?? (() => null),
    publishThreads: (view) => threads.push(view),
    publishReview: (view) => reviews.push(view),
    log: (line) => logged.push(line),
  });
  return { reading, threads, reviews, logged };
}

/** Lets the reads' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test('reads a view’s threads and pending review once it’s on screen, and sends them', async () => {
  const github = fakePoller(list('T1'), { kind: 'read', review: undefined });
  let shown: string | undefined;
  const { reading, threads, reviews } = reads(github.poller, { onScreen: () => shown });
  reading.follow('t1');
  await settled();
  expect(github.asked).toEqual([]);
  expect(threads.at(-1)).toMatchObject({ id: 't1', status: 'loading', threads: [] });
  expect(reviews.at(-1)).toEqual({ id: 't1', review: { kind: 'loading' } });

  shown = 't1';
  reading.follow('t1');
  reading.follow('t1');
  await settled();
  expect(github.asked).toEqual([`threads ${PULL.key}`, `review ${PULL.key}`]);
  expect(threads.at(-1)).toMatchObject({ status: 'ready', missing: 0, problem: null });
  expect(threads.at(-1)?.threads.map((thread) => thread.id)).toEqual(['T1']);
  expect(reviews.at(-1)).toEqual({ id: 't1', review: { kind: 'none' } });
  expect(reading.current('t1')).toEqual({ threads: threads.at(-1), review: reviews.at(-1) });
  expect(reading.current('t2')).toEqual({ threads: undefined, review: undefined });
  // The first read goes ahead of the account's other reads while the view is on screen, as the
  // diff's first draw waits on it.
  const { first } = github.held;
  const now = () => (typeof first === 'function' ? first() : first);
  expect(now()).toBe('foreground');
  shown = 't2';
  expect(now()).toBe('background');
});

test('follows the poller’s reads of the pull request, and says when the first fails', async () => {
  const github = fakePoller(list('T1'), { kind: 'read', review: undefined });
  const { reading, threads } = reads(github.poller);
  reading.follow('t1');
  await settled();
  const sent = threads.length;
  github.held.threads = list('T1', 'T2');
  github.send({
    kind: 'read',
    name: PENDING_REVIEW.name,
    pull: new PullRef('rozed-dev', 'e2e', 1),
  });
  github.send({
    kind: 'read',
    name: REVIEW_THREADS.name,
    pull: new PullRef('rozed-dev', 'e2e', 1),
  });
  expect(threads).toHaveLength(sent);
  github.send({ kind: 'confirmed', name: REVIEW_THREADS.name, pull: PULL });
  expect(threads.at(-1)?.threads.map((thread) => thread.id)).toEqual(['T1', 'T2']);
  // What was read stays though a read fails later.
  github.send({
    kind: 'readFailed',
    name: REVIEW_THREADS.name,
    pull: PULL,
    error: { kind: 'inconsistent', message: 'changed while read' },
  });
  expect(threads.at(-1)?.status).toBe('ready');
  reading.stop();
  expect(github.listeners.size).toBe(0);

  const failing = fakePoller(new Error('GitHub refused it'), { kind: 'unknown', why: 'left out' });
  const second = reads(failing.poller);
  second.reading.follow('t1');
  await settled();
  expect(second.threads.at(-1)).toMatchObject({ status: 'failed', problem: 'GitHub refused it' });
  expect(second.reviews.at(-1)).toEqual({ id: 't1', review: { kind: 'unknown' } });
  expect(second.logged).toEqual([`${PULL.toString()}: GitHub refused it`]);
});

test('a view acting as nobody, or showing a run of layers, reads none', async () => {
  const github = fakePoller(list('T1'), { kind: 'read', review: undefined });
  let view = info({ acting: { kind: 'anonymous' } });
  const { reading, threads } = reads(github.poller, { view: () => view });
  reading.follow('t1');
  await settled();
  expect(threads.at(-1)).toMatchObject({ status: 'signIn', threads: [] });
  view = info({ run: [82, 83] });
  reading.follow('t1');
  await settled();
  expect(threads.at(-1)).toMatchObject({ status: 'run', threads: [] });
  expect(github.asked).toEqual([]);
  // As rozed-bot again, it starts afresh, and reads.
  view = info();
  reading.follow('t1');
  await settled();
  expect(threads.at(-1)).toMatchObject({ status: 'ready' });
});

test('sends the comparison of revisions a view shows as it changes', () => {
  const github = fakePoller(list(), { kind: 'read', review: undefined });
  let compared: Compared | null = null;
  const { reading, threads } = reads(github.poller, { compared: () => compared });
  reading.follow('t1');
  const sent = threads.length;
  reading.compared('t1');
  expect(threads).toHaveLength(sent);
  compared = { key: 'r1..r2', from: HEAD, replayed: false };
  reading.compared('t1');
  expect(threads.at(-1)?.compared).toEqual(compared);
  reading.compared('t1');
  expect(threads).toHaveLength(sent + 1);
});

test('a closed view is let go', async () => {
  const github = fakePoller(list('T1'), { kind: 'read', review: undefined });
  let view: PullTabInfo | undefined = info();
  const { reading } = reads(github.poller, { view: () => view });
  reading.follow('t1');
  await settled();
  view = undefined;
  reading.follow('t1');
  expect(reading.current('t1').threads).toBeUndefined();
  expect(github.listeners.size).toBe(0);
});

test('rows leave out a path longer than any file’s, and keep each author’s kind', () => {
  const long = node('LONG', 'x'.repeat(4097));
  const rows = threadRows({ nodes: [node('T1'), long], missing: 1 });
  expect(rows.map((row) => row.id)).toEqual(['T1']);
  expect(rows[0]?.comments[0]).toMatchObject({ author: 'rozed-bot', authorType: 'User' });
  expect(reviewRow({ kind: 'unknown', why: 'left out' })).toEqual({ kind: 'unknown' });
});

test('a first read the poller can’t answer now fails with why, and the threads come once read', async () => {
  const github = fakePoller(list('T1'), { kind: 'read', review: undefined });
  // As the poller does before GitHub answers: it has nothing yet.
  github.poller.reviewThreads = () => Promise.resolve(undefined);
  const { reading, threads } = reads(github.poller);
  reading.follow('t1');
  await settled();
  expect(threads.at(-1)?.status).toBe('loading');
  github.change({ offline: { since: 0, retryAt: 1, error: 'The network is down.' } });
  expect(threads.at(-1)).toMatchObject({
    status: 'failed',
    problem: 'GitHub can’t be reached: The network is down.',
  });
  github.send({ kind: 'read', name: REVIEW_THREADS.name, pull: PULL });
  expect(threads.at(-1)).toMatchObject({ status: 'ready', problem: null });
  reading.stop();
  expect(github.watchers.size).toBe(0);

  // A rate limit that holds every read, or an account signed out, ends the wait the same way.
  const stalls: Partial<PollStatus>[] = [
    { rateLimit: { kind: 'paused', until: 0, reason: { kind: 'secondary' } } },
    { signedOut: true },
  ];
  for (const status of stalls) {
    const held = fakePoller(list('T1'), { kind: 'read', review: undefined });
    held.poller.reviewThreads = () => Promise.resolve(undefined);
    held.change(status);
    const again = reads(held.poller);
    again.reading.follow('t1');
    await settled();
    expect(again.threads.at(-1)?.status).toBe('failed');
  }
});
