/**
 * The merge queue view's rows, and why a pull request left its queue (`docs/design.md`, "The merge
 * queue"), from what `@lo/github` reads: the queue with its entries' checks (`queueView`), the
 * branch's open pull requests with their auto-merge (`queueWaiting`), and a pull request's last
 * removal from its queue (`queueRemoval`).
 */

import {
  queueLeftOut,
  queueWaitingCutShort,
  type CheckFacts,
  type QueueEntryFacts,
  type QueueRemoval,
  type QueueView,
  type QueueWaiting,
  type WaitingPullRequest,
} from '@lo/github';

import { knownGithubValue, outsideCase } from '../enums.ts';
import type { RequiredCheck } from '../merge.ts';
import { requiredCheck } from './facts.ts';
import {
  MERGE_QUEUE_ENTRY_STATES,
  REVIEW_DECISIONS,
  STATUS_STATES,
  type QueueEntryState,
  type ReviewDecision,
} from './github.ts';
import { sameLogin } from './reviews.ts';

/** The rows of a branch's merge queue view. */
export interface QueueRows {
  /** The queue's entries Lo read, in its order: the first merges next. */
  readonly entries: readonly QueueRow[];
  /**
   * How many entries the queue holds, as GitHub counts them, that aren't in
   * {@link QueueRows.entries}: past the 100 read, or left out by GitHub. The view says how many
   * more aren't shown and links to the queue. It can't count those GitHub left out with the
   * entries themselves: {@link QueueRows.leftOut} says so.
   */
  readonly more: number;
  /**
   * Whether GitHub left part of the queue out with an error: the queue, its entries, an entry, or
   * an entry's commits, checks or pull request. The rows then aren't the whole queue, even with
   * none, nor an entry's failed checks all of them; and with no rows, the branch may have a queue.
   * The view says it couldn't read all of the queue and reads it again, rather than show it as
   * complete or empty.
   */
  readonly leftOut: boolean;
  /**
   * The open pull requests into the branch with auto-merge on that aren't in the queue yet: they
   * join it once they're ready, and merge with the queue's own method, which the view names from
   * the queue's settings (`queueView`). Updated most recently first.
   */
  readonly waiting: readonly WaitingRow[];
  /**
   * Whether one waiting to join may be missing from {@link QueueRows.waiting}: the branch has more
   * open pull requests than were read, or GitHub left part of one out with an error. With the
   * queue left out ({@link QueueRows.leftOut}), none are shown, and this is set too.
   */
  readonly waitingCutShort: boolean;
}

/** An entry in the merge queue, and its pull request. */
export interface QueueRow {
  /** The entry's place: 1 merges next. */
  readonly position: number;
  /** The pull request's number. */
  readonly number: number;
  /** Its title, GitHub's text. */
  readonly title: string;
  /** Its page on GitHub. */
  readonly url: string;
  /** Its node ID, for the queue's writes. */
  readonly pullRequestId: string;
  /** Its head, as the queue has it. */
  readonly head: string;
  /** Its author's login, or nothing for a deleted account. */
  readonly author: string | undefined;
  /** Where the entry stands. A state newer than Lo reads as `QUEUED`, waiting. */
  readonly state: QueueEntryState;
  /** When it joined the queue, as GitHub gives it: the view shows how long it's been in. */
  readonly enqueuedAt: string;
  /** How long until it merges, in seconds, when GitHub has an estimate. */
  readonly timeToMerge: number | undefined;
  /** Whether you opened it. */
  readonly yours: boolean;
  /** Whether you added it to the queue. */
  readonly queuedByYou: boolean;
  /**
   * Whether it's among the entries GitHub tests together: the unbroken chain of built entries from
   * the front of the queue, each built on the commit the one ahead is tested on, when the chain
   * holds two or more.
   */
  readonly testedTogether: boolean;
  /**
   * The checks that failed on the commit the queue tests it on, among the first 50 read: why an
   * entry GitHub will take out is failing.
   */
  readonly failedChecks: readonly RequiredCheck[];
}

/** An open pull request into the branch with auto-merge on, waiting to join the queue. */
export interface WaitingRow {
  /** The pull request's number. */
  readonly number: number;
  /** Its title, GitHub's text. */
  readonly title: string;
  /** Its page on GitHub. */
  readonly url: string;
  /** Its node ID, for turning auto-merge off. */
  readonly pullRequestId: string;
  /** Its head. */
  readonly head: string;
  /** Its author's login, or nothing for a deleted account. */
  readonly author: string | undefined;
  /** Whether you opened it. */
  readonly yours: boolean;
  /** Who turned auto-merge on. */
  readonly enabledBy: string | undefined;
  /** When auto-merge was turned on, when GitHub says. */
  readonly enabledAt: string | undefined;
  /**
   * GitHub's review decision: nothing when the branch's rules don't require reviews. A decision
   * newer than Lo reads as a review required.
   */
  readonly reviewDecision: ReviewDecision | undefined;
  /**
   * Its checks together: `passed`, `failed`, `running` (a state newer than Lo too), or nothing when
   * it has none.
   */
  readonly checks: 'passed' | 'failed' | 'running' | undefined;
}

