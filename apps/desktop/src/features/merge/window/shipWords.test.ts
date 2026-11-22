// What approve and ship's dialog and the auto-merge watch say: the two steps as the confirmation
// lists them, the warning of a push before it merges, how a run stands, and each end in words.

import { expect, it } from 'vitest';

import type { RevisionRow } from '../../revisions/contract.ts';
import type { JobView, Refusal, ShipPlan, ShipStop, ShipView, Watched } from '../contract.ts';
import {
  plannedSteps,
  pushedWords,
  runningOf,
  shipDoneLine,
  shipLabel,
  shipWarning,
  stopTitle,
  stopWords,
  watchedWords,
} from './shipWords.ts';

const HEAD = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const NOW = 1_800_000_000_000;

/** r2 is `HEAD`, r3 `NEWER`. */
const label = (head: string) => ({ [HEAD]: 'r2', [NEWER]: 'r3' })[head];

function planOf(change: Partial<ShipPlan> = {}): ShipPlan {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    id: 't1',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 138,
    login: 'tess-okafor',
    base: 'main',
    head: HEAD,
    approval: { kind: 'approve' },
    summary: false,
    likely: { kind: 'merge', method: 'SQUASH' },
    warning: false,
    afterPush: 'keepsApprovals',
    ...change,
  };
}

/** How approve and ship from `plan` stands, as main says, with `change`. */
function viewOf(plan: ShipPlan, change: Partial<ShipView>): ShipView {
  return {
    key: plan.key,
    owner: plan.owner,
    repo: plan.repo,
    number: plan.number,
    login: plan.login,
    base: plan.base,
    head: plan.head,
    approval: plan.approval,
    approved: false,
    phase: { kind: 'approving' },
    ...change,
  };
}

/** The merge approve and ship sent for `plan`, standing as `state`, with `change`. */
function jobOf(plan: ShipPlan, state: JobView['state'], change: Partial<JobView> = {}): JobView {
  return {
    key: plan.key,
    owner: plan.owner,
    repo: plan.repo,
    number: plan.number,
    login: plan.login,
    kind: 'merge',
    method: 'SQUASH',
    base: plan.base,
    head: plan.head,
    already: false,
    state,
    together: null,
    ...change,
  };
}

/** GitHub's refusal, saying `text`, with `change`. */
function refusalOf(text: string, change: Partial<Refusal> = {}): Refusal {
  return { kind: 'failed', text, rules: [], until: null, newer: null, ...change };
}

it('lists the approval, then what follows it', () => {
  const running = { name: 'e2e (chromium)', state: 'running' as const, url: null };
  const steps = plannedSteps(
    planOf({
      approval: { kind: 'submitPending', comments: 1 },
      summary: true,
      likely: {
        kind: 'autoMerge',
        method: 'SQUASH',
        waitingOn: [
          { kind: 'check', check: running },
          { kind: 'check', check: { ...running, name: 'typecheck' } },
        ],
      },
      warning: true,
    }),
  );
  expect(steps.map((step) => [step.key, step.title, step.detail])).toEqual([
    [
      'approve',
      'Approve #138 as tess-okafor.',
      'Your summary and 1 pending comment are submitted with it.',
    ],
    [
      'ship',
      'Turn on auto-merge.',
      'GitHub squashes and merges it into main once e2e (chromium) and typecheck pass.',
    ],
  ]);
  expect(steps.every((step) => step.state === 'todo')).toBe(true);
});

/** The step after the approval the confirmation lists, where `likely` is what follows it. */
function ship(likely: ShipPlan['likely']) {
  return plannedSteps(planOf({ likely }))[1];
}

