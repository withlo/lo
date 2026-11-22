// The threads panel's words when it lists nothing; which revision's diff shows a thread the diff
// on screen doesn't, or why none can; and how `⏎` shows a thread, the last one asked for winning.

import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../../revisions/contract.ts';
import type { ThreadRow, ThreadsView } from '../contract.ts';
import { comparisonFor, emptyOf, GONE, planShow, threadIn } from './panel.ts';

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
      why: 'This thread’s commit is no longer on GitHub',
    });
    expect(why(row(), undefined)).toEqual({ why: 'Reading revisions…' });
    expect(why(row(), revisions({ status: 'failed', problem: 'GitHub returned 502.' }))).toEqual({
      why: 'GitHub returned 502.',
    });
    expect(why(row({ writtenOn: 'c'.repeat(40) }), revisions())).toEqual({
      why: 'This thread’s commit isn’t a revision',
    });
    const gone = revisions({ revisions: [revision(FIRST, 1, false), revision(HEAD, 2)] });
    expect(why(row(), gone)).toEqual({ why: 'r1 is no longer on GitHub' });
  });
});

describe('⏎ on a thread', () => {
  const whole = { from: null, to: HEAD };
  const first = { from: null, to: FIRST };
  const outdated = row();

  it('shows one the diff on screen shows there', () => {
    expect(planShow(outdated, true, revisions(), undefined)).toEqual({ kind: 'here' });
    // Before the revisions are read, too.
    expect(planShow(outdated, true, undefined, undefined)).toEqual({ kind: 'here' });
  });

  it('compares the revision one is on, for one the diff on screen doesn’t show', () => {
    expect(planShow(outdated, false, revisions(), undefined)).toEqual({
      kind: 'compare',
      compared: first,
      label: 'r1',
    });
    // That revision's whole diff on screen doesn't show it either.
    expect(planShow(outdated, false, revisions({ comparison: first }), undefined)).toEqual({
      kind: 'why',
      why: 'This thread’s lines aren’t in this diff',
    });
    expect(planShow(row({ writtenOn: null }), false, revisions(), undefined)).toEqual({
      kind: 'why',
      why: 'This thread’s commit is no longer on GitHub',
    });
  });

  it('shows the last thread asked for, calling off a comparison an earlier one asked for', () => {
    // `⏎` on the outdated thread asked for r1's whole diff, which hasn't come yet.
    const known = revisions({ comparison: whole });
    // Then `⏎` on a thread the diff on screen shows: it stays, and r1 is called off.
    expect(planShow(row({ outdated: false, line: 15 }), true, known, first)).toEqual({
      kind: 'callOff',
      compared: whole,
    });
    // Or on another on r1: it shows once r1 comes.
    expect(planShow(row({ id: 'T2' }), false, known, first)).toEqual({ kind: 'coming' });
    // Or on one on r2: r2's whole diff takes r1's place.
    expect(planShow(row({ writtenOn: SECOND }), false, known, first)).toEqual({
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
    expect(emptyOf(undefined, 'unresolved')).toEqual({ kind: 'reading' });
    expect(emptyOf(emptyView('loading'), 'unresolved')).toEqual({ kind: 'reading' });
    expect(emptyOf(emptyView('run'), 'all', [83, 84, 85])).toEqual({
      kind: 'none',
      heading: 'No threads for these 3 layers',
      line: 'Each layer has its own.',
      action: 'stacks.back',
    });
    expect(emptyOf(emptyView('signIn'), 'all')).toEqual({
      kind: 'none',
      heading: 'Sign in to see threads',
      action: 'accounts.addAccount',
    });
    expect(emptyOf(emptyView('failed', 'Offline.'), 'all')).toEqual({
      kind: 'failed',
      reason: 'Offline.',
    });
  });

  it('says what the filter found none of, as a heading', () => {
    expect(emptyOf(emptyView('ready'), 'unresolved')).toEqual({
      kind: 'none',
      heading: 'No unresolved threads',
    });
    expect(emptyOf(emptyView('ready'), 'all')).toEqual({ kind: 'none', heading: 'No threads yet' });
    expect(emptyOf(emptyView('ready'), 'yours')).toEqual({
      kind: 'none',
      heading: 'No threads of yours',
    });
  });
});

/** Main's threads for a pull request, ready, with these rows. */
const threads = (...rows: ThreadRow[]): ThreadsView => ({
  id: 'tab',
  status: 'ready',
  threads: rows,
  missing: 0,
  compared: null,
  problem: null,
});

describe('a row whose thread main no longer holds', () => {
  it('is the thread, while main holds it', () => {
    const held = row({ id: 'T1' });
    expect(threadIn(threads(held, row({ id: 'T2' })), 'T1')).toBe(held);
  });

  it('says what’s true of one that has just gone, rather than nothing or what isn’t', () => {
    expect(threadIn(threads(row({ id: 'T2' })), 'T1')).toBe(GONE);
    expect(threadIn(undefined, 'T1')).toBe(GONE);
    expect(GONE).toBe('That thread was deleted elsewhere');
  });
});
