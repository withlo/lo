// How the window words a merge status: the header's line for each kind, the panel's head and
// reasons, and the methods; and a GitHub stack's merge, as one, and a chain's, a layer at a time.

import { expect, test } from 'vitest';

import type {
  JobView,
  MergeState,
  Placement,
  Progress,
  QueuePlace,
  Together,
} from '../contract.ts';
import {
  ago,
  cantAutoMerge,
  cantMerge,
  cantOverride,
  chainSteps,
  confirmLabel,
  confirmTitle,
  doneLine,
  duration,
  headerLine,
  layerLine,
  methodNote,
  ordinal,
  outcomeDetail,
  outcomeTitle,
  panelHead,
  panelLabel,
  placedLabel,
  placedWhy,
  queueLine,
  refusalText,
  rowPage,
  rowsOf,
  shownMethod,
  skipsOf,
  steppedMethod,
  type Said,
  type Who,
} from './words.ts';

/** When the tests' statuses were read: now, so none is out of date unless a test says. */
const NOW = Date.now();

const PULL_PAGE = 'https://github.com/rozed-dev/e2e/pull/148';
const RUN = 'https://github.com/rozed-dev/e2e/actions/runs/1';

/** The account and repo a merge acts as, by name. */
const WHO: Who = { login: 'rozed-bot', repo: 'rozed-dev/e2e' };

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
    stall: null,
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
    {
      kind: 'approvals',
      more: 1,
      codeOwners: [{ kind: 'user', login: 'rozed-bot' }],
      codeOwnerRule: true,
    },
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
          { kind: 'approvals', more: 1, codeOwners: [], codeOwnerRule: false },
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
  expect(
    known(
      state({
        verdict: 'blocked',
        autoMerge: { method: 'SQUASH', by: 'rozed-bot' },
        blockers: [{ kind: 'outOfDate' }],
      }),
    )?.detail,
  ).toBe('Branch out of date · auto-merge is on');
  expect(known(state({ verdict: 'queued', position: 3 }))).toMatchObject({
    kind: 'queued',
    verdict: 'Queued, 3rd',
    opens: true,
  });
  const auto = state({
    verdict: 'waiting',
    autoMerge: { method: 'SQUASH', by: 'rozed-bot' },
    blockers: [{ kind: 'approvals', more: 1, codeOwners: [], codeOwnerRule: false }],
  });
  // The verdict says it all, but where it joins a merge queue first.
  expect(known(auto)).toEqual({
    kind: 'auto',
    verdict: 'Auto-merge is on',
    detail: undefined,
    opens: true,
  });
  expect(known({ ...auto, queue: { required: true, method: 'SQUASH' } })).toMatchObject({
    verdict: 'Auto-merge is on',
    detail: 'waiting to join',
  });
  expect(known(state({ verdict: 'merged' }))).toMatchObject({ verdict: 'Merged', opens: false });
  expect(known(state({ verdict: 'closed' }))).toMatchObject({ verdict: 'Closed', opens: false });
  expect(
    known(
      state({
        action: { kind: 'enqueue', method: 'SQUASH' },
        queue: { required: true, method: 'SQUASH' },
      }),
    ),
  ).toMatchObject({ verdict: 'Ready for merge queue', detail: 'Merge queue for main' });
});

test('the header says it’s checking before the first read, and that it can’t when that fails', () => {
  expect(headerLine(undefined)).toBeUndefined();
  expect(headerLine({ kind: 'none', why: 'Sign in to merge' })).toBeUndefined();
  // The panel opens on either, saying the same, with the reason for a failure.
  expect(headerLine({ kind: 'loading' })).toEqual({
    kind: 'waiting',
    verdict: 'Checking…',
    detail: undefined,
    opens: true,
  });
  expect(headerLine({ kind: 'failed', why: 'GitHub answered 502' })).toEqual({
    kind: 'waiting',
    verdict: 'Can’t check merge status',
    detail: undefined,
    opens: true,
  });
});

