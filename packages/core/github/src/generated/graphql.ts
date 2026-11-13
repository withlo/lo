/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The possible states for a check suite or run conclusion. */
export type CheckConclusionState =
  /** The check suite or run requires action. */
  | 'ACTION_REQUIRED'
  /** The check suite or run has been cancelled. */
  | 'CANCELLED'
  /** The check suite or run has failed. */
  | 'FAILURE'
  /** The check suite or run was neutral. */
  | 'NEUTRAL'
  /** The check suite or run was skipped. */
  | 'SKIPPED'
  /** The check suite or run was marked stale by GitHub. Only GitHub can use this conclusion. */
  | 'STALE'
  /** The check suite or run has failed at startup. */
  | 'STARTUP_FAILURE'
  /** The check suite or run has succeeded. */
  | 'SUCCESS'
  /** The check suite or run has timed out. */
  | 'TIMED_OUT';

/** The possible states of a check run in a status rollup. */
export type CheckRunState =
  /** The check run requires action. */
  | 'ACTION_REQUIRED'
  /** The check run has been cancelled. */
  | 'CANCELLED'
  /** The check run has been completed. */
  | 'COMPLETED'
  /** The check run has failed. */
  | 'FAILURE'
  /** The check run is in progress. */
  | 'IN_PROGRESS'
  /** The check run was neutral. */
  | 'NEUTRAL'
  /** The check run is in pending state. */
  | 'PENDING'
  /** The check run has been queued. */
  | 'QUEUED'
  /** The check run was skipped. */
  | 'SKIPPED'
  /** The check run was marked stale by GitHub. Only GitHub can use this conclusion. */
  | 'STALE'
  /** The check run has failed at startup. */
  | 'STARTUP_FAILURE'
  /** The check run has succeeded. */
  | 'SUCCESS'
  /** The check run has timed out. */
  | 'TIMED_OUT'
  /** The check run is in waiting state. */
  | 'WAITING';

/** The possible states for a check suite or run status. */
export type CheckStatusState =
  /** The check suite or run has been completed. */
  | 'COMPLETED'
  /** The check suite or run is in progress. */
  | 'IN_PROGRESS'
  /** The check suite or run is in pending state. */
  | 'PENDING'
  /** The check suite or run has been queued. */
  | 'QUEUED'
  /** The check suite or run has been requested. */
  | 'REQUESTED'
  /** The check suite or run is in waiting state. */
  | 'WAITING';

/** The possible errors that will prevent a user from updating a comment. */
export type CommentCannotUpdateReason =
  /** Unable to create comment because repository is archived. */
  | 'ARCHIVED'
  /** You cannot update this comment */
  | 'DENIED'
  /** You must be the author or have write access to this repository to update this comment. */
  | 'INSUFFICIENT_ACCESS'
  /** Unable to create comment because issue is locked. */
  | 'LOCKED'
  /** You must be logged in to update this comment. */
  | 'LOGIN_REQUIRED'
  /** Repository is under maintenance. */
  | 'MAINTENANCE'
  /** At least one email address must be verified to update this comment. */
  | 'VERIFIED_EMAIL_REQUIRED';

/** The possible states for a deployment status. */
export type DeploymentStatusState =
  /** The deployment experienced an error. */
  | 'ERROR'
  /** The deployment has failed. */
  | 'FAILURE'
  /** The deployment is inactive. */
  | 'INACTIVE'
  /** The deployment is in progress. */
  | 'IN_PROGRESS'
  /** The deployment is pending. */
  | 'PENDING'
  /** The deployment is queued */
  | 'QUEUED'
  /** The deployment was successful. */
  | 'SUCCESS'
  /** The deployment is waiting. */
  | 'WAITING';

/** The possible sides of a diff. */
export type DiffSide =
  /** The left side of the diff. */
  | 'LEFT'
  /** The right side of the diff. */
  | 'RIGHT';

/** Specifies a review comment thread to be left with a Pull Request Review. */
export type DraftPullRequestReviewThread = {
  /** Body of the comment to leave. */
  body: string;
  /**
   * The line of the blob to which the thread refers. The end of the line range for
   * multi-line comments. Required if not using positioning.
   */
  line: number | null | undefined;
  /** Path to the file being commented on. Required if not using positioning. */
  path: string | null | undefined;
  /** The side of the diff on which the line resides. For multi-line comments, this is the side for the end of the line range. */
  side: DiffSide | null | undefined;
  /** The first line of the range to which the comment refers. */
  startLine: number | null | undefined;
  /** The side of the diff on which the start line resides. */
  startSide: DiffSide | null | undefined;
};

/** The possible viewed states of a file . */
export type FileViewedState =
  /** The file has new changes since last viewed. */
  | 'DISMISSED'
  /** The file has not been marked as viewed. */
  | 'UNVIEWED'
  /** The file has been marked as viewed. */
  | 'VIEWED';

/** The possible states for a merge queue entry. */
export type MergeQueueEntryState =
  /** The entry is currently waiting for checks to pass. */
  | 'AWAITING_CHECKS'
  /** The entry is currently locked. */
  | 'LOCKED'
  /** The entry is currently mergeable. */
  | 'MERGEABLE'
  /** The entry is currently queued. */
  | 'QUEUED'
  /** The entry is currently unmergeable. */
  | 'UNMERGEABLE';

/** The possible merging strategies for a merge queue. */
export type MergeQueueMergingStrategy =
  /** Entries only allowed to merge if they are passing. */
  | 'ALLGREEN'
  /** Failing Entires are allowed to merge if they are with a passing entry. */
  | 'HEADGREEN';

/** Detailed status information about a pull request merge. */
export type MergeStateStatus =
  /** The head ref is out of date. */
  | 'BEHIND'
  /** The merge is blocked. */
  | 'BLOCKED'
  /** Mergeable and passing commit status. */
  | 'CLEAN'
  /** The merge commit cannot be cleanly created. */
  | 'DIRTY'
  /** The merge is blocked due to the pull request being a draft. */
  | 'DRAFT'
  /** Mergeable with passing commit status and pre-receive hooks. */
  | 'HAS_HOOKS'
  /** The state cannot currently be determined. */
  | 'UNKNOWN'
  /** Mergeable with non-passing commit status. */
  | 'UNSTABLE';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** Represents available types of methods to use when merging a pull request. */
export type PullRequestMergeMethod =
  /** Add all commits from the head branch to the base branch with a merge commit. */
  | 'MERGE'
  /** Add all commits from the head branch onto the base branch individually. */
  | 'REBASE'
  /** Combine all commits from the head branch into a single commit in the base branch. */
  | 'SQUASH';

/** The possible states of a pull request review comment. */
export type PullRequestReviewCommentState =
  /** A comment that is part of a pending review */
  | 'PENDING'
  /** A comment that is part of a submitted review */
  | 'SUBMITTED';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** The possible events to perform on a pull request review. */
export type PullRequestReviewEvent =
  /** Submit feedback and approve merging these changes. */
  | 'APPROVE'
  /** Submit general feedback without explicit approval. */
  | 'COMMENT'
  /** Dismiss review so it now longer effects merging. */
  | 'DISMISS'
  /** Submit feedback that must be addressed before merging. */
  | 'REQUEST_CHANGES';

/** The possible states of a pull request review. */
export type PullRequestReviewState =
  /** A review allowing the pull request to merge. */
  | 'APPROVED'
  /** A review blocking the pull request from merging. */
  | 'CHANGES_REQUESTED'
  /** An informational review. */
  | 'COMMENTED'
  /** A review that has been dismissed. */
  | 'DISMISSED'
  /** A review that has not yet been submitted. */
  | 'PENDING';

/** The possible subject types of a pull request review comment. */
export type PullRequestReviewThreadSubjectType =
  /** A comment that has been made against the file of a pull request */
  | 'FILE'
  /** A comment that has been made against the line of a pull request */
  | 'LINE';

/** The possible states of a pull request. */
export type PullRequestState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that has been closed by being merged. */
  | 'MERGED'
  /** A pull request that is still open. */
  | 'OPEN';

/** The access level to a repository */
export type RepositoryPermission =
  /**
   * Can read, clone, and push to this repository. Can also manage issues, pull
   * requests, and repository settings, including adding collaborators
   */
  | 'ADMIN'
  /** Can read, clone, and push to this repository. They can also manage issues, pull requests, and some repository settings */
  | 'MAINTAIN'
  /** Can read and clone this repository. Can also moderate and edit issues and manage pull requests without write access */
  | 'MODERATE'
  /** Can read and clone this repository. Can also open and comment on issues and pull requests */
  | 'READ'
  /** Can read and clone this repository. Can also manage issues and pull requests */
  | 'TRIAGE'
  /** Can read and clone this repository. Can also moderate and edit issues and manage pull requests without write access */
  | 'TRIAGE_PLUS'
  /** Can read, clone, and push to this repository. Can also manage issues and pull requests */
  | 'WRITE';

/** The rule types supported in rulesets */
export type RepositoryRuleType =
  /** Authorization */
  | 'AUTHORIZATION'
  /** Branch name pattern */
  | 'BRANCH_NAME_PATTERN'
  /**
   * Enforce minimum line coverage thresholds on pull requests. This rule evaluates
   * uploaded coverage data but does not wait for coverage uploads. To ensure
   * coverage is evaluated before merging, make each status check associated with a
   * coverage upload a required status check.
   */
  | 'CODE_COVERAGE'
  /**
   * Choose which severity levels of code quality results should block pull request
   * merges. When configured, a code quality analysis must be done on the pull
   * request before the changes can be merged.
   */
  | 'CODE_QUALITY'
  /**
   * Choose which tools must provide code scanning results before the reference is
   * updated. When configured, code scanning must be enabled and have results for
   * both the commit and the reference being updated.
   */
  | 'CODE_SCANNING'
  /** Committer email pattern */
  | 'COMMITTER_EMAIL_PATTERN'
  /** Commit author email pattern */
  | 'COMMIT_AUTHOR_EMAIL_PATTERN'
  /** Commit message pattern */
  | 'COMMIT_MESSAGE_PATTERN'
  /**
   * Request Copilot code review for new pull requests automatically if the author
   * has access to Copilot code review and AI credits.
   */
  | 'COPILOT_CODE_REVIEW'
  /** Only allow users with bypass permission to create matching refs. */
  | 'CREATION'
  /** Only allow users with bypass permissions to delete matching refs. */
  | 'DELETION'
  /** Prevent commits that include files with specified file extensions from being pushed to the commit graph. */
  | 'FILE_EXTENSION_RESTRICTION'
  /**
   * Prevent commits that include changes in specified file and folder paths from
   * being pushed to the commit graph. This includes absolute paths that contain file names.
   */
  | 'FILE_PATH_RESTRICTION'
  /** Enforce any added or changed dependencies to comply with the organization's license policy. */
  | 'LICENSE_COMPLIANCE_SCANNING'
  /** Branch is read-only. Users cannot push to the branch. */
  | 'LOCK_BRANCH'
  /** Prevent commits that include file paths that exceed the specified character limit from being pushed to the commit graph. */
  | 'MAX_FILE_PATH_LENGTH'
  /** Prevent commits with individual files that exceed the specified limit from being pushed to the commit graph. */
  | 'MAX_FILE_SIZE'
  /** Max ref updates */
  | 'MAX_REF_UPDATES'
  /** Merges must be performed via a merge queue. */
  | 'MERGE_QUEUE'
  /** Merge queue locked ref */
  | 'MERGE_QUEUE_LOCKED_REF'
  /** Prevent users with push access from force pushing to refs. */
  | 'NON_FAST_FORWARD'
  /** Require all commits be made to a non-target branch and submitted via a pull request before they can be merged. */
  | 'PULL_REQUEST'
  /** Choose which environments must be successfully deployed to before refs can be pushed into a ref that matches this rule. */
  | 'REQUIRED_DEPLOYMENTS'
  /** Prevent merge commits from being pushed to matching refs. */
  | 'REQUIRED_LINEAR_HISTORY'
  /**
   * When enabled, all conversations on code must be resolved before a pull request
   * can be merged into a branch that matches this rule.
   */
  | 'REQUIRED_REVIEW_THREAD_RESOLUTION'
  /** Commits pushed to matching refs must have verified signatures. */
  | 'REQUIRED_SIGNATURES'
  /**
   * Choose which status checks must pass before the ref is updated. When enabled,
   * commits must first be pushed to another ref where the checks pass.
   */
  | 'REQUIRED_STATUS_CHECKS'
  /**
   * Require all commits be made to a non-target branch and submitted via a pull
   * request and required workflow checks to pass before they can be merged.
   */
  | 'REQUIRED_WORKFLOW_STATUS_CHECKS'
  /** Secret scanning */
  | 'SECRET_SCANNING'
  /** Tag */
  | 'TAG'
  /** Tag name pattern */
  | 'TAG_NAME_PATTERN'
  /** Only allow users with bypass permission to update matching refs. */
  | 'UPDATE'
  /** Require all changes made to a targeted branch to pass the specified workflows before they can be merged. */
  | 'WORKFLOWS'
  /** Workflow files cannot be modified. */
  | 'WORKFLOW_UPDATES';

/** The level of enforcement for a rule or ruleset. */
export type RuleEnforcement =
  /** Rules will be enforced */
  | 'ACTIVE'
  /** Do not evaluate or enforce rules */
  | 'DISABLED'
  /**
   * Allow admins to test rules before enforcing them. Admins can view insights on
   * the Rule Insights page (`evaluate` is only available with GitHub Enterprise).
   */
  | 'EVALUATE';

/** The possible default commit messages for squash merges. */
export type SquashMergeCommitMessage =
  /** Default to a blank commit message. */
  | 'BLANK'
  /** Default to the branch's commit messages. */
  | 'COMMIT_MESSAGES'
  /** Default to the pull request's body. */
  | 'PR_BODY';

