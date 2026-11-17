// The merge queue's tab: `gq` opens a repository's merge queue for the base branch of the pull
// request on screen, as the account its tab acts as, in a tab of its own. While that tab is on
// screen, main reads the queue of the branch it shows, and the pull requests waiting to join it,
// and tells the window what it read, in rows the window words.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { branchName, pullNumber, tabId } from '../tab/contract.ts';

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/** A length of time GitHub estimates, in seconds. */
const seconds = z.number().nonnegative();

/**
 * Where an entry stands in its queue, as GitHub names it: waiting to be tested (`QUEUED`), its
 * checks running (`AWAITING_CHECKS`), passed and waiting for those ahead (`MERGEABLE`), failed and
 * about to be taken out (`UNMERGEABLE`), or locked as GitHub merges it (`LOCKED`).
 */
export const entryState = z.enum([
  'QUEUED',
  'AWAITING_CHECKS',
  'MERGEABLE',
  'UNMERGEABLE',
  'LOCKED',
]);
export type EntryState = z.output<typeof entryState>;

/** A pull request in the queue, in the queue's order. */
export const entry = z.strictObject({
  /** Its place: 1 merges next. */
  position: z.number().int().positive(),
  number: pullNumber,
  /** GitHub's text. */
  title: z.string(),
  /** Its page on GitHub. */
  url: z.string(),
  /** Its author's login, or null for an account GitHub deleted. */
  author: z.string().nullable(),
  state: entryState,
  /** When it joined the queue, or null when GitHub's time can't be read. */
  enqueuedAt: time.nullable(),
  /** How long until it merges, when GitHub has an estimate. */
  timeToMerge: seconds.nullable(),
  /** Whether the account the tab reads as opened it. */
  yours: z.boolean(),
  /** Whether that account added it to the queue. */
  queuedByYou: z.boolean(),
  /** Whether GitHub tests it together with the entries around it, from the front of the queue. */
  testedTogether: z.boolean(),
  /**
   * The GitHub stack it's a layer of, as the repository's open pull requests list it: how many
   * open layers it has, and its first and last, bottom up. Null for a pull request in no stack.
   */
  stack: z
    .strictObject({ layers: z.number().int().min(2), first: pullNumber, last: pullNumber })
    .nullable(),
});
export type Entry = z.output<typeof entry>;

/** An open pull request into the branch with auto-merge on, waiting to join the queue. */
export const waitingEntry = z.strictObject({
  number: pullNumber,
  title: z.string(),
  url: z.string(),
  author: z.string().nullable(),
  yours: z.boolean(),
  /** Its review, when the branch's rules require one. */
  review: z.enum(['approved', 'changesRequested', 'required']).nullable(),
  /** Its checks together, or null when it has none. */
  checks: z.enum(['passed', 'failed', 'running']).nullable(),
});
export type WaitingEntry = z.output<typeof waitingEntry>;

/** How the queue merges, when the account may read its settings. */
export const queueMethod = z.enum(['merge', 'squash', 'rebase']);
export type QueueMethod = z.output<typeof queueMethod>;

/**
 * What Lo read of the branch's queue:
 *
 * - `reading` before the first read of the branch shown has answered;
 * - `none` when the branch has no merge queue;
 * - `queue`, its entries in order, those past the 100 read (`more`), and those waiting to join.
 *   `leftOut` says GitHub left part of the queue out with an error, so the entries may not be all
 *   of them, even when there are none; `waitingCutShort` that one waiting to join may be missing.
 *   `method` and `groups` are the queue's settings, which GitHub shows only to those who can write
 *   to the repository: the method is always the queue's own, which decides how those waiting merge
 *   once they join. `nextMerge` is GitHub's estimate of when the next entry merges.
 */
export const queueRead = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reading') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('queue'),
    /** The queue's page on GitHub, or null when GitHub left the queue out. */
    url: z.string().nullable(),
    method: queueMethod.nullable(),
    /** How many entries GitHub tests at once. */
    groups: z.number().int().positive().nullable(),
    nextMerge: seconds.nullable(),
    entries: z.array(entry),
    more: z.number().int().nonnegative(),
    leftOut: z.boolean(),
    waiting: z.array(waitingEntry),
    waitingCutShort: z.boolean(),
  }),
]);
export type QueueRead = z.output<typeof queueRead>;

/** A branch the tab can show, and how many entries its queue holds, once Lo has read it. */
export const branchCount = z.strictObject({
  name: z.string().min(1),
  count: z.number().int().nonnegative().nullable(),
});
export type BranchCount = z.output<typeof branchCount>;

/**
 * A merge queue's tab as main has it, sent each time it changes: the branch it shows, the branches
 * it can show, what was read of the branch's queue and when, and why the last read failed, with
 * when Lo reads again.
 */
export const queueState = z.strictObject({
  id: tabId,
  branch: z.string().min(1),
  branches: z.array(branchCount),
  read: queueRead,
  readAt: time.nullable(),
  failure: z.strictObject({ message: z.string(), retryAt: time.nullable() }).nullable(),
});
export type QueueState = z.output<typeof queueState>;

export const contract = defineContract('queue', {
  requests: {
    /**
     * Shows the merge queue for `branch`: from a pull request's tab, by the id of the view on
     * screen, in the tab of its repository's queues as the account the view acts as, opened if
     * there's none; from a merge queue's tab, by its id, in that tab. Replies with the queue tab's
     * id.
     */
    show: { input: z.strictObject({ id: tabId, branch: branchName }), reply: reply<string>() },
    /** What main has for merge queue tab `id` now, which `queue` then keeps up to date. */
    state: { input: z.strictObject({ id: tabId }), reply: reply<QueueState | undefined>() },
    /**
     * Opens pull request `number` of merge queue tab `id`'s repository in its own tab, as the
     * account the queue's tab reads as, and replies with that tab's id.
     */
    open: { input: z.strictObject({ id: tabId, number: pullNumber }), reply: reply<string>() },
  },
  topics: {
    /** A merge queue's tab, each time what it shows changes. */
    queue: queueState,
  },
});
