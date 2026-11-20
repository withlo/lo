// What a merge queue's tab shows of what main read, from the merge queue's recordings on
// rozed-dev/e2e as rozed-bot, its admin: e4/queued's queue as GitHub tested a merge fixture
// generation's four pull requests, the open pull requests into it, one waiting to join with
// auto-merge on, and why three of them left it.

import {
  GithubClient,
  PullRef,
  queueRemoval,
  queueView,
  queueWaiting,
  RepoRef,
  Token,
  type OpenPullRequestList,
  type QueueView,
  type QueueWaiting,
  type TrunkRuleList,
} from '@lo/github';
import { replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import {
  countOf,
  leftOf,
  methodOf,
  readOf,
  stacksOf,
  switchBranches,
  type Leaver,
} from './read.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');
const BRANCH = 'e4/queued';

/** Each answer `queue_view_e2e` recorded for e4/queued's queue, in the order GitHub gave them. */
async function recordedViews(): Promise<QueueView[]> {
  const client = new GithubClient({ fetch: replayFetch('queue_view_e2e'), token: new Token('x') });
  const views: QueueView[] = [];
  for (let at = 0; at < 4; at++) views.push(await queueView(client, E2E, BRANCH));
  return views;
}

/** The open pull requests into e4/queued that `queue_waiting_e2e` recorded. */
async function recordedWaiting(): Promise<QueueWaiting> {
  const client = new GithubClient({
    fetch: replayFetch('queue_waiting_e2e'),
    token: new Token('x'),
  });
  return queueWaiting(client, E2E, BRANCH);
}

