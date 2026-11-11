/**
 * Whether a pull request can merge, why not, and what approve and ship does (`docs/design.md`,
 * "Merge status", "Merging", "Approve and ship" and "Acting on what you saw").
 *
 * A {@link MergeSnapshot} holds what GitHub says about a pull request's merge, and the head on
 * screen. `mergeSnapshot` (`./merge/facts.ts`) fills it from what `@lo/github` reads, through
 * GraphQL and REST. Where GitHub reports a decision (`mergeable`, `mergeStateStatus`,
 * `reviewDecision`), the decision wins, and the rest of the snapshot says why.
 *
 * - `blockers` (`./merge/blockers.ts`) lists every reason it can't merge, for the merge panel,
 *   each saying whether waiting will clear it.
 * - `mergeStatus` (`./merge/status.ts`) sums them up for the one-line status in the pull request's
 *   header.
 * - `mergeAction` (`./merge/action.ts`) is what the merge button does: merge with a method, add to
 *   the merge queue, or neither.
 * - `approveAndShip` and `afterApproving` (`./merge/ship.ts`) are approve and ship, `⌘⇧⏎`: the
 *   first refuses or plans the approval, and words the confirmation with what's likely next; the
 *   second, from the pull request read again once approved, merges, joins the queue, turns on
 *   auto-merge, or stops and says why.
 */

import type {
  CheckConclusion,
  CheckStatus,
  MergeableState,
  MergeMethod,
  MergeStateStatus,
  PullRequestState,
  ReviewDecision,
  ReviewState,
  StatusState,
} from './merge/github.ts';
import { outsideCase } from './enums.ts';
import { MERGE_METHODS } from './merge/github.ts';
import type { PendingReview } from './pending.ts';

/**
 * What GitHub says about a pull request's merge, and the head on screen, read right before Lo
 * shows the merge status or acts. Field docs name the GraphQL field each one comes from,
 * `PullRequest`'s unless they say otherwise.
 */