/** `checks`' failed ones. */
function failed(checks: readonly CheckFacts[]): RequiredCheck[] {
  return checks.map(requiredCheck).filter((check) => check.state === 'failed');
}

/**
 * How many entries from the front GitHub builds in one chain, each on the commit the one ahead is
 * tested on: what's tested together.
 */
function chainFromFront(entries: readonly QueueEntryFacts[]): number {
  let built = 0;
  for (const entry of entries) {
    if (entry.tested === undefined) break;
    const ahead = entries[built - 1];
    if (ahead !== undefined && entry.base !== ahead.tested) break;
    built += 1;
  }
  return built;
}

/** Whether `login` names an account, and the same one as `other`. */
function isYou(other: string | undefined, login: string): boolean {
  return other !== undefined && login !== '' && sameLogin(other, login);
}

/** All the checks on a commit together, as the waiting rows show them. */
function rollup(state: string | undefined): WaitingRow['checks'] {
  if (state === undefined) return undefined;
  const known = knownGithubValue(STATUS_STATES, state);
  switch (known) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    case 'PENDING':
    case 'EXPECTED':
    case undefined:
      return 'running';
    default:
      return outsideCase(known, 'running');
  }
}

function waitingRow(pull: WaitingPullRequest, login: string): WaitingRow[] {
  const { autoMerge } = pull;
  if (autoMerge === undefined) return [];
  const decision = pull.reviewDecision;
  return [
    {
      number: pull.number,
      title: pull.title,
      url: pull.url,
      pullRequestId: pull.id,
      head: pull.head,
      author: pull.author,
      yours: isYou(pull.author, login),
      enabledBy: autoMerge.enabledBy,
      enabledAt: autoMerge.enabledAt,
      reviewDecision:
        decision === undefined
          ? undefined
          : (knownGithubValue(REVIEW_DECISIONS, decision) ?? 'REVIEW_REQUIRED'),
      checks: rollup(pull.checks),
    },
  ];
}

/**
 * The merge queue view's rows for `view`, the branch's queue, and `waiting`, its open pull
 * requests, as the account `login`:
 *
 * - each entry with its pull request, in the queue's order, with where it stands, when it joined,
 *   how long until it merges, whether it's yours, and whether it's tested together with others;
 * - the pull requests with auto-merge on that aren't in the queue yet, which join it once they're
 *   ready. A branch with no queue has none.
 *
 * What GitHub left out with an error is never read as an empty queue, or as none waiting: the rows
 * say they're cut short.
 */
export function queueRows(view: QueueView, waiting: QueueWaiting, login: string): QueueRows {
  const queue = view.queue;
  const leftOut = queueLeftOut(view);
  const entries = queue?.entries ?? [];
  const together = chainFromFront(entries);
  const rows = entries.flatMap((entry, index): QueueRow[] => {
    const pull = entry.pullRequest;
    if (pull === undefined) return [];
    return [
      {
        position: entry.position,
        number: pull.number,
        title: pull.title,
        url: pull.url,
        pullRequestId: pull.id,
        head: pull.head,
        author: pull.author,
        state: knownGithubValue(MERGE_QUEUE_ENTRY_STATES, entry.state) ?? 'QUEUED',
        enqueuedAt: entry.enqueuedAt,
        timeToMerge: entry.estimate,
        yours: isYou(pull.author, login),
        queuedByYou: isYou(entry.enqueuer, login),
        testedTogether: together > 1 && index < together,
        failedChecks: failed(entry.checks),
      },
    ];
  });
  const queued = new Set(rows.map((row) => row.number));
  const joining =
    queue === undefined
      ? []
      : waiting.pullRequests
          .filter((pull) => !pull.inQueue && !queued.has(pull.number))
          .flatMap((pull) => waitingRow(pull, login));
  return {
    entries: rows,
    more: Math.max(0, (queue?.total ?? 0) - rows.length),
    leftOut,
    waiting: joining,
    waitingCutShort: queueWaitingCutShort(waiting) || (queue === undefined && leftOut),
  };
}

/**
 * Why a pull request left its merge queue, and when (`createdAt` of its last removal), with
 * whether GitHub left part of the removal out with an error (`leftOut`): who took it out, or the
 * checks that failed, may then be missing.
 */
