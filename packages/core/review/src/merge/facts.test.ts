import {
  mergeFactsComplete,
  noBranchRules,
  type BranchRule,
  type CheckFacts,
  type MergeFacts,
  type Protection,
  type PullRequestRule,
} from '@lo/github';
import { expect, test } from 'vitest';

import { blockers } from './blockers.ts';
import {
  methodsOf,
  mergeSnapshot,
  requiredCheck,
  requiredChecksOf,
  requiresSignedCommits,
  requiresUpToDate,
  reviewRulesOf,
  seesEveryRule,
  viewerOf,
  type Local,
} from './facts.ts';
import { methodList } from '../merge.ts';

const NOTHING_LOCAL: Local = {
  headOnScreen: '',
  preferredMethod: undefined,
  headContainsBase: undefined,
};

function pullRequestRule(fields: Partial<PullRequestRule>): BranchRule {
  return {
    kind: 'pullRequest',
    rule: {
      requiredApprovals: 0,
      codeOwnerReview: false,
      conversationResolution: false,
      dismissStaleReviews: false,
      lastPushApproval: false,
      allowedMethods: undefined,
      requiredReviewers: false,
      extraApprovalForCopilot: false,
      ...fields,
    },
  };
}

function protection(fields: Partial<Protection>): Protection {
  return {
    complete: false,
    requiredApprovals: 0,
    codeOwnerReview: false,
    conversationResolution: false,
    dismissStaleReviews: false,
    lastPushApproval: false,
    strict: false,
    requiredChecks: [],
    linearHistory: false,
    signatures: false,
    deployments: false,
    lockBranch: false,
    viewerCanPush: false,
    ...fields,
  };
}

/** An open pull request in a repository that allows every method, on `main` with `rules`. */
function withRules(rules: BranchRule[]): MergeFacts {
  return {
    login: '',
    repository: {
      archived: false,
      viewerPermission: undefined,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      viewerDefaultMergeMethod: undefined,
      squashTitle: '',
      squashMessage: '',
    },
    pullRequest: {
      url: '',
      state: 'OPEN',
      draft: false,
      locked: false,
      mergeable: '',
      mergeState: '',
      reviewDecision: undefined,
      head: '',
      base: '',
      baseTip: undefined,
      author: undefined,
      viewerDidAuthor: false,
      viewerCanMergeAsAdmin: false,
      viewerCanEnableAutoMerge: false,
      viewerCanDisableAutoMerge: false,
      queueRequired: false,
      inQueue: false,
      queuePosition: undefined,
      queueMethod: undefined,
      autoMerge: undefined,
      reviews: [],
      reviewRequests: [],
      viewerTeams: [],
      pendingReview: undefined,
      unresolvedThreads: 0,
      checks: [],
      checksPending: false,
      queuedApps: [],
    },
    stack: undefined,
    protection: undefined,
    rules: { ...noBranchRules('main'), rules },
    cutShort: [],
    leftOut: [],
  };
}

test('the strictest of the protection and the rulesets applies', () => {
  const facts = {
    ...withRules([
      pullRequestRule({ requiredApprovals: 2, lastPushApproval: true }),
      pullRequestRule({ requiredApprovals: 1, conversationResolution: true }),
    ]),
    protection: protection({ complete: true, requiredApprovals: 1, codeOwnerReview: true }),
  };

  expect(reviewRulesOf(facts)).toEqual({
    requiredApprovals: 2,
    codeOwnerReview: true,
    conversationResolution: true,
    dismissStaleReviews: false,
    lastPushApproval: true,
  });
});

test('each ruleset and linear history narrow the methods', () => {
  const squashOrRebase = pullRequestRule({ allowedMethods: ['squash', 'rebase'] });
  const mergeOrSquash = pullRequestRule({ allowedMethods: ['merge', 'squash'] });

  expect(methodList(methodsOf(withRules([squashOrRebase, mergeOrSquash])))).toEqual(['SQUASH']);
  expect(methodList(methodsOf(withRules([{ kind: 'requiredLinearHistory' }])))).toEqual([
    'SQUASH',
    'REBASE',
  ]);
  // Signed commits don't narrow them here: the merge rules leave out rebase themselves.
  const signed = withRules([{ kind: 'requiredSignatures' }]);
  expect(methodList(methodsOf(signed))).toHaveLength(3);
  expect(requiresSignedCommits(signed)).toBe(true);
});

test('copilots extra approval matters only on copilots pull requests', () => {
  const facts = withRules([pullRequestRule({ extraApprovalForCopilot: true })]);
  const by = (author: string): MergeFacts => ({
    ...facts,
    pullRequest: { ...facts.pullRequest, author },
  });

  expect(seesEveryRule(by('octocat'))).toBe(true);
  expect(seesEveryRule(by('Copilot'))).toBe(false);
});

test('up to date is required only with strict checks and a check to require', () => {
  const strict = (checks: { name: string; app: number | undefined }[]) =>
    withRules([{ kind: 'requiredStatusChecks', rule: { strict: true, checks } }]);
  expect(requiresUpToDate(strict([{ name: 'ci', app: undefined }]))).toBe(true);
  expect(requiresUpToDate(strict([]))).toBe(false);

  // Partly seen protection says nothing about it.
  const seenInPart = {
    ...withRules([]),
    protection: protection({ requiredChecks: [{ name: 'ci', app: undefined }] }),
  };
  expect(requiresUpToDate(seenInPart)).toBe(false);
  expect(seesEveryRule(seenInPart)).toBe(false);
});