export interface MergeSnapshot {
  /**
   * The pull request's page on GitHub (`url`), linked when GitHub reports a block Lo can't
   * explain.
   */
  readonly url: string;
  /** `state`. */
  readonly state: PullRequestState;
  /** `isDraft`. */
  readonly draft: boolean;
  /** `mergeable`. */
  readonly mergeable: MergeableState;
  /** `mergeStateStatus`. */
  readonly mergeState: MergeStateStatus;
  /** `reviewDecision`: nothing when the base branch's rules don't require reviews. */
  readonly reviewDecision: ReviewDecision | undefined;
  /**
   * Each reviewer's latest approval or request for changes, or its dismissal
   * (`latestOpinionatedReviews`, without `writersOnly`), one per reviewer. A later entry for the
   * same reviewer replaces an earlier one. It keeps reviews from people without write access,
   * marked by {@link Review.counts}, because approve and ship needs your own latest review even
   * when it doesn't count.
   */
  readonly reviews: readonly Review[];
  /** Reviews requested and not yet given (`reviewRequests`). GitHub drops a user's request when they review. */
  readonly reviewRequests: readonly ReviewRequest[];
  /** What the base branch's rules require of reviews and conversations. */
  readonly rules: ReviewRules;
  /**
   * The checks the base branch's rules require, as they stand on the head: one entry for each
   * check run and commit status under a required name, since GitHub requires every one of them to
   * pass, such as a check run and a commit status both named `build`. A required name with
   * nothing the rule accepts reported under it, such as a check pinned to an app that didn't run,
   * is one entry, `missing`.
   */
  readonly requiredChecks: readonly RequiredCheck[];
  /**
   * Whether something on the head can still report a check: a check suite or check run on it
   * hasn't completed. A required check that hasn't reported is a wait only while something can
   * still report it; a running required check counts too.
   */
  readonly checksPending: boolean;
  /** Review threads not yet resolved (`reviewThreads` with `isResolved` false). */
  readonly unresolvedThreads: number;
  /**
   * Whether there were more review threads than were read, so `unresolvedThreads` counts only
   * among those read and more may be unresolved: the merge panel says "at least".
   */
  readonly threadsCutShort: boolean;
  /**
   * Whether the head is out of date with the base where the base branch's rules require it up to
   * date. The caller works it out from the base's rules (strict required status checks) and the
   * local copy, because `mergeStateStatus` says `BEHIND` only when nothing else blocks the merge.
   * It's ignored on a branch that requires a merge queue, since the queue tests each pull request
   * on the latest base itself, and so is GitHub's `BEHIND` there.
   */
  readonly outOfDate: OutOfDate;
  /**
   * Other rules on the base branch the pull request doesn't meet yet, such as required deployments
   * or signed commits.
   */
  readonly unmetRules: readonly UnmetRule[];
  /**
   * Whether Lo sees every rule on the base branch that can block the merge: the caller read its
   * branch protection and its rulesets' active rules
   * (`GET /repos/{owner}/{repo}/rules/branches/{branch}`), each one maps to a field here, and no
   * list was cut short by paging. Rules Lo doesn't model include code scanning, required
   * workflows, reviewers required by file pattern, and the extra approval for a pull request
   * Copilot opened. Without this, a `BLOCKED` that Lo explains may be only partly explained
   * (`mayNotSeeEveryRule`).
   */
  readonly seesEveryRule: boolean;
  /** The base branch's merge queue. */
  readonly queue: MergeQueue;
  /** Auto-merge, when it's on (`autoMergeRequest`). */
  readonly autoMerge: AutoMerge | undefined;
  /** The merge methods the repository allows. */
  readonly methods: AllowedMethods;
  /**
   * Whether the base branch requires signed commits (`requiresCommitSignatures`, a ruleset's
   * `required_signatures`). GitHub can't sign the commits a rebase merge makes, so Lo doesn't
   * offer rebase there.
   */
  readonly signedCommits: boolean;
  /** The method you last used in the repository, which Lo remembers: the one to pick first. */
  readonly preferredMethod: MergeMethod | undefined;
  /**
   * GitHub's default method for you (`Repository.viewerDefaultMergeMethod`): the one to pick when
   * you haven't used one here, or the one you used is no longer allowed.
   */
  readonly defaultMethod: MergeMethod | undefined;
  /** The account Lo acts as. */
  readonly viewer: Viewer;
  /** The head commit GitHub has now (`headRefOid`), as a full SHA. Empty when GitHub didn't report it. */
  readonly head: string;
  /**
   * The head of the revision on screen, as a full SHA: what you looked at, so what approving
   * approves. Empty when there's no revision on screen yet.
   */
  readonly headOnScreen: string;
  /**
   * Your pending review (`reviews(states: PENDING, author: <your login>)`), if you have one.
   * GitHub takes no other review from you while it's pending, so approve and ship approves by
   * submitting it.
   */
  readonly pendingReview: PendingReview | undefined;
  /**
   * Whether everything this snapshot decides with was read: GitHub left no part out with an error,
   * and no list that decides the merge, such as the checks, was cut short. Approve and ship acts
   * only on a complete snapshot; with an incomplete one, its caller reads again first. Without a
   * part GitHub left out, a field here may read as GitHub's answer when it isn't, such as
   * auto-merge reading as off. {@link incomplete} says whether reading again can help.
   */
  readonly complete: boolean;
  /**
   * Whether the read stopped at the most checks it reads, 1,000, so GitHub judges some Lo didn't
   * see. The snapshot then isn't complete, and reading again can't make it so.
   */
  readonly checksCutShort: boolean;
  /**
   * Whether GitHub left part of it out with an error. The snapshot then isn't complete, and with
   * checks cut short too, {@link incomplete} names only those: this tells the two apart for
   * `afterPush`, which doesn't need the checks.
   */
  readonly leftOut: boolean;
}

