/**
 * Where the base branch was when a revision was pushed (`docs/design.md`, "Rebase-aware
 * comparison").
 *
 * A revision's base is the merge base of its head with the base branch's tip as it was when the
 * revision was pushed. Today's tip gives the same merge base as long as the branch only moved
 * forward since and doesn't contain the pull request's commits, which is the usual case. It doesn't
 * for a pull request merged with a merge commit or by a fast-forward, whose base branch now holds
 * its revisions, nor for a stacked or retargeted pull request, whose base branch was force-pushed
 * or replaced. {@link baseTipAt} picks the tip then from what GitHub and Lo saw.
 */

import type { PushedAt } from '../revisions.ts';
import { sha } from './sha.ts';

/**
 * A change of the pull request's base branch: a `BaseRefChangedEvent` (`previousRefName`,
 * `currentRefName`, `createdAt`), or an `AutomaticBaseChangeSucceededEvent` (`oldBase`,
 * `newBase`), as when the branch below in a stack is merged and deleted.
 */
export interface Retarget {
  /** The base branch before. */
  readonly from: string;
  /** The base branch after. */
  readonly to: string;
  readonly at: number;
}

/**
 * Something a source saw of where one of the pull request's base branches pointed. SHAs are full
 * commit SHAs; GitHub's all-zero SHA reads as no commit.
 */
export type BaseRecord =
  /**
   * A push in the repository activity API for a base branch
   * (`GET /repos/{owner}/{repo}/activity?ref=refs/heads/{branch}`): `before`, `after`,
   * `timestamp`, and whether `activity_type` is `force_push`. Exact. A `branch_creation` entry's
   * `before` and a `branch_deletion` entry's `after` are the all-zero SHA. The entries for a branch
   * must run unbroken from the earliest one passed to the branch's latest push, as the API pages
   * them, so that the latest at or before a time is the tip then.
   */
  | {
      readonly kind: 'activity';
      readonly branch: string;
      readonly before: string | undefined;
      readonly after: string | undefined;
      readonly at: number;
      readonly forced: boolean;
    }
  /**
   * A `BaseRefForcePushedEvent`: `afterCommit` and `createdAt`, a few seconds after the push, on
   * whichever branch the pull request targeted then. `after` is missing when GitHub no longer has
   * the commit. Exact for that moment, though normal pushes after it go unrecorded. It's taken as
   * {@link EVENT_LAG} before `createdAt`, so a layer pushed just after the one below it, as
   * stacking tools do, sees the push below.
   */
  | { readonly kind: 'forcePush'; readonly after: string | undefined; readonly at: number }
  /**
   * A tip Lo saw itself, and when it first saw it, such as a head of the pull request below in a
   * stack, whose branch is this one's base. The branch was there by then, or had moved on unseen.
   */
  | { readonly kind: 'seen'; readonly branch: string; readonly tip: string; readonly at: number };

/**
 * How long after a push GitHub makes its timeline event, at most, in milliseconds: the activity
 * API's time is 1–4 s before the event's.
 */
export const EVENT_LAG = 5_000;

/** How a pull request merged. */
export interface Merge {
  /**
   * The commit GitHub names as merging it (`mergeCommit`): a merge commit, the squashed or last
   * rebased commit, or the head itself, when the head was pushed to the base branch.
   */
  readonly commit: string;
  /** That commit's parents (`mergeCommit.parents`), its first two. */
  readonly parents: readonly string[];
  /** The pull request's head when it merged (`headRefOid`). */
  readonly head: string;
}

/**
 * Whether it merged with a merge commit of the base and the head: its first parent was the base
 * branch's tip just before.
 */
function withMergeCommit(merge: Merge): boolean {
  return merge.parents.length === 2 && merge.parents[1] === merge.head;
}

/**
 * Whether the base branch now holds the pull request's commits, as it does after a merge commit or
 * a fast-forward, so its tip now is no revision's base. A squash or rebase merge makes new commits
 * instead.
 */
function holdsThePullRequest(merge: Merge): boolean {
  return merge.commit === merge.head || merge.parents.length > 1;
}

/** What's known of a pull request's base branches over time, for {@link baseTipAt}. */
export interface BaseHistory {
  /** The base branch now (`baseRefName`). */
  readonly branch: string;
  /** Its tip now, as the local copy last fetched it. */
  readonly tip?: string | undefined;
  /** How the pull request merged, when it did. */
  readonly merge?: Merge | undefined;
  /** The pull request's retargets, in any order. */
  readonly retargets?: readonly Retarget[] | undefined;
  /** Where base branches pointed, oldest first where times tie. */
  readonly records?: readonly BaseRecord[] | undefined;
}

