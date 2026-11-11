import { expect, test } from 'vitest';

import { branchPath, branchRuleFromRest } from './rules.ts';

test('rules are read from rest and any lo does not model is other', () => {
  expect(
    branchRuleFromRest({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 2,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        allowed_merge_methods: ['squash', 'rebase'],
        required_reviewers: [],
        require_extra_approval_for_unattributed_changes: true,
      },
      ruleset_source_type: 'Organization',
      ruleset_source: 'acme',
      ruleset_id: 7,
    }),
  ).toEqual({
    kind: 'pullRequest',
    rule: {
      requiredApprovals: 2,
      codeOwnerReview: true,
      conversationResolution: true,
      dismissStaleReviews: true,
      lastPushApproval: false,
      allowedMethods: ['squash', 'rebase'],
      requiredReviewers: false,
      extraApprovalForCopilot: true,
    },
  });
  expect(
    branchRuleFromRest({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'ci', integration_id: 15368 }],
      },
    }),
  ).toEqual({
    kind: 'requiredStatusChecks',
    rule: { strict: true, checks: [{ name: 'ci', app: 15368 }] },
  });
  expect(
    branchRuleFromRest({ type: 'merge_queue', parameters: { merge_method: 'REBASE' } }),
  ).toEqual({ kind: 'mergeQueue', method: 'REBASE' });
  expect(branchRuleFromRest({ type: 'non_fast_forward' })).toEqual({
    kind: 'harmless',
    type: 'non_fast_forward',
  });
  for (const type of ['code_scanning', 'required_deployments', 'update', 'lock_branch', 'new']) {
    expect(branchRuleFromRest({ type, parameters: {} })).toEqual({ kind: 'other', type });
  }
  // Parameters Lo can't read: a rule it can't model.
  expect(branchRuleFromRest({ type: 'required_status_checks', parameters: {} })).toEqual({
    kind: 'other',
    type: 'required_status_checks',
  });
});

test('branch names are encoded for the path', () => {
  expect(branchPath('release/2.0')).toBe('release/2.0');
  expect(branchPath('fix#12 é')).toBe('fix%2312%20%C3%A9');
});