/** Why a snapshot isn't complete ({@link incomplete}), so approve and ship won't act on it. */
export type Incomplete =
  /** GitHub left part of it out: reading again may give it. */
  | 'readAgain'
  /**
   * The head has more checks than Lo reads: reading again can't help, so approve and ship never
   * acts on it, and nothing reads it again for that.
   */
  | 'checksCutShort';

/**
 * Whether the head is out of date with the base, where the base branch's rules require it up to
 * date: {@link MergeSnapshot.outOfDate}.
 *
 * - `no`: the rules don't require it up to date, or it is.
 * - `yes`: the rules require it up to date, and the base has commits the head doesn't.
 * - `unknown`: the rules require it up to date, and Lo can't tell whether it is, such as before
 *   the local copy has the base branch's tip. Lo may then not see everything that blocks the merge.
 */
export type OutOfDate = 'no' | 'yes' | 'unknown';

/**
 * Why the snapshot isn't complete, or nothing when it is. Checks cut short win over a part left
 * out: reading again can't make such a snapshot complete, whatever else it gives.
 */
export function incomplete(snapshot: MergeSnapshot): Incomplete | undefined {
  if (snapshot.checksCutShort) return 'checksCutShort';
  return snapshot.complete ? undefined : 'readAgain';
}

/**
 * The merge methods allowed here: the repository's, without rebase when the base branch requires
 * signed commits.
 */
export function allowedMethods(snapshot: MergeSnapshot): AllowedMethods {
  return { ...snapshot.methods, rebase: snapshot.methods.rebase && !snapshot.signedCommits };
}

/**
 * The method to pick first: the one you last used here, else GitHub's default for you, else the
 * first allowed, whichever is allowed first.
 */
export function pickedMethod(snapshot: MergeSnapshot): MergeMethod | undefined {
  const preferred = [snapshot.preferredMethod, snapshot.defaultMethod].filter(
    (method) => method !== undefined,
  );
  return chooseMethod(allowedMethods(snapshot), preferred);
}

/** A reviewer's latest approval or request for changes, or its dismissal: an entry of `latestOpinionatedReviews`. */
export interface Review {
  /** The reviewer's login (`author.login`). */
  readonly author: string;
  /** `state`. */
  readonly state: ReviewState;
  /** The commit reviewed (`commit.oid`), or nothing when GitHub no longer has it. */
  readonly commit: string | undefined;
  /**
   * Whether it counts toward the base branch's rules: the reviewer has write access
   * (`authorCanPushToRepository`). Other reviews neither approve nor block.
   */
  readonly counts: boolean;
  /**
   * The teams it was made on behalf of as a code owner (`onBehalfOf`), as `org/team`
   * (`Team.combinedSlug`).
   */
  readonly onBehalfOf: readonly string[];
}

/** A review requested and not yet given: an entry of `reviewRequests`. */
export interface ReviewRequest {
  /** `requestedReviewer`. */
  readonly reviewer: Reviewer;
  /** Whether GitHub requested it because the reviewer owns changed files (`asCodeOwner`). */
  readonly asCodeOwner: boolean;
}

/** Someone asked to review: a user, bot or mannequin by login, or a team as `org/team` (`Team.combinedSlug`). */
export type Reviewer =
  | { readonly kind: 'user'; readonly login: string }
  | { readonly kind: 'team'; readonly slug: string };

/**
 * What the base branch's rules require of reviews and conversations, from its branch protection
 * rule and the `pull_request` rules of its rulesets. With several, the strictest applies: the
 * highest count, and each requirement any of them sets.
 */
