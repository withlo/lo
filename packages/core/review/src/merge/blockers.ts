/** Why a pull request can't merge (`docs/design.md`, "Merge status"). */

import type { CheckState, MergeSnapshot, RequiredCheck, UnmetRule } from '../merge.ts';
import {
  changesRequestedBy,
  missingApprovals,
  nothingMissing,
  type MissingApprovals,
} from './reviews.ts';

/** A reason a pull request can't merge. */
export type Blocker =
  /** It's merged. */
  | { readonly kind: 'merged' }
  /** It's closed. */
  | { readonly kind: 'closed' }
  /** It's a draft, until its author marks it ready for review. */
  | { readonly kind: 'draft' }
  /** It conflicts with the base branch. */
  | { readonly kind: 'conflicts' }
  /**
   * The base branch's rules require it to be up to date with the base, and it isn't. Lo doesn't
   * offer GitHub's "Update branch", which adds a commit: the author updates it.
   */
  | { readonly kind: 'outOfDate' }
  /**
   * Reviewers with write access whose latest review requests changes, by login. Each one's
   * approval, or the review's dismissal, clears theirs. Empty when GitHub says changes are
   * requested but Lo can't see by whom: the review is past the page read, or its author lost write
   * access or was deleted. The merge panel then says the reviewer isn't visible and links to the
   * pull request on GitHub.
   */
  | { readonly kind: 'changesRequested'; readonly by: readonly string[] }
  /** Approvals the base branch's rules require and it doesn't have yet. */
  | ({ readonly kind: 'approvals' } & MissingApprovals)
  /**
   * A required check that hasn't passed: it failed, is running, is waiting on a deployment's
   * approval, or hasn't reported while something on the head can still report it. Never `passed`.
   */
  | { readonly kind: 'check'; readonly check: RequiredCheck }
  /**
   * A required check that hasn't reported, and nothing on the head can still report it: a workflow
   * its `paths` skipped, a renamed job, an app that didn't run, or a first-time contributor's
   * workflow waiting for someone to approve running it. GitHub keeps waiting for it, but someone
   * has to act.
   */
  | { readonly kind: 'notReported'; readonly check: RequiredCheck }
  /** Conversations still to resolve, when the base branch's rules require every one resolved. */
  | { readonly kind: 'conversations'; readonly unresolved: number }
  /** Another rule on the base branch. */
  | { readonly kind: 'rule'; readonly rule: UnmetRule }
  /** GitHub is still working out whether it merges cleanly. */
  | { readonly kind: 'checkingMergeability' }
  /**
   * GitHub says it's blocked, and nothing in the snapshot explains why. The merge panel says so and
   * links to the pull request on GitHub.
   */
  | { readonly kind: 'unexplained'; readonly url: string };

/**
 * Whether waiting clears `blocker` without anyone here acting: others' approvals, a required check
 * that's running, waiting on a deployment's approval, or yet to report, GitHub working out
 * mergeability, or a rule that says waiting meets it. A deployment's approval is its own kind of
 * wait: someone approves it, though not here.
 */
export function isWait(blocker: Blocker): boolean {
  switch (blocker.kind) {
    case 'approvals':
    case 'checkingMergeability':
      return true;
    case 'check':
      return (
        blocker.check.state === 'running' ||
        blocker.check.state === 'awaitingApproval' ||
        blocker.check.state === 'missing'
      );
    case 'rule':
      return blocker.rule.waiting;
    case 'merged':
    case 'closed':
    case 'draft':
    case 'conflicts':
    case 'outOfDate':
    case 'changesRequested':
    case 'notReported':
    case 'conversations':
    case 'unexplained':
      return false;
    default:
      return blocker satisfies never;
  }
}

/**
 * Every reason the pull request can't merge, or join its base branch's merge queue, now. Empty
 * when GitHub's rules let it; whether you may is `mergeAction`'s concern.
 *
 * Blockers waiting won't fix come first, then those it will ({@link isWait}), each kind in the
 * order {@link Blocker} lists them. Checks keep the snapshot's order: failed ones, then those
 * nothing will report; then, after missing approvals, those awaiting a deployment's approval,
 * running ones, and those yet to report.
 *
 * - A merged or closed pull request has only `merged` or `closed`.
 * - A draft is `isDraft`, or `mergeStateStatus` `DRAFT`, which REST still reports.
 * - It conflicts when `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`.
 * - It's out of date when `mergeStateStatus` is `BEHIND`, or the caller says so, except on a
 *   branch that requires a merge queue, which tests each pull request on the latest base itself.
 *   There `BEHIND` means nothing blocks joining the queue.
 * - Reviews block it when `reviewDecision` says so. With `CHANGES_REQUESTED`, the requesters are
 *   listed, and the missing approvals when any are; with `REVIEW_REQUIRED`, the missing approvals
 *   always are. With no decision, which GitHub can give where its rules still want an approval,
 *   the approvals the rules require and the reviews don't show are listed while
 *   `mergeStateStatus` is `BLOCKED`.
 * - A required check that hasn't reported is `notReported` unless something on the head can still
 *   report it. While it conflicts, a check suite still running doesn't count: GitHub runs no pull
 *   request workflow then, so it's another, such as a run started by hand.
 * - GitHub is still working out mergeability when `mergeable` or `mergeStateStatus` is `UNKNOWN`.
 * - When `mergeStateStatus` is `BLOCKED` and nothing else is listed but GitHub working out
 *   mergeability, the block is `unexplained`.
 */
