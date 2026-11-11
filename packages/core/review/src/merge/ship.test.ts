import { unchecked } from '@lo/github';
import { expect, test } from 'vitest';

import { reviewRules, snapshot, viewer } from '../../test/snapshot.ts';
import {
  incomplete,
  type AutoMerge,
  type CheckState,
  type MergeSnapshot,
  type RequiredCheck,
  type Review,
  type ReviewRequest,
  type Viewer,
} from '../merge.ts';
import type { PendingReview } from '../pending.ts';
import type { Blocker } from './blockers.ts';
import type { MergeStateStatus, ReviewDecision, ReviewState } from './github.ts';
import {
  afterApproving,
  afterPush,
  approveAndShip,
  approves,
  asAsked,
  planWording,
  showsYourApproval,
  unwarnedAutoMerge,
  type Approval,
  type ApproveAndShip,
  type Plan,
  type Ship,
  type ShippedAutoMerge,
} from './ship.ts';

const HEAD = 'c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe';
const OLD_HEAD = '0d1d4ead0d1d4ead0d1d4ead0d1d4ead0d1d4ead';
const PUSHED = '5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e';
const URL = 'https://github.com/rozed-dev/playground/pull/12';

const APPROVE: Approval = { kind: 'approve' };
const OWN: Approval = { kind: 'ownPullRequest' };
const ALREADY: Approval = { kind: 'alreadyApproved' };
const SQUASH: Ship = { kind: 'merge', method: 'SQUASH' };
const ENQUEUE: Ship = { kind: 'enqueue' };

/** Bob's pull request, waiting only on one approval, which you, Alice, can give. */
function reviewing(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return snapshot({
    url: URL,
    mergeable: 'MERGEABLE',
    mergeState: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
    rules: reviewRules({ requiredApprovals: 1, dismissStaleReviews: true }),
    methods: { merge: true, squash: true, rebase: true },
    preferredMethod: 'SQUASH',
    viewer: viewer({
      login: 'alice',
      teams: ['rozed-dev/github'],
      canApprove: true,
      approvalCounts: true,
      canMerge: true,
      canEnableAutoMerge: true,
    }),
    head: HEAD,
    headOnScreen: HEAD,
    complete: true,
    ...fields,
  });
}

/** Two approvals required, so another one is still missing after yours. */
function needingAnotherApproval(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return reviewing({ rules: { ...reviewing().rules, requiredApprovals: 2 }, ...fields });
}

function withQueue(given: MergeSnapshot): MergeSnapshot {
  return {
    ...given,
    queue: { required: true, method: 'REBASE', inQueue: false, position: undefined },
  };
}

function withViewer(given: MergeSnapshot, fields: Partial<Viewer>): MergeSnapshot {
  return { ...given, viewer: { ...given.viewer, ...fields } };
}

/** An admin who could merge past the base branch's rules. */
function asAdmin(given: MergeSnapshot): MergeSnapshot {
  return withViewer(given, { canMergeAsAdmin: true });
}

/**
 * The pull request as GitHub reports it once your approval of the head has landed, with GitHub's
 * review decision and merge state then.
 */
function approved(
  given: MergeSnapshot,
  decision: ReviewDecision | undefined,
  mergeState: MergeStateStatus,
): MergeSnapshot {
  return {
    ...given,
    reviews: [...given.reviews, review(given.viewer.login, 'APPROVED', HEAD)],
    reviewDecision: decision,
    mergeState,
  };
}

function review(author: string, state: ReviewState, commit: string): Review {
  return { author, state, commit, counts: true, onBehalfOf: [] };
}

function check(name: string, state: CheckState): RequiredCheck {
  return { name, state, url: `https://github.com/rozed-dev/playground/runs/${name}` };
}

function failing(name: string, state: CheckState): Blocker {
  return { kind: 'check', check: check(name, state) };
}

function codeOwner(slug: string): ReviewRequest {
  return { reviewer: { kind: 'team', slug }, asCodeOwner: true };
}

function plan(approval: Approval, likely: Ship): ApproveAndShip {
  return {
    kind: 'plan',
    plan: {
      head: HEAD,
      approval,
      likely,
      staleApprovalWarning: false,
      approvalOutlivesPush: false,
    },
  };
}

/** The base branch's rules keep approvals when someone pushes. */
function keepingStaleApprovals(given: MergeSnapshot): MergeSnapshot {
  return { ...given, rules: { ...given.rules, dismissStaleReviews: false } };
}

/** Auto-merge, turned on by `by`. */
function autoMergeOn(by: string | undefined): AutoMerge {
  return { method: 'SQUASH', enabledBy: by };
}

/** The plan for a snapshot that gets one. */
function thePlan(given: MergeSnapshot): Plan {
  const shipping = approveAndShip(given);
  if (shipping.kind !== 'plan') throw new Error(`expected a plan, got ${JSON.stringify(shipping)}`);
  return shipping.plan;
}

function approvals(more: number): Blocker {
  return { kind: 'approvals', more, codeOwners: [] };
}

function autoMerge(waitingOn: Blocker[]): Ship {
  return { kind: 'autoMerge', method: 'SQUASH', waitingOn };
}

function blocked(blockers: Blocker[]): Ship {
  return { kind: 'stop', stop: { kind: 'blocked', blockers, autoMerge: false } };
}

function noAutoMerge(blockers: Blocker[]): Ship {
  return { kind: 'stop', stop: { kind: 'noAutoMerge', blockers } };
}

// The first step: what it approves, and what it expects to happen next.

test('it approves and expects to merge when your approval is all that is missing', () => {
  expect(approveAndShip(reviewing())).toEqual(plan(APPROVE, SQUASH));
});

test('it expects the first allowed method without a preference', () => {
  const unpreferred = reviewing({
    methods: { merge: false, squash: true, rebase: true },
    preferredMethod: undefined,
  });

  expect(approveAndShip(unpreferred)).toEqual(plan(APPROVE, SQUASH));
});