test('a ready pull request GitHub may not have told all of never looks clean, and says why', () => {
  const unsure = [
    [state({ incomplete: 'checksCutShort' }), 'Over 1,000 checks'],
    [state({ incomplete: 'readAgain' }), 'Checking…'],
    [state({ partial: true }), 'Some rules aren’t shown'],
  ] as const;
  for (const [value, detail] of unsure) {
    expect(known(value)).toMatchObject({ kind: 'waiting', verdict: 'Ready to merge', detail });
    expect(panelHead(value).kind).toBe('waiting');
  }
});

test('a status Lo couldn’t read again, or hasn’t for long, says when it was checked in its panel', () => {
  const failed = state({ stale: 'GitHub answered 502', readAt: NOW - 3 * 60_000 });
  // The header's line is the verdict and its one detail, however old.
  expect(headerLine({ kind: 'known', state: failed })).toEqual({
    kind: 'ready',
    verdict: 'Ready to merge',
    detail: 'Squash into main',
    opens: true,
  });
  expect(rowsOf(failed, NOW).at(-1)).toMatchObject({
    key: 'stale',
    title: 'Checked 3 min ago',
    detail: 'GitHub answered 502',
    inTheWay: false,
  });
  const old = state({ verdict: 'queued', position: 1, readAt: NOW - 12 * 60_000 });
  expect(headerLine({ kind: 'known', state: old })).toMatchObject({
    verdict: 'Queued, 1st',
    detail: undefined,
  });
  expect(rowsOf(old, NOW).at(-1)).toMatchObject({ title: 'Checked 12 min ago', detail: undefined });
  // The poller can't read, worded by why GitHub gave no answer.
  const hung = state({ stall: { kind: 'timeout' }, readAt: NOW - 60_000 });
  expect(rowsOf(hung, NOW).at(-1)).toMatchObject({
    title: 'Checked 1 min ago',
    detail: 'GitHub didn’t respond.',
  });
  // A merge stays merged.
  expect(rowsOf(state({ verdict: 'merged', readAt: 0 }), NOW).at(-1)?.key).not.toBe('stale');
});

test('how long ago reads in its largest whole unit', () => {
  expect(
    [0, 59_000, 60_000, 90 * 60_000, 2 * 3_600_000, 25 * 3_600_000, 3 * 86_400_000].map((age) =>
      ago(NOW - age, NOW),
    ),
  ).toEqual(['just now', 'just now', '1 min ago', '1 h ago', '2 h ago', '1 d ago', '3 d ago']);
});

test('the panel has a row for each reason, checks of a state together with their runs', () => {
  const rows = rowsOf(GATED);
  expect(rows.map((row) => [row.key, row.title])).toEqual([
    ['checks-failed', '1 required check failed'],
    ['conversations', '1 unresolved thread'],
    ['approvals', 'Review required'],
    ['checks-running', '2 checks running'],
  ]);
  expect(rows[0]?.subs).toEqual([
    {
      key: '0',
      name: 'ci',
      note: 'failed',
      tone: 'fail',
      link: { label: 'Open in browser', url: RUN },
    },
  ]);
  expect(rows[1]?.nextThread).toBe(true);
  expect(rows[2]?.detail).toBe('1 more approval, and 1 from a code owner: @rozed-bot.');
  // `o` opens a reason's page, or its first check's run.
  expect(rows[0] && rowPage(rows[0])).toBe(RUN);
  expect(rows[3] && rowPage(rows[3])).toBeUndefined();
  expect(panelHead(GATED)).toEqual({
    kind: 'blocked',
    verdict: 'Can’t merge',
    before: 'into',
    branch: 'e4/gated',
    after: '· 4 reasons',
  });
});

