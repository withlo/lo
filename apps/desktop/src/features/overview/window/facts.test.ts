// What a tab's overview is, as the window knows it, and what the view switch's mark and the status
// bar make of it.

import { parseArtifact, type CheckedArtifact } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import type { ComparisonView } from '../../revisions/contract.ts';
import type { PullView } from '../../tab/contract.ts';
import type { OverviewCommit, OverviewState } from '../contract.ts';
import type { CheckedOverview } from './checking.ts';
import {
  knownOf,
  markOf,
  markWords,
  newestHead,
  promptKindOf,
  revisionAt,
  standingOf,
  type Standing,
} from './facts.ts';

const HEAD = 'a'.repeat(40);
const NEWER = 'e'.repeat(40);

function commitOf(id = 'c'.repeat(40)): OverviewCommit {
  return {
    id,
    source: 'base',
    repository: { owner: 'o', name: 'r' },
    byline: { login: 'ravi-k', name: 'Ravi', at: 0 },
    entries: [],
    truncated: false,
    read: true,
  };
}

function stateOf(change: Partial<OverviewState> = {}): OverviewState {
  return {
    id: 't1',
    ref: 'refs/lo/pr/7',
    watching: true,
    found: 'unknown',
    overview: null,
    newer: null,
    saved: false,
    problem: null,
    code: 'waiting',
    ...change,
  };
}

const parsed = parseArtifact(
  `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n`,
);

function resultOf(commit: OverviewCommit, checked: CheckedArtifact): CheckedOverview {
  return {
    kind: 'checked',
    key: commit.id,
    commit,
    parsed,
    checked,
    figures: new Map(),
    coming: [],
    code: { kind: 'none' },
  };
}

const shown = (commit: OverviewCommit, header = HEAD): CheckedOverview =>
  resultOf(commit, {
    outcome: { kind: 'shown', header: { format: 1, pr: 7, commit: header }, code: [], figures: [] },
    findings: [],
  });

describe('what a tab’s overview is', () => {
  it('is being read until main says what the ref holds, and none when it holds none', () => {
    expect(standingOf(undefined, undefined)).toEqual({ kind: 'reading' });
    expect(standingOf(stateOf(), undefined)).toEqual({ kind: 'reading' });
    expect(standingOf(stateOf({ found: 'none' }), undefined)).toEqual({
      kind: 'none',
      notCommit: false,
    });
    expect(standingOf(stateOf({ found: 'notCommit' }), undefined)).toEqual({
      kind: 'none',
      notCommit: true,
    });
  });

  it('failed when the ref couldn’t be read and there’s nothing to show, but none still stands', () => {
    const problem = { kind: 'offline', message: 'down', retryAt: 5 } as const;
    expect(standingOf(stateOf({ problem }), undefined)).toEqual({ kind: 'failed', problem });
    expect(standingOf(stateOf({ problem, found: 'none' }), undefined).kind).toBe('none');
  });

  it('is being checked until the window has checked the commit on screen', () => {
    const commit = commitOf();
    expect(standingOf(stateOf({ found: 'commit', overview: commit }), undefined).kind).toBe(
      'checking',
    );
    // A result for the commit before is no word on this one.
    const before = shown(commitOf('d'.repeat(40)));
    expect(standingOf(stateOf({ found: 'commit', overview: commit }), before).kind).toBe(
      'checking',
    );
  });

  it('is what its check found once checked', () => {
    const commit = commitOf();
    const state = stateOf({ found: 'commit', overview: commit });
    expect(standingOf(state, shown(commit))).toMatchObject({
      kind: 'shown',
      header: { commit: HEAD },
    });
    expect(
      standingOf(state, resultOf(commit, { outcome: { kind: 'invalid' }, findings: [] })).kind,
    ).toBe('invalid');
    expect(
      standingOf(state, resultOf(commit, { outcome: { kind: 'newer', format: 3 }, findings: [] })),
    ).toMatchObject({ kind: 'newer', format: 3 });
    expect(
      standingOf(state, { kind: 'failed', key: 'k', commit, why: 'The port closed.' }),
    ).toMatchObject({ kind: 'unchecked', why: 'The port closed.' });
  });

  it('says whether it shows, for opening on it', () => {
    const commit = commitOf();
    expect(knownOf({ kind: 'reading' })).toBe('unknown');
    expect(knownOf({ kind: 'checking', commit })).toBe('unknown');
    expect(knownOf(standingOf(stateOf({ found: 'commit', overview: commit }), shown(commit)))).toBe(
      'shown',
    );
    expect(knownOf({ kind: 'none', notCommit: false })).toBe('other');
    // A check that failed is tried again, so it says nothing yet.
    expect(knownOf({ kind: 'unchecked', commit, why: 'Main moved on.' })).toBe('unknown');
    expect(knownOf({ kind: 'newer', commit, format: 2 })).toBe('other');
  });
});

