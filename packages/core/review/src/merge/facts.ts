/**
 * What `@lo/github` reads of a pull request's merge ({@link MergeFacts}), mapped into the
 * {@link MergeSnapshot} the merge rules decide with, with what GitHub doesn't say: the head on
 * screen, the method Lo remembers, and whether the local copy's head holds the base's tip.
 *
 * A value newer than Lo never reads as passing, mergeable or permissive, and Lo then may not see
 * every rule ({@link hasUnknownValues}).
 */

import type { CheckFacts, CheckRequirement, MergeFacts, MergeList, StackFacts } from '@lo/github';

import { knownGithubValue } from '../enums.ts';
import {
  checkRunState,
  commitStatusState,
  type AllowedMethods,
  type CheckState,
  type MergeQueue,
  type MergeSnapshot,
  type RequiredCheck,
  type Review,
  type ReviewRules,
  type Viewer,
} from '../merge.ts';
import { pendingReviewFrom } from '../pending.ts';
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
  type MergeMethod,
} from './github.ts';
import { sameLogin } from './reviews.ts';

/** What GitHub doesn't say: what's on screen, what Lo remembers and what the local copy knows. */
export interface Local {
  /** The head of the revision on screen, as a full SHA. */
  readonly headOnScreen: string;
  /** The method you last used in the repository. */
  readonly preferredMethod: MergeMethod | undefined;
  /**
   * Whether the head contains the base branch's tip (`pullRequest.baseTip`), from the local copy,
   * or nothing when it can't tell yet. Asked only when the base branch requires the head to be up
   * to date ({@link requiresUpToDate}). The local copy fetches the base branch's tip only with the
   * pull request, and GitHub's may be newer, so the caller fetches it first; until then it's
   * nothing, and the snapshot says it can't tell (`outOfDate` is `unknown`).
   */
  readonly headContainsBase: boolean | undefined;
}

/** The list name GitHub gives the head's checks. */
const CHECKS: MergeList = 'checks';
/** The list name GitHub gives the review threads. */
const THREADS: MergeList = 'review threads';

/**
 * Whether the read stopped at the most checks it reads: reading again can't help, and GitHub judges
 * the ones Lo didn't see.
 */
export function checksCutShort(facts: MergeFacts): boolean {
  return facts.cutShort.includes(CHECKS);
}

/** Whether `part`, a field's path, is `field` or a field under it. */
function under(part: string, field: string): boolean {
  return part === field || part.startsWith(`${field}.`);
}

/**
 * Whether Lo read every check on the head: GitHub left none of them, and none of the check suites,
 * out with an error, and there weren't more than the most pages read. Otherwise a required check
 * Lo didn't see may have passed, or may still be reported, so none is taken as missing.
 */
export function checksSeenInFull(facts: MergeFacts): boolean {
  return (
    !checksCutShort(facts) &&
    !facts.leftOut.some(
      (part) =>
        part === CHECKS ||
        under(part, 'pullRequest.statusCheckRollup') ||
        under(part, 'pullRequest.commits'),
    )
  );
}

/**
 * Whether this is everything approve and ship decides with: GitHub left nothing out, and the checks
 * weren't cut short.
 */
export function readInFull(facts: MergeFacts): boolean {
  return facts.leftOut.length === 0 && !checksCutShort(facts);
}

/**
 * The GitHub stack it's a layer of, when that stack's base isn't its own base: a layer above the
 * bottom.
 */
function stackAboveBottom(facts: MergeFacts): StackFacts | undefined {
  const { stack } = facts;
  return stack !== undefined && stack.base !== facts.pullRequest.base ? stack : undefined;
}

/**
 * Whether the base branch's rules require the head to be up to date with the base before it
 * merges: strict required status checks, with at least one check required. Unknown, and so false,
 * when only part of the branch's protection could be read.
 */
export function requiresUpToDate(facts: MergeFacts): boolean {
  const protection = facts.protection;
  const byProtection =
    protection !== undefined && protection.strict && protection.requiredChecks.length > 0;
  return (
    byProtection ||
    facts.rules.rules.some(
      (rule) =>
        rule.kind === 'requiredStatusChecks' && rule.rule.strict && rule.rule.checks.length > 0,
    )
  );
}

/** Whether a pull request's author is Copilot's coding agent, for which a `pull_request` rule can require one more approval. */
function isCopilot(login: string): boolean {
  return sameLogin(login, 'Copilot') || login.startsWith('copilot-swe-agent');
}