export function blockers(snapshot: MergeSnapshot): Blocker[] {
  if (snapshot.state === 'MERGED') return [{ kind: 'merged' }];
  if (snapshot.state === 'CLOSED') return [{ kind: 'closed' }];
  const { mergeState } = snapshot;
  const checks = (state: CheckState) =>
    snapshot.requiredChecks.filter((check) => check.state === state);
  // GitHub runs no pull request workflow while it conflicts, so a check suite still running then,
  // such as a run started by hand, can't report a required check.
  const conflicting = snapshot.mergeable === 'CONFLICTING' || mergeState === 'DIRTY';
  const reporting =
    (snapshot.checksPending && !conflicting) ||
    snapshot.requiredChecks.some(
      (check) => check.state === 'running' || check.state === 'awaitingApproval',
    );
  const rules = (waiting: boolean): Blocker[] =>
    snapshot.unmetRules
      .filter((rule) => rule.waiting === waiting)
      .map((rule) => ({ kind: 'rule', rule }));
  const asChecks = (state: CheckState): Blocker[] =>
    checks(state).map((check) => ({ kind: 'check', check }));

  const found: Blocker[] = [];
  if (snapshot.draft || mergeState === 'DRAFT') found.push({ kind: 'draft' });
  if (conflicting) found.push({ kind: 'conflicts' });
  const behind = mergeState === 'BEHIND' || snapshot.outOfDate === 'yes';
  if (behind && !snapshot.queue.required) found.push({ kind: 'outOfDate' });
  const decision = snapshot.reviewDecision;
  if (decision === 'CHANGES_REQUESTED') {
    found.push({ kind: 'changesRequested', by: changesRequestedBy(snapshot) });
  }
  found.push(...asChecks('failed'));
  if (!reporting) {
    found.push(...checks('missing').map((check): Blocker => ({ kind: 'notReported', check })));
  }
  if (snapshot.rules.conversationResolution && snapshot.unresolvedThreads > 0) {
    found.push({ kind: 'conversations', unresolved: snapshot.unresolvedThreads });
  }
  found.push(...rules(false));
  const missing = missingApprovals(snapshot);
  let approvalsMissing: boolean;
  switch (decision) {
    case 'REVIEW_REQUIRED':
      approvalsMissing = true;
      break;
    case 'CHANGES_REQUESTED':
      approvalsMissing = !nothingMissing(missing);
      break;
    case 'APPROVED':
      approvalsMissing = false;
      break;
    case undefined:
      // GitHub leaves its decision null on a ruleset's base after a COMMENT review, though the
      // approvals the rules require are still missing. While it says `BLOCKED`, the approvals the
      // rules Lo read require and the reviews don't show block too.
      approvalsMissing = mergeState === 'BLOCKED' && !nothingMissing(missing);
      break;
    default:
      approvalsMissing = decision satisfies never;
  }
  if (approvalsMissing) found.push({ kind: 'approvals', ...missing });
  found.push(...asChecks('awaitingApproval'), ...asChecks('running'));
  if (reporting) found.push(...asChecks('missing'));
  found.push(...rules(true));

  if (mergeState === 'BLOCKED' && found.length === 0) {
    found.push({ kind: 'unexplained', url: snapshot.url });
  }
  if (snapshot.mergeable === 'UNKNOWN' || mergeState === 'UNKNOWN') {
    found.push({ kind: 'checkingMergeability' });
  }
  return found;
}

/**
 * Whether Lo may not see every rule behind GitHub's block: GitHub says `BLOCKED`, the snapshot
 * explains it at least in part, and the caller couldn't confirm Lo sees every rule on the base
 * branch ({@link MergeSnapshot.seesEveryRule}), or couldn't tell whether the head is out of date
 * where the rules require it up to date (`outOfDate` is `unknown`). The merge panel and the status
 * then note "Lo may not see every rule" and link to the pull request on GitHub, since what
 * {@link blockers} lists may be only part of why. A block nothing explains is already
 * `unexplained`.
 */
export function mayNotSeeEveryRule(snapshot: MergeSnapshot): boolean {
  return (
    snapshot.state === 'OPEN' &&
    snapshot.mergeState === 'BLOCKED' &&
    (!snapshot.seesEveryRule || snapshot.outOfDate === 'unknown') &&
    !blockers(snapshot).some((blocker) => blocker.kind === 'unexplained')
  );
}
