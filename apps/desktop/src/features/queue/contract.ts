// The merge queue's tab: `gq` opens a repository's merge queue for the base branch of the pull
// request on screen, as the account its tab acts as, in a tab of its own. While that tab is on
// screen, main reads the queue of the branch it shows, the pull requests waiting to join it, and
// why each it saw leave left, and tells the window what it read, in rows the window words.
//
// And changing the queue: `x` takes an entry out and `J` moves it to the front. Each asks main for a
// plan from what it read, which main keeps under a key for the reader to confirm; the window
// confirms the key and never sends the change itself. Main checks the plan again as it's confirmed,
// sends it once, and answers how it went. `a` on a pull request waiting to join turns its auto-merge
// off at once (`autoMergeOff`), asking nothing, since that merges nothing.

import { z } from 'zod';

import type { Cause } from '../../ipc/cause.ts';
import { defineContract, reply } from '../../ipc/contract.ts';
import { branchName, pullNumber, tabId } from '../tab/contract.ts';

/**
 * How often the queue on screen is read while reads succeed, so how long after a read the next one
 * is, as a countdown says.
 */
export const QUEUE_EVERY = 20_000;

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
  /** Its head, as the queue has it: a push since drops a question about it. */
  head: z.string().max(64),
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
  /** Its head. */
  head: z.string().max(64),
  /** Its review, when the branch's rules require one. */
  review: z.enum(['approved', 'changesRequested', 'required']).nullable(),
  /** Its checks together, or null when it has none. */
  checks: z.enum(['passed', 'failed', 'running']).nullable(),
});
export type WaitingEntry = z.output<typeof waitingEntry>;

/**
 * Why a pull request left the queue, as `@lo/review`'s `leftQueue` says: it merged; its checks
 * failed in the queue, those that did, which may be none Lo can name; it conflicted; its checks
 * ran too long; someone took it out, `by` whom when GitHub says; a reason Lo has no word for, in
 * GitHub's own; or Lo can't tell why, as GitHub left it out or Lo couldn't read it.
 */
export const leftWhy = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('merged') }),
  z.strictObject({
    kind: z.literal('failedChecks'),
    checks: z.array(z.strictObject({ name: z.string(), url: z.string().nullable() })),
  }),
  z.strictObject({ kind: z.literal('conflict') }),
  z.strictObject({ kind: z.literal('timedOut') }),
  z.strictObject({ kind: z.literal('removed'), by: z.string().nullable() }),
  z.strictObject({ kind: z.literal('other'), reason: z.string().nullable() }),
  z.strictObject({ kind: z.literal('unknown') }),
]);
export type LeftWhy = z.output<typeof leftWhy>;

/**
 * A pull request Lo saw leave the queue while the tab showed it: when, as GitHub says, or when Lo
 * saw it go; when it had joined; why; and whether GitHub left part of why out (`partial`).
 */
export const leftEntry = z.strictObject({
  number: pullNumber,
  title: z.string(),
  url: z.string(),
  at: time,
  enqueuedAt: time.nullable(),
  why: leftWhy,
  partial: z.boolean(),
});
export type LeftEntry = z.output<typeof leftEntry>;

/** How the queue merges, when the account may read its settings. */
export const queueMethod = z.enum(['merge', 'squash', 'rebase']);
export type QueueMethod = z.output<typeof queueMethod>;

/**
 * What Lo read of the branch's queue:
 *
 * - `reading` before the first read of the branch shown has answered;
 * - `none` when the branch has no merge queue;
 * - `queue`, its entries in order, those past the 100 read (`more`), those waiting to join, and
 *   those Lo saw leave it while the tab showed it (`left`), the latest first.
 *   `leftOut` says GitHub left part of the queue out with an error, so the entries may not be all
 *   of them, even when there are none; `waitingCutShort` that one waiting to join may be missing.
 *   `method` and `groups` are the queue's settings, which GitHub shows only to those who can write
 *   to the repository: the method is always the queue's own, which decides how those waiting merge
 *   once they join. `nextMerge` is GitHub's estimate of when the next entry merges. `admin` says
 *   the account is one of the repository's admins, which GitHub requires to move an entry to the
 *   front.
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
    admin: z.boolean(),
    entries: z.array(entry),
    more: z.number().int().nonnegative(),
    leftOut: z.boolean(),
    waiting: z.array(waitingEntry),
    waitingCutShort: z.boolean(),
    left: z.array(leftEntry),
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
 * when Lo reads again. `away` says its account is signed out or gone, so nothing is read, and
 * nothing in the queue is changed, until it's back: `failure.message` then says why.
 */
export const queueState = z.strictObject({
  id: tabId,
  branch: z.string().min(1),
  branches: z.array(branchCount),
  read: queueRead,
  readAt: time.nullable(),
  failure: z
    .strictObject({
      message: z.string(),
      retryAt: time.nullable(),
      /** Why, in the reader's words, where the cause is known: GitHub's text is `message`. */
      reason: z.string().optional(),
    })
    .nullable(),
  away: z.boolean(),
});
export type QueueState = z.output<typeof queueState>;

/** What names a change's plan, which main keeps for the reader to confirm. */
export const planKey = z.string().regex(/^[0-9a-f-]{36}$/);