it('names how the step after the approval merges', () => {
  expect(ship({ kind: 'merge', method: 'SQUASH' })?.title).toBe('Squash and merge it into main.');
  expect(ship({ kind: 'merge', method: 'MERGE' })?.title).toBe(
    'Merge it into main with a merge commit.',
  );
  expect(ship({ kind: 'merge', method: 'REBASE' })?.title).toBe('Rebase and merge it into main.');
  expect(ship({ kind: 'enqueue', method: null })?.title).toBe(
    'Add it to the merge queue for main.',
  );
  expect(ship({ kind: 'enqueueWhenReady', method: null, waitingOn: [] })).toMatchObject({
    title: 'Turn on auto-merge.',
    detail: 'It joins the merge queue for main once nothing blocks it.',
  });
  expect(ship({ kind: 'autoMergeAlreadyOn', waitingOn: [] })).toMatchObject({
    title: 'Auto-merge is on.',
    detail: 'GitHub merges it once it’s approved.',
  });
  expect(ship({ kind: 'alreadyQueued' })?.title).toBe('In the merge queue for main.');
});

it('skips the approval on your own pull request, says again after a dismissal, and what goes with it', () => {
  const own = planOf({ approval: { kind: 'ownPullRequest' } });
  expect(plannedSteps(own)[0]).toMatchObject({
    state: 'skipped',
    title: 'Approve #138.',
    detail: 'Authors can’t approve their own pull request.',
  });
  // The button names both, whether it approves or not.
  expect(shipLabel()).toBe('Approve and ship');
  expect(plannedSteps(planOf({ approval: { kind: 'reapproveDismissed' } }))[0]).toMatchObject({
    title: 'Approve #138 again as tess-okafor.',
    detail: undefined,
  });
  expect(plannedSteps(planOf({ approval: { kind: 'alreadyApproved' } }))[0]).toMatchObject({
    state: 'done',
    title: 'Approved as tess-okafor.',
  });
  expect(
    plannedSteps(planOf({ approval: { kind: 'submitPending', comments: 1 } }))[0]?.detail,
  ).toBe('1 pending comment is submitted with it.');
  expect(plannedSteps(planOf({ summary: true }))[0]?.detail).toBe(
    'Your summary is submitted with it.',
  );
});

it('warns of a push before it merges only when the plan does, and says auto-merge turns off for one', () => {
  expect(shipWarning(planOf())).toBeUndefined();
  expect(shipWarning(planOf({ warning: true }))).toBe(
    'A commit pushed before it merges will merge with the same approvals. While Lo is open, auto-merge turns off if a commit is pushed after your approval.',
  );
  expect(shipWarning(planOf({ warning: true, afterPush: 'noReview' }))).toBe(
    'A commit pushed before it merges will merge without review. While Lo is open, auto-merge turns off if a commit is pushed after your approval.',
  );
  expect(shipWarning(planOf({ warning: true, afterPush: 'newApproval' }))).toBeUndefined();
});

it('names where it stopped after approving, and why', () => {
  const where = planOf();
  const blocked: Extract<ShipStop, { kind: 'blocked' }> = {
    kind: 'blocked',
    blockers: [{ kind: 'conflicts' }],
    autoMerge: false,
  };
  expect(stopTitle(blocked, where)).toBe('Can’t merge yet.');
  expect(stopWords(blocked, where)).toBe('Conflicts.');
  expect(stopWords({ ...blocked, autoMerge: true }, where)).toBe('Conflicts. Auto-merge is on.');
  expect(stopTitle({ kind: 'noPermission' }, where)).toBe('tess-okafor can’t merge into main.');
  expect(stopTitle({ kind: 'noMethod' }, where)).toBe('rozed-dev/e2e allows no merge method.');
  expect(stopTitle({ kind: 'headMoved', head: NEWER }, where)).toBe(
    'This revision is out of date.',
  );
  const noAutoMerge: ShipStop = { kind: 'noAutoMerge', blockers: [] };
  expect(stopTitle(noAutoMerge, where)).toBe('Can’t turn on auto-merge.');
  expect(stopWords(noAutoMerge, where)).toBe(
    'rozed-dev/e2e doesn’t allow auto-merge, or tess-okafor can’t merge.',
  );
  const cutShort: ShipStop = { kind: 'incomplete', incomplete: 'checksCutShort' };
  expect([stopTitle(cutShort, where), stopWords(cutShort, where)]).toEqual([
    'Can’t merge yet.',
    'It has over 1,000 checks.',
  ]);
});