test('a remembered method no longer allowed falls back to githubs default for you', () => {
  const rebaseDisallowed = reviewing({
    methods: { merge: true, squash: true, rebase: false },
    preferredMethod: 'REBASE',
    defaultMethod: 'SQUASH',
  });
  const signedCommits = reviewing({
    preferredMethod: 'REBASE',
    defaultMethod: 'SQUASH',
    signedCommits: true,
  });
  const onlyRebase = reviewing({
    methods: { merge: false, squash: false, rebase: true },
    signedCommits: true,
  });

  expect(approveAndShip(rebaseDisallowed)).toEqual(plan(APPROVE, SQUASH));
  expect(approveAndShip(signedCommits)).toEqual(plan(APPROVE, SQUASH));
  expect(approveAndShip(onlyRebase)).toEqual(
    plan(APPROVE, { kind: 'stop', stop: { kind: 'noMethod' } }),
  );
});

test('it expects to join the queue on a branch that requires one', () => {
  expect(approveAndShip(withQueue(reviewing()))).toEqual(plan(APPROVE, ENQUEUE));
});

test('it does nothing when the head moved since what is on screen', () => {
  expect(approveAndShip(reviewing({ headOnScreen: OLD_HEAD }))).toEqual({
    kind: 'headMoved',
    onScreen: OLD_HEAD,
    head: HEAD,
  });
});

test('it does nothing without a head to approve', () => {
  for (const [head, headOnScreen] of [
    ['', HEAD],
    [HEAD, ''],
    ['', ''],
  ] as const) {
    expect(approveAndShip(reviewing({ head, headOnScreen }))).toEqual({ kind: 'headUnknown' });
  }
});

test('heads are the same whatever their case', () => {
  const upper = reviewing({
    head: HEAD.toUpperCase(),
    mergeState: 'CLEAN',
    reviewDecision: 'APPROVED',
    reviews: [review('alice', 'APPROVED', HEAD.toUpperCase())],
  });
  const given = thePlan(upper);
  const after = { ...upper, head: HEAD.toUpperCase() };

  expect(given.approval).toEqual(ALREADY);
  expect(afterApproving(after, given)).toEqual(SQUASH);
});

test('it does nothing to a draft', () => {
  expect(approveAndShip(reviewing({ draft: true }))).toEqual({ kind: 'draft' });
  expect(approveAndShip(reviewing({ mergeState: 'DRAFT' }))).toEqual({ kind: 'draft' });
});

test('it does nothing to a merged or closed pull request', () => {
  const merged = reviewing({ state: 'MERGED' });
  const closed = reviewing({ state: 'CLOSED', headOnScreen: OLD_HEAD });

  expect(approveAndShip(merged)).toEqual({ kind: 'merged' });
  expect(approveAndShip(closed)).toEqual({ kind: 'closed' });
});

test('it does nothing when you cannot approve someone elses pull request', () => {
  expect(approveAndShip(withViewer(reviewing(), { canApprove: false }))).toEqual({
    kind: 'cannotApprove',
  });
});

test('it skips approving your own pull request and expects to merge', () => {
  const own = withViewer(
    reviewing({
      mergeState: 'CLEAN',
      reviewDecision: 'APPROVED',
      reviews: [review('bob', 'APPROVED', HEAD)],
    }),
    { didAuthor: true, canApprove: false },
  );

  expect(approveAndShip(own)).toEqual(plan(OWN, SQUASH));
});

test('your own pull request waiting on an approval expects auto merge', () => {
  const own = withViewer(reviewing(), { didAuthor: true });

  expect(approveAndShip(own)).toEqual(plan(OWN, autoMerge([approvals(1)])));
});

test('it skips approving when you approved the head on screen', () => {
  const yours = reviewing({
    mergeState: 'CLEAN',
    reviewDecision: 'APPROVED',
    reviews: [review('alice', 'APPROVED', HEAD)],
  });

  expect(approveAndShip(yours)).toEqual(plan(ALREADY, SQUASH));
});

test('it approves again when you approved an older revision', () => {
  const older = reviewing({
    mergeState: 'CLEAN',
    reviewDecision: 'APPROVED',
    reviews: [review('alice', 'APPROVED', OLD_HEAD)],
  });

  expect(approveAndShip(older)).toEqual(plan(APPROVE, SQUASH));
});

test('it says when it approves again after your review was dismissed', () => {
  const dismissed = reviewing({ reviews: [review('alice', 'DISMISSED', HEAD)] });
  const dismissedEarlier = reviewing({ reviews: [review('alice', 'DISMISSED', OLD_HEAD)] });

  expect(approveAndShip(dismissed)).toEqual(plan({ kind: 'reapproveDismissed' }, SQUASH));
  expect(approveAndShip(dismissedEarlier)).toEqual(plan(APPROVE, SQUASH));
  expect(approves({ kind: 'reapproveDismissed' })).toBe(true);
  expect(approves(APPROVE)).toBe(true);
  expect(approves(OWN)).toBe(false);
  expect(approves(ALREADY)).toBe(false);
});

/** Your pending review, recorded on `commit`, with `comments` comments. */
function pendingOn(commit: string | undefined, comments: number): PendingReview {
  return { id: 'PRR_kwDOAbc', commit, comments };
}

test('it approves by submitting your pending review on the head on screen', () => {
  const pending = reviewing({ pendingReview: pendingOn(HEAD, 2) });
  const inAnotherCase = reviewing({ pendingReview: pendingOn(HEAD.toUpperCase(), 2) });
  // Your dismissed approval of the head is given again by submitting it.
  const dismissed = { ...pending, reviews: [review('alice', 'DISMISSED', HEAD)] };

  const submit: Approval = { kind: 'submitPending', comments: 2 };
  expect(approveAndShip(pending)).toEqual(plan(submit, SQUASH));
  expect(approveAndShip(inAnotherCase)).toEqual(plan(submit, SQUASH));
  expect(approveAndShip(dismissed)).toEqual(plan(submit, SQUASH));
  expect(approves(submit)).toBe(true);
});

