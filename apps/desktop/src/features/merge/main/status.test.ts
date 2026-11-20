// A view's merge status from what GitHub said: the merge rules' verdict, reasons and action, the
// method auto-merge goes by, and only `https://` pages linked.

import { noBranchRules } from '@lo/github';
import type { Local } from '@lo/review';
import { expect, test } from 'vitest';

import { mergeState } from '../contract.ts';
import { pageOf, pagesOf, stateOf } from './status.ts';
import { factsOf, HEAD } from './test/facts.ts';

const LOCAL: Local = {
  headOnScreen: HEAD,
  preferredMethod: undefined,
  headContainsBase: undefined,
};
const PULL = { owner: 'rozed-dev', repo: 'e2e', number: 138 };

function stateFor(...args: Parameters<typeof factsOf>) {
  const state = stateOf({ facts: factsOf(...args), local: LOCAL, readAt: 5, pull: PULL });
  // What main sends has to be what the contract takes.
  expect(mergeState.safeParse(state).success).toBe(true);
  return state;
}

test('a clean pull request is ready, with the method remembered, else GitHub’s default', () => {
  const ready = stateFor();
  expect(ready).toMatchObject({
    verdict: 'ready',
    blockers: [],
    action: { kind: 'merge', methods: ['MERGE', 'SQUASH', 'REBASE'], method: 'MERGE' },
    picked: 'MERGE',
    base: 'main',
    partial: false,
    incomplete: null,
    readAt: 5,
  });
  const remembered = stateOf({
    facts: factsOf(),
    local: { ...LOCAL, preferredMethod: 'SQUASH' },
    readAt: 5,
    pull: PULL,
  });
  expect(remembered.action).toEqual({
    kind: 'merge',
    methods: ['MERGE', 'SQUASH', 'REBASE'],
    method: 'SQUASH',
  });
});

test('what blocks it comes as the merge rules order it, checks and their runs with it', () => {
  const state = stateFor({
    mergeState: 'BLOCKED',
    draft: true,
    reviewDecision: 'REVIEW_REQUIRED',
    checks: [
      {
        kind: 'checkRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        url: 'https://github.com/rozed-dev/e2e/actions/runs/1',
      },
      { kind: 'status', context: 'deploy', state: 'PENDING', url: 'http://ci.example/deploy' },
    ],
  });
  expect(state.verdict).toBe('blocked');
  expect(state.blockers.map((blocker) => blocker.kind)).toEqual([
    'draft',
    'check',
    'approvals',
    'check',
  ]);
  expect(state.blockers[1]).toEqual({
    kind: 'check',
    check: { name: 'ci', state: 'failed', url: 'https://github.com/rozed-dev/e2e/actions/runs/1' },
  });
  // A page that isn't `https://` goes as none, so the panel never opens it.
  expect(state.blockers[3]).toEqual({
    kind: 'check',
    check: { name: 'deploy', state: 'running', url: null },
  });
  expect(state.action).toEqual({ kind: 'notPossible', reason: 'blocked' });
  expect(state.checks).toEqual({ passed: 0, total: 2 });
  expect([...pagesOf(state)]).toEqual([
    'https://github.com/rozed-dev/e2e/pull/138',
    'https://github.com/rozed-dev/e2e/actions/runs/1',
  ]);
});

test('on a branch with a merge queue, auto-merge goes by the queue’s method, not what GitHub reports', () => {
  const queued = { queueRequired: true, autoMerge: { method: 'MERGE', enabledBy: 'rozed-bot' } };
  const known = stateFor({
    ...queued,
    queueMethod: 'SQUASH',
    mergeState: 'BLOCKED',
    checksPending: true,
    checks: [
      {
        kind: 'checkRun',
        name: 'ci',
        status: 'IN_PROGRESS',
        conclusion: undefined,
        url: undefined,
      },
    ],
  });
  expect(known.verdict).toBe('waiting');
  expect(known.autoMerge).toEqual({ method: 'SQUASH', by: 'rozed-bot' });
  expect(known.queue).toEqual({ required: true, method: 'SQUASH' });
  // Its settings hidden from the account: no method, rather than GitHub's merge commit.
  expect(stateFor({ ...queued, mergeState: 'BLOCKED' }).autoMerge).toEqual({
    method: null,
    by: 'rozed-bot',
  });
  // Elsewhere, the method GitHub reports.
  expect(
    stateFor({ autoMerge: { method: 'REBASE', enabledBy: undefined }, mergeState: 'BLOCKED' })
      .autoMerge,
  ).toEqual({ method: 'REBASE', by: null });
});

test('a queued pull request says where, and a ready one into a queue joins it', () => {
  expect(stateFor({ inQueue: true, queuePosition: 3 })).toMatchObject({
    verdict: 'queued',
    position: 3,
    action: { kind: 'notPossible', reason: 'queued' },
  });
  expect(
    stateFor(
      {},
      { rules: { ...noBranchRules('main'), rules: [{ kind: 'mergeQueue', method: 'SQUASH' }] } },
    ).action,
  ).toEqual({ kind: 'enqueue', method: 'SQUASH' });
});

test('a read GitHub left part of out, or whose checks were cut short, says so', () => {
  expect(stateFor({}, { leftOut: ['pullRequest.autoMergeRequest'] }).incomplete).toBe('readAgain');
  expect(stateFor({}, { cutShort: ['checks'] }).incomplete).toBe('checksCutShort');
  // A block Lo can't see all of, as when the rulesets couldn't be read.
  const partial = stateFor(
    { mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' },
    { rules: { ...noBranchRules('main'), unavailable: 'GitHub answered 403' } },
  );
  expect(partial.partial).toBe(true);
});

test('only an https page with a host is one the panel links', () => {
  expect(pageOf('https://github.com/rozed-dev/e2e/pull/1')).toBe(
    'https://github.com/rozed-dev/e2e/pull/1',
  );
  expect(pageOf('http://github.com/')).toBeNull();
  expect(pageOf('javascript:alert(1)')).toBeNull();
  expect(pageOf(undefined)).toBeNull();
  expect(pageOf(`https://github.com/${'a'.repeat(5000)}`)).toBeNull();
});

test('the approvals it needs say whether the base’s rules want a code owner’s too', () => {
  const rule = {
    requiredApprovals: 1,
    codeOwnerReview: true,
    conversationResolution: false,
    dismissStaleReviews: false,
    lastPushApproval: false,
    allowedMethods: undefined,
    requiredReviewers: false,
    extraApprovalForCopilot: false,
  };
  const approvals = (codeOwnerReview: boolean) =>
    stateFor(
      { mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' },
      {
        rules: {
          ...noBranchRules('main'),
          rules: [{ kind: 'pullRequest', rule: { ...rule, codeOwnerReview } }],
        },
      },
    ).blockers.find((blocker) => blocker.kind === 'approvals');
  // GitHub asked no code owner, as when the only one is the pull request's author.
  expect(approvals(true)).toEqual({
    kind: 'approvals',
    more: 1,
    codeOwners: [],
    codeOwnerRule: true,
  });
  expect(approvals(false)).toEqual({
    kind: 'approvals',
    more: 1,
    codeOwners: [],
    codeOwnerRule: false,
  });
});
