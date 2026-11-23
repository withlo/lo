// What a merge queue's tab shows of what main read: the queue's rows, as `@lo/review` puts them in
// order and groups them, with the queue's settings, why each entry Lo saw leave left, and the
// branches the tab can switch between. Nothing here reads GitHub or calls Electron.

import {
  queueLeftOut,
  type OpenPullRequestList,
  type QueueRemoval,
  type QueueView,
  type QueueWaiting,
  type TrunkRuleList,
} from '@lo/github';
import {
  knownGithubValue,
  leftQueue,
  outsideCase,
  queueRows,
  type QueueRow,
  type ReviewDecision,
  type WaitingRow,
} from '@lo/review';
import { queueBranches, type Stacks } from '@lo/stacks';

import type {
  Entry,
  LeftEntry,
  LeftWhy,
  QueueMethod,
  QueueRead,
  WaitingEntry,
} from '../contract.ts';

/** GitHub's merge methods, as the queue's settings name them. */
const METHODS = ['MERGE', 'SQUASH', 'REBASE'] as const;

/**
 * The queue's own method, from its settings: the one every entry merges with, those that join it
 * with auto-merge included, whatever their auto-merge says. Nothing for one newer than Lo.
 */
export function methodOf(method: string | undefined): QueueMethod | null {
  if (method === undefined) return null;
  const known = knownGithubValue(METHODS, method);
  switch (known) {
    case 'MERGE':
      return 'merge';
    case 'SQUASH':
      return 'squash';
    case 'REBASE':
      return 'rebase';
    case undefined:
      return null;
    default:
      return outsideCase(known, null);
  }
}

