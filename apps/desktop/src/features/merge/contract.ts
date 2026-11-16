// Whether a pull request can merge, and why not: main reads what decides it for the view on
// screen, through its account's poller, maps it with `@lo/review`'s merge rules, and sends each
// view's status on `status` as it changes. The window words it: the header's one line, and the
// merge panel's reasons, methods and the squash commit's text, which it asks for as the panel opens.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { oid, tabId } from '../tab/contract.ts';

/** A count of something. */
const count = z.number().int().nonnegative();

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/** Text from GitHub: a login, a branch, a check's name. The window draws it as text. */
const text = z.string().max(1024);

/** A page to open: only `https://` ones, which main checks again before it opens one. */
const page = z.url({ protocol: /^https$/ }).max(4096);

/** A merge method, as GitHub names it. */
export const method = z.enum(['MERGE', 'SQUASH', 'REBASE']);
export type Method = z.output<typeof method>;

/** Where a required check stands on the head. */
export const checkState = z.enum(['passed', 'failed', 'running', 'awaitingApproval', 'missing']);

/** A required check: its name, where it stands, and its run's page, if it has reported. */
export const check = z.strictObject({ name: text, state: checkState, url: page.nullable() });
export type Check = z.output<typeof check>;

/** Someone asked to review: a user by login, or a team as `org/team`. */
export const reviewer = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), login: text }),
  z.strictObject({ kind: z.literal('team'), slug: text }),
]);
export type Reviewer = z.output<typeof reviewer>;

/** A reason the pull request can't merge, as `@lo/review`'s `blockers` gives it. */
export const blocker = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('merged') }),
  z.strictObject({ kind: z.literal('closed') }),
  z.strictObject({ kind: z.literal('draft') }),
  z.strictObject({ kind: z.literal('conflicts') }),
  z.strictObject({ kind: z.literal('outOfDate') }),
  /** By whom: empty when GitHub says so but Lo can't see who. */
  z.strictObject({ kind: z.literal('changesRequested'), by: z.array(text) }),
  z.strictObject({ kind: z.literal('approvals'), more: count, codeOwners: z.array(reviewer) }),
  z.strictObject({ kind: z.literal('check'), check }),
  z.strictObject({ kind: z.literal('notReported'), check }),
  /** With `cutShort`, there were more threads than Lo read, so at least this many. */
  z.strictObject({ kind: z.literal('conversations'), unresolved: count, cutShort: z.boolean() }),
  z.strictObject({
    kind: z.literal('rule'),
    description: text,
    url: page.nullable(),
    waiting: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('checkingMergeability') }),
  z.strictObject({ kind: z.literal('unexplained'), url: page }),
]);
export type Blocker = z.output<typeof blocker>;

/** A rule on the base branch Lo doesn't check, as `@lo/review`'s `uncheckedRules` names it. */
export const unchecked = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum([
      'signatures',
      'deployments',
      'locked',
      'codeScanning',
      'workflows',
      'reviewersByFile',
      'copilotApproval',
    ]),
  }),
  z.strictObject({ kind: z.literal('other'), type: text }),
]);
export type Unchecked = z.output<typeof unchecked>;

/**
 * What merging does now: merge with one of `methods`, `method` first; add it to the base branch's
 * merge queue, whose settings choose the method; or neither, for `reason`.
 */
export const action = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('merge'), methods: z.array(method).min(1), method }),
  z.strictObject({ kind: z.literal('enqueue'), method: method.nullable() }),
  z.strictObject({
    kind: z.literal('notPossible'),
    reason: z.enum(['merged', 'closed', 'queued', 'blocked', 'noPermission', 'noMethod']),
  }),
]);
export type Action = z.output<typeof action>;

