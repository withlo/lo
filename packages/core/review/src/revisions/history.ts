/**
 * A pull request's push history, as `@lo/github` reads it, mapped into what revisions are built
 * from: push records for the head branch, and what's known of the base branches over time.
 */

import type { ActivityEntry, BranchActivity, PushHistory } from '@lo/github';

import type { PushRecord } from '../revisions.ts';
import type { BaseHistory, BaseRecord } from './base.ts';

/** The branch's pushes read, oldest first. */
function entriesOf(activity: BranchActivity): ActivityEntry[] {
  const entries = activity.pages.flatMap((page) => page.entries);
  return activity.direction === 'desc' ? entries.toReversed() : entries;
}

function isDeletion(entry: ActivityEntry): boolean {
  return entry.activity_type === 'branch_deletion';
}

function isForced(entry: ActivityEntry): boolean {
  return entry.activity_type === 'force_push';
}

/**
 * Whether the activity API's log of the head branch holds every push the pull request had: it was
 * read, back to the push the pull request opened with, and each push since starts where the one
 * before ended, up to the head.
 */
export function completeLog(history: PushHistory): boolean {
  const activity = history.headActivity;
  if (activity.unavailable !== undefined || activity.failed !== undefined || activity.truncated) {
    return false;
  }
  const entries = entriesOf(activity).filter((entry) => !isDeletion(entry));
  const opened = Date.parse(history.openedAt);
  const reachedBack = entries.some((entry) => Date.parse(entry.timestamp) <= opened);
  const unbroken = entries.every(
    (entry, index) => index === 0 || entry.before === entries[index - 1]?.after,
  );
  const endsAtHead = entries.at(-1)?.after === history.head;
  return reachedBack && unbroken && endsAtHead;
}

/** A head Lo's poller saw on a pull request, and when it first saw it. */
export interface SeenHead {
  /** The head commit's SHA. */
  readonly head: string;
  /** When a poller first saw it, in milliseconds since the Unix epoch. */
  readonly firstSeen: number;
}

/**
 * What every source saw on the head branch, for `buildRevisions`, with the heads Lo's pollers saw
 * (`seen`):
 *
 * - the head branch's pushes from the activity API, but deletions, and pushes after the pull
 *   request was closed, which belong to whatever reused the branch;
 * - force-push events, those whose head GitHub lost included when the issue timeline named it;
 * - submitted reviews on commits GitHub still has. When the activity API's log of the head branch
 *   is complete (`completeLog`), a review on a commit it never had as its head is a
 *   `reviewedCommit`;
 * - check suites a push to the head branch started on the commit it pushed, made before the pull
 *   request was closed. A suite's branch is unknown once it's deleted, and then it counts. Without
 *   a complete log, a suite on one of the latest commits that no push started, as a fork's pull
 *   request's are in the base repository, says the commit was the head by then: GitHub makes
 *   suites for the heads a pull request is pushed to.
 */
export function pushRecords(history: PushHistory, seen: readonly SeenHead[] = []): PushRecord[] {
  const closed = history.closedAt === undefined ? undefined : Date.parse(history.closedAt);
  const openThen = (at: number): boolean => closed === undefined || at <= closed;
  const complete = completeLog(history);
  const entries = entriesOf(history.headActivity);
  const records: PushRecord[] = [];
  for (const entry of entries) {
    const at = Date.parse(entry.timestamp);
    if (isDeletion(entry) || !openThen(at)) continue;
    records.push({
      kind: 'activity',
      before: entry.before,
      after: entry.after,
      at,
      forced: isForced(entry),
    });
  }
  for (const push of history.headForcePushes) {
    if (push.after === undefined) continue;
    records.push({
      kind: 'forcePush',
      before: push.before,
      after: push.after,
      at: Date.parse(push.at),
    });
  }
  for (const review of history.reviews) {
    const { commit } = review;
    if (commit === undefined) continue;
    const pushed = entries.some((entry) => entry.after === commit);
    const kind = complete && !pushed ? 'reviewedCommit' : 'review';
    records.push({ kind, commit, at: Date.parse(review.at) });
  }
  for (const suite of history.checkSuites) {
    const at = Date.parse(suite.at);
    const onHeadBranch = suite.branch === undefined || suite.branch === history.headBranch;
    if (!onHeadBranch || !openThen(at)) continue;
    if (suite.next !== undefined && suite.next === suite.commit) {
      records.push({ kind: 'checkSuite', previous: suite.previous, next: suite.next, at });
    } else if (suite.previous === undefined && suite.next === undefined && !complete) {
      records.push({ kind: 'checkSuite', previous: undefined, next: suite.commit, at });
    }
  }
  for (const head of seen) {
    records.push({ kind: 'polled', head: head.head, at: head.firstSeen });
  }
  return records;
}

/**
 * What's known of the base branches over time, for `baseTipAt`, with `tip` the base branch's tip as
 * the local copy last fetched it. Tips Lo saw itself, such as the heads of the pull request below
 * in a stack, can be added to its records.
 */
export function baseHistory(history: PushHistory, tip?: string): BaseHistory {
  const records: BaseRecord[] = [];
  for (const activity of history.baseActivity) {
    for (const entry of entriesOf(activity)) {
      records.push({
        kind: 'activity',
        branch: activity.branch,
        before: entry.before,
        after: entry.after,
        at: Date.parse(entry.timestamp),
        forced: isForced(entry),
      });
    }
  }
  for (const push of history.baseForcePushes) {
    records.push({ kind: 'forcePush', after: push.after, at: Date.parse(push.at) });
  }
  const { mergeCommit } = history;
  return {
    branch: history.baseBranch,
    tip,
    merge:
      history.merged && mergeCommit
        ? { commit: mergeCommit.oid, parents: mergeCommit.parents, head: history.head }
        : undefined,
    retargets: history.retargets.map((retarget) => ({
      from: retarget.from,
      to: retarget.to,
      at: Date.parse(retarget.at),
    })),
    records,
  };
}