/** GitHub's time, in milliseconds since the Unix epoch, or null when it can't be read. */
export function timeOf(at: string | undefined): number | null {
  if (at === undefined) return null;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** The GitHub stack a pull request is a layer of, as an entry's row names it. */
export type StackOf = (number: number) => Entry['stack'];

/**
 * The GitHub stack each pull request is a layer of, among the repository's open pull requests as
 * `stacks` found them: nothing for one in no stack, or until they're found.
 */
export function stacksOf(stacks: Stacks | undefined): StackOf {
  if (stacks === undefined) return () => null;
  const byStack = new Map<number, { number: number; position: number }[]>();
  for (const { number, nativeStack } of Object.values(stacks.layers)) {
    if (nativeStack === undefined) continue;
    const layers = byStack.get(nativeStack.stack) ?? [];
    layers.push({ number, position: nativeStack.position });
    byStack.set(nativeStack.stack, layers);
  }
  return (number) => {
    const native = stacks.layers[number]?.nativeStack;
    const layers = native && byStack.get(native.stack)?.toSorted((a, b) => a.position - b.position);
    const [first] = layers ?? [];
    const last = layers?.at(-1);
    if (!layers || layers.length < 2 || !first || !last) return null;
    return { layers: layers.length, first: first.number, last: last.number };
  };
}

function entryOf(row: QueueRow, stackOf: StackOf): Entry {
  return {
    position: row.position,
    number: row.number,
    title: row.title,
    url: row.url,
    author: row.author ?? null,
    state: row.state,
    enqueuedAt: timeOf(row.enqueuedAt),
    timeToMerge: row.timeToMerge ?? null,
    yours: row.yours,
    queuedByYou: row.queuedByYou,
    head: row.head.slice(0, 64),
    testedTogether: row.testedTogether,
    stack: stackOf(row.number),
  };
}

function reviewOf(decision: ReviewDecision | undefined): WaitingEntry['review'] {
  switch (decision) {
    case undefined:
      return null;
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changesRequested';
    case 'REVIEW_REQUIRED':
      return 'required';
    default:
      return outsideCase(decision, 'required');
  }
}

function waitingOf(row: WaitingRow): WaitingEntry {
  return {
    number: row.number,
    title: row.title,
    url: row.url,
    author: row.author ?? null,
    yours: row.yours,
    head: row.head.slice(0, 64),
    review: reviewOf(row.reviewDecision),
    checks: row.checks ?? null,
  };
}

/** A pull request Lo saw leave a queue: what it showed of it as it was last read there. */
export interface Leaver {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly enqueuedAt: number | null;
}

/** Why the entry `removal` names left, as the tab shows it. */
function whyOf(
  removal: QueueRemoval,
): { why: LeftWhy; at: string | undefined; partial: boolean } | undefined {
  const found = leftQueue(removal);
  if (found === undefined) {
    // Still in the queue, or in it again: it hasn't left.
    if (removal.inQueue) return undefined;
    // GitHub lists no removal, though Lo saw it go: Lo can't tell why.
    return { why: { kind: 'unknown' }, at: undefined, partial: removal.leftOut.length > 0 };
  }
  const { at } = found;
  const partial = found.leftOut;
  switch (found.kind) {
    case 'merged':
    case 'conflict':
    case 'timedOut':
      return { why: { kind: found.kind }, at, partial };
    case 'failedChecks':
      return {
        why: {
          kind: 'failedChecks',
          checks: found.checks.map((check) => ({ name: check.name, url: check.url ?? null })),
        },
        at,
        partial,
      };
    case 'removed':
      return { why: { kind: 'removed', by: found.by ?? null }, at, partial };
    case 'other':
      return { why: { kind: 'other', reason: found.reason ?? null }, at, partial };
    case 'unknown':
      return { why: { kind: 'unknown' }, at, partial: true };
    default:
      found satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn’t know: ${JSON.stringify(found)}`);
  }
}

/**
 * What the tab shows of `leaver`, which Lo saw leave the queue at `seenAt`, from `removal`, GitHub's
 * read of why it left, or none when that read failed, so Lo can't tell why: nothing when it hasn't
 * left after all, as when it's in the queue again.
 */
export function leftOf(
  leaver: Leaver,
  removal: QueueRemoval | undefined,
  seenAt: number,
): LeftEntry | undefined {
  const found =
    removal === undefined
      ? { why: { kind: 'unknown' as const }, at: undefined, partial: false }
      : whyOf(removal);
  if (found === undefined) return undefined;
  return {
    number: leaver.number,
    title: leaver.title,
    url: leaver.url,
    at: timeOf(found.at) ?? seenAt,
    enqueuedAt: leaver.enqueuedAt,
    why: found.why,
    partial: found.partial,
  };
}

/** No pull requests into a branch, for a queue whose waiting ones haven't been read. */
function noneWaiting(branch: string): QueueWaiting {
  return { branch, pullRequests: [], total: 0, leftOut: [] };
}

/**
 * What the tab shows of a branch's queue, as `login` reads it: nothing yet until `view` is read;
 * no queue when GitHub has none for the branch and left none out; else its rows, each with the
 * GitHub stack `stackOf` says it's a layer of, those waiting to join from `waiting`, and those Lo
 * saw leave it, `left`. Until `waiting` is read none are listed, and when its read failed
 * (`waitingFailed`) the rows say one may be missing.
 */
export function readOf(
  view: QueueView | undefined,
  waiting: QueueWaiting | undefined,
  waitingFailed: boolean,
  login: string,
  stackOf: StackOf = () => null,
  left: readonly LeftEntry[] = [],
): QueueRead {
  if (view === undefined) return { kind: 'reading' };
  const { queue } = view;
  if (queue === undefined && !queueLeftOut(view)) return { kind: 'none' };
  const rows = queueRows(view, waiting ?? noneWaiting(view.branch), login);
  // GitHub may still estimate the next merge of a queue that holds nothing.
  const empty = rows.entries.length === 0 && rows.more === 0 && !rows.leftOut;
  return {
    kind: 'queue',
    url: queue?.url ?? null,
    method: methodOf(queue?.settings?.method),
    groups: queue?.settings?.building ?? null,
    nextMerge: empty ? null : (queue?.nextEstimate ?? null),
    admin: view.viewerPermission === 'ADMIN',
    entries: rows.entries.map((row) => entryOf(row, stackOf)),
    more: rows.more,
    leftOut: rows.leftOut,
    waiting: rows.waiting.map(waitingOf),
    // Not read yet is no sign one is missing: the first read is on its way.
    waitingCutShort: waitingFailed || (waiting !== undefined && rows.waitingCutShort),
    left: [...left],
  };
}

/**
 * How many entries `view`'s queue holds, as the branch switch counts them: nothing when the
 * branch has none, or GitHub left part of it out, so the count isn't known.
 */
export function countOf(view: QueueView): number | null {
  if (view.queue === undefined || queueLeftOut(view)) return null;
  return view.queue.total;
}

/**
 * The branches a merge queue's tab can switch between, in order: the repository's default branch
 * first, then by name. They're the branch it shows, those it showed before (the one `gq` opened it
 * at among them, a pull request's base), and the bases of the repository's open pull requests that
 * a ruleset gives a merge queue, as far as the rulesets Lo has read say.
 */
export function switchBranches(
  shown: string,
  before: readonly string[],
  list: OpenPullRequestList | undefined,
  rules: TrunkRuleList | undefined,
): string[] {
  const found = new Set([shown, ...before]);
  if (list !== undefined && rules !== undefined) {
    const bases = list.pullRequests.map((pull) => pull.baseRefName);
    for (const branch of queueBranches(rules, bases, list.defaultBranch).queued) found.add(branch);
  }
  const first = list?.defaultBranch;
  return [...found].toSorted((a, b) => {
    if (a === first || b === first) return a === first ? (b === first ? 0 : -1) : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