test('it does nothing while your pending review is on another revision', () => {
  const elsewhere = reviewing({ pendingReview: pendingOn(OLD_HEAD, 1) });
  const onALostCommit = reviewing({ pendingReview: pendingOn(undefined, 1) });

  expect(approveAndShip(elsewhere)).toEqual({
    kind: 'pendingReviewElsewhere',
    refusal: { refusal: 'otherRevision', reviewOn: OLD_HEAD },
  });
  expect(approveAndShip(onALostCommit)).toEqual({
    kind: 'pendingReviewElsewhere',
    refusal: { refusal: 'otherRevision', reviewOn: undefined },
  });
});

test('a pending review changes nothing when approve and ship does not approve', () => {
  // Your own pull request: nothing's approved, so the pending review stays pending.
  const own = withViewer(
    reviewing({
      mergeState: 'CLEAN',
      reviewDecision: 'APPROVED',
      reviews: [review('bob', 'APPROVED', HEAD)],
      pendingReview: pendingOn(OLD_HEAD, 1),
    }),
    { didAuthor: true, canApprove: false },
  );
  // You approved the head on screen already, then started another review.
  const yours = reviewing({
    mergeState: 'CLEAN',
    reviewDecision: 'APPROVED',
    reviews: [review('alice', 'APPROVED', HEAD)],
    pendingReview: pendingOn(OLD_HEAD, 1),
  });
  // GitHub doesn't let you approve: that's what stops it.
  const cannot = withViewer(reviewing({ pendingReview: pendingOn(OLD_HEAD, 1) }), {
    canApprove: false,
  });

  expect(approveAndShip(own)).toEqual(plan(OWN, SQUASH));
  expect(approveAndShip(yours)).toEqual(plan(ALREADY, SQUASH));
  expect(approveAndShip(cannot)).toEqual({ kind: 'cannotApprove' });
});

test('it expects auto merge when another approval is still needed', () => {
  expect(approveAndShip(needingAnotherApproval())).toEqual(
    plan(APPROVE, autoMerge([approvals(1)])),
  );
});

test('your approval and one already given are expected to meet the count', () => {
  const given = needingAnotherApproval({ reviews: [review('carol', 'APPROVED', HEAD)] });

  expect(approveAndShip(given)).toEqual(plan(APPROVE, SQUASH));
});

test('it expects to join the queue when ready on a branch that requires one', () => {
  expect(approveAndShip(withQueue(needingAnotherApproval()))).toEqual(
    plan(APPROVE, { kind: 'enqueueWhenReady', waitingOn: [approvals(1)] }),
  );
});

test('your approval is expected to cover your teams code owner review', () => {
  const owned = reviewing({
    rules: { ...reviewing().rules, requiredApprovals: 1, codeOwnerReview: true },
    reviewRequests: [codeOwner('rozed-dev/github')],
  });

  expect(approveAndShip(owned)).toEqual(plan(APPROVE, SQUASH));
});

test('another teams code owner review is expected to be waited on', () => {
  const owned = reviewing({
    rules: { ...reviewing().rules, requiredApprovals: 1, codeOwnerReview: true },
    reviewRequests: [codeOwner('rozed-dev/github'), codeOwner('rozed-dev/ui')],
  });

  expect(approveAndShip(owned)).toEqual(
    plan(
      APPROVE,
      autoMerge([
        { kind: 'approvals', more: 0, codeOwners: [{ kind: 'team', slug: 'rozed-dev/ui' }] },
      ]),
    ),
  );
});

test('your approval is expected to replace your request for changes', () => {
  const requested = reviewing({
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [review('alice', 'CHANGES_REQUESTED', OLD_HEAD)],
  });

  expect(approveAndShip(requested)).toEqual(plan(APPROVE, SQUASH));
});

test('it expects to stop when someone else requested changes', () => {
  const requested = needingAnotherApproval({
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [review('carol', 'CHANGES_REQUESTED', OLD_HEAD)],
  });

  expect(approveAndShip(requested)).toEqual(
    plan(APPROVE, blocked([{ kind: 'changesRequested', by: ['carol'] }, approvals(1)])),
  );
});

test('changes requested by someone lo cannot name are expected to stay', () => {
  // Carol's request counts for GitHub, but Lo reads her as without write access: she lost it
  // after reviewing, or her review is past the page read.
  const unnamed = reviewing({
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [{ ...review('carol', 'CHANGES_REQUESTED', HEAD), counts: false }],
  });

  expect(approveAndShip(unnamed)).toEqual(
    plan(APPROVE, blocked([{ kind: 'changesRequested', by: [] }])),
  );
});

test('changes requested by you and someone else are expected to stay', () => {
  const both = reviewing({
    reviewDecision: 'CHANGES_REQUESTED',
    reviews: [
      review('alice', 'CHANGES_REQUESTED', OLD_HEAD),
      review('carol', 'CHANGES_REQUESTED', OLD_HEAD),
    ],
  });

  expect(approveAndShip(both)).toEqual(
    plan(APPROVE, blocked([{ kind: 'changesRequested', by: ['carol'] }])),
  );
});

test('github approving is expected to stand after your approval', () => {
  // Erin and Grace own the same files. Erin approved, which covers them, but GitHub keeps Grace's
  // request, so Lo alone would read her approval as missing.
  const covered = reviewing({
    mergeState: 'CLEAN',
    reviewDecision: 'APPROVED',
    rules: { ...reviewing().rules, requiredApprovals: 1, codeOwnerReview: true },
    reviews: [review('erin', 'APPROVED', HEAD)],
    reviewRequests: [{ reviewer: { kind: 'user', login: 'grace' }, asCodeOwner: true }],
  });
  const withoutAutoMerge = withViewer(covered, { canEnableAutoMerge: false });

  expect(approveAndShip(covered)).toEqual(plan(APPROVE, SQUASH));
  expect(approveAndShip(withoutAutoMerge)).toEqual(plan(APPROVE, SQUASH));
});

