/**
 * The merge queue view's rows and why a pull request left its queue, from recordings on
 * `rozed-dev/e2e` as rozed-bot, its admin, on one generation of the merge fixture: its four pull
 * requests into `e4/queued`, whose ruleset merges through a queue. `queued-slow-1` and
 * `queued-slow-2` take ten minutes, `queued-pass` passes and `queued-fail` fails in the queue; each
 * joined in that order (`queue_view_e2e`). rozed-bot then took `queued-slow-2` out by hand, GitHub
 * took `queued-fail` out, and `queued-pass` merged (`queue_removal_e2e`).
 *
 * rozed-dev/e2e doesn't allow auto-merge, so a pull request waiting to join with it on is a derived
 * answer (`queue_waiting_e2e_auto_merge`).
 */

import {
  Fields,
  GithubClient,
  queueView,
  queueWaiting,
  RepoRef,
  Token,
  type QueueView,
} from '@lo/github';
import { cassette, replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { queueRows, type QueueRow } from '../src/merge/queue.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');
const BRANCH = 'e4/queued';
const BOT = 'rozed-bot';

type Name = 'queued-slow-1' | 'queued-slow-2' | 'queued-pass' | 'queued-fail';

function client(name: string): GithubClient {
  return new GithubClient({ fetch: replayFetch(name), token: new Token('gho_FAKE') });
}

/** The number of the generation's pull request `name`, as `recording` found it. */
function numberOf(recording: string, name: Name): number {
  return new Fields(cassette(recording).info.setup, 'setup')
    .fields('pulls')
    .fields(name)
    .integer('number');
}

/** The number of the generation's pull request `name`, as the queue's recording found it. */
function number(name: Name): number {
  return numberOf('queue_view_e2e', name);
}

/** Every read of `e4/queued`'s queue `queue_view_e2e` recorded, in order. */
async function views(): Promise<QueueView[]> {
  const reads = cassette('queue_view_e2e').interactions.filter(
    ({ interaction }) => interaction.request.operation === 'QueueView',
  );
  const github = client('queue_view_e2e');
  const read: QueueView[] = [];
  for (const _ of reads) read.push(await queueView(github, E2E, BRANCH));
  return read;
}

function rowOf(rows: readonly QueueRow[], name: Name): QueueRow {
  const row = rows.find((found) => found.number === number(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

test('the queue rows are in order, yours, and tested together once built in one chain', async () => {
  const waiting = await queueWaiting(client('queue_waiting_e2e'), E2E, BRANCH);
  const [joined, built, , failing] = await views();

  // Joined, none is built yet, so none is tested together.
  const first = queueRows(joined!, waiting, BOT);
  expect(first.more).toBe(0);
  expect(first.waiting).toEqual([]);
  expect(first.waitingCutShort).toBe(false);
  expect(
    first.entries.map((row) => [row.position, row.number, row.state, row.testedTogether]),
  ).toEqual([
    [1, number('queued-slow-1'), 'QUEUED', false],
    [2, number('queued-slow-2'), 'QUEUED', false],
    [3, number('queued-pass'), 'QUEUED', false],
    [4, number('queued-fail'), 'QUEUED', false],
  ]);
  const row = rowOf(first.entries, 'queued-pass');
  expect(row).toMatchObject({
    title: expect.stringMatching(/^Fixture M\d+: queued, passing$/),
    url: `https://github.com/rozed-dev/e2e/pull/${number('queued-pass')}`,
    author: BOT,
    yours: true,
    queuedByYou: true,
    timeToMerge: undefined,
    failedChecks: [],
  });
  expect(row.enqueuedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  // Someone else's view: none of them is theirs.
  const theirs = queueRows(joined!, waiting, 'octocat');
  expect(theirs.entries.some((found) => found.yours || found.queuedByYou)).toBe(false);

  // GitHub builds each on the commit the one ahead is tested on: all four are tested together.
  const together = queueRows(built!, waiting, BOT);
  expect(together.entries.map((found) => [found.state, found.testedTogether])).toEqual([
    ['AWAITING_CHECKS', true],
    ['AWAITING_CHECKS', true],
    ['AWAITING_CHECKS', true],
    ['AWAITING_CHECKS', true],
  ]);

  // queued-fail failed in the queue, and GitHub will take it out: its failed check is named.
  const last = queueRows(failing!, waiting, BOT);
  expect(rowOf(last.entries, 'queued-pass').state).toBe('MERGEABLE');
  const failed = rowOf(last.entries, 'queued-fail');
  expect(failed.state).toBe('UNMERGEABLE');
  expect(failed.failedChecks).toEqual([
    {
      name: 'ci',
      state: 'failed',
      url: expect.stringMatching(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//),
    },
  ]);
  expect(last.entries.every((found) => found.testedTogether)).toBe(true);
});

test('a chain broken behind the front tests only those ahead of it together', async () => {
  const waiting = await queueWaiting(client('queue_waiting_e2e'), E2E, BRANCH);
  const [, built] = await views();
  const queue = built!.queue!;
  // The third entry built on something else, as when GitHub rebuilds what's behind a failure.
  const broken: QueueView = {
    ...built!,
    queue: {
      ...queue,
      entries: queue.entries.map((entry, index) =>
        index === 2 ? { ...entry, base: queue.entries[0]?.tested } : entry,
      ),
    },
  };
  expect(queueRows(broken, waiting, BOT).entries.map((row) => row.testedTogether)).toEqual([
    true,
    true,
    false,
    false,
  ]);
  // A queue longer than the 100 read says how many more it holds.
  const longer: QueueView = { ...built!, queue: { ...queue, total: 124 } };
  expect(queueRows(longer, waiting, BOT).more).toBe(120);
  // One built alone isn't tested together with anything.
  const alone: QueueView = { ...built!, queue: { ...queue, entries: queue.entries.slice(0, 1) } };
  expect(queueRows(alone, waiting, BOT).entries.map((row) => row.testedTogether)).toEqual([false]);
});

test('a pull request with auto-merge on waits to join until it is in the queue', async () => {
  const waiting = await queueWaiting(client('queue_waiting_e2e_auto_merge'), E2E, BRANCH);
  const [joined] = await views();
  const slow = numberOf('queue_waiting_e2e', 'queued-slow-2');

  // Read before any of the four joined: the queue was empty, and queued-slow-2 waits, with its
  // ci running and no review required.
  const empty: QueueView = { ...joined!, queue: { ...joined!.queue!, entries: [], total: 0 } };
  const before = queueRows(empty, waiting, BOT);
  expect(before.entries).toEqual([]);
  expect(before.waiting).toEqual([
    {
      number: slow,
      title: expect.stringMatching(/: queued, slow \(2\)$/),
      url: `https://github.com/rozed-dev/e2e/pull/${slow}`,
      pullRequestId: expect.stringMatching(/^PR_/),
      head: expect.stringMatching(/^[0-9a-f]{40}$/),
      author: BOT,
      yours: true,
      method: 'SQUASH',
      enabledBy: BOT,
      enabledAt: '2026-11-16T19:05:00Z',
      reviewDecision: undefined,
      checks: 'running',
    },
  ]);
  // Once it's in the queue, it's an entry, and waits no longer.
  expect(queueRows(joined!, waiting, BOT).waiting).toEqual([]);
  // A branch with no queue has nothing to wait to join.
  expect(queueRows({ ...joined!, queue: undefined }, waiting, BOT)).toEqual({
    entries: [],
    more: 0,
    waiting: [],
    waitingCutShort: false,
  });
});
