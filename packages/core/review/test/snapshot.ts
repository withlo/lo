/**
 * Merge snapshots for tests, built from a few fields over a snapshot of nothing: an open pull
 * request whose mergeability GitHub is still working out, with no rules, reviews, checks or
 * methods, an account that may do nothing, and nothing read in full.
 */

import type { MergeSnapshot, ReviewRules, Viewer } from '../src/merge.ts';

/** Rules that require nothing, with `fields` over them. */
export function reviewRules(fields: Partial<ReviewRules> = {}): ReviewRules {
  return {
    requiredApprovals: 0,
    codeOwnerReview: false,
    conversationResolution: false,
    dismissStaleReviews: false,
    lastPushApproval: false,
    ...fields,
  };
}

/** An account with no login that may do nothing, with `fields` over it. */
export function viewer(fields: Partial<Viewer> = {}): Viewer {
  return {
    login: '',
    teams: [],
    didAuthor: false,
    canApprove: false,
    approvalCounts: false,
    canMerge: false,
    canMergeAsAdmin: false,
    canEnableAutoMerge: false,
    canDisableAutoMerge: false,
    ...fields,
  };
}

/** A snapshot of nothing, with `fields` over it. */
export function snapshot(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return {
    url: '',
    state: 'OPEN',
    draft: false,
    mergeable: 'UNKNOWN',
    mergeState: 'UNKNOWN',
    reviewDecision: undefined,
    reviews: [],
    reviewRequests: [],
    rules: reviewRules(),
    requiredChecks: [],
    checksPending: false,
    unresolvedThreads: 0,
    threadsCutShort: false,
    outOfDate: 'no',
    unmetRules: [],
    seesEveryRule: false,
    queue: { required: false, method: undefined, inQueue: false, position: undefined },
    autoMerge: undefined,
    methods: { merge: false, squash: false, rebase: false },
    signedCommits: false,
    preferredMethod: undefined,
    defaultMethod: undefined,
    viewer: viewer(),
    head: '',
    headOnScreen: '',
    pendingReview: undefined,
    complete: false,
    checksCutShort: false,
    leftOut: false,
    ...fields,
  };
}