/**
 * Whether Lo sees every rule on the base branch that can block the merge: the rulesets' rules were
 * read in full, the classic protection in full or not there, each rule maps to the snapshot, no
 * list was cut short or left out, and GitHub gave no value newer than Lo
 * ({@link hasUnknownValues}).
 */
export function seesEveryRule(facts: MergeFacts): boolean {
  const { protection } = facts;
  const protectionSeen =
    protection === undefined ||
    (protection.complete &&
      !protection.signatures &&
      !protection.deployments &&
      !protection.lockBranch);
  const author = facts.pullRequest.author;
  const byCopilot = author !== undefined && isCopilot(author);
  const rulesSeen = facts.rules.rules.every((rule) => {
    switch (rule.kind) {
      case 'pullRequest':
        return !rule.rule.requiredReviewers && !(rule.rule.extraApprovalForCopilot && byCopilot);
      case 'requiredStatusChecks':
      case 'mergeQueue':
      case 'requiredLinearHistory':
      case 'harmless':
        return true;
      case 'requiredSignatures':
      case 'other':
        return false;
      default:
        return rule satisfies never;
    }
  });
  const stackBaseRead = facts.stack === undefined || facts.stack.baseRead;
  return (
    protectionSeen &&
    rulesSeen &&
    stackBaseRead &&
    facts.rules.unavailable === undefined &&
    !facts.rules.cutShort &&
    facts.cutShort.length === 0 &&
    facts.leftOut.length === 0 &&
    !hasUnknownValues(facts)
  );
}

/**
 * Whether GitHub gave a value newer than Lo for the pull request's state, its review decision or a
 * review's state. Each reads as what blocks the merge ({@link mergeSnapshot}), so Lo may not see
 * why.
 */
export function hasUnknownValues(facts: MergeFacts): boolean {
  const pull = facts.pullRequest;
  const decision = pull.reviewDecision;
  return (
    knownGithubValue(PULL_REQUEST_STATES, pull.state) === undefined ||
    (decision !== undefined && knownGithubValue(REVIEW_DECISIONS, decision) === undefined) ||
    pull.reviews.some((review) => knownGithubValue(REVIEW_STATES, review.state) === undefined)
  );
}

/** The checks the base branch's rules require: its classic protection's, then its rulesets'. */
function checkRequirements(facts: MergeFacts): CheckRequirement[] {
  return [
    ...(facts.protection?.requiredChecks ?? []),
    ...facts.rules.rules.flatMap((rule) =>
      rule.kind === 'requiredStatusChecks' ? rule.rule.checks : [],
    ),
  ];
}

/** The name the base branch's rules require `check` under. */
function checkName(check: CheckFacts): string {
  return check.kind === 'checkRun' ? check.name : check.context;
}

/**
 * Whether a required check nothing has reported under may still be reported: something on the head
 * can still report a check (`pullRequest.checksPending`), or a required check that hasn't reported
 * is pinned to an app whose check suite is queued (`pullRequest.queuedApps`), such as a
 * third-party CI's build waiting for an agent.
 */
export function checksPendingOf(facts: MergeFacts): boolean {
  const pull = facts.pullRequest;
  return (
    pull.checksPending ||
    checkRequirements(facts).some(
      (required) =>
        required.app !== undefined &&
        pull.queuedApps.includes(required.app) &&
        !pull.checks.some((check) => checkName(check) === required.name),
    )
  );
}

/**
 * What the base branch's rules require of reviews and conversations: the strictest of its classic
 * protection and its rulesets' `pull_request` rules.
 */
export function reviewRulesOf(facts: MergeFacts): ReviewRules {
  const sources = [
    ...(facts.protection ? [facts.protection] : []),
    ...facts.rules.rules.flatMap((rule) => (rule.kind === 'pullRequest' ? [rule.rule] : [])),
  ];
  return {
    requiredApprovals: Math.max(0, ...sources.map((source) => source.requiredApprovals)),
    codeOwnerReview: sources.some((source) => source.codeOwnerReview),
    conversationResolution: sources.some((source) => source.conversationResolution),
    dismissStaleReviews: sources.some((source) => source.dismissStaleReviews),
    lastPushApproval: sources.some((source) => source.lastPushApproval),
  };
}

/**
 * The merge methods the repository allows, narrowed by the rulesets' `allowed_merge_methods` and,
 * when the base requires linear history, to squash and rebase.
 */