test('rules Lo doesn’t check, and a block it may not see all of, are said and linked', () => {
  const rows = rowsOf({
    ...GATED,
    blockers: [{ kind: 'unexplained', url: PULL_PAGE }],
    unchecked: [
      { kind: 'signatures' },
      { kind: 'locked' },
      { kind: 'other', type: 'max_file_size' },
    ],
  });
  expect(rows.map((row) => [row.title, row.detail])).toEqual([
    ['Blocked by GitHub', 'GitHub gives no reason.'],
    ['Commits must be signed', 'Not checked.'],
    ['e4/gated is locked', 'Not checked.'],
    ['Another rule on e4/gated', 'Not checked.'],
  ]);
  expect(rows[0]?.link).toEqual({ label: 'Open on GitHub', url: PULL_PAGE });
  expect(rows.filter((row) => row.inTheWay)).toHaveLength(1);
  const partial = rowsOf({ ...GATED, partial: true });
  expect(partial.at(-1)).toMatchObject({
    title: 'Some rules aren’t shown',
    link: { label: 'Open on GitHub', url: PULL_PAGE },
    inTheWay: false,
  });
  const cutShort = rowsOf({ ...GATED, incomplete: 'checksCutShort' });
  expect(cutShort.at(-1)).toMatchObject({
    title: 'Over 1,000 checks',
    detail: 'The first 1,000 are shown.',
  });
});

test('a ready pull request that can’t merge names the account or the repo why', () => {
  const noPermission = state({ action: { kind: 'notPossible', reason: 'noPermission' } });
  expect(rowsOf(noPermission, NOW, WHO)).toEqual([
    expect.objectContaining({
      key: 'noPermission',
      title: 'rozed-bot can’t merge into main',
      detail: 'Merging requires write access.',
      inTheWay: true,
    }),
  ]);
  // Who, when the window can't say.
  expect(rowsOf(noPermission)[0]?.title).toBe('This account can’t merge into main');
  expect(
    rowsOf(state({ action: { kind: 'notPossible', reason: 'noMethod' } }), NOW, WHO)[0]?.title,
  ).toBe('rozed-dev/e2e allows no merge method');
});

