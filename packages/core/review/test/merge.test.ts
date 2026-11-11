/**
 * Merge status, merge actions and approve and ship for whole pull requests, from snapshots filled
 * the way `@lo/github`'s reads fill them: GraphQL's and REST's enum names, check runs and commit
 * statuses, and full commit SHAs.
 */

import { expect, test } from 'vitest';

import { githubEnum } from '../src/enums.ts';
import {
  checkRunState,
  commitStatusState,
  type AllowedMethods,
  type MergeSnapshot,
  type RequiredCheck,
  type Review,
  type ReviewRequest,
  type UnmetRule,
  type Viewer,
} from '../src/merge.ts';
import { mergeAction } from '../src/merge/action.ts';
import { blockers, type Blocker } from '../src/merge/blockers.ts';
import {
  CHECK_CONCLUSIONS,
  CHECK_STATUSES,
  MERGE_METHODS,
  MERGE_STATE_STATUSES,
  MERGEABLE_STATES,
  PULL_REQUEST_STATES,
  REVIEW_DECISIONS,
  REVIEW_STATES,
  STATUS_STATES,
} from '../src/merge/github.ts';
import {
  afterApproving,
  approveAndShip,
  planWording,
  type Approval,
  type ApproveAndShip,
  type Plan,
  type Ship,
} from '../src/merge/ship.ts';
import { mergeStatus } from '../src/merge/status.ts';
import { reviewRules, snapshot, viewer } from './snapshot.ts';

const HEAD = '4e1d2c9b7f3a5e60d8c1b2a3f4e5d6c7b8a9f0e1';
/** An earlier head. */
const OLD_HEAD = '77c0a1e3d5b7f9a1c3e5d7b9f1a3c5e7d9b1f3a5';

const APPROVE: Approval = { kind: 'approve' };

/**
 * A pull request as GraphQL reports it: `state`, `mergeable`, `mergeStateStatus` and
 * `reviewDecision`, with the head on screen up to date.
 */
function pullRequest(
  url: string,
  state: string,
  mergeable: string,
  mergeState: string,
  decision: string | undefined,
): MergeSnapshot {
  return snapshot({
    url,
    state: githubEnum(PULL_REQUEST_STATES, state),
    mergeable: githubEnum(MERGEABLE_STATES, mergeable),
    mergeState: githubEnum(MERGE_STATE_STATUSES, mergeState),
    reviewDecision: decision === undefined ? undefined : githubEnum(REVIEW_DECISIONS, decision),
    head: HEAD,
    headOnScreen: HEAD,
    // Read in full: approve and ship acts on nothing less.
    complete: true,
  });
}

/** An entry of `latestOpinionatedReviews`. */
function review(author: string, state: string, commit: string, onBehalfOf: string[]): Review {
  return { author, state: githubEnum(REVIEW_STATES, state), commit, counts: true, onBehalfOf };
}

/** A required check run, from its `status` and `conclusion`. */
function checkRun(name: string, status: string, conclusion?: string): RequiredCheck {
  return {
    name,
    state: checkRunState(
      githubEnum(CHECK_STATUSES, status),
      conclusion === undefined ? undefined : githubEnum(CHECK_CONCLUSIONS, conclusion),
    ),
    url: `https://github.com/acme/shop/actions/runs/${name}`,
  };
}

/** A required commit status, from its `state`. */
function commitStatus(context: string, state: string): RequiredCheck {
  const checkState = commitStatusState(githubEnum(STATUS_STATES, state));
  return {
    name: context,
    state: checkState,
    url: checkState === 'missing' ? undefined : `https://ci.acme.dev/${context}`,
  };
}

function check(found: RequiredCheck): Blocker {
  return { kind: 'check', check: found };
}

function codeOwner(slug: string): ReviewRequest {
  return { reviewer: { kind: 'team', slug }, asCodeOwner: true };
}