export function methodsOf(facts: MergeFacts): AllowedMethods {
  const { repository } = facts;
  const linear =
    facts.protection?.linearHistory === true ||
    facts.rules.rules.some((rule) => rule.kind === 'requiredLinearHistory');
  let methods: AllowedMethods = {
    merge: repository.mergeCommitAllowed && !linear,
    squash: repository.squashMergeAllowed,
    rebase: repository.rebaseMergeAllowed,
  };
  for (const rule of facts.rules.rules) {
    if (rule.kind !== 'pullRequest' || rule.rule.allowedMethods === undefined) continue;
    const allowed = rule.rule.allowedMethods.map((name) => knownGithubValue(MERGE_METHODS, name));
    methods = {
      merge: methods.merge && allowed.includes('MERGE'),
      squash: methods.squash && allowed.includes('SQUASH'),
      rebase: methods.rebase && allowed.includes('REBASE'),
    };
  }
  return methods;
}

/** Whether the base branch requires signed commits. */
export function requiresSignedCommits(facts: MergeFacts): boolean {
  return (
    facts.protection?.signatures === true ||
    facts.rules.rules.some((rule) => rule.kind === 'requiredSignatures')
  );
}

/** The merge queue of the branch the pull request merges into, a GitHub stack's base for a layer of one. */
export function queueOf(facts: MergeFacts): MergeQueue {
  const pull = facts.pullRequest;
  const rule = facts.rules.rules.find((found) => found.kind === 'mergeQueue');
  const stack = stackAboveBottom(facts);
  const required = stack ? stack.queueRequired : pull.queueRequired;
  const queueMethod = (stack ? stack.queueMethod : pull.queueMethod) ?? rule?.method;
  return {
    required: required || rule !== undefined,
    method: queueMethod === undefined ? undefined : knownGithubValue(MERGE_METHODS, queueMethod),
    inQueue: pull.inQueue,
    position: pull.queuePosition,
  };
}

/** Repository permissions that can write to it. */
const WRITERS: readonly string[] = ['WRITE', 'MAINTAIN', 'ADMIN'];

/**
 * The account, and what GitHub lets it do here.
 *
 * - Its approval counts, and it may merge, with write access (`WRITE`, `MAINTAIN` or `ADMIN`). The
 *   base branch's push restrictions may still keep it from merging, which GitHub says when it
 *   refuses: `refUpdateRule.viewerCanPush` isn't relied on, since it may be false for every writer
 *   on a branch that requires pull requests.
 * - It may approve when it didn't open the pull request, the pull request is open, the repository
 *   isn't archived, the conversation isn't locked unless it has write access, and it can read the
 *   repository.
 */
export function viewerOf(facts: MergeFacts): Viewer {
  const pull = facts.pullRequest;
  const permission = facts.repository.viewerPermission;
  const writes = permission !== undefined && WRITERS.includes(permission);
  const open = knownGithubValue(PULL_REQUEST_STATES, pull.state) === 'OPEN';
  return {
    login: facts.login,
    teams: pull.viewerTeams,
    didAuthor: pull.viewerDidAuthor,
    canApprove:
      !pull.viewerDidAuthor &&
      open &&
      !facts.repository.archived &&
      (!pull.locked || writes) &&
      permission !== undefined,
    approvalCounts: writes,
    canMerge: writes,
    canMergeAsAdmin: pull.viewerCanMergeAsAdmin,
    canEnableAutoMerge: pull.viewerCanEnableAutoMerge,
    canDisableAutoMerge: pull.viewerCanDisableAutoMerge,
  };
}

/**
 * A required check as the merge rules take it. A status or conclusion newer than Lo counts as
 * running, and a completed run's unknown conclusion as failed, so neither reads as passing.
 */
export function requiredCheck(check: CheckFacts): RequiredCheck {
  let state: CheckState;
  if (check.kind === 'checkRun') {
    const status = knownGithubValue(CHECK_STATUSES, check.status);
    const conclusion =
      check.conclusion === undefined
        ? undefined
        : knownGithubValue(CHECK_CONCLUSIONS, check.conclusion);
    state = status === undefined ? 'running' : checkRunState(status, conclusion);
  } else {
    const status = knownGithubValue(STATUS_STATES, check.state);
    state = status === undefined ? 'running' : commitStatusState(status);
  }
  return { name: checkName(check), state, url: check.url };
}

