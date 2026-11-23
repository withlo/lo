import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../contract.ts';
import {
  ago,
  BASE,
  comparisonLabel,
  endsOf,
  moved,
  noteOf,
  overviewNote,
  rowsOf,
  runNoteOf,
  shortcutRows,
  shortcutsOf,
  withEnd,
} from './model.ts';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const head = (letter: string) => letter.repeat(40);

function revision(letter: string, number: number | null, change: Partial<RevisionRow> = {}) {
  return {
    head: head(letter),
    number,
    pushedAt: { kind: 'exact', at: NOW - 60 * MINUTE },
    forced: false,
    pusher: 'ravi-k',
    rebased: false,
    available: true,
    ...change,
  } satisfies RevisionRow;
}

/** Five revisions, r1 no longer available and r4 a force-push onto a newer base. */
function view(change: Partial<ComparisonView> = {}): ComparisonView {
  return {
    id: 't1',
    status: 'ready',
    revisions: [
      revision('1', 1, { available: false }),
      revision('2', 2),
      revision('3', 3, { forced: true }),
      revision('4', 4, {
        forced: true,
        rebased: true,
        pushedAt: { kind: 'by', at: NOW - 6 * 60 * MINUTE },
      }),
      revision('5', 5, { pushedAt: { kind: 'exact', at: NOW - 40 * MINUTE } }),
    ],
    base: { branch: 'main', tip: head('b') },
    markers: { review: head('2'), lastSeen: head('4') },
    shown: head('5'),
    comparison: { from: head('4'), to: head('5') },
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
    ...change,
  };
}

describe('the revision picker', () => {
  it('lists the revisions newest first, with what each push did, then the base', () => {
    const rows = rowsOf(view(), NOW);
    expect(rows.map((row) => [row.key.slice(0, 1), row.label, row.line])).toEqual([
      ['5', 'r5', 'Pushed'],
      ['4', 'r4', 'Force-pushed · rebased onto main'],
      ['3', 'r3', 'Force-pushed'],
      ['2', 'r2', 'Pushed'],
      ['1', 'r1', 'No longer on GitHub'],
      ['b', 'base', 'main'],
    ]);
    expect(rows[0]).toMatchObject({
      meta: `ravi-k · 40 min ago · 5555555`,
      tags: [{ label: 'Latest', kind: 'newest' }],
    });
    expect(rows[1]).toMatchObject({
      forced: true,
      meta: `ravi-k · 6 hours ago or earlier · 4444444`,
      tags: [{ label: 'Last opened', kind: 'seen' }],
    });
    expect(rows[3]?.tags).toEqual([{ label: 'Your review', kind: 'review' }]);
    expect(rows[4]).toMatchObject({ disabled: true, forced: false });
    expect(rows[5]).toMatchObject({ key: BASE, meta: 'at bbbbbbb', base: true });
  });

  it('shows a commit a review was on, but no push made the head, without a number', () => {
    const rows = rowsOf(view({ revisions: [revision('2', null), revision('5', 1)] }), NOW);
    expect(rows.map((row) => [row.label, row.line])).toEqual([
      ['r1', 'Pushed'],
      ['', 'Reviewed, never pushed'],
      ['base', 'main'],
    ]);
  });

  it('marks the revision the overview describes', () => {
    const rows = rowsOf(view(), NOW, { overview: head('3') });
    expect(rows[2]?.tags).toEqual([{ label: 'Overview', kind: 'overview' }]);
    expect(rows.filter((row) => row.tags?.some((tag) => tag.kind === 'overview'))).toHaveLength(1);
    // Beside the other markers on the same revision.
    expect(rowsOf(view(), NOW, { overview: head('5') })[0]?.tags).toEqual([
      { label: 'Latest', kind: 'newest' },
      { label: 'Overview', kind: 'overview' },
    ]);
    expect(overviewNote(view(), { overview: head('3') })).toBeUndefined();
  });

  it('names an overview’s commit that’s no revision’s head by its short id', () => {
    const marks = { overview: head('c') };
    expect(
      rowsOf(view(), NOW, marks).some((row) => row.tags?.some((tag) => tag.kind === 'overview')),
    ).toBe(false);
    expect(overviewNote(view(), marks)).toBe(
      'The overview was written for `ccccccc`, a commit inside a revision.',
    );
    // Not before the revisions are read, nor with no overview.
    expect(overviewNote(view({ status: 'loading', revisions: [] }), marks)).toBeUndefined();
    expect(overviewNote(view(), {})).toBeUndefined();
  });

  it('moves between rows, stopping at either end', () => {
    const rows = rowsOf(view(), NOW);
    expect(moved(rows, head('5'), 1)).toBe(head('4'));
    expect(moved(rows, head('5'), -1)).toBe(head('5'));
    expect(moved(rows, BASE, 1)).toBe(BASE);
    expect(moved(rows, undefined, 1)).toBe(head('5'));
  });

  it('makes a row the nearer end, never one that’s no longer available, nor the base the newer', () => {
    const rows = rowsOf(view(), NOW);
    const ends = endsOf({ from: null, to: head('5') });
    expect(ends).toEqual({ from: BASE, to: head('5') });
    // Nearer the base than r5: it's the older end.
    expect(withEnd(rows, ends, head('2'))).toEqual({ from: head('2'), to: head('5') });
    // Nearer r5: the newer.
    expect(withEnd(rows, ends, head('4'))).toEqual({ from: BASE, to: head('4') });
    // Newer or older than both ends.
    expect(withEnd(rows, { from: head('3'), to: head('4') }, head('5'))).toEqual({
      from: head('3'),
      to: head('5'),
    });
    expect(withEnd(rows, { from: head('3'), to: head('4') }, head('2'))).toEqual({
      from: head('2'),
      to: head('4'),
    });
    expect(withEnd(rows, ends, head('1'))).toBe(ends);
    expect(withEnd(rows, ends, head('5'))).toBe(ends);
  });

  it('offers to compare since each marker, and the whole pull request, up to the head on screen', () => {
    const shown = view();
    expect(shortcutsOf(shown)).toEqual({
      review: { from: head('2'), to: head('5') },
      seen: { from: head('4'), to: head('5') },
      whole: { from: null, to: head('5') },
    });
    expect(shortcutRows(shown, { review: ['r'], seen: ['s'], whole: ['w'] })).toEqual([
      { id: 'review', label: 'Since your review · r2 → r5', keys: ['r'], pressed: false },
      { id: 'seen', label: 'Since last opened · r4 → r5', keys: ['s'], pressed: true },
      { id: 'whole', label: 'Whole pull request · base → r5', keys: ['w'], pressed: false },
    ]);
    // A marker on the head on screen, or on a revision that's gone, offers nothing.
    expect(
      shortcutsOf(view({ markers: { review: head('1'), lastSeen: head('5') } })),
    ).toMatchObject({ review: undefined, seen: undefined });
  });
});