/** You, with write access, in the payments team. */
function you(fields: Partial<Viewer> = {}): Viewer {
  return viewer({
    login: 'mika',
    teams: ['acme/payments'],
    canApprove: true,
    approvalCounts: true,
    canMerge: true,
    canEnableAutoMerge: true,
    ...fields,
  });
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

/** The plan, with the confirmation warning that a later push could merge without a new review. */
function warned(given: ApproveAndShip): ApproveAndShip {
  const outlives = outlived(given);
  return outlives.kind === 'plan'
    ? { kind: 'plan', plan: { ...outlives.plan, staleApprovalWarning: true } }
    : outlives;
}

/**
 * The plan, where a push after the approval would still count it: the base branch's rules keep
 * approvals, and it isn't your own pull request.
 */
function outlived(given: ApproveAndShip): ApproveAndShip {
  return given.kind === 'plan'
    ? { kind: 'plan', plan: { ...given.plan, approvalOutlivesPush: true } }
    : given;
}

/** The plan for a snapshot that gets one. */
function thePlan(given: MergeSnapshot): Plan {
  const shipping = approveAndShip(given);
  if (shipping.kind !== 'plan') throw new Error(`expected a plan, got ${JSON.stringify(shipping)}`);
  return shipping.plan;
}

/** The pull request as GitHub reports it once your approval of the head has landed. */
function approvedByYou(given: MergeSnapshot, decision: string, mergeState: string): MergeSnapshot {
  return {
    ...given,
    reviews: [...given.reviews, review(given.viewer.login, 'APPROVED', HEAD, [])],
    reviewDecision: githubEnum(REVIEW_DECISIONS, decision),
    mergeState: githubEnum(MERGE_STATE_STATUSES, mergeState),
  };
}

function blocked(found: Blocker[]): Ship {
  return { kind: 'stop', stop: { kind: 'blocked', blockers: found, autoMerge: false } };
}

const ALL_METHODS: AllowedMethods = { merge: true, squash: true, rebase: true };

// A dependency bump: CI still running, one approval required, and you're the reviewer.

function dependencyBump(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4410',
      'OPEN',
      'MERGEABLE',
      'BLOCKED',
      'REVIEW_REQUIRED',
    ),
    rules: reviewRules({ requiredApprovals: 1 }),
    requiredChecks: [
      checkRun('build', 'COMPLETED', 'SUCCESS'),
      checkRun('test (ubuntu)', 'IN_PROGRESS'),
      checkRun('test (macos)', 'QUEUED'),
      checkRun('codecov/patch', 'COMPLETED', 'NEUTRAL'),
      commitStatus('license/cla', 'SUCCESS'),
    ],
    methods: ALL_METHODS,
    preferredMethod: 'SQUASH',
    viewer: you(),
    ...fields,
  };
}

/** The dependency bump's checks, with those at the indexes in `replaced` replaced. */
function bumpChecks(replaced: Record<number, RequiredCheck>): RequiredCheck[] {
  return dependencyBump().requiredChecks.map((found, index) => replaced[index] ?? found);
}

test('a dependency bump waits on ci and an approval', () => {
  const bump = dependencyBump();

  expect(blockers(bump)).toEqual([
    { kind: 'approvals', more: 1, codeOwners: [] },
    check(checkRun('test (ubuntu)', 'IN_PROGRESS')),
    check(checkRun('test (macos)', 'QUEUED')),
  ]);
  expect(mergeStatus(bump)).toMatchObject({ kind: 'waiting', autoMerge: false });
  expect(mergeAction(bump)).toEqual({ kind: 'notPossible', reason: { kind: 'blocked' } });
  expect(approveAndShip(bump)).toEqual(
    warned(
      plan(APPROVE, {
        kind: 'autoMerge',
        method: 'SQUASH',
        waitingOn: [
          check(checkRun('test (ubuntu)', 'IN_PROGRESS')),
          check(checkRun('test (macos)', 'QUEUED')),
        ],
      }),
    ),
  );
});

test('a dependency bump with ci done merges once github agrees after you approve', () => {
  const bump = dependencyBump({
    requiredChecks: bumpChecks({
      1: checkRun('test (ubuntu)', 'COMPLETED', 'SUCCESS'),
      2: checkRun('test (macos)', 'COMPLETED', 'SKIPPED'),
    }),
  });
  const given = thePlan(bump);

  expect(given.approval).toEqual(APPROVE);
  expect(given.likely).toEqual({ kind: 'merge', method: 'SQUASH' });
  expect(planWording(given)).toBe(
    'will likely merge. While auto-merge is on, a push could merge without a new review',
  );
  expect(afterApproving(approvedByYou(bump, 'APPROVED', 'CLEAN'), given)).toEqual({
    kind: 'merge',
    method: 'SQUASH',
  });
});

test('a dependency bump whose tests failed stops after approving', () => {
  const bump = dependencyBump({
    requiredChecks: bumpChecks({
      1: checkRun('test (ubuntu)', 'COMPLETED', 'FAILURE'),
      4: commitStatus('license/cla', 'EXPECTED'),
    }),
  });

  const given = thePlan(bump);
  const expected = [
    check(checkRun('test (ubuntu)', 'COMPLETED', 'FAILURE')),
    check(checkRun('test (macos)', 'QUEUED')),
    check(commitStatus('license/cla', 'EXPECTED')),
  ];
  expect(given.approval).toEqual(APPROVE);
  expect(given.likely).toEqual(blocked(expected));
  expect(afterApproving(approvedByYou(bump, 'APPROVED', 'BLOCKED'), given)).toEqual(
    blocked(expected),
  );
});