test('it expects to stop when a required check failed', () => {
  const failed = reviewing({
    requiredChecks: [check('build', 'failed'), check('test', 'running')],
  });

  expect(approveAndShip(failed)).toEqual(
    plan(APPROVE, blocked([failing('build', 'failed'), failing('test', 'running')])),
  );
});

test('it expects to stop on conflicts or an out of date branch', () => {
  const conflicting = reviewing({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
  const behind = reviewing({ outOfDate: 'yes' });

  for (const [given, blocker] of [
    [conflicting, { kind: 'conflicts' }],
    [behind, { kind: 'outOfDate' }],
  ] as const) {
    expect(approveAndShip(given)).toEqual(plan(APPROVE, blocked([blocker])));
  }
});

test('it expects auto merge while required checks run', () => {
  const running = reviewing({
    requiredChecks: [check('build', 'passed'), check('test', 'running'), check('e2e', 'missing')],
  });

  expect(approveAndShip(running)).toEqual(
    plan(APPROVE, autoMerge([failing('test', 'running'), failing('e2e', 'missing')])),
  );
});

test('a check nothing will report is expected to stop it', () => {
  const unreported = reviewing({ requiredChecks: [check('e2e', 'missing')] });

  expect(approveAndShip(unreported)).toEqual(
    plan(APPROVE, blocked([{ kind: 'notReported', check: check('e2e', 'missing') }])),
  );
});

test('it expects auto merge while github works out mergeability', () => {
  const unknown = reviewing({ mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' });

  expect(approveAndShip(unknown)).toEqual(
    plan(APPROVE, autoMerge([{ kind: 'checkingMergeability' }])),
  );
});

test('it expects to stop when you cannot turn on auto merge', () => {
  const cannot = withViewer(needingAnotherApproval(), { canEnableAutoMerge: false });

  expect(approveAndShip(cannot)).toEqual(plan(APPROVE, noAutoMerge([approvals(1)])));
});

test('merge when ready needs the repositorys auto merge setting too', () => {
  // GitHub refuses "Merge when ready" on a queue branch without it, as recorded on
  // rozed-dev/e2e: "Auto merge is not allowed for this repository".
  const waiting = withViewer(withQueue(needingAnotherApproval()), { canEnableAutoMerge: false });

  expect(approveAndShip(waiting)).toEqual(plan(APPROVE, noAutoMerge([approvals(1)])));
  // A queue that takes it now needs no auto-merge.
  const ready = withViewer(withQueue(reviewing()), { canEnableAutoMerge: false });
  expect(approveAndShip(ready)).toEqual(plan(APPROVE, ENQUEUE));
});

test('joining a queue now or when ready both need permission to merge', () => {
  const waiting = withViewer(withQueue(needingAnotherApproval()), { canMerge: false });
  const ready = withViewer(withQueue(reviewing()), { canMerge: false });

  expect(approveAndShip(waiting)).toEqual(plan(APPROVE, noAutoMerge([approvals(1)])));
  expect(approveAndShip(ready)).toEqual(
    plan(APPROVE, { kind: 'stop', stop: { kind: 'noPermission' } }),
  );
});

test('it expects nothing more when auto merge is already on', () => {
  const on: AutoMerge = { method: 'MERGE', enabledBy: 'bob' };
  const waiting = needingAnotherApproval({ autoMerge: on });
  const ready = reviewing({ autoMerge: on });

  expect(approveAndShip(waiting)).toEqual(
    plan(APPROVE, { kind: 'autoMergeAlreadyOn', waitingOn: [approvals(1)] }),
  );
  expect(approveAndShip(ready)).toEqual(
    plan(APPROVE, { kind: 'autoMergeAlreadyOn', waitingOn: [] }),
  );
});

test('it expects nothing more when the pull request is already queued', () => {
  const given = withQueue(
    reviewing({
      mergeState: 'CLEAN',
      reviewDecision: 'APPROVED',
      reviews: [review('carol', 'APPROVED', HEAD)],
    }),
  );
  const queued = { ...given, queue: { ...given.queue, inQueue: true } };

  expect(approveAndShip(queued)).toEqual(plan(APPROVE, { kind: 'alreadyQueued' }));
});

test('it expects to stop when you cannot merge', () => {
  expect(approveAndShip(withViewer(reviewing(), { canMerge: false }))).toEqual(
    plan(APPROVE, { kind: 'stop', stop: { kind: 'noPermission' } }),
  );
});

test('it expects to stop when no method is allowed', () => {
  const none = reviewing({ methods: { merge: false, squash: false, rebase: false } });

  expect(approveAndShip(none)).toEqual(plan(APPROVE, { kind: 'stop', stop: { kind: 'noMethod' } }));
});

test('an approval without write access is expected to leave the approval missing', () => {
  const reader = withViewer(reviewing(), {
    approvalCounts: false,
    canMerge: false,
    canEnableAutoMerge: false,
  });

  expect(approveAndShip(reader)).toEqual(plan(APPROVE, noAutoMerge([approvals(1)])));
});

test('a block lo cannot explain is expected to stop it', () => {
  const unexplained = reviewing({
    reviewDecision: 'APPROVED',
    reviews: [review('carol', 'APPROVED', HEAD)],
  });

  expect(approveAndShip(unexplained)).toEqual(
    plan(APPROVE, blocked([{ kind: 'unexplained', url: URL }])),
  );
});

test('a review github requires for a reason lo cannot see is expected to be waited on', () => {
  const unattributed = reviewing({ reviews: [review('carol', 'APPROVED', HEAD)] });

  expect(approveAndShip(unattributed)).toEqual(plan(APPROVE, autoMerge([approvals(0)])));
});

// The confirmation's wording.

test('the confirmation words what is likely to happen', () => {
  const checksRunning = reviewing({ requiredChecks: [check('test', 'running')] });
  const approvalChecksAndMergeability = needingAnotherApproval({
    mergeable: 'UNKNOWN',
    requiredChecks: [check('test', 'running')],
  });
  const autoMergeAlreadyOn = reviewing({ autoMerge: { method: 'SQUASH', enabledBy: undefined } });
  const deployment = reviewing({ requiredChecks: [check('deploy', 'awaitingApproval')] });
  const cannotMerge = withViewer(reviewing(), { canMerge: false });

  const cases: [MergeSnapshot, string][] = [
    [reviewing(), 'will likely merge'],
    [withQueue(reviewing()), 'will likely join the merge queue'],
    [checksRunning, 'will likely wait for checks, with auto-merge on'],
    [
      approvalChecksAndMergeability,
      'will likely wait for an approval, checks and GitHub to check mergeability, with ' +
        'auto-merge on',
    ],
    [
      withQueue(needingAnotherApproval()),
      'will likely wait for an approval, then join the merge queue',
    ],
    [deployment, "will likely wait for a deployment's approval, with auto-merge on"],
    [autoMergeAlreadyOn, 'will likely merge: auto-merge is on'],
    [reviewing({ outOfDate: 'yes' }), "will likely stop: something waiting won't fix blocks it"],
    [cannotMerge, "will likely stop: you can't merge into the base branch"],
  ];
  for (const [given, wording] of cases) {
    expect(planWording(thePlan(given))).toBe(wording);
  }
});

// Pushes while auto-merge is on.

test('the confirmation warns when a later push could merge with your approval', () => {
  const waiting = keepingStaleApprovals(needingAnotherApproval());
  const warning = thePlan(waiting);

  expect(warning.likely).toEqual(autoMerge([approvals(1)]));
  expect(warning.staleApprovalWarning).toBe(true);
  expect(planWording(warning)).toBe(
    'will likely wait for an approval, with auto-merge on. While auto-merge is on, a push ' +
      'could merge without a new review',
  );
});

test('the confirmation warns whenever the next step may be auto merge', () => {
  const queue = keepingStaleApprovals(withQueue(needingAnotherApproval()));
  const alreadyOn = {
    ...keepingStaleApprovals(needingAnotherApproval()),
    autoMerge: autoMergeOn('bob'),
  };
  // Expected to merge, but only if GitHub agrees once you've approved: otherwise auto-merge.
  const mergeIfGithubAgrees = keepingStaleApprovals(reviewing());
  const noReviewsRequired = reviewing({
    reviewDecision: undefined,
    rules: reviewRules({ dismissStaleReviews: true }),
    requiredChecks: [check('test', 'running')],
  });

  const unwarned = [queue, alreadyOn, mergeIfGithubAgrees, noReviewsRequired]
    .map(thePlan)
    .filter((given) => !given.staleApprovalWarning)
    .map((given) => given.likely);
  expect(unwarned).toEqual([]);
});

test('the confirmation does not warn when a push needs a new approval or it will not wait', () => {
  const dismissing = needingAnotherApproval();
  const latestPushApproved = needingAnotherApproval({
    rules: { ...keepingStaleApprovals(needingAnotherApproval()).rules, lastPushApproval: true },
  });
  const clean = keepingStaleApprovals(
    reviewing({
      mergeState: 'CLEAN',
      reviewDecision: 'APPROVED',
      reviews: [review('carol', 'APPROVED', HEAD)],
    }),
  );
  const stopping = keepingStaleApprovals(reviewing({ outOfDate: 'yes' }));

  for (const given of [dismissing, latestPushApproved, clean, stopping]) {
    const quiet = thePlan(given);
    expect(quiet.staleApprovalWarning).toBe(false);
    expect(planWording(quiet)).not.toContain('push');
  }
});

/** What approve and ship keeps of the auto-merge it turned on for `given`'s plan. */
function shipped(given: MergeSnapshot): ShippedAutoMerge {
  return { head: thePlan(given).head, enabledBy: given.viewer.login, method: 'SQUASH' };
}

test('a push after you approved turns off the auto merge lo turned on', () => {
  const waiting = keepingStaleApprovals(needingAnotherApproval());
  for (const enabledBy of ['alice', 'ALICE', undefined]) {
    const pushed = { ...waiting, head: PUSHED, autoMerge: autoMergeOn(enabledBy) };

    expect(afterPush(pushed, shipped(waiting))).toEqual({
      kind: 'turnOffAutoMerge',
      approved: HEAD,
      head: PUSHED,
    });
  }
});

/**
 * You looked at the push and approved it, leaving auto-merge on to merge it: Lo leaves it on, and
 * watches for a push after that approval instead.
 */
test('a push you approved leaves auto merge on and watching moves to it', () => {
  const waiting = keepingStaleApprovals(needingAnotherApproval());
  const approvedPush = {
    ...waiting,
    head: PUSHED,
    autoMerge: autoMergeOn('alice'),
    reviews: [review('alice', 'APPROVED', PUSHED)],
  };
  expect(afterPush(approvedPush, shipped(waiting))).toEqual({ kind: 'youApproved', head: PUSHED });

  // Watching from the push you approved: another push after it is turned off.
  const moved = { ...shipped(waiting), head: PUSHED };
  expect(afterPush(approvedPush, moved)).toEqual({ kind: 'watch' });
  const later = { ...approvedPush, head: HEAD };
  expect(afterPush(later, moved)).toEqual({
    kind: 'turnOffAutoMerge',
    approved: PUSHED,
    head: HEAD,
  });

  // An approval of another revision, or someone else's of the push, isn't yours of it.
  for (const reviews of [
    [review('alice', 'APPROVED', HEAD)],
    [review('bob', 'APPROVED', PUSHED)],
    [review('alice', 'COMMENTED', PUSHED)],
  ]) {
    expect(afterPush({ ...approvedPush, reviews }, shipped(waiting)).kind).toBe('turnOffAutoMerge');
  }
});

test('watching goes on until the auto merge lo turned on is gone', () => {
  const waiting = keepingStaleApprovals(needingAnotherApproval());
  const watched = shipped(waiting);
  const pushed = (given: MergeSnapshot): MergeSnapshot => ({
    ...given,
    head: PUSHED,
    autoMerge: autoMergeOn('alice'),
  });

  const cases: [string, MergeSnapshot, ReturnType<typeof afterPush>][] = [
    ['same head', { ...waiting, autoMerge: autoMergeOn('alice') }, { kind: 'watch' }],
    ['no head', { ...pushed(waiting), head: '' }, { kind: 'watch' }],
    // Turned off, by anyone, or never on: one turned on again later isn't Lo's.
    [
      'auto-merge off',
      { ...waiting, autoMerge: undefined },
      { kind: 'ended', ended: { kind: 'autoMergeOff' } },
    ],
    [
      'auto-merge off after a push',
      { ...pushed(waiting), autoMerge: undefined },
      { kind: 'ended', ended: { kind: 'autoMergeOff' } },
    ],
    [
      'someone else turned it on',
      { ...pushed(waiting), autoMerge: autoMergeOn('bob') },
      { kind: 'ended', ended: { kind: 'turnedOnBy', login: 'bob' } },
    ],
    // Turned off and on again, as GitHub can't change the method in place.
    [
      'another method',
      { ...pushed(waiting), autoMerge: { method: 'MERGE', enabledBy: 'alice' } },
      { kind: 'ended', ended: { kind: 'otherMethod', method: 'MERGE' } },
    ],
    [
      'stale approvals dismissed',
      pushed(needingAnotherApproval()),
      { kind: 'ended', ended: { kind: 'newApprovalNeeded', head: PUSHED } },
    ],
    [
      'merged',
      { ...pushed(waiting), state: 'MERGED' },
      { kind: 'ended', ended: { kind: 'merged' } },
    ],
    ['closed', { ...waiting, state: 'CLOSED' }, { kind: 'ended', ended: { kind: 'closed' } }],
  ];
  const outcomes = cases.map(([name, given]) => [name, afterPush(given, watched)]);
  expect(outcomes).toEqual(cases.map(([name, , then]) => [name, then]));
});

test('your own pull request gets no warning', () => {
  const stale = keepingStaleApprovals(needingAnotherApproval());
  const own = withViewer(stale, { didAuthor: true, canApprove: false });
  const quiet = thePlan(own);

  expect(quiet.approval).toEqual(OWN);
  expect(quiet.likely).toEqual(autoMerge([approvals(2)]));
  expect(quiet.staleApprovalWarning).toBe(false);
});

/** A plan likely to take `likely`, which warned of a push merging with the approval. */
function warned(likely: Ship): Plan {
  return {
    head: HEAD,
    approval: APPROVE,
    likely,
    staleApprovalWarning: true,
    approvalOutlivesPush: true,
  };
}

/** Whether `now` is what a plan likely to take `asked`, which warned, asked about. */
function named(asked: Ship, now: Ship): boolean {
  return asAsked(warned(asked), now);
}

test('only a step the confirmation named is taken', () => {
  const autoSquash = autoMerge([approvals(1)]);
  const whenReady: Ship = { kind: 'enqueueWhenReady', waitingOn: [approvals(1)] };
  const stop = noAutoMerge([approvals(1)]);

  // The same step, and the ones Lo's prediction swaps for.
  const swaps: [Ship, Ship][] = [
    [SQUASH, SQUASH],
    [SQUASH, autoSquash],
    [autoSquash, SQUASH],
    [ENQUEUE, whenReady],
    [whenReady, ENQUEUE],
  ];
  expect(swaps.filter(([asked, now]) => !named(asked, now))).toEqual([]);
  // Nothing more happens.
  expect([stop, { kind: 'alreadyQueued' } as const].filter((now) => !named(SQUASH, now))).toEqual(
    [],
  );
  // A step the confirmation didn't name: after a predicted stop, another method, or the queue
  // instead of a merge.
  const unnamed: [Ship, Ship][] = [
    [stop, SQUASH],
    [stop, ENQUEUE],
    [stop, autoSquash],
    [{ kind: 'alreadyQueued' }, ENQUEUE],
    [{ kind: 'autoMergeAlreadyOn', waitingOn: [] }, autoSquash],
    [SQUASH, { kind: 'merge', method: 'MERGE' }],
    [SQUASH, ENQUEUE],
    [whenReady, autoSquash],
  ];
  expect(unnamed.filter(([asked, now]) => named(asked, now))).toEqual([]);
});

/**
 * A merge GitHub already allowed, asked about without the stale-approval warning, never becomes
 * auto-merge where a push would count the approval: the question didn't say that a push could then
 * merge with it. Where it couldn't, the swap is still one ask.
 */
test('a merge asked without the warning never becomes auto merge', () => {
  const clean = keepingStaleApprovals(
    reviewing({
      mergeState: 'CLEAN',
      reviewDecision: 'APPROVED',
      reviews: [review('carol', 'APPROVED', HEAD)],
    }),
  );
  const merging = thePlan(clean);
  expect(merging.likely).toEqual(SQUASH);
  expect(merging.staleApprovalWarning).toBe(false);
  expect(merging.approvalOutlivesPush).toBe(true);
  const autoSquash = autoMerge([failing('test', 'running')]);
  expect(asAsked(merging, autoSquash)).toBe(false);
  expect(unwarnedAutoMerge(merging, autoSquash)).toBe(true);
  expect(asAsked(merging, SQUASH)).toBe(true);

  const queued = thePlan(withQueue(clean));
  expect(queued.likely).toEqual(ENQUEUE);
  const whenReady: Ship = { kind: 'enqueueWhenReady', waitingOn: [failing('test', 'running')] };
  expect(asAsked(queued, whenReady)).toBe(false);
  expect(unwarnedAutoMerge(queued, whenReady)).toBe(true);

  // A push needs a new approval there, or there's no approval of yours: nothing to warn of.
  for (const given of [
    { ...clean, rules: { ...clean.rules, dismissStaleReviews: true } },
    withViewer(clean, { didAuthor: true, canApprove: false }),
  ]) {
    const quiet = thePlan(given);
    expect(quiet.approvalOutlivesPush).toBe(false);
    expect(asAsked(quiet, autoSquash)).toBe(true);
    expect(unwarnedAutoMerge(quiet, autoSquash)).toBe(false);
  }
});

test('your approval shows once your latest review approves the head', () => {
  const reviewed = (reviews: Review[]) => reviewing({ reviews });

  expect(showsYourApproval(reviewing(), HEAD)).toBe(false);
  expect(showsYourApproval(reviewed([review('ALICE', 'APPROVED', OLD_HEAD)]), HEAD)).toBe(false);
  expect(showsYourApproval(reviewed([review('bob', 'APPROVED', HEAD)]), HEAD)).toBe(false);
  expect(showsYourApproval(reviewed([review('ALICE', 'APPROVED', HEAD)]), HEAD)).toBe(true);
});

// Snapshots that aren't complete.

/** `given`, with part of it left out. */
function partial(given: MergeSnapshot): MergeSnapshot {
  return { ...given, complete: false };
}

test('nothing acts on a snapshot github left part of out', () => {
  const given = thePlan(keepingStaleApprovals(needingAnotherApproval()));

  expect(approveAndShip(partial(reviewing()))).toEqual({
    kind: 'incomplete',
    incomplete: 'readAgain',
  });
  expect(afterApproving(partial(approved(reviewing(), 'APPROVED', 'CLEAN')), given)).toEqual({
    kind: 'stop',
    stop: { kind: 'incomplete', incomplete: 'readAgain' },
  });
  // A moved head with auto-merge left out, so it reads as off: never "nothing".
  const pushed = {
    ...partial(keepingStaleApprovals(needingAnotherApproval())),
    head: PUSHED,
    autoMerge: undefined,
  };
  const watched = shipped(keepingStaleApprovals(needingAnotherApproval()));
  expect(afterPush(pushed, watched)).toEqual({ kind: 'cantTell', approved: HEAD, head: PUSHED });
  const sameHead = { ...pushed, head: HEAD };
  expect(afterPush(sameHead, watched)).toEqual({ kind: 'incomplete', incomplete: 'readAgain' });
});

test('checks cut short are told apart from a part left out', () => {
  const cutShort = reviewing({ complete: false, checksCutShort: true });
  const given = thePlan(reviewing());

  expect(incomplete(cutShort)).toBe('checksCutShort');
  expect(incomplete(reviewing())).toBeUndefined();
  expect(approveAndShip(cutShort)).toEqual({ kind: 'incomplete', incomplete: 'checksCutShort' });
  expect(afterApproving(cutShort, given)).toEqual({
    kind: 'stop',
    stop: { kind: 'incomplete', incomplete: 'checksCutShort' },
  });
  // The checks don't decide what a push does to auto-merge, so they don't stop that.
  const watched: ShippedAutoMerge = { head: HEAD, enabledBy: 'alice', method: 'SQUASH' };
  const pushed = {
    ...keepingStaleApprovals(cutShort),
    head: PUSHED,
    autoMerge: autoMergeOn('alice'),
  };
  expect(afterPush(pushed, watched)).toEqual({
    kind: 'turnOffAutoMerge',
    approved: HEAD,
    head: PUSHED,
  });
  // With a part left out too, it can't tell.
  expect(afterPush({ ...pushed, leftOut: true }, watched).kind).toBe('cantTell');
});

// The second step: what GitHub reports after the approval decides.

test('it merges once github reports the pull request can merge', () => {
  const given = thePlan(reviewing());

  for (const mergeState of ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'] as const) {
    expect(afterApproving(approved(reviewing(), 'APPROVED', mergeState), given)).toEqual(SQUASH);
  }
});

test('it joins the queue once github reports the pull request can merge', () => {
  const queued = withQueue(reviewing());

  expect(afterApproving(approved(queued, 'APPROVED', 'CLEAN'), thePlan(queued))).toEqual(ENQUEUE);
});

test('it joins the queue when github reports only that the head is behind', () => {
  const queued = withQueue(reviewing());

  expect(afterApproving(approved(queued, 'APPROVED', 'BEHIND'), thePlan(queued))).toEqual(ENQUEUE);
});

test('it turns on auto merge when github still blocks for a rule lo cannot see', () => {
  // Copilot opened it, or a ruleset requires a reviewer for these files: GitHub still needs a
  // review after yours, and nothing in the snapshot says why.
  const given = thePlan(reviewing());
  const after = approved(reviewing(), 'REVIEW_REQUIRED', 'BLOCKED');

  expect(given.likely).toEqual(SQUASH);
  expect(afterApproving(after, given)).toEqual(autoMerge([approvals(0)]));
});

test('it never merges past a rule for an admin', () => {
  const admin = asAdmin(reviewing());
  const given = thePlan(admin);
  const reviewStillRequired = approved(admin, 'REVIEW_REQUIRED', 'BLOCKED');
  const blockedWithoutAReason = approved(admin, 'APPROVED', 'BLOCKED');

  expect(afterApproving(reviewStillRequired, given)).toEqual(autoMerge([approvals(0)]));
  expect(afterApproving(blockedWithoutAReason, given)).toEqual(
    blocked([{ kind: 'unexplained', url: URL }]),
  );
});

test('it turns on merge when ready when github still blocks a queue branch', () => {
  const admin = asAdmin(withQueue(reviewing()));
  const given = thePlan(admin);
  const after = approved(admin, 'REVIEW_REQUIRED', 'BLOCKED');

  expect(given.likely).toEqual(ENQUEUE);
  expect(afterApproving(after, given)).toEqual({
    kind: 'enqueueWhenReady',
    waitingOn: [approvals(0)],
  });
});

test('a code owner who only commented is waited on after your approval', () => {
  // Erin owns the files and left a comment. GitHub dropped her request, and a comment isn't an
  // opinionated review, so the snapshot can't name the owner GitHub still needs.
  const owned = reviewing({
    rules: { ...reviewing().rules, requiredApprovals: 1, codeOwnerReview: true },
  });
  const given = thePlan(owned);
  const after = approved(owned, 'REVIEW_REQUIRED', 'BLOCKED');

  expect(given.likely).toEqual(SQUASH);
  expect(afterApproving(after, given)).toEqual(autoMerge([approvals(0)]));
});

test('your approval meeting the count still waits when github wants another review', () => {
  // Two approvals required and Carol's given, so yours is expected to meet the count. But you
  // pushed the latest commit, and the rules require its approval by someone else.
  const counted = needingAnotherApproval({ reviews: [review('carol', 'APPROVED', OLD_HEAD)] });
  const given = thePlan(counted);
  const after = approved(counted, 'REVIEW_REQUIRED', 'BLOCKED');

  expect(given.likely).toEqual(SQUASH);
  expect(afterApproving(after, given)).toEqual(autoMerge([approvals(0)]));
});

test('it stops when someone pushed after you approved', () => {
  const given = thePlan(reviewing());
  const after = { ...approved(reviewing(), 'APPROVED', 'CLEAN'), head: PUSHED };

  expect(afterApproving(after, given)).toEqual({
    kind: 'stop',
    stop: { kind: 'headMoved', approved: HEAD, head: PUSHED },
  });
});

test('it stops when github reports no head after approving', () => {
  const given = thePlan(reviewing());
  const after = { ...approved(reviewing(), 'APPROVED', 'CLEAN'), head: '' };

  expect(afterApproving(after, given)).toEqual({ kind: 'stop', stop: { kind: 'headUnknown' } });
});

test('it stops when something waiting wont fix blocks it after approving', () => {
  const given = thePlan(reviewing());
  const approvedNow = approved(reviewing(), 'CHANGES_REQUESTED', 'BLOCKED');
  const after = {
    ...approvedNow,
    reviews: [...approvedNow.reviews, review('carol', 'CHANGES_REQUESTED', HEAD)],
    autoMerge: { method: 'SQUASH', enabledBy: 'bob' },
  } as const;

  expect(afterApproving(after, given)).toEqual({
    kind: 'stop',
    stop: {
      kind: 'blocked',
      blockers: [{ kind: 'changesRequested', by: ['carol'] }],
      autoMerge: true,
    },
  });
});

test('it stops when lo sees a blocker github does not report', () => {
  // GitHub says CLEAN, but the checks read beside it show a required one failed.
  const given = thePlan(reviewing());
  const after = {
    ...approved(reviewing(), 'APPROVED', 'CLEAN'),
    requiredChecks: [check('build', 'failed')],
  };

  expect(afterApproving(after, given)).toEqual(blocked([failing('build', 'failed')]));
});

test('it stops when the pull request was merged or closed meanwhile', () => {
  const given = thePlan(reviewing());
  for (const [state, blocker] of [
    ['MERGED', { kind: 'merged' }],
    ['CLOSED', { kind: 'closed' }],
  ] as const) {
    const after = { ...approved(reviewing(), 'APPROVED', 'CLEAN'), state };

    expect(afterApproving(after, given)).toEqual(blocked([blocker]));
  }
});

test('it does nothing more once approved when auto merge is on or it is queued', () => {
  const given = thePlan(needingAnotherApproval());
  const autoMergeAlreadyOn = {
    ...approved(needingAnotherApproval(), 'REVIEW_REQUIRED', 'BLOCKED'),
    autoMerge: { method: 'SQUASH', enabledBy: 'bob' },
  } as const;
  const approvedQueue = withQueue(approved(reviewing(), 'APPROVED', 'CLEAN'));
  const queued = {
    ...approvedQueue,
    queue: { ...approvedQueue.queue, inQueue: true, position: 1 },
  };

  expect(afterApproving(autoMergeAlreadyOn, given)).toEqual({
    kind: 'autoMergeAlreadyOn',
    waitingOn: [approvals(1)],
  });
  expect(afterApproving(queued, given)).toEqual({ kind: 'alreadyQueued' });
});

test('a read after github refuses auto merge on a clean pull request merges', () => {
  // Lo read UNKNOWN just before GitHub finished working out mergeability, so it turned on
  // auto-merge, and GitHub refused with "clean status". The read after that refusal merges.
  const given = thePlan(reviewing());
  const stale = { ...approved(reviewing(), 'APPROVED', 'UNKNOWN'), mergeable: 'UNKNOWN' } as const;
  const fresh = approved(reviewing(), 'APPROVED', 'CLEAN');

  expect(afterApproving(stale, given)).toEqual(autoMerge([{ kind: 'checkingMergeability' }]));
  expect(afterApproving(fresh, given)).toEqual(SQUASH);
});

test('it stops once approved when you cannot merge or turn on auto merge', () => {
  const given = thePlan(reviewing());
  const clean = withViewer(approved(reviewing(), 'APPROVED', 'CLEAN'), { canMerge: false });
  const waiting = withViewer(approved(reviewing(), 'REVIEW_REQUIRED', 'BLOCKED'), {
    canEnableAutoMerge: false,
  });

  expect(afterApproving(clean, given)).toEqual({ kind: 'stop', stop: { kind: 'noPermission' } });
  expect(afterApproving(waiting, given)).toEqual(noAutoMerge([approvals(0)]));
});

test('a merge state or step lo doesnt know never merges', () => {
  // GitHub's merge state is one newer than Lo, with nothing Lo sees blocking.
  const unknown = {
    ...approved(reviewing(), 'APPROVED', 'CLEAN'),
    mergeState: unchecked<MergeStateStatus>('MERGE_QUEUED'),
  };
  const now = afterApproving(unknown, thePlan(reviewing()));

  expect(now.kind).not.toBe('merge');
  expect(now.kind).not.toBe('enqueue');
  // And a step of a kind Lo doesn't know is never what the confirmation asked about.
  expect(asAsked(thePlan(reviewing()), unchecked<Ship>({ kind: 'somethingNew' }))).toBe(false);
});