describe('the note over the diff', () => {
  it('names the layers of a run, or the pull request when GitHub couldn’t compare it as one diff', () => {
    expect(runNoteOf([83, 84], false)).toEqual({
      tone: 'plain',
      text: '#83 → #84 · every change',
    });
    expect(runNoteOf([82, 83, 84], false).text).toBe('#82 → #84 · every change');
    // The diff shows only the top layer's pull request then, which is what the note says.
    expect(runNoteOf([83, 84], true).text).toBe('Whole pull request');
  });

  it('says what’s compared, and why it starts where it does', () => {
    expect(noteOf(view())).toEqual({ tone: 'plain', text: 'r4 → r5 · since last opened' });
    expect(noteOf(view({ comparison: { from: head('2'), to: head('5') } })).text).toBe(
      'r2 → r5 · since your review',
    );
    expect(noteOf(view({ comparison: { from: head('3'), to: head('5') } })).text).toBe('r3 → r5');
    expect(noteOf(view({ comparison: { from: null, to: head('5') } })).text).toBe(
      'base → r5 · whole pull request',
    );
    expect(noteOf(undefined).text).toBe('Whole pull request');
  });

  it('says when nothing is new, and what a comparison across a rebase shows', () => {
    expect(
      noteOf(view({ comparison: { from: null, to: head('5') }, nothingNewSince: head('5') })),
    ).toEqual({ tone: 'info', text: 'base → r5 · whole pull request · no change since r5' });
    expect(noteOf(view({ replay: 'clean' })).text).toBe(
      'r4 → r5 · since last opened · across a rebase · the author’s changes only',
    );
    expect(noteOf(view({ replay: 'conflicted', conflicted: 2 }))).toEqual({
      tone: 'warn',
      text: 'r4 → r5 · since last opened · 2 files conflicted in the rebase · includes the base branch’s changes',
    });
    expect(noteOf(view({ replay: 'retargeted' })).tone).toBe('warn');
    const gone = { kind: 'gone', head: head('2') } as const;
    const compare = { kind: 'compare', from: head('2'), to: head('5'), why: gone } as const;
    expect(noteOf(view({ problem: compare }))).toEqual({
      tone: 'warn',
      text: 'r4 → r5 · since last opened · Couldn’t compare r2 → r5 · r2’s commit is no longer on GitHub.',
    });
  });

  it('offers a comparison that came too late to be drawn first, whose key is the chip beside it', () => {
    expect(
      noteOf(
        view({
          comparison: { from: null, to: head('5') },
          offered: { from: head('4'), to: head('5') },
        }),
      ),
    ).toEqual({
      tone: 'info',
      text: 'base → r5 · whole pull request · r4 → r5 since last opened',
    });
    expect(
      noteOf(
        view({
          comparison: { from: null, to: head('5') },
          offered: { from: head('2'), to: head('5') },
        }),
      ).text,
    ).toBe('base → r5 · whole pull request · r2 → r5 since your review');
  });

  it('says what it waits for', () => {
    expect(
      noteOf(view({ comparison: null, pending: { from: head('4'), to: head('5') } })).text,
    ).toBe('Comparing r4 → r5…');
    expect(
      noteOf(
        view({
          comparison: { from: null, to: head('5') },
          pending: { from: head('2'), to: head('5') },
        }),
      ).text,
    ).toBe('base → r5 · whole pull request · comparing r2 → r5…');
  });
});

describe('labels', () => {
  it('names revisions by number, and the base as such', () => {
    expect(comparisonLabel(view(), { from: null, to: head('3') })).toBe('base → r3');
    expect(comparisonLabel(view(), { from: head('9'), to: head('3') })).toBe('9999999 → r3');
  });

  it('says how long ago in words', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('just now');
    expect(ago(NOW - 40 * MINUTE, NOW)).toBe('40 min ago');
    expect(ago(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago');
    expect(ago(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe('3 days ago');
  });
});