/** The base branch's tip when a revision was pushed, and how Lo knows it. */
export interface BaseTip {
  /** The tip's SHA. */
  readonly commit: string;
  readonly source: BaseTipSource;
}

/**
 * How {@link baseTipAt} knows a tip. All but `uncertain` give the revision's base as it was, though
 * `forcePush` and `seen` can be a push or more behind.
 */
export type BaseTipSource =
  /**
   * The first parent of the merge commit that merged the pull request into the branch it targeted
   * then, which only moved forward since.
   */
  | 'mergeParent'
  /**
   * The branch's tip just before the push that merged the pull request into it, from the activity
   * API: the push's `before`. The branch only moved forward since.
   */
  | 'beforeMerge'
  /** The activity API's latest push to the branch at or before the revision's. Exact. */
  | 'activity'
  /**
   * The branch's tip now, since it only moved forward after the revision, as far as any source
   * says, and doesn't hold the pull request's commits. Its merge base with the revision's head is
   * the same as the tip then. For a branch the pull request no longer targets, its latest push the
   * activity API read.
   */
  | 'now'
  /**
   * The latest force-push of the branch at or before the revision, from its timeline event. The
   * branch can have moved forward after it.
   */
  | 'forcePush'
  /** A tip Lo saw at or before the revision's push. The branch can have moved forward after it. */
  | 'seen'
  /**
   * The branch's tip now, or the pull request's base branch's when that isn't known, though the
   * branch was force-pushed after the revision, or now holds the pull request's commits, and
   * nothing says where it was then; or a tip that holds the revision's head. Its base can be wrong,
   * so the caller says so.
   */
  | 'uncertain';

/**
 * The tip of the pull request's base branch when a revision was pushed at `pushedAt`, or nothing
 * when nothing names one.
 *
 * - **The branch then.** Retargets after the push name the branch the pull request targeted then.
 *   A push no source dates is taken as the latest.
 * - **Merged,** into the branch the push targeted, when that branch only moved forward since: with
 *   a merge commit (its second parent the head), its first parent; otherwise the `before` of the
 *   activity API's push that merged it (whose `after` is the merge commit or the head).
 * - **From the activity API:** its latest push to the branch at or before the revision's, which is
 *   exact.
 * - **Moving forward only:** the branch's tip now, when no source says it was force-pushed, deleted
 *   or re-created since, and it doesn't hold the pull request's commits. For a branch the pull
 *   request no longer targets, that's its latest push the activity API read.
 * - **Otherwise,** the latest force-push event or tip Lo saw at or before the push, and failing
 *   those, the branch's tip now, flagged `uncertain`.
 * - **Never one holding the revision.** `contains(tip, head)` says whether commit `tip` has the
 *   revision's head, `head`, in its history (whether `head` is an ancestor of `tip` in the local
 *   copy). A tip that does is no base for the revision: its branch took in the pull request's
 *   commits, as when git-flow merges `main` back into `develop` after a pull request retargeted
 *   from `develop` merged into `main`. It's flagged `uncertain`.
 */
export function baseTipAt(
  history: BaseHistory,
  pushedAt: PushedAt,
  head: string,
  contains: (tip: string, head: string) => boolean,
): BaseTip | undefined {
  const then = tipAt(history, pushedAt);
  if (then === undefined) return undefined;
  return contains(then.commit, head) ? { ...then, source: 'uncertain' } : then;
}

