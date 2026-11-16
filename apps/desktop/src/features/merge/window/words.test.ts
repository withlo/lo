// How the window words a merge status: the header's line for each kind, the panel's head and
// reasons, and the methods.

import { expect, test } from 'vitest';

import type { MergeState } from '../contract.ts';
import {
  ago,
  headerLine,
  methodNote,
  ordinal,
  panelHead,
  rowPage,
  rowsOf,
  shownMethod,
  steppedMethod,
} from './words.ts';

/** When the tests' statuses were read: now, so none is out of date unless a test says. */
const NOW = Date.now();

const PULL_PAGE = 'https://github.com/rozed-dev/e2e/pull/148';
const RUN = 'https://github.com/rozed-dev/e2e/actions/runs/1';

/** A pull request ready to squash into `main`, with `change`. */
function state(change: Partial<MergeState> = {}): MergeState {
  return {
    verdict: 'ready',
    position: null,
    blockers: [],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'merge', methods: ['MERGE', 'SQUASH', 'REBASE'], method: 'SQUASH' },
    picked: 'SQUASH',
    methods: { merge: true, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'main',
    queue: { required: false, method: null },
    approvedBy: [],
    checks: { passed: 0, total: 0 },
    url: PULL_PAGE,
    head: 'a'.repeat(40),
    readAt: NOW,
    stale: null,
    ...change,
  };
}

/** Blocked by `e4/gated`'s rules: a failed check, an approval from a code owner, a conversation. */
const GATED = state({
  verdict: 'blocked',
  base: 'e4/gated',
  action: { kind: 'notPossible', reason: 'blocked' },
  blockers: [
    { kind: 'check', check: { name: 'ci', state: 'failed', url: RUN } },
    { kind: 'conversations', unresolved: 1, cutShort: false },
    { kind: 'approvals', more: 1, codeOwners: [{ kind: 'user', login: 'rozed-bot' }] },
    { kind: 'check', check: { name: 'e2e', state: 'running', url: null } },
    { kind: 'check', check: { name: 'lint', state: 'running', url: null } },
  ],
});

const known = (value: MergeState) => headerLine({ kind: 'known', state: value });

test('the header says each kind in one line, and opens the panel while it can merge', () => {
  expect(known(state())).toEqual({
    kind: 'ready',
    verdict: 'Ready to merge',
    detail: 'Squash into main',
    title: undefined,
    opens: true,
  });
  expect(known(GATED)).toMatchObject({
    kind: 'blocked',
    verdict: 'Can’t merge',
    detail: '1 check failed · 1 unresolved · review required · 2 checks running',
  });
  expect(
    known(
      state({
        verdict: 'waiting',
        blockers: [
          { kind: 'approvals', more: 1, codeOwners: [] },
          { kind: 'check', check: { name: 'ci', state: 'running', url: null } },
        ],
      }),
    ),
  ).toMatchObject({
    kind: 'waiting',
    verdict: 'Can’t merge yet',
    detail: 'Review required · 1 check running',
  });
  expect(
    known(
      state({
        verdict: 'blocked',
        blockers: [{ kind: 'conflicts' }, { kind: 'draft' }],
      }),
    )?.detail,
  ).toBe('Conflicts · draft');
  expect(known(state({ verdict: 'queued', position: 3 }))).toMatchObject({
    kind: 'queued',
    verdict: 'Queued, 3rd',
    opens: true,
  });
  expect(
    known(
      state({
        verdict: 'waiting',
        autoMerge: { method: 'SQUASH', by: 'rozed-bot' },
        blockers: [{ kind: 'approvals', more: 1, codeOwners: [] }],
      }),
    ),
  ).toMatchObject({ kind: 'auto', verdict: 'Merges when ready', detail: 'Auto-merge on' });
  expect(known(state({ verdict: 'merged' }))).toMatchObject({ verdict: 'Merged', opens: false });
  expect(known(state({ verdict: 'closed' }))).toMatchObject({ verdict: 'Closed', opens: false });
  expect(
    known(
      state({
        action: { kind: 'enqueue', method: 'SQUASH' },
        queue: { required: true, method: 'SQUASH' },
      }),
    ),
  ).toMatchObject({ verdict: 'Ready for the queue', detail: 'through the queue for main' });
});

test('what may be missing is the hover, and nothing shows before the first read', () => {
  expect(known({ ...GATED, partial: true })?.title).toBe('Lo may not see every rule');
  expect(known(state({ incomplete: 'readAgain' }))?.title).toContain('left part of this out');
  expect(headerLine({ kind: 'loading' })).toBeUndefined();
  expect(headerLine({ kind: 'none', why: 'Sign in to see whether it can merge.' })).toBeUndefined();
  expect(headerLine({ kind: 'failed', why: 'GitHub answered 502' })).toMatchObject({
    title: 'GitHub answered 502',
    opens: false,
  });
});

test('a ready pull request GitHub may not have told all of never looks clean', () => {
  for (const unsure of [state({ incomplete: 'readAgain' }), state({ partial: true })]) {
    expect(known(unsure)).toMatchObject({
      kind: 'waiting',
      verdict: 'Ready to merge',
      detail: 'Lo may not see everything',
    });
    expect(panelHead(unsure).kind).toBe('waiting');
  }
});