/** A pull request's tab, as main says, at `shownHead`, with `newer` pushed since. */
function pull(shownHead: string, newer: string | null): PullView {
  return {
    id: 't1',
    loading: false,
    acting: null,
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: shownHead,
    newer,
  };
}

/** A revision Lo knows, at `head`, numbered `number`. */
function revision(head: string, number: number | null) {
  return {
    head,
    number,
    pushedAt: { kind: 'unknown' as const },
    forced: null,
    pusher: null,
    rebased: false,
    available: true,
  };
}

describe('the view switch’s mark', () => {
  const commit = commitOf();
  const state = stateOf({ found: 'commit', overview: commit });

  it('is none while Lo finds out, a ring when there’s none, and red when it can’t be shown', () => {
    expect(markOf({ kind: 'reading' }, undefined)).toBeUndefined();
    expect(markOf({ kind: 'checking', commit }, undefined)).toBeUndefined();
    expect(markOf({ kind: 'none', notCommit: false }, undefined)).toBe('none');
    expect(markOf({ kind: 'newer', commit, format: 2 }, undefined)).toBe('error');
  });

  it('is current for the newest push, and stale once a push comes after the one it describes', () => {
    const standing: Standing = standingOf(state, shown(commit));
    expect(markOf(standing, newestHead(pull(HEAD, null)))).toBe('current');
    expect(markOf(standing, newestHead(pull(HEAD, NEWER)))).toBe('stale');
    expect(markOf(standing, newestHead(pull(NEWER, null)))).toBe('stale');
    expect(markWords('stale')).toBe('Overview, out of date');
    expect(markWords('none')).toBe('No overview yet');
  });
});

describe('the prompt each overview offers, and its revisions', () => {
  it('writes, updates, fixes or shrinks, and has none for the rest', () => {
    const commit = commitOf();
    expect(promptKindOf({ kind: 'none', notCommit: false })).toBe('write');
    expect(
      promptKindOf(standingOf(stateOf({ found: 'commit', overview: commit }), shown(commit))),
    ).toBe('update');
    expect(promptKindOf({ kind: 'invalid', commit, findings: [] })).toBe('fix');
    expect(
      promptKindOf({
        kind: 'tooLarge',
        commit,
        what: 'bytes',
        sizes: { bytes: 1, entries: 1, kinds: [] },
      }),
    ).toBe('shrink');
    expect(promptKindOf({ kind: 'newer', commit, format: 2 })).toBeUndefined();
    expect(promptKindOf({ kind: 'reading' })).toBeUndefined();
  });

  it('labels a revision by its number, and no commit that isn’t a revision’s head', () => {
    const view: ComparisonView = {
      id: 't1',
      status: 'ready',
      revisions: [revision(HEAD, 1), revision(NEWER, null)],
      base: null,
      markers: { review: null, lastSeen: null },
      shown: NEWER,
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
    expect(revisionAt(view, HEAD)).toEqual({ head: HEAD, number: 1 });
    expect(revisionAt(view, NEWER)).toEqual({ head: NEWER, number: undefined });
    expect(revisionAt(view, 'f'.repeat(40))).toBeUndefined();
    expect(revisionAt(undefined, HEAD)).toBeUndefined();
  });
});
