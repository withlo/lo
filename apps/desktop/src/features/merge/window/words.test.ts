// How the window words a merge status: the header's line for each kind, the panel's head and
// reasons, and the methods.

import { expect, test } from 'vitest';

import type { JobView, MergeState, QueuePlace } from '../contract.ts';
import {
  ago,
  cantMerge,
  doneLine,
  duration,
  headerLine,
  methodNote,
  ordinal,
  outcomeDetail,
  outcomeTitle,
  panelHead,
  rowPage,
  rowsOf,
  shownMethod,
  skipsOf,
  steppedMethod,
  type Said,
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
    auto: { kind: 'notPossible', reason: 'ready' },
    override: { kind: 'notPossible', reason: 'nothingToSkip' },
    afterPush: 'noReview',
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
    off: null,
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

test('a queued pull request’s place, as Lo last read its queue, says when it should merge, or that it will be removed', () => {
  const queued = { kind: 'known', state: state({ verdict: 'queued', position: 2 }) } as const;
  expect(headerLine(queued, NOW)).toMatchObject({ verdict: 'Queued, 2nd', detail: undefined });
  const place = {
    kind: 'listed',
    position: 3,
    state: 'AWAITING_CHECKS',
    timeToMerge: 720,
    failed: [],
    partial: false,
  } satisfies QueuePlace;
  expect(headerLine(queued, NOW, { place, left: null })).toMatchObject({
    kind: 'queued',
    verdict: 'Queued, 3rd',
    detail: 'about 12 min',
    opens: true,
  });
  expect(
    headerLine(queued, NOW, { place: { ...place, timeToMerge: null }, left: null }),
  ).toMatchObject({ verdict: 'Queued, 3rd', detail: undefined });
  const failed = { ...place, state: 'UNMERGEABLE', timeToMerge: null } satisfies QueuePlace;
  expect(
    headerLine(queued, NOW, {
      place: { ...failed, failed: [{ name: 'ci', state: 'failed', url: RUN }] },
      left: null,
    }),
  ).toMatchObject({
    kind: 'blocked',
    verdict: 'Will be removed',
    detail: 'ci failed in the queue',
  });
  expect(headerLine(queued, NOW, { place: failed, left: null })).toMatchObject({
    verdict: 'Will be removed',
    detail: 'from the merge queue',
  });
  // GitHub left part of the queue out: where Lo can't see it, GitHub's own read of its place stands.
  expect(
    headerLine(queued, NOW, { place: { kind: 'unlisted', partial: true }, left: null }),
  ).toMatchObject({ verdict: 'Queued, 2nd' });
  // The queue no longer lists it: it left, never the place it had, until its status says how.
  const gone = headerLine(queued, NOW, { place: { kind: 'unlisted', partial: false }, left: null });
  expect(gone).toMatchObject({ kind: 'waiting', verdict: 'Left the queue', detail: 'checking' });
  expect(gone?.title).toContain('Lo is reading whether it merged');
  // A failure in a queue GitHub left part of says more may have failed.
  expect(
    headerLine(queued, NOW, { place: { ...failed, partial: true }, left: null })?.title,
  ).toContain('more checks may have failed');
  // No longer queued, its queue's last read says nothing in the header.
  expect(headerLine({ kind: 'known', state: state() }, NOW, { place, left: null })).toMatchObject({
    verdict: 'Ready to merge',
  });
});

test('GitHub’s estimates read in minutes and hours', () => {
  expect([20, 720, 3600, 3900, 7200].map(duration)).toEqual([
    '1 min',
    '12 min',
    '1 h',
    '1 h 5 min',
    '2 h',
  ]);
});

test('merging is off, with why, offline, while GitHub asks Lo to hold off, signed out, or while it can’t merge', () => {
  expect(cantMerge(state(), 138)).toBeUndefined();
  expect(cantMerge(state({ off: { kind: 'offline' } }), 138)).toBe(
    'Offline. Merging waits until you’re back.',
  );
  const at = new Date(2026, 10, 16, 14, 5).getTime();
  expect(cantMerge(state({ off: { kind: 'paused', until: at } }), 138)).toBe(
    'GitHub asked Lo to hold off until 14:05. Merge then.',
  );
  expect(cantMerge(state({ off: { kind: 'signedOut' } }), 138)).toContain('signed out');
  expect(
    cantMerge(
      state({
        verdict: 'blocked',
        action: { kind: 'notPossible', reason: 'blocked' },
        blockers: [{ kind: 'draft' }],
      }),
      142,
    ),
  ).toBe('#142 can’t merge yet: draft.');
  expect(
    cantMerge(state({ verdict: 'closed', action: { kind: 'notPossible', reason: 'closed' } }), 9),
  ).toBe('#9 is closed.');
});

/** A merge of #138 into `main` that went, standing as `now`, with `change`. */
function job(now: JobView['state'], change: Partial<JobView> = {}): JobView {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 138,
    login: 'rozed-bot',
    kind: 'merge',
    method: 'SQUASH',
    base: 'main',
    head: 'a'.repeat(40),
    already: false,
    state: now,
    ...change,
  };
}

test('a merge that went says how it ended: done, refused, or not known', () => {
  expect(doneLine(job({ kind: 'merged' }))).toBe('Merged #138 into main');
  expect(doneLine(job({ kind: 'enqueued' }, { kind: 'enqueue', base: 'e4/queued' }))).toBe(
    'Added #138 to the merge queue for e4/queued',
  );
  expect(doneLine(job({ kind: 'pending', trouble: null }))).toBeUndefined();
  const refused = job({
    kind: 'refused',
    refusal: { kind: 'conflict', text: 'It conflicts.', rules: [], until: null, newer: null },
  });
  expect(outcomeTitle(refused)).toBe('Couldn’t merge #138.');
  expect(outcomeDetail(refused)).toBe('It conflicts.');
  const unknown = job(
    {
      kind: 'unknown',
      why: 'noAnswer',
      text: 'Its answer was lost.',
      askAgain: false,
      shows: 'open',
    },
    { already: true },
  );
  expect(outcomeTitle(unknown)).toBe('Lo can’t tell whether #138 merged.');
  expect(outcomeDetail(unknown)).toBe(
    'GitHub was already merging it, from Lo or elsewhere, so Lo followed that merge. Its answer was lost. GitHub shows it open.',
  );
  expect(outcomeTitle(job({ kind: 'merged' }))).toBeUndefined();
});

test('a merge past the rules skips each reason, and the merge queue it merges straight past', () => {
  const said: Omit<Said, 'queue'> = {
    blockers: [
      { kind: 'approvals', more: 1, codeOwners: [] },
      { kind: 'check', check: { name: 'ci', state: 'running', url: null } },
    ],
    unchecked: [],
    partial: false,
    afterPush: 'keepsApprovals',
    base: 'e4/queued',
  };
  expect(skipsOf({ ...said, queue: { required: false, method: null } })).toEqual([
    '1 more approval',
    '1 required check still running: ci',
  ]);
  expect(skipsOf({ ...said, queue: { required: true, method: 'SQUASH' } })).toEqual([
    'The merge queue for e4/queued',
    '1 more approval',
    '1 required check still running: ci',
  ]);
});