it('says how a run stands as it goes: approving, then what follows', () => {
  const plan = planOf();
  // Before main says anything, it's approving.
  expect(runningOf(plan, undefined, undefined)).toEqual({
    steps: [
      { key: 'approve', state: 'now', title: 'Approve #138 as tess-okafor.' },
      { key: 'ship', state: 'todo', title: 'Squash and merge it into main.' },
    ],
    end: { kind: 'running', working: 'Approving…' },
  });
  // With nothing to approve, the button says what follows.
  expect(
    runningOf(planOf({ approval: { kind: 'ownPullRequest' } }), undefined, undefined).end,
  ).toEqual({ kind: 'running', working: 'Merging…' });
  const reading = runningOf(
    plan,
    viewOf(plan, { approved: true, phase: { kind: 'reading' } }),
    undefined,
  );
  // The approval this run made keeps the words it was asked with: its ball says it's done.
  expect(reading.steps.map((step) => [step.state, step.title])).toEqual([
    ['done', 'Approve #138 as tess-okafor.'],
    ['now', 'Squash and merge it into main.'],
  ]);
  expect(reading.end).toEqual({ kind: 'running', working: 'Merging…' });
  const step = { kind: 'merge', method: 'SQUASH' } as const;
  const sending = viewOf(plan, {
    approved: true,
    phase: { kind: 'sending', step, job: plan.key },
  });
  expect(runningOf(plan, sending, jobOf(plan, { kind: 'pending', trouble: null })).end).toEqual({
    kind: 'running',
    working: 'Merging…',
  });
  const merged = runningOf(plan, sending, jobOf(plan, { kind: 'merged' }));
  expect(merged.steps.map((each) => each.state)).toEqual(['done', 'done']);
  expect(merged.end).toEqual({ kind: 'done', line: 'Approved and merged #138' });
});

it('says where a run stopped, what went wrong, and what the button does', () => {
  const plan = planOf();
  // A newer revision than the one approved: nothing was approved.
  const newer = refusalOf('A newer revision was pushed.', {
    kind: 'headMoved',
    newer: { from: HEAD, to: NEWER },
  });
  const stale = runningOf(
    plan,
    viewOf(plan, { phase: { kind: 'stopped', at: 'approve', refusal: newer, stop: null } }),
    undefined,
  );
  expect(stale.steps.map((step) => [step.state, step.detail])).toEqual([
    ['stopped', undefined],
    ['skipped', undefined],
  ]);
  expect(stale.end).toEqual({
    kind: 'failed',
    title: 'Couldn’t approve #138',
    reason: 'This revision is out of date.',
    again: { kind: 'newer', refusal: newer, head: HEAD },
  });
  const refused = refusalOf('GitHub returned an error.');
  expect(
    runningOf(
      plan,
      viewOf(plan, { phase: { kind: 'stopped', at: 'approve', refusal: refused, stop: null } }),
      undefined,
    ).end,
  ).toEqual({
    kind: 'failed',
    title: 'Couldn’t approve #138',
    reason: 'GitHub returned an error.',
    again: { kind: 'try' },
  });
  // Its answer lost, a look shows whether it approved, sending nothing.
  expect(
    runningOf(
      plan,
      viewOf(plan, {
        phase: { kind: 'stopped', at: 'unsure', refusal: refusalOf(''), stop: null },
      }),
      undefined,
    ).end,
  ).toEqual({
    kind: 'failed',
    title: 'Approval not confirmed',
    reason: 'GitHub didn’t respond.',
    again: { kind: 'look' },
  });
  // Approved, but GitHub blocks the merge: the merge panel merges from there.
  const blocked = runningOf(
    plan,
    viewOf(plan, {
      approved: true,
      phase: {
        kind: 'stopped',
        at: 'ship',
        refusal: refusalOf(''),
        stop: { kind: 'blocked', blockers: [{ kind: 'conflicts' }], autoMerge: false },
      },
    }),
    undefined,
  );
  expect(blocked.steps.map((step) => [step.state, step.title])).toEqual([
    ['done', 'Approve #138 as tess-okafor.'],
    ['stopped', 'Squash and merge it into main.'],
  ]);
  expect(blocked.end).toEqual({
    kind: 'failed',
    title: 'Couldn’t merge #138',
    reason: 'Can’t merge yet. Conflicts.',
    again: { kind: 'panel' },
  });
  // GitHub refused the merge it sent.
  const step = { kind: 'merge', method: 'SQUASH' } as const;
  const sending = viewOf(plan, { approved: true, phase: { kind: 'sending', step, job: plan.key } });
  expect(
    runningOf(plan, sending, jobOf(plan, { kind: 'refused', refusal: refusalOf('It conflicts.') }))
      .end,
  ).toEqual({
    kind: 'failed',
    title: 'Couldn’t merge #138',
    reason: 'It conflicts.',
    again: { kind: 'panel' },
  });
  // Lo can't tell how the merge ended: the button checks.
  const lost = jobOf(plan, {
    kind: 'unknown',
    why: 'noAnswer',
    text: 'GitHub didn’t respond.',
    askAgain: true,
    shows: null,
  });
  expect(runningOf(plan, sending, lost).end).toEqual({
    kind: 'failed',
    title: 'Merge not confirmed',
    reason: 'GitHub didn’t respond.',
    again: { kind: 'check', job: lost },
  });
});

