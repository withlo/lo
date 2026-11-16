// How a merge queue's tab words what main read: states, times, groups, what those waiting to join
// wait for, the queue's settings, and the rows the keyboard moves through.

import { describe, expect, it } from 'vitest';

import type { Entry, QueueRead, WaitingEntry } from '../contract.ts';
import {
  focusedRow,
  inQueue,
  itemsOf,
  retryIn,
  rowsOf,
  settingsOf,
  stepRow,
  tableState,
  toMerge,
  updated,
  waitingOf,
  waitsFor,
} from './rows.ts';

const NOW = Date.UTC(2026, 10, 16, 12);

function entry(position: number, number: number, extra: Partial<Entry> = {}): Entry {
  return {
    position,
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: 'mira-chen',
    state: 'AWAITING_CHECKS',
    enqueuedAt: NOW - 14 * 60_000,
    timeToMerge: 120,
    yours: false,
    queuedByYou: false,
    testedTogether: false,
    stack: null,
    ...extra,
  };
}

function waiting(number: number, extra: Partial<WaitingEntry> = {}): WaitingEntry {
  return {
    number,
    title: `Waiting ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: 'ravi-k',
    yours: false,
    review: null,
    checks: 'running',
    ...extra,
  };
}

function queue(extra: Partial<Extract<QueueRead, { kind: 'queue' }>> = {}): QueueRead {
  return {
    kind: 'queue',
    url: 'https://github.com/o/r/queue/main',
    method: 'squash',
    groups: 3,
    nextMerge: 360,
    entries: [],
    more: 0,
    leftOut: false,
    waiting: [],
    waitingCutShort: false,
    ...extra,
  };
}

describe('the queue’s entries', () => {
  it('are drawn in order, those tested together from the front as one group', () => {
    const items = itemsOf(
      [
        entry(1, 4806, { testedTogether: true }),
        entry(2, 4810, { testedTogether: true, yours: true }),
        entry(3, 4797, { testedTogether: true }),
        entry(4, 4774, { state: 'QUEUED', enqueuedAt: NOW - 6 * 60_000, timeToMerge: 480 }),
      ],
      NOW,
    );
    expect(
      items.map((item) => (item.kind === 'group' ? item.group.entries.length : 'entry')),
    ).toEqual([3, 'entry']);
    const [group, alone] = items;
    expect(group?.kind === 'group' && group.group.entries[1]).toMatchObject({
      key: 'queued-4810',
      position: 2,
      yours: true,
      state: 'running',
      inQueue: '14 min',
      merges: '~2 min',
    });
    expect(alone?.kind === 'entry' && alone.entry).toMatchObject({
      key: 'queued-4774',
      state: 'waiting',
      inQueue: '6 min',
      merges: '~8 min',
    });
  });

  it('mark a GitHub stack’s layer with how many layers it has, and which', () => {
    const [item] = itemsOf(
      [entry(5, 4821, { stack: { layers: 3, first: 4818, last: 4821 } })],
      NOW,
    );
    expect(item?.kind === 'entry' && item.entry.stack).toEqual({ layers: 3, range: '#4818–#4821' });
  });

  it('name an author GitHub deleted, rather than leave a blank', () => {
    const [item] = itemsOf([entry(1, 7, { author: null })], NOW);
    expect(item?.kind === 'entry' && item.entry.author).toBe('A deleted account');
  });

  it('say how each stands: checks running, waiting, or about to be removed', () => {
    expect(
      (['QUEUED', 'AWAITING_CHECKS', 'MERGEABLE', 'UNMERGEABLE', 'LOCKED'] as const).map(
        tableState,
      ),
    ).toEqual(['waiting', 'running', 'waiting', 'removal', 'waiting']);
  });

  it('say how long they’ve been queued and when they should merge, or that it isn’t known', () => {
    expect([
      inQueue(NOW - 30_000, NOW),
      inQueue(NOW - 59 * 60_000, NOW),
      inQueue(NOW - 125 * 60_000, NOW),
      inQueue(NOW - 120 * 60_000, NOW),
      inQueue(null, NOW),
    ]).toEqual(['<1 min', '59 min', '2 h 5 min', '2 h', '—']);
    expect([toMerge(10), toMerge(130), toMerge(3_600), toMerge(null)]).toEqual([
      '~1 min',
      '~2 min',
      '~1 h',
      '—',
    ]);
  });
});

describe('those waiting to join', () => {
  it('say what each waits for before GitHub adds it', () => {
    expect([
      waitsFor({ review: 'required', checks: null }),
      waitsFor({ review: 'changesRequested', checks: 'running' }),
      waitsFor({ review: 'approved', checks: 'running' }),
      waitsFor({ review: null, checks: 'failed' }),
      waitsFor({ review: 'approved', checks: 'passed' }),
    ]).toEqual([
      'when approved',
      'when approved and checks pass',
      'when checks pass',
      'when its failed checks pass',
      'when GitHub adds it',
    ]);
  });

  it('are drawn with whose they are', () => {
    expect(waitingOf([waiting(4826, { yours: true })])).toEqual([
      {
        key: 'waiting-4826',
        title: 'Waiting 4826',
        number: 4826,
        author: 'ravi-k',
        yours: true,
        until: 'when checks pass',
      },
    ]);
  });
});

describe('the queue’s settings', () => {
  it('name its method, its groups and the next merge, only as far as the account may read them', () => {
    expect(settingsOf(queue())).toBe('squash, groups of up to 3 · next merges in about 6 min');
    expect(settingsOf(queue({ method: 'merge', groups: 1, nextMerge: null }))).toBe(
      'merge commits, one at a time',
    );
    expect(settingsOf(queue({ method: null, groups: null, nextMerge: 90 }))).toBe(
      'next merges in about 2 min',
    );
    expect(settingsOf(queue({ method: null, groups: null, nextMerge: null }))).toBeUndefined();
    expect(settingsOf({ kind: 'none' })).toBeUndefined();
  });
});

describe('the rows the keyboard moves through', () => {
  const read = queue({
    entries: [entry(1, 1), entry(2, 2)],
    waiting: [waiting(3)],
  });

  it('are the entries, then those waiting, starting on the first', () => {
    expect(rowsOf(read).map(({ key }) => key)).toEqual(['queued-1', 'queued-2', 'waiting-3']);
    expect(rowsOf({ kind: 'none' })).toEqual([]);
    expect(focusedRow(rowsOf(read), undefined)?.key).toBe('queued-1');
    expect(focusedRow(rowsOf(read), 'queued-9')?.key).toBe('queued-1');
  });

  it('step one at a time, staying put at the ends', () => {
    const rows = rowsOf(read);
    expect(stepRow(rows, undefined, 1)?.key).toBe('queued-2');
    expect(stepRow(rows, 'waiting-3', 1)?.key).toBe('waiting-3');
    expect(stepRow(rows, 'queued-1', -1)?.key).toBe('queued-1');
    expect(stepRow([], undefined, 1)).toBeUndefined();
  });
});

describe('when the queue was read', () => {
  it('is said in the status bar, and when Lo reads again after a failure', () => {
    expect([
      updated(NOW - 2_000, NOW),
      updated(NOW - 10_000, NOW),
      updated(NOW - 3 * 60_000, NOW),
    ]).toEqual(['Updated just now', 'Updated 10 s ago', 'Updated 3 min ago']);
    expect([retryIn(NOW + 39_500, NOW), retryIn(NOW + 120_000, NOW), retryIn(null, NOW)]).toEqual([
      'in 40 s',
      'in 2 min',
      undefined,
    ]);
  });
});
