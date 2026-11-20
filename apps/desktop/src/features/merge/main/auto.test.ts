// What `a` and `⌥⏎` do in the merge panel, from what GitHub said: auto-merge on when only waits
// block, off when it's on, and a merge past the rules for an account that may, when rules are in
// the way; either goes only where a merge's write can name it, alone or a GitHub stack's bottom.

import { noBranchRules, type MergeFacts } from '@lo/github';
import type { Local } from '@lo/review';
import { expect, test } from 'vitest';

import { aloneOrBottom } from './auto.ts';
import { stateOf } from './status.ts';
import { factsOf, HEAD } from './test/facts.ts';

const LOCAL: Local = {
  headOnScreen: HEAD,
  preferredMethod: undefined,
  headContainsBase: undefined,
};
const PULL = { owner: 'rozed-dev', repo: 'e2e', number: 138 };

function stateFor(...args: Parameters<typeof factsOf>) {
  return stateOf({ facts: factsOf(...args), local: LOCAL, readAt: 5, pull: PULL });
}

type Pull = Partial<MergeFacts['pullRequest']>;
type Check = MergeFacts['pullRequest']['checks'][number];

const RUNNING: Check = {
  kind: 'checkRun',
  name: 'ci',
  status: 'IN_PROGRESS',
  conclusion: undefined,
  url: undefined,
};
const FAILED: Check = { ...RUNNING, status: 'COMPLETED', conclusion: 'FAILURE' };
const WAITING: Pull = { mergeState: 'BLOCKED', checksPending: true, checks: [RUNNING] };

test('`a` turns auto-merge on only when what blocks it is a wait, or one Lo can’t see all of', () => {
  expect(stateFor(WAITING).auto).toEqual({ kind: 'on' });
  expect(stateFor().auto).toEqual({ kind: 'notPossible', reason: 'ready' });
  expect(stateFor({ mergeState: 'BLOCKED', checks: [FAILED] }).auto).toEqual({
    kind: 'notPossible',
    reason: 'blocked',
  });
  // GitHub blocks it for what Lo can't see: auto-merge waits for that too.
  expect(stateFor({ mergeState: 'BLOCKED' }).auto).toEqual({ kind: 'on' });
  // GitHub says no, as for a repository that doesn't allow it.
  expect(stateFor({ ...WAITING, viewerCanEnableAutoMerge: false }).auto).toEqual({
    kind: 'notPossible',
    reason: 'notAllowed',
  });
  expect(stateFor({ ...WAITING, inQueue: true, queueRequired: true }).auto).toEqual({
    kind: 'notPossible',
    reason: 'queued',
  });
});

test('`a` with auto-merge on turns it off, when GitHub lets the account', () => {
  const on: Pull = { ...WAITING, autoMerge: { method: 'SQUASH', enabledBy: 'jun-park' } };
  expect(stateFor({ ...on, viewerCanDisableAutoMerge: true }).auto).toEqual({ kind: 'off' });
  expect(stateFor(on).auto).toEqual({ kind: 'notPossible', reason: 'cantTurnOff' });
});

test('`⌥⏎` merges past the rules for an account that may bypass them, when rules are in the way', () => {
  const owed: Pull = { mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' };
  expect(stateFor({ ...owed, viewerCanMergeAsAdmin: true }).override).toEqual({ kind: 'override' });
  expect(stateFor(owed).override).toEqual({ kind: 'notPossible', reason: 'noPermission' });
  expect(stateFor({ viewerCanMergeAsAdmin: true }).override).toEqual({
    kind: 'notPossible',
    reason: 'nothingToSkip',
  });
  // No rule makes these, so none is skipped.
  expect(stateFor({ ...owed, viewerCanMergeAsAdmin: true, draft: true }).override).toEqual({
    kind: 'notPossible',
    reason: 'draft',
  });
  expect(
    stateFor({
      ...owed,
      viewerCanMergeAsAdmin: true,
      mergeable: 'CONFLICTING',
      mergeState: 'DIRTY',
    }).override,
  ).toEqual({ kind: 'notPossible', reason: 'conflicts' });
  // GitHub merges past the rules only a GitHub stack's bottom layer.
  const stack = {
    number: 7,
    position: 2,
    base: 'main',
    baseRead: true,
    queueRequired: false,
    queueMethod: undefined,
  };
  expect(
    stateFor({ ...owed, viewerCanMergeAsAdmin: true, base: 'merge/7/stack-1' }, { stack }).override,
  ).toEqual({ kind: 'notPossible', reason: 'stackLayer' });
  expect(
    stateFor({ ...owed, viewerCanMergeAsAdmin: true }, { stack: { ...stack, position: 1 } })
      .override,
  ).toEqual({ kind: 'override' });
});

test('a push before auto-merge merges keeps the approvals unless the rules dismiss them', () => {
  expect(stateFor().afterPush).toBe('noReview');
  const review = {
    requiredApprovals: 1,
    codeOwnerReview: false,
    conversationResolution: false,
    dismissStaleReviews: false,
    lastPushApproval: false,
    allowedMethods: undefined,
    requiredReviewers: false,
    extraApprovalForCopilot: false,
  };
  const rulesWith = (rule: typeof review) => ({
    rules: { ...noBranchRules('main'), rules: [{ kind: 'pullRequest' as const, rule }] },
  });
  expect(stateFor({}, rulesWith(review)).afterPush).toBe('keepsApprovals');
  expect(stateFor({}, rulesWith({ ...review, dismissStaleReviews: true })).afterPush).toBe(
    'newApproval',
  );
});

test('either goes alone, or from a GitHub stack’s bottom layer, never with layers below it', () => {
  expect(aloneOrBottom({ kind: 'alone' }, 138, true)).toBeUndefined();
  expect(aloneOrBottom({ kind: 'githubStack', stack: 7, below: [] }, 138, false)).toBeUndefined();
  expect(aloneOrBottom({ kind: 'githubStack', stack: 7, below: [136, 137] }, 138, true)).toBe(
    'GitHub merges past the rules only a stack’s bottom layer, and #136 and #137 are below #138 in GitHub stack #7.',
  );
  expect(aloneOrBottom({ kind: 'githubStack', stack: 7, below: [137] }, 138, false)).toBe(
    '#137, below #138 in GitHub stack #7, would merge with it when auto-merge merges it. Merge #137 first.',
  );
  expect(aloneOrBottom({ kind: 'chainAbove', bottom: 136 }, 138, false)).toBe(
    'Merge #136 first: it’s this chain’s bottom layer.',
  );
});