test('a status Lo couldn’t read again, or hasn’t for long, says how old it is', () => {
  const failed = state({ stale: 'GitHub answered 502', readAt: NOW - 3 * 60_000 });
  expect(headerLine({ kind: 'known', state: failed }, NOW)).toMatchObject({
    kind: 'ready',
    detail: 'Squash into main · as of 3 min ago',
    title: 'Lo couldn’t check again: GitHub answered 502',
  });
  expect(rowsOf(failed, NOW).at(-1)).toMatchObject({
    key: 'stale',
    title: 'Lo couldn’t check again',
    detail: 'GitHub answered 502 What’s shown is as of 3 min ago.',
    inTheWay: false,
  });
  // Read five minutes ago it's current: the poller reads it again at most that often.
  expect(headerLine({ kind: 'known', state: state({ readAt: NOW - 5 * 60_000 }) }, NOW)).toEqual(
    known(state()),
  );
  const old = state({ verdict: 'queued', position: 1, readAt: NOW - 12 * 60_000 });
  expect(headerLine({ kind: 'known', state: old }, NOW)).toMatchObject({
    verdict: 'Queued, 1st',
    detail: 'as of 12 min ago',
    title: 'Lo hasn’t read this since 12 min ago.',
  });
  expect(rowsOf(old, NOW).at(-1)?.title).toBe('As of 12 min ago');
  // A merge stays merged.
  expect(
    headerLine({ kind: 'known', state: state({ verdict: 'merged', readAt: 0 }) }, NOW)?.detail,
  ).toBeUndefined();
  expect(
    [0, 59_000, 60_000, 2 * 3_600_000, 3 * 86_400_000].map((age) => ago(NOW - age, NOW)),
  ).toEqual(['a moment ago', 'a moment ago', '1 min ago', '2 hours ago', '3 days ago']);
});

test('the panel has a row for each reason, checks of a state together with their runs', () => {
  const rows = rowsOf(GATED);
  expect(rows.map((row) => [row.key, row.title])).toEqual([
    ['checks-failed', '1 required check failed'],
    ['conversations', '1 unresolved conversation'],
    ['approvals', 'Review required'],
    ['checks-running', '2 checks running'],
  ]);
  expect(rows[0]?.subs).toEqual([
    {
      key: '0',
      name: 'ci',
      note: 'failed',
      tone: 'fail',
      link: { label: 'Open the run ↗', url: RUN },
    },
  ]);
  expect(rows[1]?.nextThread).toBe(true);
  expect(rows[2]?.detail).toBe('1 more approval, and one from a code owner: @rozed-bot.');
  // `o` opens a reason's page, or its first check's run.
  expect(rows[0] && rowPage(rows[0])).toBe(RUN);
  expect(rows[3] && rowPage(rows[3])).toBeUndefined();
  expect(panelHead(GATED)).toEqual({
    kind: 'blocked',
    verdict: 'Can’t merge',
    into: true,
    after: '· 4 things in the way',
  });
});

test('rules Lo doesn’t check, and a block it may not see all of, are said and linked', () => {
  const rows = rowsOf({
    ...GATED,
    blockers: [{ kind: 'unexplained', url: PULL_PAGE }],
    unchecked: [{ kind: 'signatures' }, { kind: 'other', type: 'max_file_size' }],
  });
  expect(rows.map((row) => [row.title, row.detail])).toEqual([
    ['GitHub says no, and not why', 'Lo checked reviews, checks, conversations and rules.'],
    ['Commits must be signed', 'A rule on e4/gated, which Lo doesn’t check.'],
    ['A rule Lo doesn’t know: max_file_size', 'A rule on e4/gated, which Lo doesn’t check.'],
  ]);
  expect(rows[0]?.link).toEqual({ label: 'See it on GitHub ↗', url: PULL_PAGE });
  expect(rows.filter((row) => row.inTheWay)).toHaveLength(1);
  const partial = rowsOf({ ...GATED, partial: true });
  expect(partial.at(-1)).toMatchObject({ title: 'Lo may not see every rule', inTheWay: false });
});

test('the panel’s head says what it merges into and how it stands', () => {
  expect(panelHead(state({ approvedBy: ['jun-park'], checks: { passed: 12, total: 12 } }))).toEqual(
    {
      kind: 'ready',
      verdict: 'Ready to merge',
      into: true,
      after: '· approved by jun-park · 12 checks passed',
    },
  );
  expect(
    panelHead(
      state({
        verdict: 'waiting',
        autoMerge: { method: 'SQUASH', by: 'tess-okafor' },
        blockers: [{ kind: 'approvals', more: 1, codeOwners: [] }],
      }),
    ),
  ).toEqual({
    kind: 'auto',
    verdict: 'Merges when ready',
    into: false,
    after: 'Auto-merge on · squash · turned on by tess-okafor',
  });
  expect(
    panelHead(
      state({ action: { kind: 'enqueue', method: null }, queue: { required: true, method: null } }),
    ),
  ).toMatchObject({
    verdict: 'Ready for the queue',
    into: false,
    after: 'main merges through a queue',
  });
});

test('the methods step round those allowed, and say which are off', () => {
  const two = state({
    action: { kind: 'merge', methods: ['SQUASH', 'REBASE'], method: 'SQUASH' },
    methods: { merge: false, squash: true, rebase: true },
  });
  expect(shownMethod(two, undefined)).toBe('SQUASH');
  expect(steppedMethod(two, undefined, 1)).toBe('REBASE');
  expect(steppedMethod(two, 'REBASE', 1)).toBe('SQUASH');
  expect(steppedMethod(two, undefined, -1)).toBe('REBASE');
  // A method chosen that's no longer allowed falls back to the one picked first.
  expect(shownMethod(two, 'MERGE')).toBe('SQUASH');
  expect(methodNote(two)).toBe('Merge commits are off in this repo');
  expect(methodNote(state({ signedCommits: true }))).toBe(
    'main needs signed commits, so no rebase',
  );
  expect(methodNote(state())).toBeUndefined();
});

test('places in a queue read as ordinals', () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '101st',
  ]);
});