/** The possible default commit titles for squash merges. */
export type SquashMergeCommitTitle =
  /** Default to the commit's title (if only one commit) or the pull request's title (when more than one commit). */
  | 'COMMIT_OR_PR_TITLE'
  /** Default to the pull request's title. */
  | 'PR_TITLE';

/** The possible commit status states. */
export type StatusState =
  /** Status is errored. */
  | 'ERROR'
  /** Status is expected. */
  | 'EXPECTED'
  /** Status is failing. */
  | 'FAILURE'
  /** Status is pending. */
  | 'PENDING'
  /** Status is successful. */
  | 'SUCCESS';

export type AddCommentMutationVariables = Exact<{
  subjectId: string;
  body: string;
}>;


export type AddCommentMutation = { addComment: { commentEdge: { node: { id: string } | null } | null } | null };

export type AddPullRequestReviewMutationVariables = Exact<{
  pullRequestId: string;
  commitOID: string;
  event: PullRequestReviewEvent | null | undefined;
  body: string | null | undefined;
  threads: Array<DraftPullRequestReviewThread> | DraftPullRequestReviewThread | null | undefined;
}>;


export type AddPullRequestReviewMutation = { addPullRequestReview: { pullRequestReview: { id: string, state: PullRequestReviewState, comments: { nodes: Array<{ id: string } | null> | null } } | null } | null };

export type AddPullRequestReviewThreadMutationVariables = Exact<{
  pullRequestReviewId: string;
  path: string;
  body: string;
  subjectType: PullRequestReviewThreadSubjectType;
  line: number | null | undefined;
  side: DiffSide | null | undefined;
  startLine: number | null | undefined;
  startSide: DiffSide | null | undefined;
}>;


export type AddPullRequestReviewThreadMutation = { addPullRequestReviewThread: { thread: { id: string, comments: { nodes: Array<{ id: string, commit: { oid: string } | null, pullRequestReview: { id: string } | null } | null> | null } } | null } | null };

export type AddPullRequestReviewThreadReplyMutationVariables = Exact<{
  pullRequestReviewThreadId: string;
  body: string;
  pullRequestReviewId: string | null | undefined;
}>;


export type AddPullRequestReviewThreadReplyMutation = { addPullRequestReviewThreadReply: { comment: { id: string, state: PullRequestReviewCommentState, pullRequestReview: { id: string, state: PullRequestReviewState } | null } | null } | null };

export type BranchProtectionQueryVariables = Exact<{
  owner: string;
  name: string;
  qualified: string;
  branch: string;
}>;


export type BranchProtectionQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { ref: { name: string, refUpdateRule: { requiredApprovingReviewCount: number | null, requiredStatusCheckContexts: Array<string | null> | null, requiresCodeOwnerReviews: boolean, requiresConversationResolution: boolean, requiresLinearHistory: boolean, requiresSignatures: boolean, viewerCanPush: boolean } | null, branchProtectionRule: { requiresApprovingReviews: boolean, requiredApprovingReviewCount: number | null, requiresCodeOwnerReviews: boolean, dismissesStaleReviews: boolean, requireLastPushApproval: boolean, requiresConversationResolution: boolean, requiresStatusChecks: boolean, requiresStrictStatusChecks: boolean, requiresLinearHistory: boolean, requiresCommitSignatures: boolean, requiresDeployments: boolean, lockBranch: boolean, requiredStatusChecks: Array<{ context: string, app: { databaseId: number | null } | null }> | null } | null } | null, mergeQueue: { configuration: { mergeMethod: PullRequestMergeMethod | null } | null } | null } | null };

export type BaseRulesFragment = { refUpdateRule: { requiredApprovingReviewCount: number | null, requiredStatusCheckContexts: Array<string | null> | null, requiresCodeOwnerReviews: boolean, requiresConversationResolution: boolean, requiresLinearHistory: boolean, requiresSignatures: boolean, viewerCanPush: boolean } | null, branchProtectionRule: { requiresApprovingReviews: boolean, requiredApprovingReviewCount: number | null, requiresCodeOwnerReviews: boolean, dismissesStaleReviews: boolean, requireLastPushApproval: boolean, requiresConversationResolution: boolean, requiresStatusChecks: boolean, requiresStrictStatusChecks: boolean, requiresLinearHistory: boolean, requiresCommitSignatures: boolean, requiresDeployments: boolean, lockBranch: boolean, requiredStatusChecks: Array<{ context: string, app: { databaseId: number | null } | null }> | null } | null };

export type DeleteIssueCommentMutationVariables = Exact<{
  id: string;
}>;


export type DeleteIssueCommentMutation = { deleteIssueComment: { clientMutationId: string | null } | null };

export type DeletePullRequestReviewMutationVariables = Exact<{
  pullRequestReviewId: string;
}>;


export type DeletePullRequestReviewMutation = { deletePullRequestReview: { pullRequestReview: { id: string } | null } | null };

export type DeletePullRequestReviewCommentMutationVariables = Exact<{
  id: string;
}>;


export type DeletePullRequestReviewCommentMutation = { deletePullRequestReviewComment: { pullRequestReview: { id: string } | null } | null };

export type DequeuePullRequestMutationVariables = Exact<{
  id: string;
}>;


export type DequeuePullRequestMutation = { dequeuePullRequest: { mergeQueueEntry: { id: string, position: number, state: MergeQueueEntryState, jump: boolean, solo: boolean, enqueuedAt: string, estimatedTimeToMerge: number | null, headCommit: { oid: string } | null, pullRequest: { number: number } | null } | null } | null };

export type DisablePullRequestAutoMergeMutationVariables = Exact<{
  pullRequestId: string;
}>;


export type DisablePullRequestAutoMergeMutation = { disablePullRequestAutoMerge: { pullRequest: { number: number, headRefOid: string, state: PullRequestState, isInMergeQueue: boolean, autoMergeRequest: { mergeMethod: PullRequestMergeMethod, enabledAt: string | null, commitHeadline: string | null, commitBody: string | null, enabledBy:
          | { __typename: 'Bot', login: string }
          | { __typename: 'EnterpriseUserAccount', login: string }
          | { __typename: 'Mannequin', login: string }
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         | null } | null } | null } | null };

export type EnablePullRequestAutoMergeMutationVariables = Exact<{
  pullRequestId: string;
  mergeMethod: PullRequestMergeMethod;
  expectedHeadOid: string;
  commitHeadline: string | null | undefined;
  commitBody: string | null | undefined;
}>;


export type EnablePullRequestAutoMergeMutation = { enablePullRequestAutoMerge: { pullRequest: { number: number, headRefOid: string, state: PullRequestState, isInMergeQueue: boolean, autoMergeRequest: { mergeMethod: PullRequestMergeMethod, enabledAt: string | null, commitHeadline: string | null, commitBody: string | null, enabledBy:
          | { __typename: 'Bot', login: string }
          | { __typename: 'EnterpriseUserAccount', login: string }
          | { __typename: 'Mannequin', login: string }
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         | null } | null } | null } | null };

export type EnqueuePullRequestMutationVariables = Exact<{
  pullRequestId: string;
  expectedHeadOid: string;
  jump: boolean;
}>;


export type EnqueuePullRequestMutation = { enqueuePullRequest: { mergeQueueEntry: { id: string, position: number, state: MergeQueueEntryState, jump: boolean, solo: boolean, enqueuedAt: string, estimatedTimeToMerge: number | null, headCommit: { oid: string } | null, pullRequest: { number: number } | null } | null } | null };

export type MarkFileAsViewedMutationVariables = Exact<{
  pullRequestId: string;
  path: string;
}>;


export type MarkFileAsViewedMutation = { markFileAsViewed: { pullRequest: { id: string } | null } | null };

export type MergeChecksQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  after: string;
}>;


export type MergeChecksQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { headRefOid: string, statusCheckRollup: { contexts: { pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
            | { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string, isRequired: boolean }
            | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null, isRequired: boolean }
           | null> | null } } | null } | null } | null };

type MergeCheck_CheckRun_Fragment = { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string, isRequired: boolean };

type MergeCheck_StatusContext_Fragment = { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null, isRequired: boolean };

export type MergeCheckFragment =
  | MergeCheck_CheckRun_Fragment
  | MergeCheck_StatusContext_Fragment
;

export type MergeQueueQueryVariables = Exact<{
  owner: string;
  name: string;
  branch: string;
}>;


export type MergeQueueQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { mergeQueue: { id: string, url: string, nextEntryEstimatedTimeToMerge: number | null, configuration: { mergeMethod: PullRequestMergeMethod | null, mergingStrategy: MergeQueueMergingStrategy | null, checkResponseTimeout: number | null, maximumEntriesToBuild: number | null, maximumEntriesToMerge: number | null, minimumEntriesToMerge: number | null, minimumEntriesToMergeWaitTime: number | null } | null, entries: { totalCount: number, nodes: Array<{ id: string, position: number, state: MergeQueueEntryState, enqueuedAt: string, estimatedTimeToMerge: number | null, jump: boolean, solo: boolean, enqueuer:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
          , baseCommit: { oid: string } | null, headCommit: { oid: string } | null, pullRequest: { id: string, number: number, title: string, url: string, headRefOid: string, viewerDidAuthor: boolean, author:
              | { __typename: 'Bot', login: string }
              | { __typename: 'EnterpriseUserAccount', login: string }
              | { __typename: 'Mannequin', login: string }
              | { __typename: 'Organization', login: string }
              | { __typename: 'User', login: string }
             | null } | null } | null> | null } | null } | null } | null };

export type MergeSnapshotQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  login: string;
}>;


export type MergeSnapshotQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { isArchived: boolean, viewerPermission: RepositoryPermission | null, mergeCommitAllowed: boolean, squashMergeAllowed: boolean, rebaseMergeAllowed: boolean, viewerDefaultMergeMethod: PullRequestMergeMethod, squashMergeCommitTitle: SquashMergeCommitTitle, squashMergeCommitMessage: SquashMergeCommitMessage, pullRequest: { url: string, state: PullRequestState, isDraft: boolean, locked: boolean, mergeable: MergeableState, mergeStateStatus: MergeStateStatus, reviewDecision: PullRequestReviewDecision | null, headRefOid: string, baseRefName: string, viewerDidAuthor: boolean, viewerCanMergeAsAdmin: boolean, viewerCanEnableAutoMerge: boolean, viewerCanDisableAutoMerge: boolean, isMergeQueueEnabled: boolean, isInMergeQueue: boolean, author:
        | { __typename: 'Bot', login: string }
        | { __typename: 'EnterpriseUserAccount', login: string }
        | { __typename: 'Mannequin', login: string }
        | { __typename: 'Organization', login: string }
        | { __typename: 'User', login: string }
       | null, baseRef: { target:
          | { __typename: 'Blob', oid: string }
          | { __typename: 'Commit', oid: string }
          | { __typename: 'Tag', oid: string }
          | { __typename: 'Tree', oid: string }
         | null, refUpdateRule: { requiredApprovingReviewCount: number | null, requiredStatusCheckContexts: Array<string | null> | null, requiresCodeOwnerReviews: boolean, requiresConversationResolution: boolean, requiresLinearHistory: boolean, requiresSignatures: boolean, viewerCanPush: boolean } | null, branchProtectionRule: { requiresApprovingReviews: boolean, requiredApprovingReviewCount: number | null, requiresCodeOwnerReviews: boolean, dismissesStaleReviews: boolean, requireLastPushApproval: boolean, requiresConversationResolution: boolean, requiresStatusChecks: boolean, requiresStrictStatusChecks: boolean, requiresLinearHistory: boolean, requiresCommitSignatures: boolean, requiresDeployments: boolean, lockBranch: boolean, requiredStatusChecks: Array<{ context: string, app: { databaseId: number | null } | null }> | null } | null } | null, stackEntry: { position: number, stack: { number: number, baseRefName: string, entries: { nodes: Array<{ pullRequest: { baseRefName: string, isMergeQueueEnabled: boolean, baseRef: { refUpdateRule: { requiredApprovingReviewCount: number | null, requiredStatusCheckContexts: Array<string | null> | null, requiresCodeOwnerReviews: boolean, requiresConversationResolution: boolean, requiresLinearHistory: boolean, requiresSignatures: boolean, viewerCanPush: boolean } | null, branchProtectionRule: { requiresApprovingReviews: boolean, requiredApprovingReviewCount: number | null, requiresCodeOwnerReviews: boolean, dismissesStaleReviews: boolean, requireLastPushApproval: boolean, requiresConversationResolution: boolean, requiresStatusChecks: boolean, requiresStrictStatusChecks: boolean, requiresLinearHistory: boolean, requiresCommitSignatures: boolean, requiresDeployments: boolean, lockBranch: boolean, requiredStatusChecks: Array<{ context: string, app: { databaseId: number | null } | null }> | null } | null } | null, mergeQueue: { configuration: { mergeMethod: PullRequestMergeMethod | null } | null } | null } | null } | null> | null } } | null } | null, mergeQueueEntry: { position: number } | null, mergeQueue: { configuration: { mergeMethod: PullRequestMergeMethod | null } | null } | null, autoMergeRequest: { mergeMethod: PullRequestMergeMethod, enabledBy:
          | { __typename: 'Bot', login: string }
          | { __typename: 'EnterpriseUserAccount', login: string }
          | { __typename: 'Mannequin', login: string }
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         | null } | null, latestOpinionatedReviews: { totalCount: number, nodes: Array<{ state: PullRequestReviewState, authorCanPushToRepository: boolean, author:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
           | null, commit: { oid: string } | null, onBehalfOf: { totalCount: number, nodes: Array<{ combinedSlug: string } | null> | null } } | null> | null } | null, reviewRequests: { totalCount: number, nodes: Array<{ asCodeOwner: boolean, requestedReviewer:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseTeam' }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Team', combinedSlug: string, members: { nodes: Array<{ login: string } | null> | null } }
            | { __typename: 'User', login: string }
           | null } | null> | null } | null, viewerPendingReview: { nodes: Array<{ id: string, commit: { oid: string } | null, comments: { totalCount: number } } | null> | null } | null, reviewThreads: { totalCount: number, nodes: Array<{ isResolved: boolean } | null> | null }, statusCheckRollup: { contexts: { totalCount: number, checkRunCountsByState: Array<{ state: CheckRunState, count: number }> | null, statusContextCountsByState: Array<{ state: StatusState, count: number }> | null, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
            | { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string, isRequired: boolean }
            | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null, isRequired: boolean }
           | null> | null } } | null, commits: { nodes: Array<{ commit: { oid: string, checkSuites: { totalCount: number, nodes: Array<{ status: CheckStatusState, app: { databaseId: number | null } | null, workflowRun: { databaseId: number | null } | null } | null> | null } | null } } | null> | null } } | null } | null };