describe('what a merge queue’s tab shows', () => {
  it('is nothing until the queue is read', () => {
    expect(readOf(undefined, undefined, false, 'rozed-bot')).toEqual({ kind: 'reading' });
  });

  it('lists the entries in order, those GitHub tests together, yours, and the queue’s settings', async () => {
    const views = await recordedViews();
    const tested = readOf(views.at(-1), await recordedWaiting(), false, 'rozed-bot');
    if (tested.kind !== 'queue') throw new Error(`expected a queue, got ${tested.kind}`);
    expect(tested.url).toBe('https://github.com/rozed-dev/e2e/queue/e4/queued');
    expect({ method: tested.method, groups: tested.groups }).toEqual({
      method: 'squash',
      groups: 5,
    });
    expect(
      tested.entries.map(({ position, number, state, testedTogether, yours, queuedByYou }) => ({
        position,
        number,
        state,
        testedTogether,
        yours,
        queuedByYou,
      })),
    ).toEqual([
      {
        position: 1,
        number: 132,
        state: 'AWAITING_CHECKS',
        testedTogether: true,
        yours: true,
        queuedByYou: true,
      },
      {
        position: 2,
        number: 133,
        state: 'AWAITING_CHECKS',
        testedTogether: true,
        yours: true,
        queuedByYou: true,
      },
      {
        position: 3,
        number: 131,
        state: 'MERGEABLE',
        testedTogether: true,
        yours: true,
        queuedByYou: true,
      },
      {
        position: 4,
        number: 134,
        state: 'UNMERGEABLE',
        testedTogether: true,
        yours: true,
        queuedByYou: true,
      },
    ]);
    expect(tested.entries[0]?.enqueuedAt).toBeTypeOf('number');
    expect({ more: tested.more, leftOut: tested.leftOut }).toEqual({ more: 0, leftOut: false });

    // As another account sees it, none of them is theirs. Before GitHub built them, none is tested
    // together.
    const queued = readOf(views[0], undefined, false, 'tess-okafor');
    if (queued.kind !== 'queue') throw new Error(`expected a queue, got ${queued.kind}`);
    expect(queued.entries.map(({ yours, testedTogether }) => ({ yours, testedTogether }))).toEqual(
      Array.from({ length: 4 }, () => ({ yours: false, testedTogether: false })),
    );
  });

  it('lists those waiting to join with auto-merge on, naming no method but the queue’s', async () => {
    const [view] = await recordedViews();
    if (!view?.queue) throw new Error('expected a queue');
    // Not in the queue as recorded: #133 waits to join it, with auto-merge on.
    const outside: QueueView = {
      ...view,
      queue: {
        ...view.queue,
        entries: view.queue.entries.filter(({ position }) => position !== 2),
      },
    };
    const read = readOf(outside, await recordedWaiting(), false, 'rozed-bot');
    if (read.kind !== 'queue') throw new Error(`expected a queue, got ${read.kind}`);
    expect(read.waiting).toEqual([
      {
        number: 133,
        title: 'Fixture M2: queued, slow (2)',
        url: 'https://github.com/rozed-dev/e2e/pull/133',
        author: 'rozed-bot',
        yours: true,
        head: '3230ff8eaabe0f4f6d0ebc6fa5188a1b6e51dfcd',
        review: null,
        checks: 'running',
      },
    ]);
    // GitHub gives auto-merge's method as MERGE on a queue's branch, whatever was asked: the method
    // shown is the queue's own.
    expect(read.method).toBe('squash');
    expect(read.waitingCutShort).toBe(false);
  });

  it('says one waiting may be missing only once their read failed, not before it answers', async () => {
    const [view] = await recordedViews();
    const before = readOf(view, undefined, false, 'rozed-bot');
    const failed = readOf(view, undefined, true, 'rozed-bot');
    expect(before.kind === 'queue' && before.waitingCutShort).toBe(false);
    expect(failed.kind === 'queue' && failed.waitingCutShort).toBe(true);
  });

  it('is no queue only when GitHub says the branch has none, and never when it left it out', () => {
    const none: QueueView = {
      branch: 'main',
      viewerPermission: 'ADMIN',
      queue: undefined,
      leftOut: [],
    };
    expect(readOf(none, undefined, false, 'rozed-bot')).toEqual({ kind: 'none' });
    const leftOut = readOf({ ...none, leftOut: ['mergeQueue'] }, undefined, false, 'rozed-bot');
    expect(leftOut).toMatchObject({ kind: 'queue', url: null, entries: [], leftOut: true });
    expect(countOf({ ...none, leftOut: ['mergeQueue'] })).toBeNull();
    expect(countOf(none)).toBeNull();
  });

  it('names a method newer than Lo as none, rather than guess', () => {
    expect([
      methodOf('MERGE'),
      methodOf('rebase'),
      methodOf('FAST_FORWARD'),
      methodOf(undefined),
    ]).toEqual(['merge', 'rebase', null, null]);
  });
});

/** An open pull request's place among the stacks, at `position` in GitHub stack `stack`, if any. */
function layer(number: number, stack?: number, position = 1) {
  return { number, nativeStack: stack === undefined ? undefined : { stack, position } };
}

describe('a GitHub stack’s layer in the queue', () => {
  it('is marked with how many open layers the stack has, and its first and last', async () => {
    const views = await recordedViews();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the layers are read.
    const stacks = {
      layers: {
        131: layer(131, 140, 2),
        132: layer(132),
        133: layer(133, 140, 1),
        134: layer(134, 141),
      },
    } as unknown as Parameters<typeof stacksOf>[0];
    const read = readOf(views.at(-1), undefined, false, 'rozed-bot', stacksOf(stacks));
    if (read.kind !== 'queue') throw new Error(`expected a queue, got ${read.kind}`);
    expect(read.entries.map(({ number, stack }) => [number, stack])).toEqual([
      [132, null],
      [133, { layers: 2, first: 133, last: 131 }],
      [131, { layers: 2, first: 133, last: 131 }],
      // A stack Lo sees one layer of is no stack it can name.
      [134, null],
    ]);
    expect(stacksOf(undefined)(131)).toBeNull();
  });
});

/** An open pull request into `baseRefName`, of which only its base is read. */
function openInto(baseRefName: string): OpenPullRequestList['pullRequests'][number] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only its base is read.
  return { baseRefName } as OpenPullRequestList['pullRequests'][number];
}