export interface ReviewRules {
  /** Approving reviews required (`requiredApprovingReviewCount`). */
  readonly requiredApprovals: number;
  /**
   * Whether files with a code owner need one of their owners to approve (`requireCodeOwnerReview`,
   * `requiresCodeOwnerReviews`).
   */
  readonly codeOwnerReview: boolean;
  /**
   * Whether every conversation must be resolved (`requiredReviewThreadResolution`,
   * `requiresConversationResolution`).
   */
  readonly conversationResolution: boolean;
  /**
   * Whether a push dismisses the approvals given before it (`dismissStaleReviewsOnPush`,
   * `dismissesStaleReviews`). GitHub's default is not to, so a push keeps them.
   */
  readonly dismissStaleReviews: boolean;
  /**
   * Whether the latest push needs approving by someone other than whoever pushed it
   * (`requireLastPushApproval`).
   */
  readonly lastPushApproval: boolean;
}

/**
 * Whether a push makes GitHub want a new approval before the pull request merges: the rules
 * require reviews, and dismiss stale approvals or require the latest push's approval. Otherwise a
 * push merges with the approvals already given, or with none when none are required.
 */
export function pushNeedsNewApproval(rules: ReviewRules): boolean {
  const reviewsRequired = rules.requiredApprovals > 0 || rules.codeOwnerReview;
  return reviewsRequired && (rules.dismissStaleReviews || rules.lastPushApproval);
}

/**
 * A check run or commit status under a name the base branch's rules require, or the name alone
 * when nothing has reported under it.
 */
export interface RequiredCheck {
  /** The check run's `name`, or the commit status's `context`. Several entries can share it. */
  readonly name: string;
  /** Where it stands on the head. */
  readonly state: CheckState;
  /**
   * Its page: the check run's `detailsUrl` (else `url`), or the commit status's `targetUrl`.
   * Nothing for a check that hasn't reported.
   */
  readonly url: string | undefined;
}

/**
 * Where a required check stands on the head.
 *
 * - `passed`: it succeeded, or ended neutral or skipped, which GitHub's rules accept as passing.
 * - `failed`: it ended any other way. Running it again is up to someone.
 * - `running`: it's requested, queued or running.
 * - `awaitingApproval`: it's waiting on a deployment's protection rules, usually for a reviewer to
 *   approve the deployment (a check run's `WAITING`).
 * - `missing`: it hasn't reported on the head. It's a wait while something on the head can still
 *   report it ({@link MergeSnapshot.checksPending}), and otherwise blocks until someone acts.
 */
export type CheckState = 'passed' | 'failed' | 'running' | 'awaitingApproval' | 'missing';

/**
 * A check run's state, from its `status` and, once completed, its `conclusion`. A completed run
 * with no conclusion, which GitHub shouldn't report, counts as failed.
 */
export function checkRunState(
  status: CheckStatus,
  conclusion: CheckConclusion | undefined,
): CheckState {
  if (status === 'COMPLETED') {
    const passing =
      conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED';
    return passing ? 'passed' : 'failed';
  }
  return status === 'WAITING' ? 'awaitingApproval' : 'running';
}

/** A commit status's state. `EXPECTED` is a required status not reported yet. */
export function commitStatusState(state: StatusState): CheckState {
  switch (state) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    case 'PENDING':
      return 'running';
    case 'EXPECTED':
      return 'missing';
    default:
      return outsideCase(state, 'running');
  }
}

/**
 * A rule on the base branch the pull request doesn't meet yet, other than reviews, checks,
 * conversations and being up to date, such as required deployments (`REQUIRED_DEPLOYMENTS`) or
 * signed commits (`REQUIRED_SIGNATURES`).
 */
export interface UnmetRule {
  /** What the rule requires, as the merge panel shows it. */
  readonly description: string;
  /** Where to see more, such as the deployment's page. */
  readonly url: string | undefined;
  /** Whether waiting meets it without anyone acting, such as a deployment that's running. */
  readonly waiting: boolean;
}

/** The base branch's merge queue. */
export interface MergeQueue {
  /**
   * Whether the base branch requires one (`isMergeQueueEnabled`). Then pull requests merge only
   * through it.
   */
  readonly required: boolean;
  /** The method it merges with (`mergeQueue.configuration.mergeMethod`). */
  readonly method: MergeMethod | undefined;
  /**
   * Whether the pull request is in it (`isInMergeQueue`). GitHub can say so while
   * `mergeQueueEntry` is null or can't be read, so this, not `position`, says it's queued.
   */
  readonly inQueue: boolean;
  /** The pull request's position in it (`mergeQueueEntry.position`), when it's in it and GitHub says where. */
  readonly position: number | undefined;
}

