// A queued pull request's place, what's ahead of one about to join, and why one left, from the
// merge queue's recordings on rozed-dev/e2e as rozed-bot, its admin: e4/queued's queue as GitHub
// tested a merge fixture generation's four pull requests, and why three of them left it.

import {
  GithubClient,
  PullRef,
  queueRemoval,
  queueView,
  RepoRef,
  Token,
  type QueueRemoval,
  type QueueView,
} from '@lo/github';
import { replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import { aheadOf, leftOf, placeOf, queuePages } from './places.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** Each answer `queue_view_e2e` recorded for e4/queued's queue, in the order GitHub gave them. */
async function recordedViews(): Promise<QueueView[]> {
  const client = new GithubClient({ fetch: replayFetch('queue_view_e2e'), token: new Token('x') });
  const views: QueueView[] = [];
  for (let at = 0; at < 4; at++) views.push(await queueView(client, E2E, 'e4/queued'));
  return views;
}

/** Why `number` last left e4/queued's queue, as `queue_removal_e2e` recorded it. */
async function recordedRemoval(number: number): Promise<QueueRemoval> {
  const client = new GithubClient({
    fetch: replayFetch('queue_removal_e2e'),
    token: new Token('x'),
  });
  return queueRemoval(client, new PullRef('rozed-dev', 'e2e', number));
}

const RUN = /^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//;

describe('a queued pull request’s place', () => {
  it('is where its entry is and how it stands, with the checks that failed in the queue', async () => {
    const tested = (await recordedViews()).at(-1);
    if (!tested) throw new Error('nothing recorded');
    expect(placeOf(tested, 131, 'rozed-bot')).toEqual({
      kind: 'listed',
      position: 3,
      state: 'MERGEABLE',
      timeToMerge: null,
      failed: [],
    });
    expect(placeOf(tested, 134, 'rozed-bot')).toEqual({
      kind: 'listed',
      position: 4,
      state: 'UNMERGEABLE',
      timeToMerge: null,
      failed: [{ name: 'ci', state: 'failed', url: expect.stringMatching(RUN) }],
    });
  });

  it('is unlisted once its entry is gone, and partly so when GitHub left part of the queue out', async () => {
    const [first] = await recordedViews();
    if (!first?.queue) throw new Error('nothing recorded');
    expect(placeOf(first, 4821, 'rozed-bot')).toEqual({ kind: 'unlisted', partial: false });
    const leftOut = { ...first, leftOut: ['mergeQueue.entries.nodes.1'] };
    expect(placeOf(leftOut, 4821, 'rozed-bot')).toEqual({ kind: 'unlisted', partial: true });
    const longer = { ...first, queue: { ...first.queue, total: 140 } };
    expect(placeOf(longer, 4821, 'rozed-bot')).toEqual({ kind: 'unlisted', partial: true });
  });

  it('takes GitHub’s estimate of when it merges', async () => {
    const [first] = await recordedViews();
    if (!first?.queue) throw new Error('nothing recorded');
    const estimated = {
      ...first,
      queue: {
        ...first.queue,
        entries: first.queue.entries.map((entry) => ({ ...entry, estimate: 720 })),
      },
    };
    expect(placeOf(estimated, 133, 'rozed-bot')).toMatchObject({ position: 2, timeToMerge: 720 });
  });
});

describe('what’s ahead in the queue a pull request would join', () => {
  it('is how many entries, and when the last should merge once GitHub estimated each', async () => {
    const [first] = await recordedViews();
    if (!first?.queue) throw new Error('nothing recorded');
    expect(aheadOf(first, 4821)).toEqual({
      kind: 'queue',
      count: 4,
      atLeast: false,
      timeToMerge: null,
    });
    const estimated = {
      ...first,
      queue: {
        ...first.queue,
        entries: first.queue.entries.map((entry, at) => ({ ...entry, estimate: 300 * (at + 1) })),
      },
    };
    expect(aheadOf(estimated, 4821)).toEqual({
      kind: 'queue',
      count: 4,
      atLeast: false,
      timeToMerge: 1200,
    });
  });

  it('is at least those read when GitHub left part of the queue out, never an empty queue, and none for no queue', async () => {
    const [first] = await recordedViews();
    if (!first?.queue) throw new Error('nothing recorded');
    expect(aheadOf({ ...first, queue: undefined, leftOut: ['mergeQueue'] }, 4821)).toEqual({
      kind: 'queue',
      count: 0,
      atLeast: true,
      timeToMerge: null,
    });
    expect(aheadOf({ ...first, leftOut: ['mergeQueue.entries.nodes.4'] }, 4821)).toMatchObject({
      count: 4,
      atLeast: true,
    });
    expect(aheadOf({ ...first, queue: undefined }, 4821)).toEqual({ kind: 'none' });
  });
});

describe('why a pull request left its queue', () => {
  it('is the checks that failed in the queue, with their runs, or who took it out', async () => {
    const failed = leftOf(await recordedRemoval(134), 'rozed-bot');
    expect(failed).toEqual({
      at: Date.parse('2026-11-16T19:24:30Z'),
      why: {
        kind: 'failedChecks',
        checks: [{ name: 'ci', state: 'failed', url: expect.stringMatching(RUN) }],
      },
      partial: false,
    });
    expect(queuePages(null, failed ?? null)).toEqual(
      new Set([failed?.why.kind === 'failedChecks' ? failed.why.checks[0]?.url : '']),
    );
    expect(leftOf(await recordedRemoval(133), 'Rozed-Bot')?.why).toEqual({
      kind: 'removed',
      by: 'rozed-bot',
      you: true,
    });
    expect(leftOf(await recordedRemoval(133), 'tess-okafor')?.why).toMatchObject({ you: false });
  });

  it('is nothing once it merged, or while it’s in the queue', async () => {
    expect(leftOf(await recordedRemoval(131), 'rozed-bot')).toBeUndefined();
    const back = { ...(await recordedRemoval(134)), inQueue: true, removal: undefined };
    expect(leftOf(back, 'rozed-bot')).toBeUndefined();
  });

  it('is unknown, never that it stayed, when GitHub left the removal or its reason out or lists none', async () => {
    const failed = await recordedRemoval(134);
    const leftOut = ['pullRequest.timelineItems.nodes.0'];
    expect(leftOf({ ...failed, removal: undefined, leftOut }, 'rozed-bot')).toEqual({
      at: null,
      why: { kind: 'unknown', why: null },
      partial: true,
    });
    const noReason = failed.removal && { ...failed.removal, reason: undefined };
    expect(leftOf({ ...failed, removal: noReason, leftOut }, 'rozed-bot')).toEqual({
      at: Date.parse('2026-11-16T19:24:30Z'),
      why: { kind: 'unknown', why: null },
      partial: true,
    });
    expect(leftOf({ ...failed, removal: undefined }, 'rozed-bot')).toEqual({
      at: null,
      why: { kind: 'unknown', why: null },
      partial: false,
    });
  });

  it('is GitHub’s own word for a reason Lo has none for, with what it may be missing', async () => {
    const failed = await recordedRemoval(134);
    const other = failed.removal && { ...failed.removal, reason: 'branch_protection_changed' };
    expect(
      leftOf(
        { ...failed, removal: other, leftOut: ['pullRequest.timelineItems.nodes.0.actor'] },
        'x',
      ),
    ).toEqual({
      at: Date.parse('2026-11-16T19:24:30Z'),
      why: { kind: 'other', reason: 'branch_protection_changed' },
      partial: true,
    });
  });
});