/** {@link baseTipAt}, before the check that the tip doesn't hold the revision. */
function tipAt(history: BaseHistory, pushedAt: PushedAt): BaseTip | undefined {
  const at = pushedAt.kind === 'unknown' ? undefined : pushedAt.at;
  const branch = branchAt(history, at);
  const today = branch === history.branch;
  const forwardOnly = !movedBackAfter(history, branch, at);
  // A merge is into today's base branch.
  const merge = today ? history.merge : undefined;
  if (forwardOnly && merge) {
    if (withMergeCommit(merge) && merge.parents[0] !== undefined) {
      return tip(merge.parents[0], 'mergeParent');
    }
    const before = beforeMerge(history, branch, merge);
    if (before !== undefined) return tip(before, 'beforeMerge');
  }
  const after = latest(history, branch, at, activityTip);
  if (after !== undefined) return tip(after, 'activity');
  const now = today ? sha(history.tip) : latest(history, branch, undefined, activityTip);
  const holds = merge !== undefined && holdsThePullRequest(merge);
  if (forwardOnly && !holds && now !== undefined) return tip(now, 'now');
  const forced = latest(history, branch, at, (record) =>
    record.kind === 'forcePush' ? { tip: sha(record.after) } : undefined,
  );
  if (forced !== undefined) return tip(forced, 'forcePush');
  const seen = latest(history, branch, at, (record) =>
    record.kind === 'seen' ? { tip: sha(record.tip) } : undefined,
  );
  if (seen !== undefined) return tip(seen, 'seen');
  const fallback = now ?? sha(history.tip);
  return fallback === undefined ? undefined : tip(fallback, 'uncertain');
}

function tip(commit: string, source: BaseTipSource): BaseTip {
  return { commit, source };
}

/**
 * The tip a record names, `{ tip: undefined }` for a time the branch had no tip, such as a
 * deletion, or nothing for a record that says nothing of the kind asked about.
 */
type TipOf = (record: BaseRecord) => { tip: string | undefined } | undefined;

/** The tip an activity API's push left, or no tip for a deletion. */
const activityTip: TipOf = (record) =>
  record.kind === 'activity' ? { tip: sha(record.after) } : undefined;

/** The branch's tip just before the activity API's push that merged the pull request into it. */
function beforeMerge(history: BaseHistory, branch: string, merge: Merge): string | undefined {
  let found: { at: number; before: string } | undefined;
  for (const record of history.records ?? []) {
    if (record.kind !== 'activity' || record.branch !== branch) continue;
    if (record.after !== merge.commit && record.after !== merge.head) continue;
    const before = sha(record.before);
    // Ties go to the later record.
    if (before !== undefined && (found === undefined || record.at >= found.at)) {
      found = { at: record.at, before };
    }
  }
  return found?.before;
}

/**
 * The base branch the pull request targeted at `at`: the branch the first retarget after it left,
 * or today's when none came after. No time is now.
 */
function branchAt(history: BaseHistory, at: number | undefined): string {
  if (at === undefined) return history.branch;
  let first: Retarget | undefined;
  for (const retarget of history.retargets ?? []) {
    if (retarget.at > at && (first === undefined || retarget.at < first.at)) first = retarget;
  }
  return first?.from ?? history.branch;
}

/**
 * The branch a record is about. A force-push event is about the branch the pull request targeted
 * when it happened.
 */
function recordBranch(history: BaseHistory, record: BaseRecord): string {
  return record.kind === 'forcePush' ? branchAt(history, recordTime(record)) : record.branch;
}

/** When a record's tip was there from: a force-push event's push was up to {@link EVENT_LAG} before it. */
function recordTime(record: BaseRecord): number {
  return record.kind === 'forcePush' ? record.at - EVENT_LAG : record.at;
}

/**
 * Whether a source says `branch` moved anywhere but forward after `at`: a force-push, or the branch
 * deleted or created. Nothing comes after no time, which is now.
 */
function movedBackAfter(history: BaseHistory, branch: string, at: number | undefined): boolean {
  if (at === undefined) return false;
  return (history.records ?? []).some((record) => {
    const movedBack =
      record.kind === 'activity'
        ? record.forced || sha(record.before) === undefined || sha(record.after) === undefined
        : record.kind === 'forcePush';
    return movedBack && recordTime(record) > at && recordBranch(history, record) === branch;
  });
}

/**
 * The tip `tipOf` reads from the latest record about `branch` at or before `at`, among the records
 * it reads one from. A record that names no commit, such as a deletion, is a time the branch had no
 * tip. Ties go to the later record.
 */
function latest(
  history: BaseHistory,
  branch: string,
  at: number | undefined,
  tipOf: TipOf,
): string | undefined {
  let found: { time: number; tip: string | undefined } | undefined;
  for (const record of history.records ?? []) {
    const time = recordTime(record);
    if (at !== undefined && time > at) continue;
    if (recordBranch(history, record) !== branch) continue;
    const read = tipOf(record);
    if (read !== undefined && (found === undefined || time >= found.time)) {
      found = { time, tip: read.tip };
    }
  }
  return found?.tip;
}