/** What `x` and `J` change: take an entry out of the queue, or move it to the front. */
export const actKind = z.enum(['remove', 'jump']);
export type ActKind = z.output<typeof actKind>;

/**
 * A change to the queue, for the reader to confirm before anything is sent:
 *
 * - `key`: what names it, which the window confirms; `id`: the merge queue's tab it was asked from;
 * - `owner`, `repo`, `branch`: the queue; `login`: the account that changes it;
 * - `number`, `title`, `position`: the entry, and where it stood as Lo read it;
 * - `head`: its head as the queue has it, which a push since drops the question;
 * - `stack`: the GitHub stack it's a layer of, when it's in one with other open layers;
 * - `above`: for `remove`, that stack's layers above it in the queue, bottom up, which GitHub takes
 *   out with it.
 */
export interface ActPlan {
  readonly key: string;
  readonly id: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly login: string;
  readonly kind: ActKind;
  readonly number: number;
  readonly title: string;
  readonly position: number;
  readonly head: string;
  readonly stack: number | null;
  readonly above: readonly number[];
}

/**
 * What the reader can do about a change that didn't go: nothing given, try it again; `signIn`, sign
 * in to its account again; `open`, open the pull request, to add it to the queue again from its
 * merge panel; `remove`, remove it from the queue; `ask`, see the question again, asked afresh;
 * `none`, nothing, as for a wait or a refusal; `gone`, nothing, since the question no longer
 * stands.
 */
export type ActNext = 'signIn' | 'open' | 'remove' | 'ask' | 'none' | 'gone';

/**
 * Why a change didn't go, or isn't known to have: `why`, one line in the reader's words, empty for
 * a cause not known; `cause`, why GitHub gives no answer, which the window words in place of an
 * empty `why`; `details`, GitHub's own text, as it came; `next`, what can be done about it;
 * `checking`, that it failed while Lo checked the queue, before it asked.
 */
export interface ActWhy {
  readonly why: string;
  readonly cause?: Cause | undefined;
  readonly details?: string | undefined;
  readonly next?: ActNext | undefined;
  readonly checking?: boolean | undefined;
}

/** A change to confirm, or why there's none. */
export type ActPlanned =
  { readonly kind: 'plan'; readonly plan: ActPlan } | ({ readonly kind: 'refused' } & ActWhy);

/**
 * How a change to the queue went:
 *
 * - `removed`: those pull requests left the queue, the one asked for first;
 * - `moved`: it's back in the queue at `position`, the front or as near it as GitHub puts it, behind
 *   entries GitHub is testing;
 * - `autoMergeOff`: auto-merge is off;
 * - `again`: something the confirmation named changed since it was shown, as `why` says: the new
 *   plan, under a key of its own, is for the reader to confirm;
 * - `refused`: nothing changed, for `why`;
 * - `partly`: GitHub did part of it, such as taking an entry out to move it to the front and not
 *   adding it back;
 * - `unknown`: GitHub's answer was lost, so what it did isn't known. Main reads the queue again,
 *   which shows it, and sends nothing again.
 */
export type Acted =
  | { readonly kind: 'removed'; readonly numbers: readonly number[] }
  | { readonly kind: 'moved'; readonly position: number }
  | { readonly kind: 'autoMergeOff' }
  | { readonly kind: 'again'; readonly plan: ActPlan; readonly why: string }
  | ({ readonly kind: 'refused' } & ActWhy)
  | ({ readonly kind: 'partly' } & ActWhy)
  | ({ readonly kind: 'unknown' } & ActWhy);

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
    /**
     * Plans `kind` for pull request `number` in merge queue tab `id`'s queue, from a read of it no
     * older than 40 s, read again first when there's none, and keeps it for the reader to confirm,
     * in place of the tab's last plan; or says why there's none.
     */
    plan: {
      input: z.strictObject({ id: tabId, number: pullNumber, kind: actKind }),
      reply: reply<ActPlanned>(),
    },
    /**
     * Sends the change the plan named `key` holds, once, if it can still go as the plan says, and
     * answers how it went; else asks again with a new plan, when something it named changed, or
     * refuses.
     */
    confirm: { input: z.strictObject({ key: planKey }), reply: reply<Acted>() },
    /** Forgets the plan named `key`, and stops its confirmation while it's checked, before it's sent. */
    cancel: { input: z.strictObject({ key: planKey }), reply: reply<void>() },
    /**
     * Reads merge queue tab `id`'s queue and those waiting to join it again, both begun now, and
     * replies once they answer, with why one failed, if one did. What they read comes as `queue`
     * first: what "Check again" looks at, after a change whose answer was lost.
     */
    look: { input: z.strictObject({ id: tabId }), reply: reply<string | undefined>() },
    /**
     * Turns off auto-merge for pull request `number`, waiting to join merge queue tab `id`'s queue,
     * at once, asking nothing, since that merges nothing.
     */
    autoMergeOff: {
      input: z.strictObject({ id: tabId, number: pullNumber }),
      reply: reply<Acted>(),
    },
  },
  topics: {
    /** A merge queue's tab, each time what it shows changes. */
    queue: queueState,
    /** The change the plan named `key` holds passed its checks, and is being sent. */
    sent: z.strictObject({ key: planKey }),
  },
});