/**
 * Where a pull request's merge stands, from what GitHub said at `readAt`.
 *
 * - `verdict`: merged, closed, queued (at `position` when GitHub says), ready, `waiting` on what
 *   waiting will clear, or `blocked` by something it won't.
 * - `blockers`: every reason it can't merge, what waiting won't fix first.
 * - `autoMerge`: on, with the method GitHub merges with, the queue's on a branch with a merge
 *   queue, where GitHub reports a merge commit whatever was asked, or none when Lo can't tell; and
 *   who turned it on.
 * - `partial`: GitHub blocks it, and Lo may not see every rule behind that, so the reasons may be
 *   only part of why. `incomplete`: GitHub left part of the read out (`readAgain`, which Lo does),
 *   or the head has more checks than Lo reads (`checksCutShort`); either way what's shown may not
 *   be all.
 * - `picked`: the method to pick first, of those allowed: the one last used in the repository,
 *   else GitHub's default for the account.
 * - `methods`: what the repository and the base's rules allow, before rebase is left out for
 *   signed commits (`signedCommits`).
 * - `base`: the branch it merges into, a GitHub stack's base for a layer of one.
 * - `queue`: whether that branch merges through a queue, and the queue's method when the account
 *   may read it.
 * - `approvedBy`: who approved it, among those whose approval counts; `checks`: how many required
 *   checks passed, of how many.
 * - `stale`: why Lo couldn't read it again since `readAt`, while it can't: a read failed, GitHub
 *   can't be reached, the account is signed out, or the rate limit holds every read.
 */
export const mergeState = z.strictObject({
  verdict: z.enum(['merged', 'closed', 'queued', 'ready', 'waiting', 'blocked']),
  position: count.nullable(),
  blockers: z.array(blocker),
  autoMerge: z.strictObject({ method: method.nullable(), by: text.nullable() }).nullable(),
  partial: z.boolean(),
  incomplete: z.enum(['readAgain', 'checksCutShort']).nullable(),
  action,
  picked: method.nullable(),
  methods: z.strictObject({ merge: z.boolean(), squash: z.boolean(), rebase: z.boolean() }),
  signedCommits: z.boolean(),
  unchecked: z.array(unchecked),
  base: text,
  queue: z.strictObject({ required: z.boolean(), method: method.nullable() }),
  approvedBy: z.array(text),
  checks: z.strictObject({ passed: count, total: count }),
  url: page,
  /** GitHub's head now; empty when GitHub didn't say. */
  head: z.union([oid, z.literal('')]),
  readAt: time,
  stale: text.nullable(),
});
export type MergeState = z.output<typeof mergeState>;

/**
 * A view's merge status:
 *
 * - `none`: nothing to show, for `why`: a tab acting as nobody, or a run of layers;
 * - `loading`: Lo is reading it for the first time;
 * - `failed`: the first read failed, for `why`; Lo tries again;
 * - `known`: as `state` says.
 */
export const mergeView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none'), why: z.string().max(4096) }),
  z.strictObject({ kind: z.literal('loading') }),
  z.strictObject({ kind: z.literal('failed'), why: z.string().max(4096) }),
  z.strictObject({ kind: z.literal('known'), state: mergeState }),
]);
export type MergeView = z.output<typeof mergeView>;

/** A view's merge status, each time it changes. */
export const status = z.strictObject({ id: tabId, view: mergeView });
export type MergeStatusView = z.output<typeof status>;

/** A squash commit's title and message as GitHub would start them, at `head`. */
export interface SquashText {
  readonly title: string;
  readonly message: string;
  readonly head: string;
}

export const contract = defineContract('merge', {
  requests: {
    /** View `id`'s merge status now, which `status` then keeps up to date. */
    state: { input: z.strictObject({ id: tabId }), reply: reply<MergeView>() },
    /**
     * What the merge panel reads as it opens, for view `id`: the squash commit's title and message
     * GitHub would start with. Fails as `unavailable`, saying why, when GitHub can't say now.
     */
    panel: { input: z.strictObject({ id: tabId }), reply: reply<SquashText>() },
    /**
     * Opens `url`, a page view `id`'s status links, in the system's browser: a check's run, or the
     * pull request on GitHub. Anything else is refused.
     */
    open: { input: z.strictObject({ id: tabId, url: page }), reply: reply<void>() },
  },
  topics: { status },
});