/** Auto-merge, turned on: `autoMergeRequest`. */
export interface AutoMerge {
  /** `mergeMethod`. On a branch with a merge queue, the queue's method applies instead. */
  readonly method: MergeMethod;
  /** Who turned it on (`enabledBy.login`). */
  readonly enabledBy: string | undefined;
}

/**
 * The merge methods the repository allows (`mergeCommitAllowed`, `squashMergeAllowed`,
 * `rebaseMergeAllowed`), narrowed by the `allowedMergeMethods` of the base branch's rulesets, and
 * to squash and rebase when the base requires linear history. Lo itself leaves out rebase when the
 * base requires signed commits ({@link MergeSnapshot.signedCommits}).
 */
export interface AllowedMethods {
  readonly merge: boolean;
  readonly squash: boolean;
  readonly rebase: boolean;
}

/** Whether `methods` allow `method`. */
export function allows(methods: AllowedMethods, method: MergeMethod): boolean {
  switch (method) {
    case 'MERGE':
      return methods.merge;
    case 'SQUASH':
      return methods.squash;
    case 'REBASE':
      return methods.rebase;
    default:
      return outsideCase(method, false);
  }
}

/** The allowed methods, in the order GitHub's merge button lists them. */
export function methodList(methods: AllowedMethods): MergeMethod[] {
  return MERGE_METHODS.filter((method) => allows(methods, method));
}

/** The method to pick first: the first of `preferred` that's allowed, else the first allowed. */
export function chooseMethod(
  methods: AllowedMethods,
  preferred: readonly MergeMethod[],
): MergeMethod | undefined {
  return preferred.find((method) => allows(methods, method)) ?? methodList(methods)[0];
}

/** The account Lo acts as, and what GitHub lets it do here. */
export interface Viewer {
  /** Its login. */
  readonly login: string;
  /**
   * The teams it's in, as `org/team` (`Team.combinedSlug`). Only teams asked to review as code
   * owners matter: its approval counts for them.
   */
  readonly teams: readonly string[];
  /** Whether it opened the pull request (`viewerDidAuthor`). GitHub doesn't let authors approve. */
  readonly didAuthor: boolean;
  /**
   * Whether GitHub lets it submit an approving review here. GraphQL has no `viewerCanApprove`, so
   * it's worked out: it didn't open the pull request, the pull request is open, the repository
   * isn't archived, the conversation isn't locked unless it has write access, and it can read the
   * repository.
   */
  readonly canApprove: boolean;
  /**
   * Whether its approval counts toward the base branch's rules: it has write access
   * (`Repository.viewerPermission` is `WRITE`, `MAINTAIN` or `ADMIN`).
   */
  readonly approvalCounts: boolean;
  /**
   * Whether it can merge into the base branch, or add to its merge queue: write access. The base's
   * push restrictions may still keep it out, which GitHub says when it refuses.
   */
  readonly canMerge: boolean;
  /**
   * Whether it can merge without meeting the base branch's rules (`viewerCanMergeAsAdmin`), for
   * the merge panel's admin override. Approve and ship never relies on it: `afterApproving` merges
   * only when GitHub reports the rules are met.
   */
  readonly canMergeAsAdmin: boolean;
  /**
   * Whether it can turn on auto-merge (`viewerCanEnableAutoMerge`): write access, and the
   * repository allows auto-merge.
   */
  readonly canEnableAutoMerge: boolean;
  /**
   * Whether it can turn auto-merge off (`viewerCanDisableAutoMerge`). It reads false for an admin
   * while auto-merge is off, so it says something only while auto-merge is on.
   */
  readonly canDisableAutoMerge: boolean;
}