it('says what it did once done, with the approval', () => {
  const plan = planOf();
  const view = viewOf(plan, {
    approved: true,
    phase: { kind: 'done', step: { kind: 'autoMergeAlreadyOn', waitingOn: [] } },
  });
  expect(shipDoneLine(view, undefined)).toBe('Approved #138');
  const job = jobOf(
    plan,
    { kind: 'enqueued' },
    { kind: 'enqueue', method: null, base: 'e4/queued' },
  );
  expect(shipDoneLine(view, job)).toBe('Approved and added #138 to merge queue');
  expect(shipDoneLine(view, jobOf(plan, { kind: 'merged' }))).toBe('Approved and merged #138');
  expect(shipDoneLine(view, jobOf(plan, { kind: 'autoMergeOn' }, { kind: 'autoMerge' }))).toBe(
    'Approved #138 and turned on auto-merge',
  );
  // Without the approval, the merge's own words, or what was there already.
  const own: ShipView = { ...view, approved: false, approval: { kind: 'ownPullRequest' } };
  expect(shipDoneLine(own, job)).toBe('Added #138 to merge queue');
  expect(shipDoneLine(own, undefined)).toBe('Auto-merge is already on for #138');
  expect(
    shipDoneLine({ ...own, phase: { kind: 'done', step: { kind: 'alreadyQueued' } } }, undefined),
  ).toBe('#138 is already in the merge queue');
});

it('names who pushed which revision after the approval it watched, in one line and one button', () => {
  const revisions: RevisionRow[] = [
    {
      head: NEWER,
      number: 3,
      pushedAt: { kind: 'exact', at: NOW - 2 * 60_000 },
      forced: false,
      pusher: 'mira-chen',
      rebased: false,
      available: true,
    },
  ];
  const watched: Watched = {
    key: '00000000-0000-4000-8000-000000000002',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 138,
    login: 'tess-okafor',
    kind: 'turnedOff',
    approved: HEAD,
    head: NEWER,
    why: null,
  };
  expect(watchedWords(watched, revisions, label)).toEqual({
    tone: 'warn',
    title: 'mira-chen pushed r3 after your approval · Auto-merge is off',
    detail: undefined,
    action: 'show',
  });
  // GitHub's own reason isn't in the words.
  expect(
    watchedWords({ ...watched, kind: 'notTurnedOff', why: 'Not allowed.' }, revisions, label),
  ).toEqual({
    tone: 'danger',
    title: 'Couldn’t turn off auto-merge',
    detail: 'mira-chen pushed r3 after your approval.',
    action: 'turnOff',
  });
  expect(watchedWords({ ...watched, kind: 'cantTell' }, undefined, label)).toEqual({
    tone: 'warn',
    title: 'Someone pushed r3 after your approval · Auto-merge is on',
    detail: undefined,
    action: 'turnOff',
  });
  expect(pushedWords(revisions, NEWER, label, NOW)).toBe('mira-chen pushed r3 2 min ago');
  // A revision Lo has no label for is its commit's short ID.
  expect(pushedWords(undefined, 'c'.repeat(40), label, NOW)).toBe('Someone pushed ccccccc');
});