export type MergeTextQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type MergeTextQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { headRefOid: string, squashTitle: string, squashMessage: string } | null } | null };

export type MergedPullRequestsQueryVariables = Exact<{
  owner: string;
  name: string;
  b0: string;
  b1: string;
  b2: string;
  b3: string;
  b4: string;
  b5: string;
  b6: string;
  b7: string;
  b8: string;
  b9: string;
  first: number;
}>;


export type MergedPullRequestsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { b0: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b1: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b2: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b3: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b4: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b5: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b6: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b7: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b8: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null }, b9: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null } } | null };

export type MergedPullRequestFieldsFragment = { number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
      | { __typename: 'Blob', oid: string }
      | { __typename: 'Commit', oid: string }
      | { __typename: 'Tag', oid: string }
      | { __typename: 'Tree', oid: string }
     | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null };

export type OpenPullRequestsQueryVariables = Exact<{
  owner: string;
  name: string;
  first: number;
  after: string | null | undefined;
  merged: number;
}>;


export type OpenPullRequestsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { defaultBranchRef: { name: string } | null, pullRequests: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, number: number, title: string, isDraft: boolean, createdAt: string, updatedAt: string, baseRefName: string, baseRefOid: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, author:
          | { __typename: 'Bot', login: string }
          | { __typename: 'EnterpriseUserAccount', login: string }
          | { __typename: 'Mannequin', login: string }
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         | null, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, headRef: { refUpdateRule: { pattern: string } | null } | null, headRepositoryOwner:
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, stackEntry: { position: number, stack: { number: number, size: number, baseRefName: string } | null } | null } | null> | null }, mergedPullRequests: { nodes: Array<{ number: number, createdAt: string, baseRefName: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, baseRef: { target:
            | { __typename: 'Blob', oid: string }
            | { __typename: 'Commit', oid: string }
            | { __typename: 'Tag', oid: string }
            | { __typename: 'Tree', oid: string }
           | null, refUpdateRule: { pattern: string } | null } | null, commits: { nodes: Array<{ commit: { oid: string } } | null> | null }, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, stackEntry: { position: number, stack: { number: number } | null } | null } | null> | null } } | null };

export type PendingReviewQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  login: string;
}>;


export type PendingReviewQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { reviews: { nodes: Array<{ id: string, commit: { oid: string } | null, comments: { totalCount: number } } | null> | null } | null } | null } | null };

export type PullRequestQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  filesFirst: number;
  filesAfter: string | null | undefined;
}>;


export type PullRequestQuery = { repository: { pullRequest: { id: string, number: number, title: string, url: string, state: PullRequestState, isDraft: boolean, updatedAt: string, baseRefName: string, baseRefOid: string, headRefName: string, headRefOid: string, isCrossRepository: boolean, author:
        | { __typename: 'Bot', login: string, avatarUrl: string }
        | { __typename: 'EnterpriseUserAccount', login: string, avatarUrl: string }
        | { __typename: 'Mannequin', login: string, avatarUrl: string }
        | { __typename: 'Organization', login: string, avatarUrl: string }
        | { __typename: 'User', login: string, avatarUrl: string }
       | null, headRepository: { nameWithOwner: string, isFork: boolean } | null, files: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ path: string, viewerViewedState: FileViewedState } | null> | null } | null } | null } | null };

export type PullRequestCheckQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type PullRequestCheckQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { updatedAt: string, state: PullRequestState, isDraft: boolean, baseRefName: string, baseRefOid: string, headRefOid: string, reviewDecision: PullRequestReviewDecision | null, mergeStateStatus: MergeStateStatus, changedFiles: number, lastEditedAt: string | null, statusCheckRollup: { state: StatusState } | null, checkCounts: { contexts: { checkRunCountsByState: Array<{ state: CheckRunState, count: number }> | null, statusContextCountsByState: Array<{ state: StatusState, count: number }> | null } } | null, mergeQueueEntry: { state: MergeQueueEntryState, position: number } | null, timelineItems: { updatedAt: string, totalCount: number }, revisionEvents: { filteredCount: number }, commits: { totalCount: number }, reviews: { totalCount: number } | null, submittedReviews: { totalCount: number } | null, reviewThreads: { totalCount: number, nodes: Array<{ isResolved: boolean, comments: { totalCount: number } } | null> | null }, viewerPendingReview: { nodes: Array<{ viewerDidAuthor: boolean, comments: { totalCount: number } } | null> | null } | null, comments: { totalCount: number }, timelineEvents: { filteredCount: number, updatedAt: string } } | null } | null };

export type PullRequestRevisionsQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  login: string;
  first: number;
  timelineAfter: string | null | undefined;
  reviewsAfter: string | null | undefined;
}>;


export type PullRequestRevisionsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { createdAt: string, closed: boolean, closedAt: string | null, merged: boolean, headRefName: string, headRefOid: string, baseRefName: string, headRepository: { name: string, owner:
          | { __typename: 'Organization', login: string }
          | { __typename: 'User', login: string }
         } | null, mergeCommit: { oid: string, parents: { nodes: Array<{ oid: string } | null> | null } } | null, timelineItems: { filteredCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AddedToProjectV2Event' }
          | { __typename: 'AddedToStackEvent' }
          | { __typename: 'AssignedEvent' }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent', createdAt: string, oldBase: string, newBase: string }
          | { __typename: 'BaseRefChangedEvent', createdAt: string, previousRefName: string, currentRefName: string }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent', createdAt: string, beforeCommit: { oid: string } | null, afterCommit: { oid: string } | null }
          | { __typename: 'BlockedByAddedEvent' }
          | { __typename: 'BlockedByRemovedEvent' }
          | { __typename: 'BlockingAddedEvent' }
          | { __typename: 'BlockingRemovedEvent' }
          | { __typename: 'ClosedEvent' }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent' }
          | { __typename: 'ConvertedFromDraftEvent' }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent' }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent', createdAt: string, beforeCommit: { oid: string } | null, afterCommit: { oid: string } | null }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment' }
          | { __typename: 'IssueCommentPinnedEvent' }
          | { __typename: 'IssueCommentUnpinnedEvent' }
          | { __typename: 'IssueFieldAddedEvent' }
          | { __typename: 'IssueFieldChangedEvent' }
          | { __typename: 'IssueFieldRemovedEvent' }
          | { __typename: 'IssueTypeAddedEvent' }
          | { __typename: 'IssueTypeChangedEvent' }
          | { __typename: 'IssueTypeRemovedEvent' }
          | { __typename: 'LabeledEvent' }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent' }
          | { __typename: 'MilestonedEvent' }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'ProjectV2ItemStatusChangedEvent' }
          | { __typename: 'PullRequestCommit' }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview' }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent' }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent' }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RemovedFromProjectV2Event' }
          | { __typename: 'RemovedFromStackEvent' }
          | { __typename: 'RenamedTitleEvent' }
          | { __typename: 'ReopenedEvent' }
          | { __typename: 'ReviewDismissedEvent' }
          | { __typename: 'ReviewRequestRemovedEvent' }
          | { __typename: 'ReviewRequestedEvent' }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent' }
          | { __typename: 'UnlabeledEvent' }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null }, reviews: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ submittedAt: string | null, commit: { oid: string } | null, author:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
           | null } | null> | null } | null, viewerLastReview: { nodes: Array<{ submittedAt: string | null, commit: { oid: string } | null } | null> | null } | null, commits: { nodes: Array<{ commit: { oid: string, checkSuites: { nodes: Array<{ createdAt: string, branch: { name: string } | null, push: { previousSha: string | null, nextSha: string | null } | null } | null> | null } | null } } | null> | null } } | null } | null };

export type PullRequestSidebarQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type PullRequestSidebarQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { isDraft: boolean, labels: { nodes: Array<{ name: string, color: string } | null> | null } | null, reviewRequests: { nodes: Array<{ requestedReviewer:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseTeam', slug: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Team', combinedSlug: string }
            | { __typename: 'User', login: string }
           | null } | null> | null } | null, latestReviews: { nodes: Array<{ state: PullRequestReviewState, author:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
           | null } | null> | null } | null, assignees: { nodes: Array<{ __typename: 'User', login: string } | null> | null } } | null } | null };

export type QueueRemovalQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
}>;


export type QueueRemovalQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { number: number, title: string, url: string, state: PullRequestState, isInMergeQueue: boolean, timelineItems: { nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AddedToProjectV2Event' }
          | { __typename: 'AddedToStackEvent' }
          | { __typename: 'AssignedEvent' }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent' }
          | { __typename: 'BaseRefChangedEvent' }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent' }
          | { __typename: 'BlockedByAddedEvent' }
          | { __typename: 'BlockedByRemovedEvent' }
          | { __typename: 'BlockingAddedEvent' }
          | { __typename: 'BlockingRemovedEvent' }
          | { __typename: 'ClosedEvent' }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent' }
          | { __typename: 'ConvertedFromDraftEvent' }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent' }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent' }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment' }
          | { __typename: 'IssueCommentPinnedEvent' }
          | { __typename: 'IssueCommentUnpinnedEvent' }
          | { __typename: 'IssueFieldAddedEvent' }
          | { __typename: 'IssueFieldChangedEvent' }
          | { __typename: 'IssueFieldRemovedEvent' }
          | { __typename: 'IssueTypeAddedEvent' }
          | { __typename: 'IssueTypeChangedEvent' }
          | { __typename: 'IssueTypeRemovedEvent' }
          | { __typename: 'LabeledEvent' }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent' }
          | { __typename: 'MilestonedEvent' }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'ProjectV2ItemStatusChangedEvent' }
          | { __typename: 'PullRequestCommit' }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview' }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent' }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent', createdAt: string, reason: string | null, actor:
              | { __typename: 'Bot', login: string }
              | { __typename: 'EnterpriseUserAccount', login: string }
              | { __typename: 'Mannequin', login: string }
              | { __typename: 'Organization', login: string }
              | { __typename: 'User', login: string }
             | null, beforeCommit: { oid: string, statusCheckRollup: { contexts: { nodes: Array<
                    | { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string }
                    | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null }
                   | null> | null } } | null } | null }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RemovedFromProjectV2Event' }
          | { __typename: 'RemovedFromStackEvent' }
          | { __typename: 'RenamedTitleEvent' }
          | { __typename: 'ReopenedEvent' }
          | { __typename: 'ReviewDismissedEvent' }
          | { __typename: 'ReviewRequestRemovedEvent' }
          | { __typename: 'ReviewRequestedEvent' }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent' }
          | { __typename: 'UnlabeledEvent' }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null } } | null } | null };

type QueueCheck_CheckRun_Fragment = { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string };

type QueueCheck_StatusContext_Fragment = { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null };

export type QueueCheckFragment =
  | QueueCheck_CheckRun_Fragment
  | QueueCheck_StatusContext_Fragment
;

export type QueueViewQueryVariables = Exact<{
  owner: string;
  name: string;
  branch: string;
}>;


export type QueueViewQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { viewerPermission: RepositoryPermission | null, mergeQueue: { url: string, nextEntryEstimatedTimeToMerge: number | null, configuration: { mergeMethod: PullRequestMergeMethod | null, mergingStrategy: MergeQueueMergingStrategy | null, maximumEntriesToBuild: number | null } | null, entries: { totalCount: number, nodes: Array<{ id: string, position: number, state: MergeQueueEntryState, enqueuedAt: string, estimatedTimeToMerge: number | null, jump: boolean, solo: boolean, enqueuer:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
          , baseCommit: { oid: string } | null, headCommit: { oid: string, statusCheckRollup: { contexts: { nodes: Array<
                  | { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null, detailsUrl: string | null, url: string }
                  | { __typename: 'StatusContext', context: string, state: StatusState, targetUrl: string | null }
                 | null> | null } } | null } | null, pullRequest: { id: string, number: number, title: string, url: string, headRefOid: string, viewerDidAuthor: boolean, author:
              | { __typename: 'Bot', login: string }
              | { __typename: 'EnterpriseUserAccount', login: string }
              | { __typename: 'Mannequin', login: string }
              | { __typename: 'Organization', login: string }
              | { __typename: 'User', login: string }
             | null } | null } | null> | null } | null } | null } | null };

export type RenderedBodiesQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  description: boolean;
  ids: Array<string> | string;
}>;


export type RenderedBodiesQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest?: { bodyHTML: string } | null } | null, nodes: Array<
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment', id: string, bodyHTML: string }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest' }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview', id: string, bodyHTML: string }
    | { __typename: 'PullRequestReviewComment', id: string, bodyHTML: string }
    | { __typename: 'PullRequestReviewThread' }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null> };

export type ResolveReviewThreadMutationVariables = Exact<{
  threadId: string;
}>;


export type ResolveReviewThreadMutation = { resolveReviewThread: { thread: { id: string, isResolved: boolean } | null } | null };

export type ReviewCommentQueryVariables = Exact<{
  comment: string;
  thread: string;
}>;