test('a failing status beside a passing check run of the same name blocks it', () => {
  const bump = dependencyBump({
    requiredChecks: [
      ...bumpChecks({
        1: checkRun('test (ubuntu)', 'COMPLETED', 'SUCCESS'),
        2: checkRun('test (macos)', 'COMPLETED', 'SUCCESS'),
      }),
      commitStatus('build', 'FAILURE'),
    ],
  });

  expect(blockers(bump)).toEqual([
    check(commitStatus('build', 'FAILURE')),
    { kind: 'approvals', more: 1, codeOwners: [] },
  ]);
});

test('a dependency bump pushed to while you read it stops before approving', () => {
  const pushed = dependencyBump({ head: 'a91f03b6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a6c8' });

  expect(approveAndShip(pushed)).toEqual({
    kind: 'headMoved',
    onScreen: HEAD,
    head: 'a91f03b6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a6c8',
  });
});

// A change across two code-owned areas of a monorepo, in a repository that requires code-owner
// review and resolved conversations.

function checkoutChange(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4398',
      'OPEN',
      'MERGEABLE',
      'BLOCKED',
      'REVIEW_REQUIRED',
    ),
    reviewRequests: [
      codeOwner('acme/payments'),
      codeOwner('acme/platform'),
      { reviewer: { kind: 'user', login: 'lee' }, asCodeOwner: false },
    ],
    rules: {
      requiredApprovals: 1,
      codeOwnerReview: true,
      conversationResolution: true,
      dismissStaleReviews: true,
      lastPushApproval: false,
    },
    requiredChecks: [checkRun('ci', 'COMPLETED', 'SUCCESS')],
    methods: { ...ALL_METHODS, merge: false },
    preferredMethod: 'MERGE',
    viewer: you(),
    ...fields,
  };
}

/** `given` approved by you on behalf of your team, which GitHub drops the request of. */
function approvedForPayments(given: MergeSnapshot): MergeSnapshot {
  const after = approvedByYou(given, 'REVIEW_REQUIRED', 'BLOCKED');
  const yours = after.reviews.at(-1);
  if (!yours) throw new Error('no review of yours');
  return {
    ...after,
    reviews: [...after.reviews.slice(0, -1), { ...yours, onBehalfOf: ['acme/payments'] }],
    reviewRequests: after.reviewRequests.slice(1),
  };
}

test('a change across code owned areas names the owners missing', () => {
  expect(blockers(checkoutChange())).toEqual([
    {
      kind: 'approvals',
      more: 1,
      codeOwners: [
        { kind: 'team', slug: 'acme/payments' },
        { kind: 'team', slug: 'acme/platform' },
      ],
    },
  ]);
});

test('your approval covers your team and auto merge waits for the other', () => {
  const change = checkoutChange();
  const otherTeam: Blocker = {
    kind: 'approvals',
    more: 0,
    codeOwners: [{ kind: 'team', slug: 'acme/platform' }],
  };
  const given = thePlan(change);

  expect(given.likely).toEqual({ kind: 'autoMerge', method: 'SQUASH', waitingOn: [otherTeam] });
  expect(planWording(given)).toBe('will likely wait for approvals, with auto-merge on');
  expect(afterApproving(approvedForPayments(change), given)).toEqual({
    kind: 'autoMerge',
    method: 'SQUASH',
    waitingOn: [otherTeam],
  });
});

test('once the other team approved your approval merges it', () => {
  const change = checkoutChange({
    reviews: [review('ana', 'APPROVED', HEAD, ['acme/platform'])],
  });

  expect(approveAndShip(change)).toEqual(plan(APPROVE, { kind: 'merge', method: 'SQUASH' }));
});

test('a code owner who only commented is waited on rather than merged past', () => {
  // The platform team's owner left a comment. GitHub dropped the team's request, and a comment
  // isn't an opinionated review, so nothing in the snapshot names the owner GitHub still needs.
  const original = checkoutChange();
  const change = {
    ...original,
    reviewRequests: original.reviewRequests.filter((_, index) => index !== 1),
  };
  const given = thePlan(change);

  expect(given.likely).toEqual({ kind: 'merge', method: 'SQUASH' });
  expect(afterApproving(approvedForPayments(change), given)).toEqual({
    kind: 'autoMerge',
    method: 'SQUASH',
    waitingOn: [{ kind: 'approvals', more: 0, codeOwners: [] }],
  });
});

