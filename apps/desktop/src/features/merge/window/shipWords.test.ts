// What approve and ship's dialog and the auto-merge watch say: the steps as the confirmation lists
// them, the warning of a push before it merges, and each end in words.

import { expect, it } from 'vitest';

import type { RevisionRow } from '../../revisions/contract.ts';
import type { ShipPlan, ShipView, Watched } from '../contract.ts';
import {
  plannedSteps,
  shipDoneLine,
  shipLabel,
  shipWarning,
  stopTitle,
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

it('names the revision it approves first, then the approval, then what follows', () => {
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
    label,
  );
  expect(steps.map((step) => [step.title, step.detail])).toEqual([
    [
      'Check that r2 is still the newest push',
      'If anyone pushed since you looked, Lo stops here and approves nothing.',
    ],
    ['Approve as tess-okafor', 'With your summary and 1 pending comment.'],
    [
      'Turn on auto-merge, squash into main',
      'GitHub squashes it once e2e (chromium) and typecheck pass.',
    ],
  ]);
  expect(steps.every((step) => step.state === 'todo')).toBe(true);
});

it('skips the approval on your own pull request, and says again after a dismissal', () => {
  const own = planOf({ approval: { kind: 'ownPullRequest' } });
  expect(plannedSteps(own, label)[1]).toMatchObject({ state: 'skipped', title: 'Approve' });
  expect(shipLabel(own.approval)).toBe('Ship');
  const again = planOf({ approval: { kind: 'reapproveDismissed' } });
  expect(plannedSteps(again, label)[1]).toMatchObject({
    title: 'Approve again as tess-okafor',
    detail: 'Your approval was dismissed.',
  });
  expect(shipLabel(again.approval)).toBe('Approve and ship');
});

it('warns of a push before it merges only when the plan does, and says Lo watches for one', () => {
  expect(shipWarning(planOf())).toBeUndefined();
  expect(shipWarning(planOf({ warning: true }))).toBe(
    'A push before it merges would merge with the approvals already given. While Lo runs, it turns auto-merge off if someone pushes after your approval.',
  );
  expect(shipWarning(planOf({ warning: true, afterPush: 'newApproval' }))).toBeUndefined();
});

it('names where it stopped after approving', () => {
  expect(
    stopTitle({ kind: 'blocked', blockers: [{ kind: 'conflicts' }], autoMerge: false }, 'main'),
  ).toMatch(/^Can’t merge: conflict/);
  expect(stopTitle({ kind: 'noPermission' }, 'main')).toBe('Can’t merge into main');
});

it('says what it did once done, with the approval', () => {
  const plan = planOf();
  const view: ShipView = {
    key: plan.key,
    owner: plan.owner,
    repo: plan.repo,
    number: plan.number,
    login: plan.login,
    base: plan.base,
    head: plan.head,
    approval: plan.approval,
    approved: true,
    phase: { kind: 'done', step: { kind: 'autoMergeAlreadyOn', waitingOn: [] } },
  };
  expect(shipDoneLine(view, undefined)).toBe('Approved #138. Auto-merge is on for #138 already');
  const job = {
    key: plan.key,
    owner: plan.owner,
    repo: plan.repo,
    number: plan.number,
    login: plan.login,
    kind: 'enqueue' as const,
    method: null,
    base: 'e4/queued',
    head: HEAD,
    already: false,
    state: { kind: 'enqueued' as const },
    together: null,
  };
  expect(shipDoneLine(view, job)).toBe('Approved and added #138 to the merge queue for e4/queued');
  expect(
    shipDoneLine({ ...view, approved: false, approval: { kind: 'ownPullRequest' } }, job),
  ).toBe('Added #138 to the merge queue for e4/queued');
});

it('names who pushed which revision after the approval it watched', () => {
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
  const said = watchedWords(watched, revisions, label, NOW);
  expect(said.title).toMatch(
    /^Lo turned off auto-merge: mira-chen pushed r3 2 min.* after you approved r2\.$/,
  );
  expect(
    watchedWords({ ...watched, kind: 'notTurnedOff', why: 'Not allowed.' }, undefined, label, NOW),
  ).toMatchObject({ tone: 'danger', detail: expect.stringContaining('Not allowed.') });
});
