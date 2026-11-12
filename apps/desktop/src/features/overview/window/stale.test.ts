// What an overview written for an older push says: when it's out of date, its banner's words as
// what changed since comes in, and each code block's flag for the lines that changed, revisions
// named by their labels and other commits by their short ids.

import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../../revisions/contract.ts';
import {
  compareState,
  flagWords,
  labelOf,
  pushesSince,
  staleAgainst,
  staleWords,
} from './stale.ts';

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

describe('labelOf and pushesSince', () => {
  it('names a revision by its label, and any other commit by its short id', () => {
    expect(labelOf(view, R2)).toBe('r2');
    expect(labelOf(view, OTHER)).toBe('abcdef0');
    expect(labelOf(undefined, R2)).toBe('2222222');
  });

  it('counts the pushes between two revisions, not a commit reviewed but never pushed', () => {
    expect(pushesSince(view, R1, R3)).toBe(2);
    expect(pushesSince(view, R2, R3)).toBe(1);
    expect(pushesSince(view, R3, R1)).toBeUndefined();
    expect(pushesSince(view, 'f'.repeat(40), R3)).toBeUndefined();
    expect(pushesSince(undefined, R1, R3)).toBeUndefined();
  });
});

describe('compareState', () => {
  it('compares two revisions, the older first', () => {
    expect(compareState(view, R1, R3)).toEqual({ ok: true });
  });

  it('says why it can’t compare', () => {
    expect(compareState(undefined, R1, R3)).toEqual({
      ok: false,
      why: 'Lo is still reading the revisions.',
    });
    expect(compareState({ ...view, status: 'signIn' }, R1, R3)).toEqual({
      ok: false,
      why: 'Revisions show only for a signed-in account.',
    });
    expect(
      compareState({ ...view, status: 'failed', problem: 'GitHub said 502.' }, R1, R3),
    ).toEqual({ ok: false, why: 'GitHub said 502.' });
    expect(compareState({ ...view, waitingFor: 'git' }, R1, R3)).toEqual({
      ok: false,
      why: 'Comparing revisions needs git, which Lo can’t find.',
    });
    expect(compareState(view, 'f'.repeat(40), R3)).toEqual({
      ok: false,
      why: 'The overview’s commit isn’t one of the revisions.',
    });
    const gone = viewOf([{ ...revision(R1, 1), available: false }, revision(R2, 2)]);
    expect(compareState(gone, R1, R2)).toEqual({ ok: false, why: 'r1 is no longer available.' });
  });
});

describe('staleWords', () => {
  it('says what it was written for and where the pull request is, from the first frame', () => {
    expect(staleWords({ written: 'r3', now: 'r5' })).toEqual({
      title: 'Written for r3. The PR is at r5.',
      detail: '',
    });
    expect(staleWords({ written: 'abcdef0', now: 'r5' }).title).toBe(
      'Written for abcdef0. The PR is at r5.',
    );
  });

  it('fills in the pushes, files and blocks since as each comes', () => {
    expect(staleWords({ written: 'r3', now: 'r5', pushes: 2 }).detail).toBe('2 pushes since.');
    expect(staleWords({ written: 'r3', now: 'r5', pushes: 2, files: 5 }).detail).toBe(
      '2 pushes since, touching 5 files.',
    );
    expect(staleWords({ written: 'r3', now: 'r5', pushes: 2, files: 5, blocks: 1 }).detail).toBe(
      '2 pushes since, touching 5 files. 1 code block below points at lines that changed.',
    );
    expect(staleWords({ written: 'r4', now: 'r5', pushes: 1, files: 1, blocks: 3 }).detail).toBe(
      '1 push since, touching 1 file. 3 code blocks below point at lines that changed.',
    );
    expect(staleWords({ written: 'r4', now: 'r5', pushes: 1, files: 0, blocks: 0 }).detail).toBe(
      '1 push since, touching no files. No code block below points at lines that changed.',
    );
  });

  it('counts files alone for a commit that isn’t a revision, and leaves out what it can’t count', () => {
    expect(staleWords({ written: 'abcdef0', now: 'r5', files: 5 }).detail).toBe(
      '5 files changed since.',
    );
    expect(staleWords({ written: 'abcdef0', now: 'r5', files: 1 }).detail).toBe(
      '1 file changed since.',
    );
    expect(staleWords({ written: 'r3', now: 'r5', pushes: 2, files: null }).detail).toBe(
      '2 pushes since.',
    );
  });
});

const labels = { written: 'r3', now: 'r5' };

/** The flag for `changed`, lines that changed between r3 and r5. */
function lines(changed: { from: number; to: number }[]): string | undefined {
  return flagWords({ kind: 'lines', changed, added: [], addedLines: 0 }, labels);
}

describe('flagWords', () => {
  const shows = 'This block shows r3, which the text describes.';

  it('names the lines that changed', () => {
    expect(lines([{ from: 48, to: 48 }])).toBe(`Line 48 changed in r5. ${shows}`);
    expect(
      lines([
        { from: 48, to: 48 },
        { from: 50, to: 50 },
      ]),
    ).toBe(`Lines 48 and 50 changed in r5. ${shows}`);
    expect(
      lines([
        { from: 46, to: 48 },
        { from: 50, to: 50 },
        { from: 52, to: 53 },
      ]),
    ).toBe(`Lines 46–48, 50 and 52–53 changed in r5. ${shows}`);
    expect(
      lines([
        { from: 1, to: 1 },
        { from: 3, to: 4 },
        { from: 6, to: 6 },
        { from: 8, to: 8 },
        { from: 10, to: 12 },
      ]),
    ).toBe(`8 of its lines changed in r5. ${shows}`);
  });

  it('says where lines were added inside the block', () => {
    expect(
      flagWords(
        { kind: 'lines', changed: [{ from: 7, to: 7 }], added: [8], addedLines: 1 },
        { written: 'r1', now: 'r2' },
      ),
    ).toBe(
      'Line 7 changed in r2, and a line was added after line 8. This block shows r1, which the text describes.',
    );
    expect(flagWords({ kind: 'lines', changed: [], added: [8, 12], addedLines: 4 }, labels)).toBe(
      `Lines were added after lines 8 and 12 in r5. ${shows}`,
    );
    expect(
      flagWords({ kind: 'lines', changed: [], added: [1, 2, 3, 4, 5], addedLines: 5 }, labels),
    ).toBe(`Lines were added in 5 places in r5. ${shows}`);
  });

  it('says a file was deleted, or changed in a way Lo can’t compare', () => {
    expect(flagWords({ kind: 'deleted' }, labels)).toBe(`This file was deleted in r5. ${shows}`);
    expect(flagWords({ kind: 'opaque' }, labels)).toBe(
      `This file changed in r5, and Lo can’t tell which lines. ${shows}`,
    );
  });

  it('says nothing when no line it shows changed', () => {
    expect(flagWords({ kind: 'none' }, labels)).toBeUndefined();
  });

  it('names a commit that isn’t a revision by its short id', () => {
    expect(flagWords({ kind: 'deleted' }, { written: 'abcdef0', now: 'r5' })).toBe(
      'This file was deleted in r5. This block shows abcdef0, which the text describes.',
    );
  });
});