test('the panel’s head says what it merges into and how it stands', () => {
  expect(panelHead(state({ approvedBy: ['jun-park'], checks: { passed: 12, total: 12 } }))).toEqual(
    {
      kind: 'ready',
      verdict: 'Ready to merge',
      before: 'into',
      branch: 'main',
      after: '· approved by jun-park · 12 checks passed',
    },
  );
  expect(panelHead(state())).toEqual({
    kind: 'ready',
    verdict: 'Ready to merge',
    before: 'into',
    branch: 'main',
    after: undefined,
  });
  expect(
    panelHead(
      state({
        verdict: 'waiting',
        autoMerge: { method: 'SQUASH', by: 'tess-okafor' },
        blockers: [{ kind: 'approvals', more: 1, codeOwners: [], codeOwnerRule: false }],
      }),
    ),
  ).toEqual({
    kind: 'auto',
    verdict: 'Auto-merge is on',
    before: undefined,
    branch: undefined,
    after: 'Squash · turned on by tess-okafor',
  });
  expect(
    panelHead(
      state({ action: { kind: 'enqueue', method: null }, queue: { required: true, method: null } }),
    ),
  ).toEqual({
    kind: 'ready',
    verdict: 'Ready for merge queue',
    before: undefined,
    branch: 'main',
    after: 'has a merge queue',
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
  expect(methodNote(two)).toBe('Merge commit is off in this repo.');
  expect(methodNote(state({ methods: { merge: true, squash: false, rebase: false } }))).toBe(
    'Squash and Rebase are off in this repo.',
  );
  expect(methodNote(state({ signedCommits: true }))).toBe(
    'main requires signed commits, so Rebase is off.',
  );
  expect(methodNote(state())).toBeUndefined();
});

test('a pull request blocked from a merge queue shows the queue’s method, or none', () => {
  const blocked = {
    verdict: 'blocked',
    base: 'e4/queued',
    action: { kind: 'notPossible', reason: 'blocked' },
    picked: 'MERGE',
  } as const;
  // The queue squashes, whatever was picked for the repository.
  expect(
    shownMethod(state({ ...blocked, queue: { required: true, method: 'SQUASH' } }), 'MERGE'),
  ).toBe('SQUASH');
  // Its settings hidden from the account, it names none.
  expect(
    shownMethod(state({ ...blocked, queue: { required: true, method: null } }), undefined),
  ).toBeUndefined();
  // Straight in, it's the one picked.
  expect(shownMethod(state(blocked), undefined)).toBe('MERGE');
  // Where the method control would be, the queue's settings choose it.
  expect(queueLine('SQUASH')).toBe('Squash, set by the merge queue');
  expect(queueLine(null)).toBe('Method set by the merge queue');
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

test('a queued pull request’s place, as Lo last read its queue, says when it should merge, or that it’s leaving', () => {
  const queued = { kind: 'known', state: state({ verdict: 'queued', position: 2 }) } as const;
  expect(headerLine(queued)).toMatchObject({ verdict: 'Queued, 2nd', detail: undefined });
  const place = {
    kind: 'listed',
    position: 3,
    state: 'AWAITING_CHECKS',
    timeToMerge: 720,
    failed: [],
    partial: false,
  } satisfies QueuePlace;
  expect(headerLine(queued, { place, left: null })).toEqual({
    kind: 'queued',
    verdict: 'Queued, 3rd',
    detail: 'merges in about 12 min',
    opens: true,
  });
  expect(headerLine(queued, { place: { ...place, timeToMerge: null }, left: null })).toMatchObject({
    verdict: 'Queued, 3rd',
    detail: undefined,
  });
  const failed = { ...place, state: 'UNMERGEABLE', timeToMerge: null } satisfies QueuePlace;
  expect(
    headerLine(queued, {
      place: { ...failed, failed: [{ name: 'ci', state: 'failed', url: RUN }] },
      left: null,
    }),
  ).toMatchObject({
    kind: 'blocked',
    verdict: 'Leaving merge queue',
    detail: 'ci failed',
  });
  expect(headerLine(queued, { place: failed, left: null })).toMatchObject({
    verdict: 'Leaving merge queue',
    detail: undefined,
  });
  // GitHub left part of the queue out: where Lo can't see it, GitHub's own read of its place stands.
  expect(
    headerLine(queued, { place: { kind: 'unlisted', partial: true }, left: null }),
  ).toMatchObject({ verdict: 'Queued, 2nd' });
  // The queue no longer lists it: it left, never the place it had, until its status says how.
  expect(headerLine(queued, { place: { kind: 'unlisted', partial: false }, left: null })).toEqual({
    kind: 'waiting',
    verdict: 'Left merge queue',
    detail: 'Checking…',
    opens: true,
  });
  // No longer queued, its queue's last read says nothing in the header.
  expect(headerLine({ kind: 'known', state: state() }, { place, left: null })).toMatchObject({
    verdict: 'Ready to merge',
  });
});

test('GitHub’s estimates read in their largest whole unit', () => {
  expect([20, 720, 3600, 3900, 7200].map(duration)).toEqual([
    '1 min',
    '12 min',
    '1 h',
    '1 h',
    '2 h',
  ]);
});

test('a refusal for GitHub giving no answer says its cause as a dimmed control does, else main’s words', () => {
  expect(refusalText({ text: '', cause: { kind: 'timeout' } })).toBe('No response');
  expect(refusalText({ text: '', cause: { kind: 'offline' } })).toBe('Offline');
  expect(refusalText({ text: '', cause: { kind: 'unknown' } })).toBe('Can’t reach GitHub');
  expect(refusalText({ text: 'This tab’s account has changed.' })).toBe(
    'This tab’s account has changed.',
  );
});

test('merging is off, with why, offline, while GitHub’s rate limit holds, signed out, or while it can’t merge', () => {
  expect(cantMerge(state(), 138)).toBeUndefined();
  expect(cantMerge(state({ off: { kind: 'offline', cause: { kind: 'offline' } } }), 138)).toBe(
    'Offline',
  );
  expect(cantMerge(state({ off: { kind: 'offline', cause: { kind: 'timeout' } } }), 138)).toBe(
    'No response',
  );
  const at = new Date(2026, 10, 16, 14, 5).getTime();
  expect(cantMerge(state({ off: { kind: 'paused', until: at } }), 138)).toBe(
    'GitHub’s rate limit resets at 14:05',
  );
  expect(cantMerge(state({ off: { kind: 'signedOut' } }), 138, WHO)).toBe(
    'rozed-bot is signed out',
  );
  expect(cantMerge(state({ off: { kind: 'signedOut' } }), 138)).toBe('This account is signed out');
  // Blocked, it's the reasons' titles, a line each.
  expect(
    cantMerge(
      state({
        verdict: 'blocked',
        action: { kind: 'notPossible', reason: 'blocked' },
        blockers: [{ kind: 'draft' }, { kind: 'conflicts' }],
      }),
      142,
    ),
  ).toBe('Draft pull request\nConflicts with main');
  expect(
    cantMerge(
      state({ verdict: 'blocked', action: { kind: 'notPossible', reason: 'blocked' } }),
      142,
    ),
  ).toBe('Blocked by GitHub');
  expect(
    cantMerge(state({ verdict: 'closed', action: { kind: 'notPossible', reason: 'closed' } }), 9),
  ).toBe('#9 is closed');
  expect(
    cantMerge(state({ verdict: 'merged', action: { kind: 'notPossible', reason: 'merged' } }), 9),
  ).toBe('#9 is already merged');
  expect(
    cantMerge(state({ verdict: 'queued', action: { kind: 'notPossible', reason: 'queued' } }), 9),
  ).toBe('#9 is already in the merge queue');
  expect(
    cantMerge(state({ action: { kind: 'notPossible', reason: 'noPermission' } }), 9, WHO),
  ).toBe('rozed-bot can’t merge into main');
  expect(cantMerge(state({ action: { kind: 'notPossible', reason: 'noMethod' } }), 9, WHO)).toBe(
    'rozed-dev/e2e allows no merge method',
  );
  expect(cantMerge(state({ incomplete: 'checksCutShort' }), 138)).toBe(
    '#138 has over 1,000 checks',
  );
});

test('auto-merge and a merge past the rules say in a few words why they can’t', () => {
  const auto = (reason: Extract<MergeState['auto'], { kind: 'notPossible' }>['reason']) =>
    cantAutoMerge(state({ auto: { kind: 'notPossible', reason } }), 138, WHO);
  expect(cantAutoMerge(state({ auto: { kind: 'on' } }), 138)).toBeUndefined();
  expect(auto('ready')).toBe('#138 can merge now');
  expect(auto('noPermission')).toBe('rozed-bot can’t add to the merge queue');
  expect(auto('notAllowed')).toBe(
    'rozed-dev/e2e doesn’t allow auto-merge, or rozed-bot can’t merge',
  );
  expect(auto('cantTurnOff')).toBe('rozed-bot can’t turn off auto-merge');
  // Blocked, only what waiting won't clear.
  expect(
    cantAutoMerge(
      state({
        verdict: 'blocked',
        auto: { kind: 'notPossible', reason: 'blocked' },
        blockers: [
          { kind: 'conflicts' },
          { kind: 'check', check: { name: 'ci', state: 'running', url: null } },
        ],
      }),
      138,
    ),
  ).toBe('Conflicts with main');
  expect(
    cantAutoMerge(
      state({ auto: { kind: 'on' }, off: { kind: 'offline', cause: { kind: 'offline' } } }),
      138,
    ),
  ).toBe('Offline');

  const override = (reason: Extract<MergeState['override'], { kind: 'notPossible' }>['reason']) =>
    cantOverride(state({ override: { kind: 'notPossible', reason } }), 138, WHO);
  expect(cantOverride(state({ override: { kind: 'override' } }), 138)).toBeUndefined();
  expect(override('nothingToSkip')).toBe('No rule blocks #138');
  expect(override('noPermission')).toBe('rozed-bot can’t bypass rules for main');
  expect(override('draft')).toBe('Draft pull requests can’t merge');
  expect(override('conflicts')).toBe('#138 conflicts with main');
  expect(override('stackLayer')).toBe('Only a GitHub stack’s bottom layer can bypass rules');
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
    together: null,
    state: now,
    ...change,
  };
}

test('a merge that went says how it ended: done, refused, or not known', () => {
  expect(doneLine(job({ kind: 'merged' }))).toBe('Merged #138');
  expect(doneLine(job({ kind: 'enqueued' }, { kind: 'enqueue', base: 'e4/queued' }))).toBe(
    'Added #138 to merge queue',
  );
  expect(doneLine(job({ kind: 'autoMergeOn' }, { kind: 'autoMerge' }))).toBe(
    'Turned on auto-merge for #138',
  );
  expect(doneLine(job({ kind: 'autoMergeOff' }, { kind: 'autoMergeOff' }))).toBe(
    'Turned off auto-merge for #138',
  );
  expect(doneLine(job({ kind: 'pending', trouble: null }))).toBeUndefined();
  const refusal = { kind: 'conflict', text: 'It conflicts.', rules: [], until: null, newer: null };
  const refused = job({ kind: 'refused', refusal });
  expect(outcomeTitle(refused)).toBe('Couldn’t merge #138');
  expect(outcomeDetail(refused)).toBe('It conflicts.');
  expect(outcomeTitle(job({ kind: 'refused', refusal }, { kind: 'enqueue' }))).toBe(
    'Couldn’t add #138 to the merge queue',
  );
  expect(outcomeTitle(job({ kind: 'refused', refusal }, { kind: 'autoMerge' }))).toBe(
    'Couldn’t turn on auto-merge',
  );
  expect(outcomeTitle(job({ kind: 'refused', refusal }, { kind: 'autoMergeOff' }))).toBe(
    'Couldn’t turn off auto-merge',
  );
  const lost = {
    kind: 'unknown',
    why: 'noAnswer',
    text: 'Its answer was lost.',
    askAgain: false,
    shows: 'open',
  } as const;
  // Following a merge GitHub was already running says nothing more.
  const unknown = job(lost, { already: true });
  expect(outcomeTitle(unknown)).toBe('Merge not confirmed');
  expect(outcomeDetail(unknown)).toBe('Its answer was lost. #138 is still open.');
  expect(outcomeTitle(job(lost, { kind: 'whenReady' }))).toBe('Auto-merge not confirmed');
  expect(outcomeTitle(job({ kind: 'merged' }))).toBeUndefined();
});

const STACK: Together = {
  kind: 'stack',
  stack: 90,
  below: [
    { number: 136, title: '', head: 'c'.repeat(40), review: null, checks: null },
    { number: 137, title: '', head: 'd'.repeat(40), review: null, checks: null },
  ],
  above: [139],
};

/** How #90's merge went, its three layers as the Stacks API said. */
function stacked(landed: number[] | null): Progress {
  return {
    kind: 'stack',
    layers: [136, 137, 138].map((number) => ({ number, title: '', state: 'open' })),
    above: [139],
    takenAt: NOW,
    landed,
  };
}

test('a merge’s title and buttons name the pull request, or a GitHub stack’s layers', () => {
  const plan = { kind: 'merge', number: 138, base: 'main', method: 'SQUASH' } as const;
  expect(confirmTitle({ ...plan, together: null })).toBe('Merge #138');
  expect(confirmLabel({ ...plan, together: null })).toBe('Merge #138');
  expect(confirmTitle({ ...plan, together: STACK })).toBe('Merge 3 layers');
  expect(confirmLabel({ ...plan, together: STACK })).toBe('Merge 3 layers');
  // The title has the count for the merge queue; the button is the same either way.
  expect(confirmTitle({ ...plan, kind: 'enqueue', together: null })).toBe(
    'Add #138 to merge queue',
  );
  expect(confirmTitle({ ...plan, kind: 'enqueue', together: STACK })).toBe(
    'Add 3 layers to merge queue',
  );
  expect(confirmLabel({ ...plan, kind: 'enqueue', together: STACK })).toBe('Add to merge queue');
  for (const kind of ['autoMerge', 'whenReady'] as const) {
    expect(confirmTitle({ ...plan, kind })).toBe('Turn on auto-merge');
    expect(confirmLabel({ ...plan, kind })).toBe('Turn on auto-merge');
  }
  expect(confirmTitle({ ...plan, kind: 'override' })).toBe('Bypass rules and merge');
  expect(confirmLabel({ ...plan, kind: 'override' })).toBe('Bypass rules and merge');

  const placed: Placement = { kind: 'stack', stack: 90, below: [136, 137] };
  expect(placedLabel(placed, false, 'Merge #138')).toBe('Merge 3 layers');
  expect(placedLabel(placed, true, 'Add to merge queue')).toBe('Add to merge queue');
  expect(placedLabel({ kind: 'alone' }, false, 'Merge #138')).toBe('Merge #138');
  // The panel's button opens the confirmation.
  expect(panelLabel(placed, false, 138)).toBe('Merge 3 layers…');
  expect(panelLabel(placed, true, 138)).toBe('Add 3 layers to merge queue…');
  expect(panelLabel({ kind: 'alone' }, false, 138)).toBe('Merge #138…');
  expect(panelLabel(undefined, true, 138)).toBe('Add to merge queue…');
});

test('a GitHub stack’s merge says it merged its layers', () => {
  expect(doneLine(job({ kind: 'merged' }, { together: stacked(null) }))).toBe('Merged 3 layers');
  expect(doneLine(job({ kind: 'enqueued' }, { kind: 'enqueue', together: stacked(null) }))).toBe(
    'Added 3 layers to merge queue',
  );
  expect(
    doneLine(job({ kind: 'pending', trouble: null }, { together: stacked(null) })),
  ).toBeUndefined();
});

test('a GitHub stack’s merge GitHub stopped says which layers went in, if any did', () => {
  const refusal = { kind: 'failed', text: 'GitHub stopped.', rules: [], until: null, newer: null };
  const stopped = (landed: number[] | null) =>
    job({ kind: 'refused', refusal }, { together: stacked(landed) });
  expect(outcomeTitle(stopped([]))).toBe('Couldn’t merge 3 layers');
  expect(outcomeTitle(stopped([136]))).toBe('Merged #136 only');
  expect(outcomeTitle(stopped([136, 137]))).toBe('Merged #136 and #137 only');
  expect(outcomeTitle(stopped(null))).toBe('Merge not confirmed');
  // The title says which; the reason is GitHub's.
  for (const landed of [[], [136], null]) {
    expect(outcomeDetail(stopped(landed))).toBe('GitHub stopped.');
  }
});

/** #138's merge, which went, its chain's run as far as `phase`, saying `text`. */
function ran(phase: 'moving' | 'done' | 'stopped', text: string | null): JobView {
  return job(
    { kind: 'merged' },
    { together: { kind: 'chain', phase, moves: [], needsRebase: [139], text } },
  );
}

test('a chain’s merge a layer at a time lists each move, and says how its run ended', () => {
  const chain: Extract<Together, { kind: 'chain' }> = {
    kind: 'chain',
    before: { pr: 138, from: 'feature', to: 'main' },
    after: [{ pr: 139, from: 'chain-1', to: 'main' }],
    needsRebase: [139, 140],
  };
  expect(chainSteps({ number: 138, base: 'main', method: 'SQUASH' }, chain)).toEqual([
    { key: 'before', title: 'Move #138 onto main.', detail: 'From feature.', branch: 'main' },
    { key: 'merge', title: 'Merge #138 into main.', detail: undefined, branch: 'main' },
    {
      key: 'after-139',
      title: 'Move #139 onto main.',
      detail: 'From chain-1. Needs a rebase.',
      branch: 'main',
    },
    { key: 'rebase-140', title: '#140 stays on main.', detail: 'Needs a rebase.', branch: 'main' },
  ]);
  // A merge commit lands #138's commits as they are: no rebase after one, and #140 isn't moved.
  expect(chainSteps({ number: 138, base: 'main', method: 'MERGE' }, chain)).toEqual([
    { key: 'before', title: 'Move #138 onto main.', detail: 'From feature.', branch: 'main' },
    { key: 'merge', title: 'Merge #138 into main.', detail: undefined, branch: 'main' },
    { key: 'after-139', title: 'Move #139 onto main.', detail: 'From chain-1.', branch: 'main' },
  ]);
  // Into a merge queue whose method Lo can't read, it says nothing of a rebase.
  expect(chainSteps({ number: 138, base: 'main', method: null }, chain).slice(2)).toEqual([
    { key: 'after-139', title: 'Move #139 onto main.', detail: 'From chain-1.', branch: 'main' },
    { key: 'rebase-140', title: '#140 stays on main.', detail: undefined, branch: 'main' },
  ]);

  expect(doneLine(ran('moving', null))).toBeUndefined();
  expect(doneLine(ran('done', '#139 moved onto main.'))).toBe('Merged #138');
  expect(outcomeTitle(ran('done', '#139 moved onto main.'))).toBeUndefined();
  const stopped = ran('stopped', 'GitHub didn’t respond.');
  expect(outcomeTitle(stopped)).toBe('Couldn’t move the layers above #138');
  expect(outcomeDetail(stopped)).toBe('GitHub didn’t respond.');
});

test('the merge panel’s `⏎` doesn’t merge a chain stacks could make a GitHub stack first', () => {
  expect(placedWhy({ kind: 'convert', offer: 'These PRs share commits.' })).toBe(
    'Convert to GitHub stack first',
  );
  expect(placedWhy({ kind: 'refused', why: 'Merge #137 first.', again: false })).toBe(
    'Merge #137 first.',
  );
  expect(placedWhy({ kind: 'chain', into: 'main', above: [139], reasons: [] })).toBeUndefined();
});

test('a GitHub stack’s layer says where it stands in its confirmation, once its state was read', () => {
  expect(layerLine({ review: 'approved', checks: 'passing' })).toBe('Approved · checks passed');
  expect(layerLine({ review: 'changesRequested', checks: 'failing' })).toBe(
    'Changes requested · checks failed',
  );
  expect(layerLine({ review: null, checks: 'running' })).toBe('Checks running');
  expect(layerLine({ review: 'reviewRequired', checks: null })).toBe('Review required');
  expect(layerLine({ review: null, checks: null })).toBeUndefined();
});

test('a merge past the rules bypasses each reason, and the merge queue it merges straight past', () => {
  const said: Omit<Said, 'queue'> = {
    blockers: [
      { kind: 'approvals', more: 1, codeOwners: [], codeOwnerRule: false },
      { kind: 'check', check: { name: 'ci', state: 'running', url: null } },
    ],
    unchecked: [],
    partial: false,
    afterPush: 'keepsApprovals',
    base: 'e4/queued',
  };
  expect(skipsOf({ ...said, queue: { required: false, method: null } })).toEqual([
    '1 more approval',
    '1 check running: ci',
  ]);
  expect(skipsOf({ ...said, queue: { required: true, method: 'SQUASH' } })).toEqual([
    'The merge queue for e4/queued',
    '1 more approval',
    '1 check running: ci',
  ]);
  // The rules want a code owner's approval GitHub asks nobody for: the count says it.
  expect(
    skipsOf({
      ...said,
      blockers: [{ kind: 'approvals', more: 1, codeOwners: [], codeOwnerRule: true }],
      queue: { required: false, method: null },
    }),
  ).toEqual(['1 more approval']);
  expect(
    skipsOf({
      ...said,
      blockers: [{ kind: 'check', check: { name: 'test (node 20)', state: 'failed', url: RUN } }],
      unchecked: [{ kind: 'signatures' }],
      partial: true,
      queue: { required: false, method: null },
    }),
  ).toEqual([
    '1 required check failed: test (node 20)',
    'Commits must be signed',
    'Some rules aren’t shown',
  ]);
});

/**
 * What the panel says of the review blocked `e4/gated`'s pull request needs, with `more` approvals
 * to come and no code owner asked: the only one is its author, or one approved already, and GitHub
 * requests nobody.
 */
function gated(more: number, codeOwnerRule: boolean): string | undefined {
  return rowsOf(
    state({
      verdict: 'blocked',
      base: 'e4/gated',
      action: { kind: 'notPossible', reason: 'blocked' },
      blockers: [{ kind: 'approvals', more, codeOwners: [], codeOwnerRule }],
    }),
  ).find((row) => row.key === 'approvals')?.detail;
}

test('a code owner’s approval the rules require is named, though GitHub asked no one for it', () => {
  expect(gated(1, true)).toBe('1 more approval. e4/gated requires a code owner’s approval.');
  expect(gated(2, false)).toBe('2 more approvals.');
  expect(gated(0, true)).toBe('e4/gated requires a code owner’s approval.');
  // The title, "Review required", says the rest.
  expect(gated(0, false)).toBeUndefined();
});