export type ReviewCommentQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, comment:
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment' }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest' }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview' }
    | { __typename: 'PullRequestReviewComment', id: string, body: string, state: PullRequestReviewCommentState, lastEditedAt: string | null, viewerDidAuthor: boolean, viewerCanUpdate: boolean, viewerCanDelete: boolean, viewerCannotUpdateReasons: Array<CommentCannotUpdateReason>, author:
        | { __typename: 'Bot', login: string }
        | { __typename: 'EnterpriseUserAccount', login: string }
        | { __typename: 'Mannequin', login: string }
        | { __typename: 'Organization', login: string }
        | { __typename: 'User', login: string }
       | null, editor:
        | { __typename: 'Bot', login: string }
        | { __typename: 'EnterpriseUserAccount', login: string }
        | { __typename: 'Mannequin', login: string }
        | { __typename: 'Organization', login: string }
        | { __typename: 'User', login: string }
       | null, pullRequestReview: { state: PullRequestReviewState, comments: { totalCount: number } } | null }
    | { __typename: 'PullRequestReviewThread' }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null, thread:
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment' }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest' }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview' }
    | { __typename: 'PullRequestReviewComment' }
    | { __typename: 'PullRequestReviewThread', isResolved: boolean, comments: { totalCount: number } }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null };

export type ReviewStateQueryVariables = Exact<{
  id: string;
}>;


export type ReviewStateQuery = { node:
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment' }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest' }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview', state: PullRequestReviewState }
    | { __typename: 'PullRequestReviewComment' }
    | { __typename: 'PullRequestReviewThread' }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null };

export type ReviewThreadCommentsQueryVariables = Exact<{
  id: string;
  first: number;
  after: string | null | undefined;
}>;


export type ReviewThreadCommentsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, node:
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment' }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest' }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview' }
    | { __typename: 'PullRequestReviewComment' }
    | { __typename: 'PullRequestReviewThread', comments: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, body: string, state: PullRequestReviewCommentState, createdAt: string, url: string, isMinimized: boolean, minimizedReason: string | null, viewerCanUpdate: boolean, viewerCanDelete: boolean, author:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseUserAccount', login: string }
            | { __typename: 'Mannequin', login: string }
            | { __typename: 'Organization', login: string }
            | { __typename: 'User', login: string }
           | null, commit: { oid: string } | null, originalCommit: { oid: string } | null } | null> | null } }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null };

export type ReviewCommentFragment = { id: string, body: string, state: PullRequestReviewCommentState, createdAt: string, url: string, isMinimized: boolean, minimizedReason: string | null, viewerCanUpdate: boolean, viewerCanDelete: boolean, author:
    | { __typename: 'Bot', login: string }
    | { __typename: 'EnterpriseUserAccount', login: string }
    | { __typename: 'Mannequin', login: string }
    | { __typename: 'Organization', login: string }
    | { __typename: 'User', login: string }
   | null, commit: { oid: string } | null, originalCommit: { oid: string } | null };

export type ReviewThreadsQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  first: number;
  after: string | null | undefined;
}>;


export type ReviewThreadsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { reviewThreads: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, path: string, subjectType: PullRequestReviewThreadSubjectType, diffSide: DiffSide, startDiffSide: DiffSide | null, line: number | null, startLine: number | null, originalLine: number | null, originalStartLine: number | null, isOutdated: boolean, isResolved: boolean, viewerCanReply: boolean, viewerCanResolve: boolean, viewerCanUnresolve: boolean, comments: { totalCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<{ id: string, body: string, state: PullRequestReviewCommentState, createdAt: string, url: string, isMinimized: boolean, minimizedReason: string | null, viewerCanUpdate: boolean, viewerCanDelete: boolean, author:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, commit: { oid: string } | null, originalCommit: { oid: string } | null } | null> | null } } | null> | null } } | null } | null };

export type StackLayersQueryVariables = Exact<{
  ids: Array<string> | string;
}>;


export type StackLayersQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, nodes: Array<
    | { __typename: 'AddedToMergeQueueEvent' }
    | { __typename: 'AddedToProjectEvent' }
    | { __typename: 'AddedToProjectV2Event' }
    | { __typename: 'AddedToStackEvent' }
    | { __typename: 'App' }
    | { __typename: 'AssignedEvent' }
    | { __typename: 'AutoMergeDisabledEvent' }
    | { __typename: 'AutoMergeEnabledEvent' }
    | { __typename: 'AutoRebaseEnabledEvent' }
    | { __typename: 'AutoSquashEnabledEvent' }
    | { __typename: 'AutomaticBaseChangeFailedEvent' }
    | { __typename: 'AutomaticBaseChangeSucceededEvent' }
    | { __typename: 'BaseRefChangedEvent' }
    | { __typename: 'BaseRefDeletedEvent' }
    | { __typename: 'BaseRefForcePushedEvent' }
    | { __typename: 'Blob' }
    | { __typename: 'BlockedByAddedEvent' }
    | { __typename: 'BlockedByRemovedEvent' }
    | { __typename: 'BlockingAddedEvent' }
    | { __typename: 'BlockingRemovedEvent' }
    | { __typename: 'Bot' }
    | { __typename: 'BranchProtectionRule' }
    | { __typename: 'BypassForcePushAllowance' }
    | { __typename: 'BypassPullRequestAllowance' }
    | { __typename: 'CWE' }
    | { __typename: 'CheckRun' }
    | { __typename: 'CheckSuite' }
    | { __typename: 'ClosedEvent' }
    | { __typename: 'CodeOfConduct' }
    | { __typename: 'CommentDeletedEvent' }
    | { __typename: 'Commit' }
    | { __typename: 'CommitComment' }
    | { __typename: 'CommitCommentThread' }
    | { __typename: 'Comparison' }
    | { __typename: 'ConnectedEvent' }
    | { __typename: 'ConvertToDraftEvent' }
    | { __typename: 'ConvertedFromDraftEvent' }
    | { __typename: 'ConvertedNoteToIssueEvent' }
    | { __typename: 'ConvertedToDiscussionEvent' }
    | { __typename: 'CrossReferencedEvent' }
    | { __typename: 'DemilestonedEvent' }
    | { __typename: 'DependencyGraphManifest' }
    | { __typename: 'DeployKey' }
    | { __typename: 'DeployedEvent' }
    | { __typename: 'Deployment' }
    | { __typename: 'DeploymentEnvironmentChangedEvent' }
    | { __typename: 'DeploymentReview' }
    | { __typename: 'DeploymentStatus' }
    | { __typename: 'DisconnectedEvent' }
    | { __typename: 'Discussion' }
    | { __typename: 'DiscussionCategory' }
    | { __typename: 'DiscussionComment' }
    | { __typename: 'DiscussionPoll' }
    | { __typename: 'DiscussionPollOption' }
    | { __typename: 'DraftIssue' }
    | { __typename: 'Enterprise' }
    | { __typename: 'EnterpriseAdministratorInvitation' }
    | { __typename: 'EnterpriseIdentityProvider' }
    | { __typename: 'EnterpriseMemberInvitation' }
    | { __typename: 'EnterpriseRepositoryInfo' }
    | { __typename: 'EnterpriseServerInstallation' }
    | { __typename: 'EnterpriseServerUserAccount' }
    | { __typename: 'EnterpriseServerUserAccountEmail' }
    | { __typename: 'EnterpriseServerUserAccountsUpload' }
    | { __typename: 'EnterpriseTeam' }
    | { __typename: 'EnterpriseUserAccount' }
    | { __typename: 'Environment' }
    | { __typename: 'ExternalIdentity' }
    | { __typename: 'Gist' }
    | { __typename: 'GistComment' }
    | { __typename: 'HeadRefDeletedEvent' }
    | { __typename: 'HeadRefForcePushedEvent' }
    | { __typename: 'HeadRefRestoredEvent' }
    | { __typename: 'IpAllowListEntry' }
    | { __typename: 'Issue' }
    | { __typename: 'IssueComment' }
    | { __typename: 'IssueCommentPinnedEvent' }
    | { __typename: 'IssueCommentUnpinnedEvent' }
    | { __typename: 'IssueFieldAddedEvent' }
    | { __typename: 'IssueFieldChangedEvent' }
    | { __typename: 'IssueFieldDate' }
    | { __typename: 'IssueFieldDateValue' }
    | { __typename: 'IssueFieldMultiSelect' }
    | { __typename: 'IssueFieldMultiSelectValue' }
    | { __typename: 'IssueFieldNumber' }
    | { __typename: 'IssueFieldNumberValue' }
    | { __typename: 'IssueFieldRemovedEvent' }
    | { __typename: 'IssueFieldSingleSelect' }
    | { __typename: 'IssueFieldSingleSelectOption' }
    | { __typename: 'IssueFieldSingleSelectValue' }
    | { __typename: 'IssueFieldText' }
    | { __typename: 'IssueFieldTextValue' }
    | { __typename: 'IssueType' }
    | { __typename: 'IssueTypeAddedEvent' }
    | { __typename: 'IssueTypeChangedEvent' }
    | { __typename: 'IssueTypeRemovedEvent' }
    | { __typename: 'Label' }
    | { __typename: 'LabeledEvent' }
    | { __typename: 'Language' }
    | { __typename: 'License' }
    | { __typename: 'LinkedBranch' }
    | { __typename: 'LockedEvent' }
    | { __typename: 'Mannequin' }
    | { __typename: 'MarkedAsDuplicateEvent' }
    | { __typename: 'MarketplaceCategory' }
    | { __typename: 'MarketplaceListing' }
    | { __typename: 'MemberFeatureRequestNotification' }
    | { __typename: 'MembersCanDeleteReposClearAuditEntry' }
    | { __typename: 'MembersCanDeleteReposDisableAuditEntry' }
    | { __typename: 'MembersCanDeleteReposEnableAuditEntry' }
    | { __typename: 'MentionedEvent' }
    | { __typename: 'MergeQueue' }
    | { __typename: 'MergeQueueEntry' }
    | { __typename: 'MergedEvent' }
    | { __typename: 'MigrationSource' }
    | { __typename: 'Milestone' }
    | { __typename: 'MilestonedEvent' }
    | { __typename: 'MovedColumnsInProjectEvent' }
    | { __typename: 'OIDCProvider' }
    | { __typename: 'OauthApplicationCreateAuditEntry' }
    | { __typename: 'OrgAddBillingManagerAuditEntry' }
    | { __typename: 'OrgAddMemberAuditEntry' }
    | { __typename: 'OrgBlockUserAuditEntry' }
    | { __typename: 'OrgConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'OrgCreateAuditEntry' }
    | { __typename: 'OrgDisableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgDisableSamlAuditEntry' }
    | { __typename: 'OrgDisableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgEnableOauthAppRestrictionsAuditEntry' }
    | { __typename: 'OrgEnableSamlAuditEntry' }
    | { __typename: 'OrgEnableTwoFactorRequirementAuditEntry' }
    | { __typename: 'OrgInviteMemberAuditEntry' }
    | { __typename: 'OrgInviteToBusinessAuditEntry' }
    | { __typename: 'OrgOauthAppAccessApprovedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessBlockedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessDeniedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessRequestedAuditEntry' }
    | { __typename: 'OrgOauthAppAccessUnblockedAuditEntry' }
    | { __typename: 'OrgRemoveBillingManagerAuditEntry' }
    | { __typename: 'OrgRemoveMemberAuditEntry' }
    | { __typename: 'OrgRemoveOutsideCollaboratorAuditEntry' }
    | { __typename: 'OrgRestoreMemberAuditEntry' }
    | { __typename: 'OrgUnblockUserAuditEntry' }
    | { __typename: 'OrgUpdateDefaultRepositoryPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryCreationPermissionAuditEntry' }
    | { __typename: 'OrgUpdateMemberRepositoryInvitationPermissionAuditEntry' }
    | { __typename: 'Organization' }
    | { __typename: 'OrganizationIdentityProvider' }
    | { __typename: 'OrganizationInvitation' }
    | { __typename: 'OrganizationMigration' }
    | { __typename: 'Package' }
    | { __typename: 'PackageFile' }
    | { __typename: 'PackageTag' }
    | { __typename: 'PackageVersion' }
    | { __typename: 'ParentIssueAddedEvent' }
    | { __typename: 'ParentIssueRemovedEvent' }
    | { __typename: 'PendingAssigneeSuggestion' }
    | { __typename: 'PendingCloseSuggestion' }
    | { __typename: 'PendingFieldSuggestion' }
    | { __typename: 'PendingLabelSuggestion' }
    | { __typename: 'PendingTypeSuggestion' }
    | { __typename: 'PinnedDiscussion' }
    | { __typename: 'PinnedEnvironment' }
    | { __typename: 'PinnedEvent' }
    | { __typename: 'PinnedIssue' }
    | { __typename: 'PinnedIssueComment' }
    | { __typename: 'PrivateRepositoryForkingDisableAuditEntry' }
    | { __typename: 'PrivateRepositoryForkingEnableAuditEntry' }
    | { __typename: 'Project' }
    | { __typename: 'ProjectCard' }
    | { __typename: 'ProjectColumn' }
    | { __typename: 'ProjectV2' }
    | { __typename: 'ProjectV2Field' }
    | { __typename: 'ProjectV2Item' }
    | { __typename: 'ProjectV2ItemFieldDateValue' }
    | { __typename: 'ProjectV2ItemFieldIterationValue' }
    | { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
    | { __typename: 'ProjectV2ItemFieldNumberValue' }
    | { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
    | { __typename: 'ProjectV2ItemFieldTextValue' }
    | { __typename: 'ProjectV2ItemStatusChangedEvent' }
    | { __typename: 'ProjectV2IterationField' }
    | { __typename: 'ProjectV2MultiSelectField' }
    | { __typename: 'ProjectV2SingleSelectField' }
    | { __typename: 'ProjectV2StatusUpdate' }
    | { __typename: 'ProjectV2View' }
    | { __typename: 'ProjectV2Workflow' }
    | { __typename: 'PublicKey' }
    | { __typename: 'PullRequest', id: string, number: number, state: PullRequestState, headRefOid: string, reviewDecision: PullRequestReviewDecision | null, isInMergeQueue: boolean, statusCheckRollup: { state: StatusState } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, files: { totalCount: number, nodes: Array<{ viewerViewedState: FileViewedState } | null> | null } | null, reviewThreads: { totalCount: number, nodes: Array<{ isResolved: boolean } | null> | null }, movedFrom: { nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AddedToProjectV2Event' }
          | { __typename: 'AddedToStackEvent' }
          | { __typename: 'AssignedEvent' }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent', oldBase: string }
          | { __typename: 'BaseRefChangedEvent', previousRefName: string }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent' }
          | { __typename: 'BlockedByAddedEvent' }
          | { __typename: 'BlockedByRemovedEvent' }
          | { __typename: 'BlockingAddedEvent' }
          | { __typename: 'BlockingRemovedEvent' }
          | { __typename: 'ClosedEvent' }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent' }
          | { __typename: 'ConvertedFromDraftEvent' }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent' }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent' }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment' }
          | { __typename: 'IssueCommentPinnedEvent' }
          | { __typename: 'IssueCommentUnpinnedEvent' }
          | { __typename: 'IssueFieldAddedEvent' }
          | { __typename: 'IssueFieldChangedEvent' }
          | { __typename: 'IssueFieldRemovedEvent' }
          | { __typename: 'IssueTypeAddedEvent' }
          | { __typename: 'IssueTypeChangedEvent' }
          | { __typename: 'IssueTypeRemovedEvent' }
          | { __typename: 'LabeledEvent' }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent' }
          | { __typename: 'MilestonedEvent' }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'ProjectV2ItemStatusChangedEvent' }
          | { __typename: 'PullRequestCommit' }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview' }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent' }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent' }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RemovedFromProjectV2Event' }
          | { __typename: 'RemovedFromStackEvent' }
          | { __typename: 'RenamedTitleEvent' }
          | { __typename: 'ReopenedEvent' }
          | { __typename: 'ReviewDismissedEvent' }
          | { __typename: 'ReviewRequestRemovedEvent' }
          | { __typename: 'ReviewRequestedEvent' }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent' }
          | { __typename: 'UnlabeledEvent' }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null } }
    | { __typename: 'PullRequestCommit' }
    | { __typename: 'PullRequestCommitCommentThread' }
    | { __typename: 'PullRequestReview' }
    | { __typename: 'PullRequestReviewComment' }
    | { __typename: 'PullRequestReviewThread' }
    | { __typename: 'PullRequestStack' }
    | { __typename: 'PullRequestStackEntry' }
    | { __typename: 'PullRequestThread' }
    | { __typename: 'Push' }
    | { __typename: 'PushAllowance' }
    | { __typename: 'Query' }
    | { __typename: 'Reaction' }
    | { __typename: 'ReadyForReviewEvent' }
    | { __typename: 'Ref' }
    | { __typename: 'ReferencedEvent' }
    | { __typename: 'Release' }
    | { __typename: 'ReleaseAsset' }
    | { __typename: 'RemovedFromMergeQueueEvent' }
    | { __typename: 'RemovedFromProjectEvent' }
    | { __typename: 'RemovedFromProjectV2Event' }
    | { __typename: 'RemovedFromStackEvent' }
    | { __typename: 'RenamedTitleEvent' }
    | { __typename: 'ReopenedEvent' }
    | { __typename: 'RepoAccessAuditEntry' }
    | { __typename: 'RepoAddMemberAuditEntry' }
    | { __typename: 'RepoAddTopicAuditEntry' }
    | { __typename: 'RepoArchivedAuditEntry' }
    | { __typename: 'RepoChangeMergeSettingAuditEntry' }
    | { __typename: 'RepoConfigDisableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigDisableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigDisableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigEnableAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigEnableCollaboratorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableContributorsOnlyAuditEntry' }
    | { __typename: 'RepoConfigEnableSockpuppetDisallowedAuditEntry' }
    | { __typename: 'RepoConfigLockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoConfigUnlockAnonymousGitAccessAuditEntry' }
    | { __typename: 'RepoCreateAuditEntry' }
    | { __typename: 'RepoDestroyAuditEntry' }
    | { __typename: 'RepoRemoveMemberAuditEntry' }
    | { __typename: 'RepoRemoveTopicAuditEntry' }
    | { __typename: 'Repository' }
    | { __typename: 'RepositoryCustomProperty' }
    | { __typename: 'RepositoryInvitation' }
    | { __typename: 'RepositoryMigration' }
    | { __typename: 'RepositoryRule' }
    | { __typename: 'RepositoryRuleset' }
    | { __typename: 'RepositoryRulesetBypassActor' }
    | { __typename: 'RepositoryTopic' }
    | { __typename: 'RepositoryVisibilityChangeDisableAuditEntry' }
    | { __typename: 'RepositoryVisibilityChangeEnableAuditEntry' }
    | { __typename: 'RepositoryVulnerabilityAlert' }
    | { __typename: 'ReviewDismissalAllowance' }
    | { __typename: 'ReviewDismissedEvent' }
    | { __typename: 'ReviewRequest' }
    | { __typename: 'ReviewRequestRemovedEvent' }
    | { __typename: 'ReviewRequestedEvent' }
    | { __typename: 'SavedReply' }
    | { __typename: 'SecurityAdvisory' }
    | { __typename: 'SponsorsActivity' }
    | { __typename: 'SponsorsListing' }
    | { __typename: 'SponsorsListingFeaturedItem' }
    | { __typename: 'SponsorsTier' }
    | { __typename: 'Sponsorship' }
    | { __typename: 'SponsorshipNewsletter' }
    | { __typename: 'Status' }
    | { __typename: 'StatusCheckRollup' }
    | { __typename: 'StatusContext' }
    | { __typename: 'SubIssueAddedEvent' }
    | { __typename: 'SubIssueRemovedEvent' }
    | { __typename: 'SubscribedEvent' }
    | { __typename: 'Tag' }
    | { __typename: 'Team' }
    | { __typename: 'TeamAddMemberAuditEntry' }
    | { __typename: 'TeamAddRepositoryAuditEntry' }
    | { __typename: 'TeamChangeParentTeamAuditEntry' }
    | { __typename: 'TeamRemoveMemberAuditEntry' }
    | { __typename: 'TeamRemoveRepositoryAuditEntry' }
    | { __typename: 'Topic' }
    | { __typename: 'TransferredEvent' }
    | { __typename: 'Tree' }
    | { __typename: 'UnassignedEvent' }
    | { __typename: 'UnlabeledEvent' }
    | { __typename: 'UnlockedEvent' }
    | { __typename: 'UnmarkedAsDuplicateEvent' }
    | { __typename: 'UnpinnedEvent' }
    | { __typename: 'UnsubscribedEvent' }
    | { __typename: 'User' }
    | { __typename: 'UserBlockedEvent' }
    | { __typename: 'UserContentEdit' }
    | { __typename: 'UserList' }
    | { __typename: 'UserNamespaceRepository' }
    | { __typename: 'UserStatus' }
    | { __typename: 'VerifiableDomain' }
    | { __typename: 'Workflow' }
    | { __typename: 'WorkflowRun' }
    | { __typename: 'WorkflowRunFile' }
   | null> };