/**
 * The checks the base branch's rules require, as they stand on the head: each required check run
 * and commit status, in GitHub's order, then each required name nothing has reported under, as
 * `missing`, in the rules' order. A name is taken as missing only when Lo read every check
 * ({@link checksSeenInFull}).
 */
export function requiredChecksOf(facts: MergeFacts): RequiredCheck[] {
  const checks = facts.pullRequest.checks.map(requiredCheck);
  if (!checksSeenInFull(facts)) return checks;
  for (const required of checkRequirements(facts)) {
    if (!checks.some((check) => check.name === required.name)) {
      checks.push({ name: required.name, state: 'missing', url: undefined });
    }
  }
  return checks;
}

/**
 * The snapshot the merge rules decide with, from `facts` and what GitHub doesn't say (`local`). The
 * local copy says whether the head is out of date only when the base branch requires it to be up
 * to date ({@link requiresUpToDate}).
 *
 * A value newer than Lo never reads as passing, mergeable or permissive, and Lo then may not see
 * every rule ({@link hasUnknownValues}):
 *
 * - a merge state or mergeability reads as GitHub still working it out, which blocks the merge;
 * - a pull request's state reads as closed;
 * - a review decision reads as a review required;
 * - an auto-merge method reads as a merge commit;
 * - a review in a state Lo doesn't know is left out, so it neither approves nor blocks: a
 *   {@link Review} has no state that wouldn't misdescribe it.
 */
export function mergeSnapshot(facts: MergeFacts, local: Local): MergeSnapshot {
  const pull = facts.pullRequest;
  const reviews = pull.reviews.flatMap((review): Review[] => {
    const state = knownGithubValue(REVIEW_STATES, review.state);
    if (state === undefined) return [];
    return [
      {
        // GitHub shows a deleted account as `ghost`.
        author: review.author ?? 'ghost',
        state,
        commit: review.commit,
        counts: review.authorCanPush,
        onBehalfOf: review.onBehalfOf,
      },
    ];
  });
  const decision = pull.reviewDecision;
  let outOfDate: MergeSnapshot['outOfDate'] = 'no';
  if (requiresUpToDate(facts)) {
    if (local.headContainsBase === undefined) outOfDate = 'unknown';
    else outOfDate = local.headContainsBase ? 'no' : 'yes';
  }
  const autoMerge = pull.autoMerge;
  const defaultMethod = facts.repository.viewerDefaultMergeMethod;
  return {
    url: pull.url,
    state: knownGithubValue(PULL_REQUEST_STATES, pull.state) ?? 'CLOSED',
    draft: pull.draft,
    mergeable: knownGithubValue(MERGEABLE_STATES, pull.mergeable) ?? 'UNKNOWN',
    mergeState: knownGithubValue(MERGE_STATE_STATUSES, pull.mergeState) ?? 'UNKNOWN',
    reviewDecision:
      decision === undefined
        ? undefined
        : (knownGithubValue(REVIEW_DECISIONS, decision) ?? 'REVIEW_REQUIRED'),
    reviews,
    reviewRequests: pull.reviewRequests.map((request) => ({
      reviewer: request.team
        ? { kind: 'team', slug: request.reviewer }
        : { kind: 'user', login: request.reviewer },
      asCodeOwner: request.asCodeOwner,
    })),
    rules: reviewRulesOf(facts),
    requiredChecks: requiredChecksOf(facts),
    checksPending: checksPendingOf(facts),
    unresolvedThreads: pull.unresolvedThreads,
    threadsCutShort: facts.cutShort.includes(THREADS),
    outOfDate,
    unmetRules: [],
    seesEveryRule: seesEveryRule(facts),
    queue: queueOf(facts),
    autoMerge: autoMerge && {
      method: knownGithubValue(MERGE_METHODS, autoMerge.method) ?? 'MERGE',
      enabledBy: autoMerge.enabledBy,
    },
    methods: methodsOf(facts),
    signedCommits: requiresSignedCommits(facts),
    preferredMethod: local.preferredMethod,
    defaultMethod:
      defaultMethod === undefined ? undefined : knownGithubValue(MERGE_METHODS, defaultMethod),
    viewer: viewerOf(facts),
    head: pull.head,
    headOnScreen: local.headOnScreen,
    pendingReview: pendingReviewFrom(pull.pendingReview),
    complete: readInFull(facts),
    checksCutShort: checksCutShort(facts),
    leftOut: facts.leftOut.length > 0,
  };
}
