/**
 * GitHub's enums for a pull request's merge, by GitHub's GraphQL names. Each reads from its
 * GraphQL name (`HAS_HOOKS`) or its REST name (`has_hooks`) with `githubEnum`.
 */

import type {
  CheckConclusionState,
  CheckStatusState,
  MergeableState as GithubMergeableState,
  MergeStateStatus as GithubMergeStateStatus,
  PullRequestMergeMethod,
  PullRequestReviewDecision,
  PullRequestReviewState,
  PullRequestState as GithubPullRequestState,
  StatusState as GithubStatusState,
} from '@lo/github';

/** Whether a pull request is open. REST has only `open` and `closed`, with `merged` beside it. */
export const PULL_REQUEST_STATES = [
  'OPEN',
  'CLOSED',
  'MERGED',
] as const satisfies readonly GithubPullRequestState[];

/** Whether a pull request is open: GraphQL's `PullRequestState`. */
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/**
 * Whether a pull request merges without conflicts. `UNKNOWN` while GitHub is still working it
 * out, which it does in the background after a push to the head or the base, so a fresh read
 * usually has it. REST's `mergeable` is a nullable boolean: see {@link mergeableFromRest}.
 */
export const MERGEABLE_STATES = [
  'MERGEABLE',
  'CONFLICTING',
  'UNKNOWN',
] as const satisfies readonly GithubMergeableState[];

/** Whether a pull request merges without conflicts: GraphQL's `MergeableState`. */
export type MergeableState = (typeof MERGEABLE_STATES)[number];

/** REST's `mergeable`, as GraphQL names it: `true`, `false`, or `null` while GitHub works it out. */
export function mergeableFromRest(mergeable: boolean | null): MergeableState {
  if (mergeable === null) return 'UNKNOWN';
  return mergeable ? 'MERGEABLE' : 'CONFLICTING';
}

/**
 * GitHub's summary of whether a pull request can merge. It names one reason at a time, so a pull
 * request that's both blocked and out of date says only `BLOCKED`.
 *
 * - `BEHIND`: the base branch's rules require the head to be up to date with the base, and it
 *   isn't.
 * - `BLOCKED`: something the base branch's rules require is missing: reviews, checks, resolved
 *   conversations or another rule.
 * - `CLEAN`: it can merge, and its checks pass.
 * - `DIRTY`: it conflicts with the base.
 * - `DRAFT`: it's a draft. Deprecated in GraphQL in favour of `isDraft`, but REST still reports it.
 * - `HAS_HOOKS`: it can merge, and the server has pre-receive hooks.
 * - `UNKNOWN`: GitHub is still working it out.
 * - `UNSTABLE`: it can merge, but a check that isn't required hasn't passed.
 */
export const MERGE_STATE_STATUSES = [
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE',
] as const satisfies readonly GithubMergeStateStatus[];

/** GitHub's summary of whether a pull request can merge: GraphQL's `mergeStateStatus`, REST's `mergeable_state`. */
export type MergeStateStatus = (typeof MERGE_STATE_STATUSES)[number];

/** Where a pull request stands on review. */
export const REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REVIEW_REQUIRED',
] as const satisfies readonly PullRequestReviewDecision[];

/** Where a pull request stands on review: GraphQL's `PullRequestReviewDecision`. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** A review's state. */
export const REVIEW_STATES = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING',
] as const satisfies readonly PullRequestReviewState[];

/** A review's state: GraphQL's `PullRequestReviewState`, REST's review `state`. */
export type ReviewState = (typeof REVIEW_STATES)[number];

/** How a pull request merges, in the order GitHub's merge button lists them. */
export const MERGE_METHODS = [
  'MERGE',
  'SQUASH',
  'REBASE',
] as const satisfies readonly PullRequestMergeMethod[];

/**
 * How a pull request merges: GraphQL's `PullRequestMergeMethod`, which the merge queue's
 * `configuration.mergeMethod` uses too, and REST's `merge_method`.
 */
export type MergeMethod = (typeof MERGE_METHODS)[number];

/** Where a check run is. */
export const CHECK_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'WAITING',
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
] as const satisfies readonly CheckStatusState[];

/** Where a check run is: GraphQL's `CheckStatusState`, REST's check run `status`. */
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** How a completed check run ended. */
export const CHECK_CONCLUSIONS = [
  'SUCCESS',
  'NEUTRAL',
  'SKIPPED',
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
] as const satisfies readonly CheckConclusionState[];

/** How a completed check run ended: GraphQL's `CheckConclusionState`, REST's check run `conclusion`. */
export type CheckConclusion = (typeof CHECK_CONCLUSIONS)[number];

/** A commit status's state. `EXPECTED` is a required status that hasn't been reported on the commit yet. */
export const STATUS_STATES = [
  'SUCCESS',
  'PENDING',
  'FAILURE',
  'ERROR',
  'EXPECTED',
] as const satisfies readonly GithubStatusState[];

/** A commit status's state: GraphQL's `StatusState`, REST's status `state`. */
export type StatusState = (typeof STATUS_STATES)[number];
