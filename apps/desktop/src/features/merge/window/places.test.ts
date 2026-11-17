// How the window words a pull request in a merge queue: the merge panel's line for one queued or
// ready to join a queue, its rows once it will be removed or left, and the banner's sentence for
// why it left, for each reason GitHub gives and for one Lo can't tell.

import { describe, expect, it } from 'vitest';

import type { InQueue, LeftQueue, MergeState } from '../contract.ts';
import {
  aheadWords,
  leftNow,
  leftTitle,
  leftTone,
  leftWhy,
  panelRows,
  queueHead,
  queueRows,
} from './places.ts';
import { panelHead } from './words.ts';

const RUN = 'https://github.com/rozed-dev/e2e/actions/runs/1';

/** A pull request queued 2nd into `e4/queued`, with `change`. */
function state(change: Partial<MergeState> = {}): MergeState {
  return {
    verdict: 'queued',
    position: 2,
    blockers: [],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'notPossible', reason: 'queued' },
    picked: 'MERGE',
    methods: { merge: true, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'e4/queued',
    queue: { required: true, method: 'SQUASH' },
    approvedBy: [],
    checks: { passed: 1, total: 1 },
    url: 'https://github.com/rozed-dev/e2e/pull/134',
    head: 'a'.repeat(40),
    readAt: Date.now(),
    stale: null,
    off: null,
    ...change,
  };
}

/** Ready to join `e4/queued`'s queue. */
const READY = state({
  verdict: 'ready',
  position: null,
  action: { kind: 'enqueue', method: 'SQUASH' },
});

const FAILED: InQueue = {
  place: {
    kind: 'listed',
    position: 3,
    state: 'UNMERGEABLE',
    timeToMerge: null,
    failed: [{ name: 'ci', state: 'failed', url: RUN }],
  },
  left: null,
};

function left(why: LeftQueue['why'], partial = false): LeftQueue {
  return { at: Date.parse('2026-11-16T19:24:30Z'), why, partial };
}

describe('the panel’s line', () => {
  it('says where a queued pull request is, fresher than GitHub’s read of it, or that it will be removed', () => {
    const queued = state();
    const none = { kind: 'none' } as const;
    expect(queueHead(panelHead(queued), queued, undefined, none)).toEqual({
      kind: 'queued',
      verdict: 'Queued',
      into: false,
      after: 'In the merge queue for e4/queued · 2nd',
    });
    const third: InQueue = {
      place: { kind: 'listed', position: 3, state: 'QUEUED', timeToMerge: null, failed: [] },
      left: null,
    };
    expect(queueHead(panelHead(queued), queued, third, none).after).toBe(
      'In the merge queue for e4/queued · 3rd',
    );
    expect(queueHead(panelHead(queued), queued, FAILED, none)).toMatchObject({
      kind: 'blocked',
      verdict: 'Will be removed',
    });
    const unplaced = state({ position: null });
    expect(queueHead(panelHead(unplaced), unplaced, undefined, none).after).toBe(
      'In the merge queue for e4/queued',
    );
  });

  it('says what’s ahead of one ready for the queue, once read', () => {
    const head = panelHead(READY);
    expect(queueHead(head, READY, undefined, { kind: 'reading' })).toEqual(head);
    const read = (ahead: Parameters<typeof aheadWords>[0]) =>
      queueHead(head, READY, undefined, { kind: 'read', ahead }).after;
    expect(read({ kind: 'queue', count: 4, atLeast: false, timeToMerge: 1080 })).toBe(
      'e4/queued merges through a queue · 4 ahead, about 18 min',
    );
    expect(read({ kind: 'queue', count: 0, atLeast: false, timeToMerge: null })).toBe(
      'e4/queued merges through a queue · none ahead',
    );
    expect(read({ kind: 'none' })).toBe('e4/queued merges through a queue');
    expect(queueHead(head, READY, undefined, { kind: 'failed', why: 'x' })).toEqual(head);
  });

  it('never reads a queue GitHub left part of out as empty', () => {
    expect(aheadWords({ kind: 'queue', count: 2, atLeast: true, timeToMerge: null })).toBe(
      'at least 2 ahead',
    );
    expect(aheadWords({ kind: 'queue', count: 0, atLeast: true, timeToMerge: null })).toBe(
      'Lo can’t tell how many are ahead',
    );
    expect(aheadWords({ kind: 'none' })).toBeUndefined();
  });
});