export type SubmitPullRequestReviewMutationVariables = Exact<{
  pullRequestReviewId: string;
  event: PullRequestReviewEvent;
  body: string | null | undefined;
}>;


export type SubmitPullRequestReviewMutation = { submitPullRequestReview: { pullRequestReview: { id: string, state: PullRequestReviewState } | null } | null };

export type TimelineQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  last: number;
  before: string | null | undefined;
}>;


export type TimelineQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { body: string, createdAt: string, lastEditedAt: string | null, author:
        | { __typename: 'Bot', login: string }
        | { __typename: 'EnterpriseUserAccount', login: string }
        | { __typename: 'Mannequin', login: string }
        | { __typename: 'Organization', login: string }
        | { __typename: 'User', login: string }
       | null, timelineEvents: { updatedAt: string }, timelineItems: { filteredCount: number, pageInfo: { hasPreviousPage: boolean, startCursor: string | null }, edges: Array<{ cursor: string, node:
            | { __typename: 'AddedToMergeQueueEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AddedToProjectEvent' }
            | { __typename: 'AddedToProjectV2Event' }
            | { __typename: 'AddedToStackEvent', createdAt: string, stackNumber: number | null, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AssignedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, assignee:
                | { __typename: 'Bot', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutoMergeDisabledEvent', createdAt: string, reason: string | null, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutoMergeEnabledEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutoRebaseEnabledEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutoSquashEnabledEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutomaticBaseChangeFailedEvent', createdAt: string, oldBase: string, newBase: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'AutomaticBaseChangeSucceededEvent', createdAt: string, oldBase: string, newBase: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'BaseRefChangedEvent', createdAt: string, previousRefName: string, currentRefName: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'BaseRefDeletedEvent' }
            | { __typename: 'BaseRefForcePushedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, beforeCommit: { oid: string } | null, afterCommit: { oid: string } | null }
            | { __typename: 'BlockedByAddedEvent' }
            | { __typename: 'BlockedByRemovedEvent' }
            | { __typename: 'BlockingAddedEvent' }
            | { __typename: 'BlockingRemovedEvent' }
            | { __typename: 'ClosedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'CommentDeletedEvent' }
            | { __typename: 'ConnectedEvent' }
            | { __typename: 'ConvertToDraftEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'ConvertedFromDraftEvent' }
            | { __typename: 'ConvertedNoteToIssueEvent' }
            | { __typename: 'ConvertedToDiscussionEvent' }
            | { __typename: 'CrossReferencedEvent', createdAt: string, willCloseTarget: boolean, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, source:
                | { __typename: 'Issue', number: number, title: string, url: string, repository: { nameWithOwner: string } }
                | { __typename: 'PullRequest', number: number, title: string, url: string, repository: { nameWithOwner: string } }
               }
            | { __typename: 'DemilestonedEvent' }
            | { __typename: 'DeployedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, deployment: { environment: string | null, latestStatus: { state: DeploymentStatusState } | null } }
            | { __typename: 'DeploymentEnvironmentChangedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, deploymentStatus: { state: DeploymentStatusState, deployment: { environment: string | null } } }
            | { __typename: 'DisconnectedEvent' }
            | { __typename: 'HeadRefDeletedEvent' }
            | { __typename: 'HeadRefForcePushedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, beforeCommit: { oid: string } | null, afterCommit: { oid: string } | null }
            | { __typename: 'HeadRefRestoredEvent' }
            | { __typename: 'IssueComment', id: string, body: string, createdAt: string, lastEditedAt: string | null, url: string, isMinimized: boolean, minimizedReason: string | null, viewerCanUpdate: boolean, viewerCanDelete: boolean, author:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'IssueCommentPinnedEvent' }
            | { __typename: 'IssueCommentUnpinnedEvent' }
            | { __typename: 'IssueFieldAddedEvent' }
            | { __typename: 'IssueFieldChangedEvent' }
            | { __typename: 'IssueFieldRemovedEvent' }
            | { __typename: 'IssueTypeAddedEvent' }
            | { __typename: 'IssueTypeChangedEvent' }
            | { __typename: 'IssueTypeRemovedEvent' }
            | { __typename: 'LabeledEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, label: { name: string, color: string } }
            | { __typename: 'LockedEvent' }
            | { __typename: 'MarkedAsDuplicateEvent' }
            | { __typename: 'MentionedEvent' }
            | { __typename: 'MergedEvent', createdAt: string, mergeRefName: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, commit: { oid: string } | null }
            | { __typename: 'MilestonedEvent' }
            | { __typename: 'MovedColumnsInProjectEvent' }
            | { __typename: 'ParentIssueAddedEvent' }
            | { __typename: 'ParentIssueRemovedEvent' }
            | { __typename: 'PinnedEvent' }
            | { __typename: 'ProjectV2ItemStatusChangedEvent' }
            | { __typename: 'PullRequestCommit', gitCommit: { oid: string, messageHeadline: string, committedDate: string, author: { name: string | null, user: { login: string } | null } | null, statusCheckRollup: { state: StatusState } | null } }
            | { __typename: 'PullRequestCommitCommentThread' }
            | { __typename: 'PullRequestReview', id: string, body: string, state: PullRequestReviewState, createdAt: string, submittedAt: string | null, lastEditedAt: string | null, url: string, isMinimized: boolean, author:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, commit: { oid: string } | null, comments: { totalCount: number } }
            | { __typename: 'PullRequestReviewThread' }
            | { __typename: 'PullRequestRevisionMarker' }
            | { __typename: 'ReadyForReviewEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'ReferencedEvent' }
            | { __typename: 'RemovedFromMergeQueueEvent', createdAt: string, reason: string | null, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'RemovedFromProjectEvent' }
            | { __typename: 'RemovedFromProjectV2Event' }
            | { __typename: 'RemovedFromStackEvent', createdAt: string, stackNumber: number | null, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'RenamedTitleEvent' }
            | { __typename: 'ReopenedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'ReviewDismissedEvent', createdAt: string, dismissalMessage: string | null, previousReviewState: PullRequestReviewState, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, review: { id: string, author:
                  | { __typename: 'Bot', login: string }
                  | { __typename: 'EnterpriseUserAccount', login: string }
                  | { __typename: 'Mannequin', login: string }
                  | { __typename: 'Organization', login: string }
                  | { __typename: 'User', login: string }
                 | null } | null }
            | { __typename: 'ReviewRequestRemovedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, requestedReviewer:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseTeam', slug: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Team', combinedSlug: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'ReviewRequestedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, requestedReviewer:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseTeam', slug: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Team', combinedSlug: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'SubIssueAddedEvent' }
            | { __typename: 'SubIssueRemovedEvent' }
            | { __typename: 'SubscribedEvent' }
            | { __typename: 'TransferredEvent' }
            | { __typename: 'UnassignedEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, assignee:
                | { __typename: 'Bot', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null }
            | { __typename: 'UnlabeledEvent', createdAt: string, actor:
                | { __typename: 'Bot', login: string }
                | { __typename: 'EnterpriseUserAccount', login: string }
                | { __typename: 'Mannequin', login: string }
                | { __typename: 'Organization', login: string }
                | { __typename: 'User', login: string }
               | null, label: { name: string, color: string } }
            | { __typename: 'UnlockedEvent' }
            | { __typename: 'UnmarkedAsDuplicateEvent' }
            | { __typename: 'UnpinnedEvent' }
            | { __typename: 'UnsubscribedEvent' }
            | { __typename: 'UserBlockedEvent' }
           | null } | null> | null } } | null } | null };

export type TrunkRulesQueryVariables = Exact<{
  owner: string;
  name: string;
}>;


export type TrunkRulesQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { rulesets: { nodes: Array<{ enforcement: RuleEnforcement, conditions: { refName: { include: Array<string>, exclude: Array<string> } | null }, rules: { nodes: Array<{ type: RepositoryRuleType } | null> | null } | null } | null> | null } | null } | null };

export type UnmarkFileAsViewedMutationVariables = Exact<{
  pullRequestId: string;
  path: string;
}>;


export type UnmarkFileAsViewedMutation = { unmarkFileAsViewed: { pullRequest: { id: string } | null } | null };

export type UnresolveReviewThreadMutationVariables = Exact<{
  threadId: string;
}>;


export type UnresolveReviewThreadMutation = { unresolveReviewThread: { thread: { id: string, isResolved: boolean } | null } | null };

export type UpdateIssueCommentMutationVariables = Exact<{
  id: string;
  body: string;
}>;


export type UpdateIssueCommentMutation = { updateIssueComment: { issueComment: { id: string } | null } | null };

export type UpdatePullRequestReviewCommentMutationVariables = Exact<{
  id: string;
  body: string;
}>;


export type UpdatePullRequestReviewCommentMutation = { updatePullRequestReviewComment: { pullRequestReviewComment: { id: string } | null } | null };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { login: string, databaseId: number | null, name: string | null, avatarUrl: string } };

export type YourReviewsQueryVariables = Exact<{
  owner: string;
  name: string;
  number: number;
  login: string;
}>;


export type YourReviewsQuery = { rateLimit: { cost: number, limit: number, remaining: number, used: number, resetAt: string } | null, repository: { pullRequest: { reviews: { nodes: Array<{ id: string, state: PullRequestReviewState, body: string, submittedAt: string | null, commit: { oid: string } | null } | null> | null } | null } | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const BaseRulesFragmentDoc = new TypedDocumentString(`
    fragment BaseRules on Ref {
  refUpdateRule {
    requiredApprovingReviewCount
    requiredStatusCheckContexts
    requiresCodeOwnerReviews
    requiresConversationResolution
    requiresLinearHistory
    requiresSignatures
    viewerCanPush
  }
  branchProtectionRule {
    requiresApprovingReviews
    requiredApprovingReviewCount
    requiresCodeOwnerReviews
    dismissesStaleReviews
    requireLastPushApproval
    requiresConversationResolution
    requiresStatusChecks
    requiresStrictStatusChecks
    requiredStatusChecks {
      context
      app {
        databaseId
      }
    }
    requiresLinearHistory
    requiresCommitSignatures
    requiresDeployments
    lockBranch
  }
}
    `, {"fragmentName":"BaseRules"}) as unknown as TypedDocumentString<BaseRulesFragment, unknown>;
export const MergeCheckFragmentDoc = new TypedDocumentString(`
    fragment MergeCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
    isRequired(pullRequestNumber: $number)
  }
  ... on StatusContext {
    context
    state
    targetUrl
    isRequired(pullRequestNumber: $number)
  }
}
    `, {"fragmentName":"MergeCheck"}) as unknown as TypedDocumentString<MergeCheckFragment, unknown>;
export const MergedPullRequestFieldsFragmentDoc = new TypedDocumentString(`
    fragment MergedPullRequestFields on PullRequest {
  number
  createdAt
  baseRefName
  baseRef {
    target {
      __typename
      oid
    }
    refUpdateRule {
      pattern
    }
  }
  headRefName
  headRefOid
  isCrossRepository
  commits(last: 20) {
    nodes {
      commit {
        oid
      }
    }
  }
  mergeCommit {
    oid
    parents(first: 2) {
      nodes {
        oid
      }
    }
  }
  stackEntry {
    position
    stack {
      number
    }
  }
}
    `, {"fragmentName":"MergedPullRequestFields"}) as unknown as TypedDocumentString<MergedPullRequestFieldsFragment, unknown>;
export const QueueCheckFragmentDoc = new TypedDocumentString(`
    fragment QueueCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
  }
  ... on StatusContext {
    context
    state
    targetUrl
  }
}
    `, {"fragmentName":"QueueCheck"}) as unknown as TypedDocumentString<QueueCheckFragment, unknown>;
export const ReviewCommentFragmentDoc = new TypedDocumentString(`
    fragment ReviewComment on PullRequestReviewComment {
  id
  author {
    __typename
    login
  }
  body
  state
  createdAt
  url
  isMinimized
  minimizedReason
  viewerCanUpdate
  viewerCanDelete
  commit {
    oid
  }
  originalCommit {
    oid
  }
}
    `, {"fragmentName":"ReviewComment"}) as unknown as TypedDocumentString<ReviewCommentFragment, unknown>;
export const AddCommentDocument = new TypedDocumentString(`
    mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: {subjectId: $subjectId, body: $body}) {
    commentEdge {
      node {
        id
      }
    }
  }
}
    `) as unknown as TypedDocumentString<AddCommentMutation, AddCommentMutationVariables>;
export const AddPullRequestReviewDocument = new TypedDocumentString(`
    mutation AddPullRequestReview($pullRequestId: ID!, $commitOID: GitObjectID!, $event: PullRequestReviewEvent, $body: String, $threads: [DraftPullRequestReviewThread!]) {
  addPullRequestReview(
    input: {pullRequestId: $pullRequestId, commitOID: $commitOID, event: $event, body: $body, threads: $threads}
  ) {
    pullRequestReview {
      id
      state
      comments(first: 1) {
        nodes {
          id
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<AddPullRequestReviewMutation, AddPullRequestReviewMutationVariables>;
export const AddPullRequestReviewThreadDocument = new TypedDocumentString(`
    mutation AddPullRequestReviewThread($pullRequestReviewId: ID!, $path: String!, $body: String!, $subjectType: PullRequestReviewThreadSubjectType!, $line: Int, $side: DiffSide, $startLine: Int, $startSide: DiffSide) {
  addPullRequestReviewThread(
    input: {pullRequestReviewId: $pullRequestReviewId, path: $path, body: $body, subjectType: $subjectType, line: $line, side: $side, startLine: $startLine, startSide: $startSide}
  ) {
    thread {
      id
      comments(first: 1) {
        nodes {
          id
          commit {
            oid
          }
          pullRequestReview {
            id
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<AddPullRequestReviewThreadMutation, AddPullRequestReviewThreadMutationVariables>;
export const AddPullRequestReviewThreadReplyDocument = new TypedDocumentString(`
    mutation AddPullRequestReviewThreadReply($pullRequestReviewThreadId: ID!, $body: String!, $pullRequestReviewId: ID) {
  addPullRequestReviewThreadReply(
    input: {pullRequestReviewThreadId: $pullRequestReviewThreadId, body: $body, pullRequestReviewId: $pullRequestReviewId}
  ) {
    comment {
      id
      state
      pullRequestReview {
        id
        state
      }
    }
  }
}
    `) as unknown as TypedDocumentString<AddPullRequestReviewThreadReplyMutation, AddPullRequestReviewThreadReplyMutationVariables>;
export const BranchProtectionDocument = new TypedDocumentString(`
    query BranchProtection($owner: String!, $name: String!, $qualified: String!, $branch: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $qualified) {
      name
      ...BaseRules
    }
    mergeQueue(branch: $branch) {
      configuration {
        mergeMethod
      }
    }
  }
}
    fragment BaseRules on Ref {
  refUpdateRule {
    requiredApprovingReviewCount
    requiredStatusCheckContexts
    requiresCodeOwnerReviews
    requiresConversationResolution
    requiresLinearHistory
    requiresSignatures
    viewerCanPush
  }
  branchProtectionRule {
    requiresApprovingReviews
    requiredApprovingReviewCount
    requiresCodeOwnerReviews
    dismissesStaleReviews
    requireLastPushApproval
    requiresConversationResolution
    requiresStatusChecks
    requiresStrictStatusChecks
    requiredStatusChecks {
      context
      app {
        databaseId
      }
    }
    requiresLinearHistory
    requiresCommitSignatures
    requiresDeployments
    lockBranch
  }
}`) as unknown as TypedDocumentString<BranchProtectionQuery, BranchProtectionQueryVariables>;
export const DeleteIssueCommentDocument = new TypedDocumentString(`
    mutation DeleteIssueComment($id: ID!) {
  deleteIssueComment(input: {id: $id}) {
    clientMutationId
  }
}
    `) as unknown as TypedDocumentString<DeleteIssueCommentMutation, DeleteIssueCommentMutationVariables>;
export const DeletePullRequestReviewDocument = new TypedDocumentString(`
    mutation DeletePullRequestReview($pullRequestReviewId: ID!) {
  deletePullRequestReview(input: {pullRequestReviewId: $pullRequestReviewId}) {
    pullRequestReview {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<DeletePullRequestReviewMutation, DeletePullRequestReviewMutationVariables>;
export const DeletePullRequestReviewCommentDocument = new TypedDocumentString(`
    mutation DeletePullRequestReviewComment($id: ID!) {
  deletePullRequestReviewComment(input: {id: $id}) {
    pullRequestReview {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<DeletePullRequestReviewCommentMutation, DeletePullRequestReviewCommentMutationVariables>;
export const DequeuePullRequestDocument = new TypedDocumentString(`
    mutation DequeuePullRequest($id: ID!) {
  dequeuePullRequest(input: {id: $id}) {
    mergeQueueEntry {
      id
      position
      state
      jump
      solo
      enqueuedAt
      estimatedTimeToMerge
      headCommit {
        oid
      }
      pullRequest {
        number
      }
    }
  }
}
    `) as unknown as TypedDocumentString<DequeuePullRequestMutation, DequeuePullRequestMutationVariables>;
export const DisablePullRequestAutoMergeDocument = new TypedDocumentString(`
    mutation DisablePullRequestAutoMerge($pullRequestId: ID!) {
  disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) {
    pullRequest {
      number
      headRefOid
      state
      isInMergeQueue
      autoMergeRequest {
        mergeMethod
        enabledAt
        enabledBy {
          __typename
          login
        }
        commitHeadline
        commitBody
      }
    }
  }
}
    `) as unknown as TypedDocumentString<DisablePullRequestAutoMergeMutation, DisablePullRequestAutoMergeMutationVariables>;
export const EnablePullRequestAutoMergeDocument = new TypedDocumentString(`
    mutation EnablePullRequestAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!, $commitHeadline: String, $commitBody: String) {
  enablePullRequestAutoMerge(
    input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid, commitHeadline: $commitHeadline, commitBody: $commitBody}
  ) {
    pullRequest {
      number
      headRefOid
      state
      isInMergeQueue
      autoMergeRequest {
        mergeMethod
        enabledAt
        enabledBy {
          __typename
          login
        }
        commitHeadline
        commitBody
      }
    }
  }
}
    `) as unknown as TypedDocumentString<EnablePullRequestAutoMergeMutation, EnablePullRequestAutoMergeMutationVariables>;
export const EnqueuePullRequestDocument = new TypedDocumentString(`
    mutation EnqueuePullRequest($pullRequestId: ID!, $expectedHeadOid: GitObjectID!, $jump: Boolean!) {
  enqueuePullRequest(
    input: {pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, jump: $jump}
  ) {
    mergeQueueEntry {
      id
      position
      state
      jump
      solo
      enqueuedAt
      estimatedTimeToMerge
      headCommit {
        oid
      }
      pullRequest {
        number
      }
    }
  }
}
    `) as unknown as TypedDocumentString<EnqueuePullRequestMutation, EnqueuePullRequestMutationVariables>;
export const MarkFileAsViewedDocument = new TypedDocumentString(`
    mutation MarkFileAsViewed($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: {pullRequestId: $pullRequestId, path: $path}) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<MarkFileAsViewedMutation, MarkFileAsViewedMutationVariables>;
export const MergeChecksDocument = new TypedDocumentString(`
    query MergeChecks($owner: String!, $name: String!, $number: Int!, $after: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      statusCheckRollup {
        contexts(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...MergeCheck
          }
        }
      }
    }
  }
}
    fragment MergeCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
    isRequired(pullRequestNumber: $number)
  }
  ... on StatusContext {
    context
    state
    targetUrl
    isRequired(pullRequestNumber: $number)
  }
}`) as unknown as TypedDocumentString<MergeChecksQuery, MergeChecksQueryVariables>;
export const MergeQueueDocument = new TypedDocumentString(`
    query MergeQueue($owner: String!, $name: String!, $branch: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    mergeQueue(branch: $branch) {
      id
      url
      nextEntryEstimatedTimeToMerge
      configuration {
        mergeMethod
        mergingStrategy
        checkResponseTimeout
        maximumEntriesToBuild
        maximumEntriesToMerge
        minimumEntriesToMerge
        minimumEntriesToMergeWaitTime
      }
      entries(first: 100) {
        totalCount
        nodes {
          id
          position
          state
          enqueuedAt
          estimatedTimeToMerge
          jump
          solo
          enqueuer {
            __typename
            login
          }
          baseCommit {
            oid
          }
          headCommit {
            oid
          }
          pullRequest {
            id
            number
            title
            url
            headRefOid
            viewerDidAuthor
            author {
              __typename
              login
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<MergeQueueQuery, MergeQueueQueryVariables>;
export const MergeSnapshotDocument = new TypedDocumentString(`
    query MergeSnapshot($owner: String!, $name: String!, $number: Int!, $login: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    isArchived
    viewerPermission
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerDefaultMergeMethod
    squashMergeCommitTitle
    squashMergeCommitMessage
    pullRequest(number: $number) {
      url
      state
      isDraft
      locked
      mergeable
      mergeStateStatus
      reviewDecision
      headRefOid
      baseRefName
      author {
        __typename
        login
      }
      viewerDidAuthor
      viewerCanMergeAsAdmin
      viewerCanEnableAutoMerge
      viewerCanDisableAutoMerge
      baseRef {
        target {
          __typename
          oid
        }
        ...BaseRules
      }
      stackEntry {
        position
        stack {
          number
          baseRefName
          entries(first: 1) {
            nodes {
              pullRequest {
                baseRefName
                baseRef {
                  ...BaseRules
                }
                isMergeQueueEnabled
                mergeQueue {
                  configuration {
                    mergeMethod
                  }
                }
              }
            }
          }
        }
      }
      isMergeQueueEnabled
      isInMergeQueue
      mergeQueueEntry {
        position
      }
      mergeQueue {
        configuration {
          mergeMethod
        }
      }
      autoMergeRequest {
        mergeMethod
        enabledBy {
          __typename
          login
        }
      }
      latestOpinionatedReviews(first: 50) {
        totalCount
        nodes {
          author {
            __typename
            login
          }
          state
          commit {
            oid
          }
          authorCanPushToRepository
          onBehalfOf(first: 10) {
            totalCount
            nodes {
              combinedSlug
            }
          }
        }
      }
      reviewRequests(first: 25) {
        totalCount
        nodes {
          asCodeOwner
          requestedReviewer {
            __typename
            ... on User {
              login
            }
            ... on Bot {
              login
            }
            ... on Mannequin {
              login
            }
            ... on Team {
              combinedSlug
              members(query: $login, first: 100) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
      viewerPendingReview: reviews(states: [PENDING], author: $login, first: 1) {
        nodes {
          id
          commit {
            oid
          }
          comments {
            totalCount
          }
        }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved
        }
      }
      statusCheckRollup {
        contexts(first: 100) {
          totalCount
          checkRunCountsByState {
            state
            count
          }
          statusContextCountsByState {
            state
            count
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...MergeCheck
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            checkSuites(first: 100) {
              totalCount
              nodes {
                status
                app {
                  databaseId
                }
                workflowRun {
                  databaseId
                }
              }
            }
          }
        }
      }
    }
  }
}
    fragment BaseRules on Ref {
  refUpdateRule {
    requiredApprovingReviewCount
    requiredStatusCheckContexts
    requiresCodeOwnerReviews
    requiresConversationResolution
    requiresLinearHistory
    requiresSignatures
    viewerCanPush
  }
  branchProtectionRule {
    requiresApprovingReviews
    requiredApprovingReviewCount
    requiresCodeOwnerReviews
    dismissesStaleReviews
    requireLastPushApproval
    requiresConversationResolution
    requiresStatusChecks
    requiresStrictStatusChecks
    requiredStatusChecks {
      context
      app {
        databaseId
      }
    }
    requiresLinearHistory
    requiresCommitSignatures
    requiresDeployments
    lockBranch
  }
}
fragment MergeCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
    isRequired(pullRequestNumber: $number)
  }
  ... on StatusContext {
    context
    state
    targetUrl
    isRequired(pullRequestNumber: $number)
  }
}`) as unknown as TypedDocumentString<MergeSnapshotQuery, MergeSnapshotQueryVariables>;
export const MergeTextDocument = new TypedDocumentString(`
    query MergeText($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      squashTitle: viewerMergeHeadlineText(mergeType: SQUASH)
      squashMessage: viewerMergeBodyText(mergeType: SQUASH)
    }
  }
}
    `) as unknown as TypedDocumentString<MergeTextQuery, MergeTextQueryVariables>;
export const MergedPullRequestsDocument = new TypedDocumentString(`
    query MergedPullRequests($owner: String!, $name: String!, $b0: String!, $b1: String!, $b2: String!, $b3: String!, $b4: String!, $b5: String!, $b6: String!, $b7: String!, $b8: String!, $b9: String!, $first: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    b0: pullRequests(
      states: [MERGED]
      headRefName: $b0
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b1: pullRequests(
      states: [MERGED]
      headRefName: $b1
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b2: pullRequests(
      states: [MERGED]
      headRefName: $b2
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b3: pullRequests(
      states: [MERGED]
      headRefName: $b3
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b4: pullRequests(
      states: [MERGED]
      headRefName: $b4
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b5: pullRequests(
      states: [MERGED]
      headRefName: $b5
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b6: pullRequests(
      states: [MERGED]
      headRefName: $b6
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b7: pullRequests(
      states: [MERGED]
      headRefName: $b7
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b8: pullRequests(
      states: [MERGED]
      headRefName: $b8
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
    b9: pullRequests(
      states: [MERGED]
      headRefName: $b9
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
  }
}
    fragment MergedPullRequestFields on PullRequest {
  number
  createdAt
  baseRefName
  baseRef {
    target {
      __typename
      oid
    }
    refUpdateRule {
      pattern
    }
  }
  headRefName
  headRefOid
  isCrossRepository
  commits(last: 20) {
    nodes {
      commit {
        oid
      }
    }
  }
  mergeCommit {
    oid
    parents(first: 2) {
      nodes {
        oid
      }
    }
  }
  stackEntry {
    position
    stack {
      number
    }
  }
}`) as unknown as TypedDocumentString<MergedPullRequestsQuery, MergedPullRequestsQueryVariables>;
export const OpenPullRequestsDocument = new TypedDocumentString(`
    query OpenPullRequests($owner: String!, $name: String!, $first: Int!, $after: String, $merged: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      name
    }
    pullRequests(
      states: [OPEN]
      orderBy: {field: CREATED_AT, direction: DESC}
      first: $first
      after: $after
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        number
        title
        isDraft
        createdAt
        updatedAt
        author {
          __typename
          login
        }
        baseRefName
        baseRefOid
        baseRef {
          target {
            __typename
            oid
          }
          refUpdateRule {
            pattern
          }
        }
        headRefName
        headRefOid
        headRef {
          refUpdateRule {
            pattern
          }
        }
        isCrossRepository
        headRepositoryOwner {
          __typename
          login
        }
        commits(last: 20) {
          nodes {
            commit {
              oid
            }
          }
        }
        stackEntry {
          position
          stack {
            number
            size
            baseRefName
          }
        }
      }
    }
    mergedPullRequests: pullRequests(
      states: [MERGED]
      orderBy: {field: UPDATED_AT, direction: DESC}
      first: $merged
    ) {
      nodes {
        ...MergedPullRequestFields
      }
    }
  }
}
    fragment MergedPullRequestFields on PullRequest {
  number
  createdAt
  baseRefName
  baseRef {
    target {
      __typename
      oid
    }
    refUpdateRule {
      pattern
    }
  }
  headRefName
  headRefOid
  isCrossRepository
  commits(last: 20) {
    nodes {
      commit {
        oid
      }
    }
  }
  mergeCommit {
    oid
    parents(first: 2) {
      nodes {
        oid
      }
    }
  }
  stackEntry {
    position
    stack {
      number
    }
  }
}`) as unknown as TypedDocumentString<OpenPullRequestsQuery, OpenPullRequestsQueryVariables>;
export const PendingReviewDocument = new TypedDocumentString(`
    query PendingReview($owner: String!, $name: String!, $number: Int!, $login: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(states: [PENDING], author: $login, first: 1) {
        nodes {
          id
          commit {
            oid
          }
          comments {
            totalCount
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PendingReviewQuery, PendingReviewQueryVariables>;
export const PullRequestDocument = new TypedDocumentString(`
    query PullRequest($owner: String!, $name: String!, $number: Int!, $filesFirst: Int!, $filesAfter: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      number
      title
      url
      state
      isDraft
      updatedAt
      author {
        __typename
        login
        avatarUrl
      }
      baseRefName
      baseRefOid
      headRefName
      headRefOid
      isCrossRepository
      headRepository {
        nameWithOwner
        isFork
      }
      files(first: $filesFirst, after: $filesAfter) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          path
          viewerViewedState
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PullRequestQuery, PullRequestQueryVariables>;
export const PullRequestCheckDocument = new TypedDocumentString(`
    query PullRequestCheck($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      updatedAt
      state
      isDraft
      baseRefName
      baseRefOid
      headRefOid
      reviewDecision
      mergeStateStatus
      statusCheckRollup {
        state
      }
      checkCounts: statusCheckRollup {
        contexts {
          checkRunCountsByState {
            state
            count
          }
          statusContextCountsByState {
            state
            count
          }
        }
      }
      mergeQueueEntry {
        state
        position
      }
      timelineItems {
        updatedAt
        totalCount
      }
      revisionEvents: timelineItems(
        itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT]
      ) {
        filteredCount
      }
      commits {
        totalCount
      }
      reviews {
        totalCount
      }
      submittedReviews: reviews(
        states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]
      ) {
        totalCount
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved
          comments {
            totalCount
          }
        }
      }
      viewerPendingReview: reviews(states: [PENDING], first: 1) {
        nodes {
          viewerDidAuthor
          comments {
            totalCount
          }
        }
      }
      comments {
        totalCount
      }
      changedFiles
      lastEditedAt
      timelineEvents: timelineItems(
        itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_FORCE_PUSHED_EVENT, LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, CROSS_REFERENCED_EVENT, MERGED_EVENT, ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT, DEPLOYED_EVENT, DEPLOYMENT_ENVIRONMENT_CHANGED_EVENT, CONVERT_TO_DRAFT_EVENT, READY_FOR_REVIEW_EVENT, CLOSED_EVENT, REOPENED_EVENT, BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT, AUTOMATIC_BASE_CHANGE_FAILED_EVENT, REVIEW_DISMISSED_EVENT, AUTO_MERGE_ENABLED_EVENT, AUTO_MERGE_DISABLED_EVENT, AUTO_REBASE_ENABLED_EVENT, AUTO_SQUASH_ENABLED_EVENT, ADDED_TO_STACK_EVENT, REMOVED_FROM_STACK_EVENT]
      ) {
        filteredCount
        updatedAt
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PullRequestCheckQuery, PullRequestCheckQueryVariables>;
export const PullRequestRevisionsDocument = new TypedDocumentString(`
    query PullRequestRevisions($owner: String!, $name: String!, $number: Int!, $login: String!, $first: Int!, $timelineAfter: String, $reviewsAfter: String) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      createdAt
      closed
      closedAt
      merged
      headRefName
      headRefOid
      baseRefName
      headRepository {
        name
        owner {
          __typename
          login
        }
      }
      mergeCommit {
        oid
        parents(first: 2) {
          nodes {
            oid
          }
        }
      }
      timelineItems(
        first: $first
        after: $timelineAfter
        itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT]
      ) {
        filteredCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          __typename
          ... on HeadRefForcePushedEvent {
            createdAt
            beforeCommit {
              oid
            }
            afterCommit {
              oid
            }
          }
          ... on BaseRefForcePushedEvent {
            createdAt
            beforeCommit {
              oid
            }
            afterCommit {
              oid
            }
          }
          ... on BaseRefChangedEvent {
            createdAt
            previousRefName
            currentRefName
          }
          ... on AutomaticBaseChangeSucceededEvent {
            createdAt
            oldBase
            newBase
          }
        }
      }
      reviews(
        first: $first
        after: $reviewsAfter
        states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          submittedAt
          commit {
            oid
          }
          author {
            __typename
            login
          }
        }
      }
      viewerLastReview: reviews(
        last: 1
        author: $login
        states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]
      ) {
        nodes {
          submittedAt
          commit {
            oid
          }
        }
      }
      commits(last: 100) {
        nodes {
          commit {
            oid
            checkSuites(first: 10) {
              nodes {
                createdAt
                branch {
                  name
                }
                push {
                  previousSha
                  nextSha
                }
              }
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PullRequestRevisionsQuery, PullRequestRevisionsQueryVariables>;
export const PullRequestSidebarDocument = new TypedDocumentString(`
    query PullRequestSidebar($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      isDraft
      labels(first: 100) {
        nodes {
          name
          color
        }
      }
      reviewRequests(first: 100) {
        nodes {
          requestedReviewer {
            __typename
            ... on User {
              login
            }
            ... on Bot {
              login
            }
            ... on Mannequin {
              login
            }
            ... on Team {
              combinedSlug
            }
            ... on EnterpriseTeam {
              slug
            }
          }
        }
      }
      latestReviews(first: 100) {
        nodes {
          author {
            __typename
            login
          }
          state
        }
      }
      assignees(first: 100) {
        nodes {
          __typename
          login
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PullRequestSidebarQuery, PullRequestSidebarQueryVariables>;
export const QueueRemovalDocument = new TypedDocumentString(`
    query QueueRemoval($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      url
      state
      isInMergeQueue
      timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          __typename
          ... on RemovedFromMergeQueueEvent {
            createdAt
            reason
            actor {
              __typename
              login
            }
            beforeCommit {
              oid
              statusCheckRollup {
                contexts(first: 50) {
                  nodes {
                    ...QueueCheck
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
    fragment QueueCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
  }
  ... on StatusContext {
    context
    state
    targetUrl
  }
}`) as unknown as TypedDocumentString<QueueRemovalQuery, QueueRemovalQueryVariables>;
export const QueueViewDocument = new TypedDocumentString(`
    query QueueView($owner: String!, $name: String!, $branch: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    viewerPermission
    mergeQueue(branch: $branch) {
      url
      nextEntryEstimatedTimeToMerge
      configuration {
        mergeMethod
        mergingStrategy
        maximumEntriesToBuild
      }
      entries(first: 100) {
        totalCount
        nodes {
          id
          position
          state
          enqueuedAt
          estimatedTimeToMerge
          jump
          solo
          enqueuer {
            __typename
            login
          }
          baseCommit {
            oid
          }
          headCommit {
            oid
            statusCheckRollup {
              contexts(first: 50) {
                nodes {
                  ...QueueCheck
                }
              }
            }
          }
          pullRequest {
            id
            number
            title
            url
            headRefOid
            viewerDidAuthor
            author {
              __typename
              login
            }
          }
        }
      }
    }
  }
}
    fragment QueueCheck on StatusCheckRollupContext {
  __typename
  ... on CheckRun {
    name
    status
    conclusion
    detailsUrl
    url
  }
  ... on StatusContext {
    context
    state
    targetUrl
  }
}`) as unknown as TypedDocumentString<QueueViewQuery, QueueViewQueryVariables>;
export const RenderedBodiesDocument = new TypedDocumentString(`
    query RenderedBodies($owner: String!, $name: String!, $number: Int!, $description: Boolean!, $ids: [ID!]!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) @include(if: $description) {
      bodyHTML
    }
  }
  nodes(ids: $ids) {
    __typename
    ... on IssueComment {
      id
      bodyHTML
    }
    ... on PullRequestReview {
      id
      bodyHTML
    }
    ... on PullRequestReviewComment {
      id
      bodyHTML
    }
  }
}
    `) as unknown as TypedDocumentString<RenderedBodiesQuery, RenderedBodiesQueryVariables>;
export const ResolveReviewThreadDocument = new TypedDocumentString(`
    mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}
    `) as unknown as TypedDocumentString<ResolveReviewThreadMutation, ResolveReviewThreadMutationVariables>;
export const ReviewCommentDocument = new TypedDocumentString(`
    query ReviewComment($comment: ID!, $thread: ID!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  comment: node(id: $comment) {
    __typename
    ... on PullRequestReviewComment {
      id
      author {
        __typename
        login
      }
      body
      state
      lastEditedAt
      editor {
        __typename
        login
      }
      viewerDidAuthor
      viewerCanUpdate
      viewerCanDelete
      viewerCannotUpdateReasons
      pullRequestReview {
        state
        comments {
          totalCount
        }
      }
    }
  }
  thread: node(id: $thread) {
    __typename
    ... on PullRequestReviewThread {
      isResolved
      comments {
        totalCount
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ReviewCommentQuery, ReviewCommentQueryVariables>;
export const ReviewStateDocument = new TypedDocumentString(`
    query ReviewState($id: ID!) {
  node(id: $id) {
    __typename
    ... on PullRequestReview {
      state
    }
  }
}
    `) as unknown as TypedDocumentString<ReviewStateQuery, ReviewStateQueryVariables>;
export const ReviewThreadCommentsDocument = new TypedDocumentString(`
    query ReviewThreadComments($id: ID!, $first: Int!, $after: String) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  node(id: $id) {
    __typename
    ... on PullRequestReviewThread {
      comments(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ...ReviewComment
        }
      }
    }
  }
}
    fragment ReviewComment on PullRequestReviewComment {
  id
  author {
    __typename
    login
  }
  body
  state
  createdAt
  url
  isMinimized
  minimizedReason
  viewerCanUpdate
  viewerCanDelete
  commit {
    oid
  }
  originalCommit {
    oid
  }
}`) as unknown as TypedDocumentString<ReviewThreadCommentsQuery, ReviewThreadCommentsQueryVariables>;
export const ReviewThreadsDocument = new TypedDocumentString(`
    query ReviewThreads($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          path
          subjectType
          diffSide
          startDiffSide
          line
          startLine
          originalLine
          originalStartLine
          isOutdated
          isResolved
          viewerCanReply
          viewerCanResolve
          viewerCanUnresolve
          comments(first: $first) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ...ReviewComment
            }
          }
        }
      }
    }
  }
}
    fragment ReviewComment on PullRequestReviewComment {
  id
  author {
    __typename
    login
  }
  body
  state
  createdAt
  url
  isMinimized
  minimizedReason
  viewerCanUpdate
  viewerCanDelete
  commit {
    oid
  }
  originalCommit {
    oid
  }
}`) as unknown as TypedDocumentString<ReviewThreadsQuery, ReviewThreadsQueryVariables>;
export const StackLayersDocument = new TypedDocumentString(`
    query StackLayers($ids: [ID!]!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  nodes(ids: $ids) {
    __typename
    ... on PullRequest {
      id
      number
      state
      headRefOid
      reviewDecision
      statusCheckRollup {
        state
      }
      isInMergeQueue
      mergeQueueEntry {
        position
        state
      }
      files(first: 100) {
        totalCount
        nodes {
          viewerViewedState
        }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved
        }
      }
      movedFrom: timelineItems(
        itemTypes: [AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT, BASE_REF_CHANGED_EVENT]
        last: 1
      ) {
        nodes {
          __typename
          ... on AutomaticBaseChangeSucceededEvent {
            oldBase
          }
          ... on BaseRefChangedEvent {
            previousRefName
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<StackLayersQuery, StackLayersQueryVariables>;
export const SubmitPullRequestReviewDocument = new TypedDocumentString(`
    mutation SubmitPullRequestReview($pullRequestReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(
    input: {pullRequestReviewId: $pullRequestReviewId, event: $event, body: $body}
  ) {
    pullRequestReview {
      id
      state
    }
  }
}
    `) as unknown as TypedDocumentString<SubmitPullRequestReviewMutation, SubmitPullRequestReviewMutationVariables>;
export const TimelineDocument = new TypedDocumentString(`
    query Timeline($owner: String!, $name: String!, $number: Int!, $last: Int!, $before: String) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      author {
        __typename
        login
      }
      body
      createdAt
      lastEditedAt
      timelineEvents: timelineItems(
        itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_FORCE_PUSHED_EVENT, LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, CROSS_REFERENCED_EVENT, MERGED_EVENT, ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT, DEPLOYED_EVENT, DEPLOYMENT_ENVIRONMENT_CHANGED_EVENT, CONVERT_TO_DRAFT_EVENT, READY_FOR_REVIEW_EVENT, CLOSED_EVENT, REOPENED_EVENT, BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT, AUTOMATIC_BASE_CHANGE_FAILED_EVENT, REVIEW_DISMISSED_EVENT, AUTO_MERGE_ENABLED_EVENT, AUTO_MERGE_DISABLED_EVENT, AUTO_REBASE_ENABLED_EVENT, AUTO_SQUASH_ENABLED_EVENT, ADDED_TO_STACK_EVENT, REMOVED_FROM_STACK_EVENT]
      ) {
        updatedAt
      }
      timelineItems(last: $last, before: $before) {
        filteredCount
        pageInfo {
          hasPreviousPage
          startCursor
        }
        edges {
          cursor
          node {
            __typename
            ... on IssueComment {
              id
              author {
                __typename
                login
              }
              body
              createdAt
              lastEditedAt
              url
              isMinimized
              minimizedReason
              viewerCanUpdate
              viewerCanDelete
            }
            ... on PullRequestReview {
              id
              author {
                __typename
                login
              }
              body
              state
              createdAt
              submittedAt
              lastEditedAt
              url
              isMinimized
              commit {
                oid
              }
              comments {
                totalCount
              }
            }
            ... on PullRequestCommit {
              gitCommit: commit {
                oid
                messageHeadline
                committedDate
                author {
                  name
                  user {
                    login
                  }
                }
                statusCheckRollup {
                  state
                }
              }
            }
            ... on HeadRefForcePushedEvent {
              actor {
                __typename
                login
              }
              createdAt
              beforeCommit {
                oid
              }
              afterCommit {
                oid
              }
            }
            ... on BaseRefForcePushedEvent {
              actor {
                __typename
                login
              }
              createdAt
              beforeCommit {
                oid
              }
              afterCommit {
                oid
              }
            }
            ... on LabeledEvent {
              actor {
                __typename
                login
              }
              createdAt
              label {
                name
                color
              }
            }
            ... on UnlabeledEvent {
              actor {
                __typename
                login
              }
              createdAt
              label {
                name
                color
              }
            }
            ... on AssignedEvent {
              actor {
                __typename
                login
              }
              createdAt
              assignee {
                __typename
                ... on User {
                  login
                }
                ... on Bot {
                  login
                }
                ... on Mannequin {
                  login
                }
                ... on Organization {
                  login
                }
              }
            }
            ... on UnassignedEvent {
              actor {
                __typename
                login
              }
              createdAt
              assignee {
                __typename
                ... on User {
                  login
                }
                ... on Bot {
                  login
                }
                ... on Mannequin {
                  login
                }
                ... on Organization {
                  login
                }
              }
            }
            ... on ReviewRequestedEvent {
              actor {
                __typename
                login
              }
              createdAt
              requestedReviewer {
                __typename
                ... on User {
                  login
                }
                ... on Bot {
                  login
                }
                ... on Mannequin {
                  login
                }
                ... on Team {
                  combinedSlug
                }
                ... on EnterpriseTeam {
                  slug
                }
              }
            }
            ... on ReviewRequestRemovedEvent {
              actor {
                __typename
                login
              }
              createdAt
              requestedReviewer {
                __typename
                ... on User {
                  login
                }
                ... on Bot {
                  login
                }
                ... on Mannequin {
                  login
                }
                ... on Team {
                  combinedSlug
                }
                ... on EnterpriseTeam {
                  slug
                }
              }
            }
            ... on CrossReferencedEvent {
              actor {
                __typename
                login
              }
              createdAt
              willCloseTarget
              source {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
                ... on PullRequest {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
              }
            }
            ... on MergedEvent {
              actor {
                __typename
                login
              }
              createdAt
              commit {
                oid
              }
              mergeRefName
            }
            ... on AddedToMergeQueueEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on RemovedFromMergeQueueEvent {
              actor {
                __typename
                login
              }
              createdAt
              reason
            }
            ... on DeployedEvent {
              actor {
                __typename
                login
              }
              createdAt
              deployment {
                environment
                latestStatus {
                  state
                }
              }
            }
            ... on DeploymentEnvironmentChangedEvent {
              actor {
                __typename
                login
              }
              createdAt
              deploymentStatus {
                state
                deployment {
                  environment
                }
              }
            }
            ... on ConvertToDraftEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on ReadyForReviewEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on ClosedEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on ReopenedEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on BaseRefChangedEvent {
              actor {
                __typename
                login
              }
              createdAt
              previousRefName
              currentRefName
            }
            ... on AutomaticBaseChangeSucceededEvent {
              actor {
                __typename
                login
              }
              createdAt
              oldBase
              newBase
            }
            ... on AutomaticBaseChangeFailedEvent {
              actor {
                __typename
                login
              }
              createdAt
              oldBase
              newBase
            }
            ... on ReviewDismissedEvent {
              actor {
                __typename
                login
              }
              createdAt
              dismissalMessage
              previousReviewState
              review {
                id
                author {
                  __typename
                  login
                }
              }
            }
            ... on AutoMergeEnabledEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on AutoMergeDisabledEvent {
              actor {
                __typename
                login
              }
              createdAt
              reason
            }
            ... on AutoRebaseEnabledEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on AutoSquashEnabledEvent {
              actor {
                __typename
                login
              }
              createdAt
            }
            ... on AddedToStackEvent {
              actor {
                __typename
                login
              }
              createdAt
              stackNumber
            }
            ... on RemovedFromStackEvent {
              actor {
                __typename
                login
              }
              createdAt
              stackNumber
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<TimelineQuery, TimelineQueryVariables>;
export const TrunkRulesDocument = new TypedDocumentString(`
    query TrunkRules($owner: String!, $name: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    rulesets(first: 100, targets: [BRANCH]) {
      nodes {
        enforcement
        conditions {
          refName {
            include
            exclude
          }
        }
        rules(first: 50) {
          nodes {
            type
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<TrunkRulesQuery, TrunkRulesQueryVariables>;
export const UnmarkFileAsViewedDocument = new TypedDocumentString(`
    mutation UnmarkFileAsViewed($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: {pullRequestId: $pullRequestId, path: $path}) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<UnmarkFileAsViewedMutation, UnmarkFileAsViewedMutationVariables>;
export const UnresolveReviewThreadDocument = new TypedDocumentString(`
    mutation UnresolveReviewThread($threadId: ID!) {
  unresolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}
    `) as unknown as TypedDocumentString<UnresolveReviewThreadMutation, UnresolveReviewThreadMutationVariables>;
export const UpdateIssueCommentDocument = new TypedDocumentString(`
    mutation UpdateIssueComment($id: ID!, $body: String!) {
  updateIssueComment(input: {id: $id, body: $body}) {
    issueComment {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateIssueCommentMutation, UpdateIssueCommentMutationVariables>;
export const UpdatePullRequestReviewCommentDocument = new TypedDocumentString(`
    mutation UpdatePullRequestReviewComment($id: ID!, $body: String!) {
  updatePullRequestReviewComment(
    input: {pullRequestReviewCommentId: $id, body: $body}
  ) {
    pullRequestReviewComment {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<UpdatePullRequestReviewCommentMutation, UpdatePullRequestReviewCommentMutationVariables>;
export const ViewerDocument = new TypedDocumentString(`
    query Viewer {
  viewer {
    login
    databaseId
    name
    avatarUrl
  }
}
    `) as unknown as TypedDocumentString<ViewerQuery, ViewerQueryVariables>;
export const YourReviewsDocument = new TypedDocumentString(`
    query YourReviews($owner: String!, $name: String!, $number: Int!, $login: String!) {
  rateLimit {
    cost
    limit
    remaining
    used
    resetAt
  }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(author: $login, last: 20) {
        nodes {
          id
          state
          body
          submittedAt
          commit {
            oid
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<YourReviewsQuery, YourReviewsQueryVariables>;