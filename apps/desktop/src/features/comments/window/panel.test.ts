// The threads panel's words when it lists nothing; which revision's diff shows a thread the diff
// on screen doesn't, or why none can; and how `⏎` shows a thread, the last one asked for winning.

import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../../revisions/contract.ts';
import type { ThreadRow, ThreadsView } from '../contract.ts';
import { comparisonFor, emptyText, planShow } from './panel.ts';

const FIRST = 'f'.repeat(40);
const SECOND = 's'.repeat(40);
const HEAD = 'h'.repeat(40);

function revision(head: string, number: number, available = true): RevisionRow {
  return {
    head,
    number,
    pushedAt: { kind: 'unknown' },
    forced: false,
    pusher: 'rozed-bot',
    rebased: false,
    available,
  };
}

function revisions(overrides: Partial<ComparisonView> = {}): ComparisonView {
  return {
    id: 'tab',
    status: 'ready',
    revisions: [revision(FIRST, 1), revision(SECOND, 2), revision(HEAD, 3)],
    base: { branch: 'main', tip: null },
    markers: { review: null, lastSeen: null },
    shown: HEAD,
    comparison: null,
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
    ...overrides,
  };
}

function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 'T',
    path: 'src/backoff.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: null,
    startLine: null,
    originalLine: 9,
    originalStartLine: null,
    outdated: true,
    resolved: false,
    currentOn: FIRST,
    writtenOn: FIRST,
    comments: [],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

describe('a thread the diff on screen doesn’t show', () => {
  it('shows in the whole diff of the revision it was written on, if it’s outdated', () => {
    expect(comparisonFor(row(), revisions())).toEqual({ head: FIRST, label: 'r1' });
  });

  it('shows in the whole diff of the revision it’s on, if it isn’t', () => {
    const between = revisions({ comparison: { from: FIRST, to: HEAD } });
    const current = row({ outdated: false, line: 9, currentOn: HEAD, writtenOn: FIRST });
    expect(comparisonFor(current, between)).toEqual({ head: HEAD, label: 'r3' });
  });

  it('says why when no revision’s diff can show it', () => {
    const why = comparisonFor;
    expect(why(row({ writtenOn: null }), revisions())).toEqual({
      why: 'GitHub no longer has the commit this thread is on.',
    });
    expect(why(row(), undefined)).toEqual({
      why: 'Lo hasn’t read the pull request’s revisions yet.',
    });
    expect(why(row(), revisions({ status: 'failed', problem: 'GitHub returned 502.' }))).toEqual({
      why: 'GitHub returned 502.',
    });
    expect(why(row({ writtenOn: 'c'.repeat(40) }), revisions())).toEqual({
      why: 'This thread is on a commit that isn’t one of the pull request’s pushes.',
    });
    const gone = revisions({ revisions: [revision(FIRST, 1, false), revision(HEAD, 2)] });
    expect(why(row(), gone)).toEqual({ why: 'GitHub no longer has r1, so Lo can’t show it.' });
  });
});

describe('⏎ on a thread', () => {
  const whole = { from: null, to: HEAD };
  const first = { from: null, to: FIRST };
  const outdated = row();

  it('shows one the diff on screen shows there', () => {
    expect(planShow(outdated, true, revisions())).toEqual({ kind: 'here' });
    // Before the revisions are read, too.
    expect(planShow(outdated, true, undefined)).toEqual({ kind: 'here' });
  });

  it('compares the revision one is on, for one the diff on screen doesn’t show', () => {
    expect(planShow(outdated, false, revisions())).toEqual({
      kind: 'compare',
      compared: first,
      label: 'r1',
    });
    // That revision's whole diff on screen doesn't show it either.
    expect(planShow(outdated, false, revisions({ comparison: first }))).toEqual({
      kind: 'why',
      why: 'This thread’s lines aren’t in the diff on screen.',
    });
    expect(planShow(row({ writtenOn: null }), false, revisions())).toEqual({
      kind: 'why',
      why: 'GitHub no longer has the commit this thread is on.',
    });
  });

  it('shows the last thread asked for, calling off a comparison an earlier one asked for', () => {
    // `⏎` on the outdated thread asked for r1's whole diff, which hasn't come yet.
    const coming = revisions({ comparison: whole, pending: first });
    // Then `⏎` on a thread the diff on screen shows: it stays, and r1 is called off.
    expect(planShow(row({ outdated: false, line: 15 }), true, coming)).toEqual({
      kind: 'callOff',
      compared: whole,
    });
    // Or on another on r1: it shows once r1 comes.
    expect(planShow(row({ id: 'T2' }), false, coming)).toEqual({ kind: 'coming' });
    // Or on one on r2: r2's whole diff takes r1's place.
    expect(planShow(row({ writtenOn: SECOND }), false, coming)).toEqual({
      kind: 'compare',
      compared: { from: null, to: SECOND },
      label: 'r2',
    });
  });
});

/** What main sends of a view's threads when it has none: as `status` says, and why. */
function emptyView(status: ThreadsView['status'], problem: string | null = null): ThreadsView {
  return { id: 'tab', status, threads: [], missing: 0, compared: null, problem };
}

describe('the panel with nothing to list', () => {
  it('says why: reading, a run, signed out or a failed read', () => {
    expect(emptyText(undefined, 'unresolved')).toBe('Reading the review threads…');
    expect(emptyText(emptyView('loading'), 'unresolved')).toBe('Reading the review threads…');
    expect(emptyText(emptyView('run'), 'all')).toBe(
      'A run has no threads. Show one of its layers to see them.',
    );
    expect(emptyText(emptyView('signIn'), 'all')).toBe('Sign in to see comments.');
    expect(emptyText(emptyView('failed', 'GitHub can’t be reached.'), 'all')).toBe(
      'The review threads didn’t load. GitHub can’t be reached.',
    );
  });

  it('says what the filter found none of', () => {
    expect(emptyText(emptyView('ready'), 'unresolved')).toBe('No unresolved threads.');
    expect(emptyText(emptyView('ready'), 'all')).toBe('No review threads yet.');
    expect(emptyText(emptyView('ready'), 'yours')).toBe(
      'You haven’t started or replied in a thread.',
    );
  });
});