export type LeftQueue = {
  readonly at: string | undefined;
  readonly leftOut: boolean;
} & LeftQueueReason;

/** Why a pull request left its merge queue. */
export type LeftQueueReason =
  /** It merged. */
  | { readonly kind: 'merged' }
  /**
   * Its checks failed on the commit the queue tested it on: `checks` are those that failed, among
   * the first 50 read, and may be none Lo can name.
   */
  | { readonly kind: 'failedChecks'; readonly checks: readonly RequiredCheck[] }
  /** It conflicted with the branch, or with the entries ahead of it. */
  | { readonly kind: 'conflict' }
  /** Its checks took longer than the queue allows. */
  | { readonly kind: 'timedOut' }
  /** Someone took it out, `by` this account when GitHub says. */
  | { readonly kind: 'removed'; readonly by: string | undefined }
  /** Another reason, in GitHub's word, or none when GitHub gave none. */
  | { readonly kind: 'other'; readonly reason: string | undefined }
  /**
   * GitHub left its last removal, or its reason, out with an error: it may have left, and why
   * isn't known. The view says it couldn't tell, rather than that it never left.
   */
  | { readonly kind: 'unknown' };

/** The reasons GitHub's words name. */
type KnownReason = Exclude<LeftQueueReason['kind'], 'other' | 'unknown'>;

/** GitHub's words for why a pull request left its queue, by the reason each names. */
const REASONS: ReadonlyMap<string, KnownReason> = new Map([
  ['merged', 'merged'],
  ['failed_checks', 'failedChecks'],
  ['manual', 'removed'],
]);

/**
 * The reason GitHub's word `reason` names. GitHub doesn't list its words: `merged`,
 * `failed_checks` and `manual` name what they say, and any other naming a conflict or a timeout is
 * read as one, set apart from case, spaces and hyphens. Nothing for the rest.
 */
function reasonOf(reason: string): KnownReason | undefined {
  const word = reason
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const known = REASONS.get(word);
  if (known !== undefined) return known;
  if (word.includes('conflict')) return 'conflict';
  if (word.includes('timeout') || word.includes('timed_out')) return 'timedOut';
  return undefined;
}

/**
 * Why the pull request `removal` names left its merge queue: merged once GitHub says it's merged,
 * whatever the removal says, else by the reason GitHub gave its last removal, and a word Lo doesn't
 * know as itself (`other`). Nothing when it hasn't left: it's in the queue, or GitHub lists no
 * removal and left none out. When GitHub left the removal or its reason out with an error, it's
 * `unknown`, never nothing.
 */
export function leftQueue(removal: QueueRemoval): LeftQueue | undefined {
  const event = removal.removal;
  const leftOut = removal.leftOut.length > 0;
  if (removal.state.toUpperCase() === 'MERGED') return { kind: 'merged', at: event?.at, leftOut };
  if (removal.inQueue) return undefined;
  if (event === undefined) return leftOut ? { kind: 'unknown', at: undefined, leftOut } : undefined;
  const { at, reason } = event;
  // A reason left out is null, as is one GitHub didn't give.
  if (reason === undefined && leftOut) return { kind: 'unknown', at, leftOut };
  const kind = reason === undefined ? undefined : reasonOf(reason);
  switch (kind) {
    case 'merged':
      return { kind: 'merged', at, leftOut };
    case 'failedChecks':
      return { kind: 'failedChecks', at, leftOut, checks: failed(event.checks) };
    case 'conflict':
      return { kind: 'conflict', at, leftOut };
    case 'timedOut':
      return { kind: 'timedOut', at, leftOut };
    case 'removed':
      return { kind: 'removed', at, leftOut, by: event.by };
    case undefined:
      return { kind: 'other', at, leftOut, reason: reason === '' ? undefined : reason };
    default:
      return outsideCase(kind, { kind: 'other', at, leftOut, reason });
  }
}

/**
 * Whether `removal` answers for a leaving of the queue's entry that joined it at `joined`, in
 * milliseconds since the Unix epoch on GitHub's clock: it merged, or GitHub's last removal came at
 * or after `joined`, or GitHub left the removal out, which is all it will say. A removal from before
 * `joined` is of an earlier entry, and none at all, or GitHub still saying it's in the queue, is a
 * timeline that hasn't caught up: worth reading again before saying Lo can't tell why. With no
 * `joined`, or no time to compare, any removal answers.
 */
export function leftSince(removal: QueueRemoval, joined: number | undefined): boolean {
  const found = leftQueue(removal);
  if (found === undefined) return false;
  if (found.kind === 'merged' || joined === undefined || found.at === undefined) return true;
  const at = Date.parse(found.at);
  return !Number.isFinite(at) || at >= joined;
}