/** The state of a required check run `ci` with `status` and `conclusion`. */
function run(status: string, conclusion?: string) {
  return requiredCheck({ kind: 'checkRun', name: 'ci', status, conclusion, url: undefined }).state;
}

test('an unknown value never reads as passing or mergeable', () => {
  expect(run('COMPLETED', 'SUCCESS')).toBe('passed');
  expect(run('COMPLETED', 'SOMETHING_NEW')).toBe('failed');
  expect(run('SOMETHING_NEW')).toBe('running');
  const status: CheckFacts = {
    kind: 'status',
    context: 'ci',
    state: 'SOMETHING_NEW',
    url: undefined,
  };
  expect(requiredCheck(status).state).toBe('running');

  const facts = withRules([]);
  const unknown = {
    ...facts,
    pullRequest: { ...facts.pullRequest, mergeable: 'SOMETHING_NEW', mergeState: 'MERGE_QUEUED' },
  };
  const snapshot = mergeSnapshot(unknown, NOTHING_LOCAL);
  expect(snapshot.mergeable).toBe('UNKNOWN');
  expect(snapshot.mergeState).toBe('UNKNOWN');
});

/** A pull request GitHub says is blocked, with `fields` over it. */
function blocked(fields: Partial<MergeFacts['pullRequest']> = {}): MergeFacts {
  const facts = withRules([]);
  return {
    ...facts,
    pullRequest: { ...facts.pullRequest, mergeable: 'MERGEABLE', mergeState: 'BLOCKED', ...fields },
  };
}

test('an unknown decision review or state never reads as permissive', () => {
  expect(seesEveryRule(blocked())).toBe(true);

  // A review decision newer than Lo: a review is still required.
  const decided = mergeSnapshot(blocked({ reviewDecision: 'SOMETHING_NEW' }), NOTHING_LOCAL);
  expect(decided.reviewDecision).toBe('REVIEW_REQUIRED');
  expect(blockers(decided).map((blocker) => blocker.kind)).toEqual(['approvals']);
  expect(decided.seesEveryRule).toBe(false);

  // A review in a state newer than Lo neither approves nor counts as yours.
  const reviewed = mergeSnapshot(
    blocked({
      reviews: [
        {
          author: 'octocat',
          state: 'SOMETHING_NEW',
          commit: undefined,
          authorCanPush: true,
          onBehalfOf: [],
        },
      ],
    }),
    NOTHING_LOCAL,
  );
  expect(reviewed.reviews).toEqual([]);
  expect(reviewed.seesEveryRule).toBe(false);

  // A pull request in a state newer than Lo is never open to merging or approving.
  const stated = mergeSnapshot(blocked({ state: 'SOMETHING_NEW' }), NOTHING_LOCAL);
  expect(stated.state).toBe('CLOSED');
  expect(stated.viewer.canApprove).toBe(false);
  expect(stated.seesEveryRule).toBe(false);
});

test('write access alone lets the account merge', () => {
  const facts = withRules([]);
  const as = (viewerPermission: string): MergeFacts => ({
    ...facts,
    repository: { ...facts.repository, viewerPermission },
    // Push restrictions that may keep it out: GitHub says so if it refuses the merge.
    protection: protection({ viewerCanPush: false }),
  });

  expect(viewerOf(as('WRITE')).canMerge).toBe(true);
  expect(viewerOf(as('TRIAGE')).canMerge).toBe(false);
});

/** Each required check's name and state. */
function states(read: MergeFacts): string[][] {
  return requiredChecksOf(read).map((check) => [check.name, check.state]);
}

test('a required check lo did not see is never missing', () => {
  const facts = withRules([
    {
      kind: 'requiredStatusChecks',
      rule: {
        strict: false,
        checks: [
          { name: 'ci', app: undefined },
          { name: 'lint', app: undefined },
        ],
      },
    },
  ]);
  facts.pullRequest.checks.push({
    kind: 'checkRun',
    name: 'lint',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    url: undefined,
  });
  const lint = ['lint', 'passed'];
  const ci = ['ci', 'missing'];
  expect(states(facts)).toEqual([lint, ci]);
  expect(mergeSnapshot(facts, NOTHING_LOCAL).complete).toBe(true);

  // More than 1,000 checks: `ci` may be past them. Reading again won't see them, but approve and
  // ship doesn't act on it.
  const cut: MergeFacts = { ...facts, cutShort: ['checks'] };
  expect(states(cut)).toEqual([lint]);
  expect(mergeFactsComplete(cut)).toBe(true);
  expect(mergeSnapshot(cut, NOTHING_LOCAL).complete).toBe(false);
  // Nothing was left out, which what a push does to auto-merge decides on.
  expect(mergeSnapshot(cut, NOTHING_LOCAL).leftOut).toBe(false);

  // GitHub left out a check, the checks, or the check suites, which say whether `ci` may still be
  // reported.
  for (const part of [
    'checks',
    'pullRequest.statusCheckRollup.contexts.nodes.3',
    'pullRequest.statusCheckRollup',
    'pullRequest.commits',
  ]) {
    const leftOut: MergeFacts = { ...facts, leftOut: [part] };
    expect(states(leftOut)).toEqual([lint]);
    expect(mergeSnapshot(leftOut, NOTHING_LOCAL).complete).toBe(false);
    expect(mergeSnapshot(leftOut, NOTHING_LOCAL).leftOut).toBe(true);
  }
  // Another part left out leaves the checks seen in full.
  const other: MergeFacts = { ...facts, leftOut: ['pullRequest.statusCheckRollupish'] };
  expect(states(other)).toEqual([lint, ci]);
});