/** Open pull requests into `bases`, in a repository whose default branch is `main`. */
function listOf(bases: readonly string[]): OpenPullRequestList {
  return {
    pullRequests: bases.map(openInto),
    totalCount: bases.length,
    truncated: false,
    defaultBranch: 'main',
    merged: [],
    lookups: [],
    mergedTruncated: false,
  };
}

/** A ruleset that requires a merge queue on the branches `include` matches. */
function queueRules(include: string[]): TrunkRuleList {
  return {
    rulesets: [{ include, exclude: [], gatesMerging: true, queue: true }],
    unavailable: undefined,
    leftOut: false,
  };
}

describe('the branches a merge queue’s tab switches between', () => {
  it('are the one shown, those shown before, and the open pull requests’ bases with a queue', () => {
    const list = listOf(['main', 'release/2.8', 'feature/x', 'release/2.9']);
    const rules = queueRules(['~DEFAULT_BRANCH', 'refs/heads/release/*']);
    expect(switchBranches('topic', ['feature/x'], list, rules)).toEqual([
      'main',
      'feature/x',
      'release/2.8',
      'release/2.9',
      'topic',
    ]);
  });

  it('are the one shown and those before while the rulesets or the list haven’t been read', () => {
    expect(switchBranches('e4/queued', ['merge/4/base'], undefined, undefined)).toEqual([
      'e4/queued',
      'merge/4/base',
    ]);
    expect(switchBranches('main', [], listOf(['main', 'dev']), undefined)).toEqual(['main']);
  });
});

/** Pull request `number`, which Lo saw in e4/queued's queue since it joined at 19:13:38. */
function leaver(number: number): Leaver {
  return {
    number,
    title: `Fixture M2: ${number}`,
    url: `https://github.com/rozed-dev/e2e/pull/${number}`,
    enqueuedAt: Date.parse('2026-11-16T19:13:38Z'),
  };
}

describe('why one left the queue', () => {
  const client = new GithubClient({
    fetch: replayFetch('queue_removal_e2e'),
    token: new Token('x'),
  });
  const removal = (number: number) => queueRemoval(client, new PullRef('rozed-dev', 'e2e', number));
  const SEEN = Date.parse('2026-11-16T19:30:00Z');

  it('says it was taken out by hand, its checks failed with the run, or it merged, when GitHub said', async () => {
    expect(leftOf(leaver(133), await removal(133), SEEN)).toEqual({
      ...leaver(133),
      at: Date.parse('2026-11-16T19:14:46Z'),
      why: { kind: 'removed', by: 'rozed-bot' },
      partial: false,
    });
    const failed = leftOf(leaver(134), await removal(134), SEEN);
    expect(failed?.at).toBe(Date.parse('2026-11-16T19:24:30Z'));
    expect(failed?.why).toEqual({
      kind: 'failedChecks',
      checks: [
        {
          name: 'ci',
          url: expect.stringMatching(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//),
        },
      ],
    });
    expect(leftOf(leaver(131), await removal(131), SEEN)?.why).toEqual({ kind: 'merged' });
  });

  it('says Lo can’t tell why when the read failed, or GitHub left the removal out, and nothing when it’s queued after all', () => {
    expect(leftOf(leaver(1), undefined, SEEN)).toEqual({
      ...leaver(1),
      at: SEEN,
      why: { kind: 'unknown' },
      partial: false,
    });
    const leftOutOf = { number: 1, state: 'OPEN', inQueue: false, removal: undefined };
    expect(
      leftOf(leaver(1), { ...leftOutOf, leftOut: ['pullRequest.timelineItems.nodes.0'] }, SEEN),
    ).toMatchObject({ why: { kind: 'unknown' }, partial: true });
    expect(leftOf(leaver(1), { ...leftOutOf, leftOut: [] }, SEEN)).toMatchObject({
      why: { kind: 'unknown' },
      partial: false,
    });
    expect(leftOf(leaver(1), { ...leftOutOf, inQueue: true, leftOut: [] }, SEEN)).toBeUndefined();
  });
});
