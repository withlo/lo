// What an overview written for an older push says: when it's out of date, its banner's words as
// what changed since comes in, and each code block's flag for the lines that changed, revisions
// named by their labels and other commits by their short ids.

import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../../revisions/contract.ts';
import { compareState, flagWords, labelOf, staleAgainst, staleWords } from './stale.ts';

const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);
const R3 = '3'.repeat(40);
const OTHER = 'abcdef0'.padEnd(40, '9');

function revision(head: string, number: number | null): RevisionRow {
  return {
    head,
    number,
    pushedAt: { kind: 'unknown' },
    forced: false,
    pusher: null,
    rebased: false,
    available: true,
  };
}

function viewOf(revisions: RevisionRow[]): ComparisonView {
  return {
    id: 't1',
    status: 'ready',
    revisions,
    base: null,
    markers: { review: null, lastSeen: null },
    shown: null,
    comparison: null,
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
  };
}

const view = viewOf([revision(R1, 1), revision(OTHER, null), revision(R2, 2), revision(R3, 3)]);

describe('staleAgainst', () => {
  it('is out of date against the head on screen when it describes another commit', () => {
    expect(staleAgainst(R1, { shown: R3, newer: null })).toBe(R3);
    expect(staleAgainst(R3, { shown: R3, newer: null })).toBeUndefined();
    expect(staleAgainst(R1, { shown: null, newer: null })).toBeUndefined();
    expect(staleAgainst(R1, undefined)).toBeUndefined();
  });

  it('isn’t out of date for a newer push that isn’t loaded, which it describes', () => {
    expect(staleAgainst(R3, { shown: R2, newer: R3 })).toBeUndefined();
    // An older one is, against what's on screen.
    expect(staleAgainst(R1, { shown: R2, newer: R3 })).toBe(R2);
  });
});

describe('labelOf', () => {
  it('names a revision by its label, and any other commit by its short id', () => {
    expect(labelOf(view, R2)).toBe('r2');
    expect(labelOf(view, OTHER)).toBe('abcdef0');
    expect(labelOf(undefined, R2)).toBe('2222222');
  });
});

describe('compareState', () => {
  it('compares two revisions, the older first', () => {
    expect(compareState(view, R1, R3)).toEqual({ ok: true });
  });

  it('says why it can’t compare', () => {
    expect(compareState(undefined, R1, R3)).toEqual({ ok: false, why: 'Reading revisions…' });
    expect(compareState({ ...view, status: 'signIn' }, R1, R3)).toEqual({
      ok: false,
      why: 'Sign in to compare revisions',
    });
    expect(
      compareState(
        { ...view, status: 'failed', problem: { kind: 'read', cause: { kind: 'github' } } },
        R1,
        R3,
      ),
    ).toEqual({ ok: false, why: 'Couldn’t read the revisions' });
    expect(compareState({ ...view, waitingFor: 'git' }, R1, R3)).toEqual({
      ok: false,
      why: 'Can’t find Git',
    });
    expect(compareState(view, 'f'.repeat(40), R3)).toEqual({
      ok: false,
      why: 'This overview’s commit isn’t a revision',
    });
    const gone = viewOf([{ ...revision(R1, 1), available: false }, revision(R2, 2)]);
    expect(compareState(gone, R1, R2)).toEqual({ ok: false, why: 'r1 is no longer on GitHub' });
  });
});

describe('staleWords', () => {
  it('says what it was written for and where the pull request is, from the first frame', () => {
    expect(staleWords({ written: 'r3', now: 'r5' })).toEqual({
      title: 'Written for r3 · now r5',
      detail: '',
    });
    expect(staleWords({ written: 'abcdef0', now: 'r5' }).title).toBe(
      'Written for abcdef0 · now r5',
    );
  });

  it('fills in how many files changed once it’s known, and nothing when it can’t be', () => {
    expect(staleWords({ written: 'r3', now: 'r5', files: 5 }).detail).toBe('5 files changed');
    expect(staleWords({ written: 'r3', now: 'r5', files: 1 }).detail).toBe('1 file changed');
    expect(staleWords({ written: 'r3', now: 'r5', files: 0 }).detail).toBe('no files changed');
    expect(staleWords({ written: 'r3', now: 'r5', files: null }).detail).toBe('');
  });
});

const labels = { written: 'r3', now: 'r5' };

/** The flag for `changed`, lines that changed between r3 and r5. */
function lines(changed: { from: number; to: number }[]): string | undefined {
  return flagWords({ kind: 'lines', changed, added: [], addedLines: 0 }, labels);
}

describe('flagWords', () => {
  const shows = 'showing r3';

  it('names the lines that changed', () => {
    expect(lines([{ from: 48, to: 48 }])).toBe(`Line 48 changed in r5 · ${shows}`);
    expect(
      lines([
        { from: 48, to: 48 },
        { from: 50, to: 50 },
      ]),
    ).toBe(`Lines 48 and 50 changed in r5 · ${shows}`);
    expect(
      lines([
        { from: 46, to: 48 },
        { from: 50, to: 50 },
        { from: 52, to: 53 },
      ]),
    ).toBe(`Lines 46–48, 50 and 52–53 changed in r5 · ${shows}`);
    expect(
      lines([
        { from: 1, to: 1 },
        { from: 3, to: 4 },
        { from: 6, to: 6 },
        { from: 8, to: 8 },
        { from: 10, to: 12 },
      ]),
    ).toBe(`8 lines changed in r5 · ${shows}`);
  });

  it('says where lines were added inside the block', () => {
    expect(
      flagWords(
        { kind: 'lines', changed: [{ from: 7, to: 7 }], added: [8], addedLines: 1 },
        { written: 'r1', now: 'r2' },
      ),
    ).toBe('Line 7 changed in r2 · lines added after line 8 · showing r1');
    expect(flagWords({ kind: 'lines', changed: [], added: [12], addedLines: 1 }, labels)).toBe(
      `1 line added after line 12 in r5 · ${shows}`,
    );
    expect(flagWords({ kind: 'lines', changed: [], added: [8, 12], addedLines: 4 }, labels)).toBe(
      `Lines added after lines 8 and 12 in r5 · ${shows}`,
    );
    expect(
      flagWords({ kind: 'lines', changed: [], added: [1, 2, 3, 4, 5], addedLines: 5 }, labels),
    ).toBe(`Lines added in 5 places in r5 · ${shows}`);
  });

  it('says a file was deleted, or changed in a way that can’t be compared', () => {
    expect(flagWords({ kind: 'deleted' }, labels)).toBe(`Deleted in r5 · ${shows}`);
    expect(flagWords({ kind: 'opaque' }, labels)).toBe(`Changed in r5 · ${shows}`);
  });

  it('says nothing when no line it shows changed', () => {
    expect(flagWords({ kind: 'none' }, labels)).toBeUndefined();
  });

  it('names a commit that isn’t a revision by its short id', () => {
    expect(flagWords({ kind: 'deleted' }, { written: 'abcdef0', now: 'r5' })).toBe(
      'Deleted in r5 · showing abcdef0',
    );
  });
});
