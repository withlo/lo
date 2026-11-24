// A queued pull request's place in its branch's merge queue, what's ahead of one about to join it,
// and why one left it, from what GitHub said: `@lo/review`'s queue rows and `leftQueue` decide,
// and this maps their answers into what the window words. A part GitHub left out is said to be
// missing, never read as an empty queue or as a pull request that hasn't left. Nothing here calls
// Electron or GitHub.

import { queueLeftOut, queueViewCutShort, type QueueRemoval, type QueueView } from '@lo/github';
import { leftQueue, queueRows } from '@lo/review';

import type { Ahead, LeftQueue, QueuePlace } from '../contract.ts';
import { checkOf } from './status.ts';

/** The longest text the contract takes from GitHub. */
const TEXT_LIMIT = 1024;

/** GitHub's time, in milliseconds since the Unix epoch, or null when it can't be read. */
function timeOf(at: string | undefined): number | null {
  if (at === undefined) return null;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Whether two logins name one account: GitHub's ignore case. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Pull request `number`'s place in `view`, its branch's queue, as `login` reads it: where it is and
 * stands, when GitHub expects it to merge, and the checks that failed on the commit the queue tests
 * it on, which may be missing some when GitHub left part of the queue out (`partial`). Not listed,
 * it's partly because GitHub left part of the queue out, or the queue is longer than Lo reads;
 * otherwise it's no longer there.
 */
export function placeOf(view: QueueView, number: number, login: string): QueuePlace {
  const rows = queueRows(
    view,
    { branch: view.branch, pullRequests: [], total: 0, leftOut: [] },
    login,
  );
  const row = rows.entries.find((entry) => entry.number === number);
  if (!row) return { kind: 'unlisted', partial: queueViewCutShort(view) };
  return {
    kind: 'listed',
    position: Math.max(1, Math.round(row.position)),
    state: row.state,
    timeToMerge: row.timeToMerge ?? null,
    failed: row.failedChecks.map(checkOf),
    partial: rows.leftOut,
  };
}

/**
 * When pull request `number`'s entry in `view` joined the queue, in milliseconds since the Unix
 * epoch on GitHub's clock, or nothing when `view` doesn't list it or GitHub didn't say.
 */
export function joinedAt(view: QueueView, number: number): number | undefined {
  const entry = view.queue?.entries.find((each) => each.pullRequest?.number === number);
  return timeOf(entry?.enqueuedAt) ?? undefined;
}

/**
 * What's ahead of pull request `number` in `view`, the queue of the branch it would join: no queue,
 * or how many entries, at least that many when GitHub left part of the queue out, and when the last
 * of them should merge, when GitHub estimated each it read and Lo read them all.
 */
export function aheadOf(view: QueueView, number: number): Ahead {
  const { queue } = view;
  const leftOut = queueLeftOut(view);
  if (queue === undefined && !leftOut) return { kind: 'none' };
  const entries = queue?.entries ?? [];
  const others = entries.filter((entry) => entry.pullRequest?.number !== number);
  const listedSelf = others.length < entries.length ? 1 : 0;
  const count = Math.max(others.length, (queue?.total ?? 0) - listedSelf);
  const estimates = others.map((entry) => entry.estimate);
  const all = !leftOut && count === others.length;
  const timeToMerge =
    all && others.length > 0 && estimates.every((each) => each !== undefined)
      ? Math.max(...estimates.map((each) => each ?? 0))
      : null;
  return { kind: 'queue', count, atLeast: leftOut, timeToMerge };
}

/**
 * Why the pull request `removal` names left its merge queue, as `login` reads it, or nothing when
 * it hasn't left (it's in the queue still, or again) or it merged. One GitHub lists no removal for,
 * though Lo saw it queued, left without Lo knowing why. A removal GitHub left out with an error is
 * one Lo can't tell the reason for, never one that didn't happen.
 */
export function leftOf(removal: QueueRemoval, login: string): LeftQueue | undefined {
  const found = leftQueue(removal);
  if (found === undefined) {
    if (removal.inQueue) return undefined;
    return { at: null, why: { kind: 'unknown', why: null }, partial: removal.leftOut.length > 0 };
  }
  const at = timeOf(found.at);
  const partial = found.leftOut;
  switch (found.kind) {
    case 'merged':
      return undefined;
    case 'failedChecks':
      return { at, why: { kind: 'failedChecks', checks: found.checks.map(checkOf) }, partial };
    case 'conflict':
    case 'timedOut':
      return { at, why: { kind: found.kind }, partial };
    case 'removed':
      return {
        at,
        why: {
          kind: 'removed',
          by: found.by === undefined ? null : found.by.slice(0, TEXT_LIMIT),
          you: found.by !== undefined && sameLogin(found.by, login),
        },
        partial,
      };
    case 'other':
      return {
        at,
        why: { kind: 'other', reason: found.reason?.slice(0, TEXT_LIMIT) ?? null },
        partial,
      };
    case 'unknown':
      return { at, why: { kind: 'unknown', why: null }, partial: true };
    default:
      found satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn’t know: ${JSON.stringify(found)}`);
  }
}

/** Every page `place` and `left` link: the runs of the checks that failed. */
export function queuePages(place: QueuePlace | null, left: LeftQueue | null): Set<string> {
  const pages = new Set<string>();
  const checks = [
    ...(place?.kind === 'listed' ? place.failed : []),
    ...(left?.why.kind === 'failedChecks' ? left.why.checks : []),
  ];
  for (const check of checks) if (check.url !== null) pages.add(check.url);
  return pages;
}