describe('why it left', () => {
  it('is a sentence for each reason GitHub gives', () => {
    const base = 'e4/queued';
    const why = (reason: LeftQueue['why'], partial?: boolean) =>
      leftWhy(left(reason, partial), base);
    expect(
      why({
        kind: 'failedChecks',
        checks: [
          { name: 'ci', state: 'failed', url: RUN },
          { name: 'lint', state: 'failed', url: null },
        ],
      }),
    ).toBe('ci and lint failed with its group.');
    expect(why({ kind: 'failedChecks', checks: [] })).toBe('its checks failed with its group.');
    expect(why({ kind: 'conflict' })).toBe('it conflicts with e4/queued or an entry ahead of it.');
    expect(why({ kind: 'timedOut' })).toBe('its checks ran past the queue’s time limit.');
    expect(why({ kind: 'removed', by: 'rozed-bot', you: true })).toBe('you took it out.');
    expect(why({ kind: 'removed', by: 'tess-okafor', you: false })).toBe(
      'tess-okafor took it out.',
    );
    expect(why({ kind: 'removed', by: null, you: false })).toBe('someone took it out.');
    expect(why({ kind: 'other', reason: 'branch_protection_changed' })).toBe(
      'GitHub says “branch_protection_changed”.',
    );
    expect(why({ kind: 'other', reason: null })).toBe('GitHub gave no reason.');
  });

  it('says Lo can’t tell, never that it stayed, and what GitHub may have left out', () => {
    const base = 'e4/queued';
    expect(leftWhy(left({ kind: 'unknown', why: null }), base)).toBe('Lo can’t tell why.');
    expect(leftWhy(left({ kind: 'unknown', why: null }, true), base)).toBe(
      'Lo can’t tell why: GitHub left it out of its answer.',
    );
    expect(leftWhy(left({ kind: 'unknown', why: 'GitHub can’t be reached.' }), base)).toBe(
      'Lo couldn’t read why: GitHub can’t be reached.',
    );
    expect(leftWhy(left({ kind: 'conflict' }, true), base)).toBe(
      'it conflicts with e4/queued or an entry ahead of it. GitHub left part of why out, so there may be more.',
    );
  });

  it('is loud for a failure in the queue, and news for the rest', () => {
    expect(leftTitle(134)).toBe('#134 left the merge queue:');
    expect(leftTone(left({ kind: 'timedOut' }))).toBe('danger');
    expect(leftTone(left({ kind: 'removed', by: null, you: false }))).toBe('warn');
    expect(leftTone(left({ kind: 'unknown', why: null }))).toBe('warn');
  });

  it('is news only until it’s queued again or merged', () => {
    const gone: InQueue = { place: null, left: left({ kind: 'conflict' }) };
    expect(leftNow(state({ verdict: 'blocked' }), gone)).toEqual(gone.left);
    expect(leftNow(READY, gone)).toEqual(gone.left);
    expect(leftNow(state(), gone)).toBeUndefined();
    expect(leftNow(state({ verdict: 'merged' }), gone)).toBeUndefined();
    expect(leftNow(READY, undefined)).toBeUndefined();
  });
});

describe('the panel’s rows', () => {
  it('put why it left first, with the runs of the checks that failed', () => {
    const blocked = state({
      verdict: 'blocked',
      position: null,
      blockers: [{ kind: 'check', check: { name: 'ci', state: 'failed', url: RUN } }],
    });
    const gone: InQueue = {
      place: null,
      left: left({ kind: 'failedChecks', checks: [{ name: 'ci', state: 'failed', url: RUN }] }),
    };
    const rows = panelRows(blocked, gone);
    expect(rows.map((row) => row.key)).toEqual(['left', 'checks-failed']);
    expect(rows[0]).toMatchObject({
      kind: 'fail',
      title: 'It left the merge queue',
      detail: '1 check failed with its group.',
      inTheWay: false,
      subs: [{ name: 'ci', link: { label: 'Open the run ↗', url: RUN } }],
    });
    const out = (why: LeftQueue['why'], partial?: boolean) =>
      panelRows(blocked, { place: null, left: left(why, partial) })[0]?.detail;
    expect(out({ kind: 'removed', by: null, you: true })).toBe('You took it out.');
    // Names from GitHub keep their case.
    expect(out({ kind: 'removed', by: 'tess-okafor', you: false })).toBe(
      'Taken out by tess-okafor.',
    );
    expect(out({ kind: 'conflict' }, true)).toBe(
      'It conflicts with e4/queued or an entry ahead of it. GitHub left part of why out, so there may be more.',
    );
  });

  it('say first that a queued one will be removed, and which checks failed', () => {
    expect(queueRows(state(), FAILED)).toEqual([
      expect.objectContaining({
        key: 'queue-removal',
        title: '1 check failed in the queue',
        detail: 'GitHub takes it out of the queue.',
        inTheWay: true,
        subs: [
          expect.objectContaining({ name: 'ci', link: { label: 'Open the run ↗', url: RUN } }),
        ],
      }),
    ]);
    const listed = FAILED.place?.kind === 'listed' ? FAILED.place : undefined;
    if (!listed) throw new Error('not listed');
    expect(queueRows(state(), { place: { ...listed, failed: [] }, left: null })[0]?.title).toBe(
      'It can’t merge as the queue tested it',
    );
    expect(queueRows(state(), { place: { ...listed, state: 'MERGEABLE' }, left: null })).toEqual(
      [],
    );
  });

  it('say when Lo can’t see its place, only where GitHub left part of the queue out', () => {
    expect(queueRows(state(), { place: { kind: 'unlisted', partial: true }, left: null })).toEqual([
      expect.objectContaining({
        key: 'queue-unlisted',
        title: 'Lo can’t see its place in the queue',
      }),
    ]);
    expect(queueRows(state(), { place: { kind: 'unlisted', partial: false }, left: null })).toEqual(
      [],
    );
  });
});