test('unresolved conversations stop it after approving', () => {
  const unresolved = checkoutChange({ unresolvedThreads: 2 });

  expect(approveAndShip(unresolved)).toEqual(
    plan(
      APPROVE,
      blocked([
        { kind: 'conversations', unresolved: 2 },
        { kind: 'approvals', more: 0, codeOwners: [{ kind: 'team', slug: 'acme/platform' }] },
      ]),
    ),
  );
});

// A busy repository whose main branch requires a merge queue that squashes.

function queuedRepository(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4402',
      'OPEN',
      'MERGEABLE',
      'BLOCKED',
      'REVIEW_REQUIRED',
    ),
    reviews: [review('ana', 'APPROVED', HEAD, [])],
    rules: reviewRules({ requiredApprovals: 2 }),
    requiredChecks: [
      checkRun('lint', 'COMPLETED', 'SUCCESS'),
      checkRun('test', 'COMPLETED', 'SUCCESS'),
    ],
    queue: {
      required: true,
      method: githubEnum(MERGE_METHODS, 'SQUASH'),
      inQueue: false,
      position: undefined,
    },
    methods: ALL_METHODS,
    viewer: you(),
    ...fields,
  };
}

/** The busy repository's pull request once you've approved it and GitHub says it's clean. */
function approvedInQueuedRepository(): MergeSnapshot {
  const queued = queuedRepository();
  return {
    ...queued,
    reviews: [...queued.reviews, review('mika', 'APPROVED', HEAD, [])],
    reviewDecision: 'APPROVED',
    mergeState: 'CLEAN',
  };
}

test('a queue branch joins the queue once you approve', () => {
  const queued = queuedRepository();
  const given = thePlan(queued);

  expect(approveAndShip(queued)).toEqual(warned(plan(APPROVE, { kind: 'enqueue' })));
  expect(planWording(given)).toBe(
    'will likely join the merge queue. While auto-merge is on, a push could merge without a ' +
      'new review',
  );
  expect(afterApproving(approvedByYou(queued, 'APPROVED', 'CLEAN'), given)).toEqual({
    kind: 'enqueue',
  });
});

test('an approved pull request on a queue branch offers the queue', () => {
  const ready = approvedInQueuedRepository();

  expect(mergeAction(ready)).toEqual({ kind: 'enqueue', method: 'SQUASH' });
  expect(mergeStatus(ready)).toEqual({ kind: 'ready' });
  expect(approveAndShip(ready)).toEqual(
    outlived(plan({ kind: 'alreadyApproved' }, { kind: 'enqueue' })),
  );
});

test('a queued pull request shows its position and ships nothing more', () => {
  const ready = approvedInQueuedRepository();
  const queued = { ...ready, queue: { ...ready.queue, inQueue: true, position: 3 } };

  expect(mergeStatus(queued)).toEqual({ kind: 'queued', position: 3 });
  expect(mergeAction(queued)).toEqual({
    kind: 'notPossible',
    reason: { kind: 'queued', position: 3 },
  });
  expect(approveAndShip(queued)).toEqual(
    outlived(plan({ kind: 'alreadyApproved' }, { kind: 'alreadyQueued' })),
  );
});

test('a queue branch with another approval missing joins when ready', () => {
  const short = queuedRepository({ rules: reviewRules({ requiredApprovals: 3 }) });

  expect(approveAndShip(short)).toEqual(
    warned(
      plan(APPROVE, {
        kind: 'enqueueWhenReady',
        waitingOn: [{ kind: 'approvals', more: 1, codeOwners: [] }],
      }),
    ),
  );
});

// Your own pull request, as REST reports it.

function yourPullRequest(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4415',
      'open',
      'MERGEABLE',
      'blocked',
      'APPROVED',
    ),
    reviews: [review('ana', 'APPROVED', OLD_HEAD, [])],
    rules: reviewRules({ requiredApprovals: 1 }),
    requiredChecks: [commitStatus('ci/build', 'pending')],
    autoMerge: { method: githubEnum(MERGE_METHODS, 'rebase'), enabledBy: 'mika' },
    methods: ALL_METHODS,
    viewer: you({ didAuthor: true, canApprove: false }),
    ...fields,
  };
}

test('your pull request with auto merge on waits for ci', () => {
  const yours = yourPullRequest();

  expect(mergeStatus(yours)).toEqual({
    kind: 'waiting',
    blockers: [check(commitStatus('ci/build', 'pending'))],
    autoMerge: true,
    partial: true,
  });
  // Your own pull request has no approval of yours a push could merge with: no warning.
  expect(approveAndShip(yours)).toEqual(
    plan(
      { kind: 'ownPullRequest' },
      { kind: 'autoMergeAlreadyOn', waitingOn: [check(commitStatus('ci/build', 'pending'))] },
    ),
  );
});

test('your pull request with ci done merges without approving', () => {
  const yours = yourPullRequest({
    requiredChecks: [commitStatus('ci/build', 'success')],
    autoMerge: undefined,
    mergeState: githubEnum(MERGE_STATE_STATUSES, 'clean'),
    preferredMethod: 'REBASE',
  });

  expect(approveAndShip(yours)).toEqual(
    plan({ kind: 'ownPullRequest' }, { kind: 'merge', method: 'REBASE' }),
  );
});

// Pull requests that can't merge for reasons waiting won't fix.

/**
 * Every reason a conflicting draft can have at once. Being merged or closed, a block nothing
 * explains, GitHub working out mergeability and a check nothing will report can't happen beside
 * these, so other tests cover them.
 */
test('a conflicting draft lists every other reason it cannot merge', () => {
  const signatures: UnmetRule = {
    description: 'Commits must have verified signatures',
    url: undefined,
    waiting: false,
  };
  const deployment: UnmetRule = {
    description: 'Deployment to staging must succeed',
    url: 'https://github.com/acme/shop/deployments/staging',
    waiting: true,
  };
  const draft: MergeSnapshot = {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4377',
      'OPEN',
      'CONFLICTING',
      'DIRTY',
      'CHANGES_REQUESTED',
    ),
    draft: true,
    outOfDate: 'yes',
    reviews: [
      review('ana', 'CHANGES_REQUESTED', OLD_HEAD, []),
      review('lee', 'APPROVED', HEAD, []),
    ],
    reviewRequests: [codeOwner('acme/platform')],
    rules: reviewRules({
      requiredApprovals: 2,
      codeOwnerReview: true,
      conversationResolution: true,
    }),
    requiredChecks: [
      checkRun('build', 'COMPLETED', 'TIMED_OUT'),
      checkRun('e2e', 'WAITING'),
      checkRun('test', 'IN_PROGRESS'),
      commitStatus('license/cla', 'EXPECTED'),
    ],
    unresolvedThreads: 5,
    unmetRules: [deployment, signatures],
    viewer: you(),
    methods: ALL_METHODS,
  };

  const expected: Blocker[] = [
    { kind: 'draft' },
    { kind: 'conflicts' },
    { kind: 'outOfDate' },
    { kind: 'changesRequested', by: ['ana'] },
    check(checkRun('build', 'COMPLETED', 'TIMED_OUT')),
    { kind: 'conversations', unresolved: 5 },
    { kind: 'rule', rule: signatures },
    { kind: 'approvals', more: 1, codeOwners: [{ kind: 'team', slug: 'acme/platform' }] },
    check(checkRun('e2e', 'WAITING')),
    check(checkRun('test', 'IN_PROGRESS')),
    check(commitStatus('license/cla', 'EXPECTED')),
    { kind: 'rule', rule: deployment },
  ];
  expect(blockers(draft)).toEqual(expected);
  expect(mergeStatus(draft)).toEqual({
    kind: 'blocked',
    blockers: expected,
    autoMerge: false,
    partial: false,
  });
  expect(approveAndShip(draft)).toEqual({ kind: 'draft' });
});

test('a block github reports without a reason links to the pull request', () => {
  const unexplained = {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4390',
      'OPEN',
      'MERGEABLE',
      'BLOCKED',
      'APPROVED',
    ),
    reviews: [review('ana', 'APPROVED', HEAD, [])],
    requiredChecks: [checkRun('ci', 'COMPLETED', 'SUCCESS')],
    viewer: you(),
    methods: ALL_METHODS,
  };
  const why: Blocker = { kind: 'unexplained', url: 'https://github.com/acme/shop/pull/4390' };

  expect(blockers(unexplained)).toEqual([why]);
  expect(approveAndShip(unexplained)).toEqual(outlived(plan(APPROVE, blocked([why]))));
});

test('a merged pull request has nothing to do', () => {
  const merged = {
    ...pullRequest(
      'https://github.com/acme/shop/pull/4300',
      'MERGED',
      'UNKNOWN',
      'UNKNOWN',
      'APPROVED',
    ),
    viewer: you(),
  };

  expect(blockers(merged)).toEqual([{ kind: 'merged' }]);
  expect(mergeStatus(merged)).toEqual({ kind: 'merged' });
  expect(mergeAction(merged)).toEqual({ kind: 'notPossible', reason: { kind: 'merged' } });
  expect(approveAndShip(merged)).toEqual({ kind: 'merged' });
});
