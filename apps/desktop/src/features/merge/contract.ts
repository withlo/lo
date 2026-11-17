// Whether a pull request can merge, and why not: main reads what decides it for the view on
// screen, through its account's poller, maps it with `@lo/review`'s merge rules, and sends each
// view's status on `status` as it changes. The window words it: the header's one line, and the
// merge panel's reasons, methods and the squash commit's text, which it asks for as the panel opens.
// While the pull request on screen is in a merge queue, main reads its place there, and once it
// leaves without merging, why, and sends each view's on `queued`.
//
// And merging: `⏎` in the panel asks main for a plan from what GitHub said last, which main keeps
// under a key for the reader to confirm; the window confirms the key and never sends the merge
// itself. Main checks the plan again as it's confirmed, sends it once, and says how each merge goes
// on `jobs`. `a` plans auto-merge the same way, and `⌥⏎` a merge past the base branch's rules,
// which the reader confirms with the pull request's number typed; `a` with auto-merge on turns it
// off at once (`autoMergeOff`), asking nothing, since that merges nothing.

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

/** A pull request's number. */
const number = z.number().int().min(1);

/** What Lo says: a sentence or two, often with GitHub's words in it. The window draws it as text. */
const words = z.string().max(4096);

/**
 * Why Lo merges nothing now, whatever the pull request's state: GitHub can't be reached, GitHub
 * asked Lo to hold off writing until `until`, or the account is signed out.
 */
export const off = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('offline') }),
  z.strictObject({ kind: z.literal('paused'), until: time }),
  z.strictObject({ kind: z.literal('signedOut') }),
]);
export type Off = z.output<typeof off>;

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
 * What `a` in the merge panel does now: turn auto-merge on, so GitHub merges the pull request, or
 * adds it to the merge queue, once only waits stand in its way; turn it off, at once; or neither,
 * for `reason`.
 */
export const autoAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('on') }),
  z.strictObject({ kind: z.literal('off') }),
  z.strictObject({
    kind: z.literal('notPossible'),
    reason: z.enum([
      'merged',
      'closed',
      'queued',
      'ready',
      'blocked',
      'noPermission',
      'notAllowed',
      'cantTurnOff',
      'noMethod',
    ]),
  }),
]);
export type AutoAction = z.output<typeof autoAction>;

/** Whether `⌥⏎` in the merge panel merges past the base branch's rules now, or why not. */
export const overrideAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('override') }),
  z.strictObject({
    kind: z.literal('notPossible'),
    reason: z.enum([
      'merged',
      'closed',
      'queued',
      'nothingToSkip',
      'noPermission',
      'draft',
      'conflicts',
      'noMethod',
    ]),
  }),
]);
export type OverrideAction = z.output<typeof overrideAction>;

/**
 * What a push before it merges does to the approvals: GitHub wants a new one (`newApproval`), it
 * merges with those already given (`keepsApprovals`), or the base branch requires no review.
 */
export const afterPush = z.enum(['newApproval', 'keepsApprovals', 'noReview']);
export type AfterPush = z.output<typeof afterPush>;

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
 * - `off`: why Lo merges nothing now, whatever GitHub says of the pull request, if it doesn't.
 * - `auto`, `override`: what `a` and `⌥⏎` do now, as `action` is what `⏎` does; `afterPush`, what
 *   a push before it merges does to the approvals, which turning auto-merge on warns of.
 */
export const mergeState = z.strictObject({
  verdict: z.enum(['merged', 'closed', 'queued', 'ready', 'waiting', 'blocked']),
  position: count.nullable(),
  blockers: z.array(blocker),
  autoMerge: z.strictObject({ method: method.nullable(), by: text.nullable() }).nullable(),
  partial: z.boolean(),
  incomplete: z.enum(['readAgain', 'checksCutShort']).nullable(),
  action,
  auto: autoAction,
  override: overrideAction,
  afterPush,
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
  off: off.nullable(),
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

/** A length of time GitHub estimates, in seconds. */
const seconds = z.number().nonnegative();

/**
 * Where an entry stands in its merge queue, as GitHub names it: waiting to be tested (`QUEUED`), its
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

/**
 * A queued pull request's place, as Lo last read its branch's merge queue: `listed`, at `position`,
 * with where it stands, GitHub's estimate of when it merges, and the checks that failed on the
 * commit the queue tests it on, which with `partial` may be missing some, as GitHub left part of the
 * queue out; or not listed, which with `partial` is because GitHub left part of the queue out, or
 * the queue is longer than Lo reads, so Lo can't see its place, and without it means it's no longer
 * in the queue, which Lo reads the pull request again to tell how.
 */
export const queuePlace = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('listed'),
    position: z.number().int().positive(),
    state: entryState,
    timeToMerge: seconds.nullable(),
    failed: z.array(check),
    partial: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('unlisted'), partial: z.boolean() }),
]);
export type QueuePlace = z.output<typeof queuePlace>;

/** Why a pull request left its merge queue without merging, as `@lo/review`'s `leftQueue` says. */
export const leftWhy = z.discriminatedUnion('kind', [
  /** Its checks failed in the queue: those that did, which may be none Lo can name. */
  z.strictObject({ kind: z.literal('failedChecks'), checks: z.array(check) }),
  /** It conflicted with the branch, or with the entries ahead of it. */
  z.strictObject({ kind: z.literal('conflict') }),
  /** Its checks took longer than the queue allows. */
  z.strictObject({ kind: z.literal('timedOut') }),
  /** Someone took it out: `by` whom, when GitHub says, and whether that's the account read as. */
  z.strictObject({ kind: z.literal('removed'), by: text.nullable(), you: z.boolean() }),
  /** A reason Lo has no word for, in GitHub's own, or none when GitHub gave none. */
  z.strictObject({ kind: z.literal('other'), reason: text.nullable() }),
  /** Lo can't tell why: GitHub didn't say, or Lo couldn't read it, for `why`. */
  z.strictObject({ kind: z.literal('unknown'), why: z.string().max(4096).nullable() }),
]);
export type LeftWhy = z.output<typeof leftWhy>;

/**
 * A pull request Lo saw leave its merge queue without merging, while it showed it: when, as GitHub
 * says, why, and whether GitHub left part of why out (`partial`), so Lo may not see all of it.
 */
export const leftQueue = z.strictObject({
  at: time.nullable(),
  why: leftWhy,
  partial: z.boolean(),
});
export type LeftQueue = z.output<typeof leftQueue>;

/** A view's pull request in a merge queue: its place while it's queued, and why it last left one. */
export const inQueue = z.strictObject({
  place: queuePlace.nullable(),
  left: leftQueue.nullable(),
});
export type InQueue = z.output<typeof inQueue>;

/** A view's place in a merge queue, each time it changes. */
export const queued = z.strictObject({ id: tabId, queue: inQueue });
export type Queued = z.output<typeof queued>;

/**
 * What's ahead in the merge queue of the branch a pull request merges into: no queue there now, or
 * `count` entries, at least that many with `atLeast`, as GitHub left part of the queue out, and
 * GitHub's estimate of when the last of them merges, when it has one for each.
 */
export type Ahead =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'queue';
      readonly count: number;
      readonly atLeast: boolean;
      readonly timeToMerge: number | null;
    };

/**
 * What names a merge's plan, which main keeps for the reader to confirm: the window confirms it by
 * this, and never sends the merge itself.
 */
export const planKey = z.string().regex(/^[0-9a-f-]{36}$/);

/**
 * A merge straight into the base branch, or an entry into its merge queue; auto-merge turned on,
 * so GitHub merges it, or on a branch with a merge queue adds it to the queue (`whenReady`), once
 * what it waits on clears; or a merge past the base branch's rules (`override`).
 */
export const planKind = z.enum(['merge', 'enqueue', 'autoMerge', 'whenReady', 'override']);
export type PlanKind = z.output<typeof planKind>;

/** What the reader asked of the panel: `⏎` merges, `a` turns auto-merge on, `⌥⏎` overrides. */
export const asked = z.enum(['merge', 'autoMerge', 'override']);
export type Asked = z.output<typeof asked>;

/** A merge write: as a plan has it, or auto-merge turned off, which asks nothing first. */
export const writeKind = z.enum([
  'merge',
  'enqueue',
  'autoMerge',
  'whenReady',
  'override',
  'autoMergeOff',
]);
export type WriteKind = z.output<typeof writeKind>;

/**
 * What a merge will do, for the reader to confirm before anything is sent:
 *
 * - `key`: what names it, which the window confirms; `id`: the view it was asked for from;
 * - `owner`, `repo`, `number`: the pull request; `login`: the account it merges as;
 * - `kind`: straight in with `method`, or into `base`'s merge queue, whose settings choose the
 *   method: `method` when the account may read them, else `null`; or auto-merge on, either way,
 *   with `method` as that goes; or straight in with `method`, past `base`'s rules;
 * - `head`: the head on screen, which GitHub merges only while it's the pull request's head;
 * - `title`, `message`: a squash commit's title and message as the reader typed them, empty for
 *   GitHub's own, which `squashTitle` is, when Lo read it.
 */
export const plan = z.strictObject({
  key: planKey,
  id: tabId,
  owner: text,
  repo: text,
  number,
  login: text,
  kind: planKind,
  method: method.nullable(),
  base: text,
  head: oid,
  title: z.string().max(1024),
  message: z.string().max(65_536),
});
export type MergePlan = z.output<typeof plan>;

/** A plan to confirm, or why there's none: in Lo's words, with GitHub's text in them. */
export const planned = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('plan'), plan }),
  z.strictObject({ kind: z.literal('refused'), why: words }),
]);
export type Planned = z.output<typeof planned>;

/**
 * Why a merge didn't go, or won't, as GitHub or Lo said:
 *
 * - `kind`: the core's name for GitHub's refusal, such as `headMoved`, `rules` or `paused`, or
 *   Lo's own at the press, such as `offline`, `busy` or `unread`;
 * - `text`: what happened, and what to do, in sentences;
 * - `rules`: each rule GitHub named, for `rules`;
 * - `until`: when GitHub allows writes again, for `paused`;
 * - `newer`: for a newer push than the one on screen, `from` the head on screen, `to` the newer
 *   one when Lo knows it, which "See r5 → r6" compares;
 * - `offer`: what Lo planned in its place, for the reader to confirm, as the merge when GitHub
 *   won't turn auto-merge on because nothing blocks it now (`canMergeNow`).
 */
export const refusal = z.strictObject({
  kind: z.string().max(64),
  text: words,
  rules: z.array(words),
  until: time.nullable(),
  newer: z.strictObject({ from: oid, to: oid.nullable() }).nullable(),
  offer: plan.optional(),
});
export type Refusal = z.output<typeof refusal>;

/** What the reader's confirmation came to: sent, or a new plan to confirm, or refused. */
export const confirmed = z.discriminatedUnion('kind', [
  /** It went to GitHub, and `jobs` says how it goes. */
  z.strictObject({ kind: z.literal('sent') }),
  /**
   * Something the confirmation named changed since it was shown, as `why` says: the new plan, under
   * a key of its own, is for the reader to confirm.
   */
  z.strictObject({ kind: z.literal('again'), plan, why: words }),
  z.strictObject({ kind: z.literal('refused'), refusal }),
]);
export type Confirmed = z.output<typeof confirmed>;

/**
 * Why Lo can't tell how a merge ended: its answer was lost (`noAnswer`); GitHub no longer answers
 * about it (`lost`); it was still running when Lo stopped asking (`stillPending`); Lo was stopping
 * (`stopped`); or GitHub answered a state Lo doesn't know (`status`).
 */
export const unsure = z.enum(['noAnswer', 'lost', 'stillPending', 'stopped', 'status']);
export type Unsure = z.output<typeof unsure>;

/**
 * Where a merge stands:
 *
 * - `sending`: Lo is sending it;
 * - `pending`: GitHub took it and is running it; `trouble` is why Lo's last question about it got
 *   no answer, while waiting may fix it;
 * - `merged`, `enqueued`: it merged, or joined the merge queue;
 * - `autoMergeOn`, `autoMergeOff`: auto-merge is on, or off, as GitHub answered, or as a read
 *   showed once Lo couldn't tell;
 * - `refused`: GitHub refused it, as it took it or as it ran it, or Lo couldn't send it;
 * - `unknown`: Lo can't tell whether it merged, for `why`, which `text` says. `askAgain` says
 *   whether GitHub can still be asked about it, rather than the pull request read again; `shows`
 *   is what GitHub showed of the pull request since, `open` while it doesn't settle it.
 */
export const jobState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sending') }),
  z.strictObject({ kind: z.literal('pending'), trouble: words.nullable() }),
  z.strictObject({ kind: z.literal('merged') }),
  z.strictObject({ kind: z.literal('enqueued') }),
  z.strictObject({ kind: z.literal('autoMergeOn') }),
  z.strictObject({ kind: z.literal('autoMergeOff') }),
  z.strictObject({ kind: z.literal('refused'), refusal }),
  z.strictObject({
    kind: z.literal('unknown'),
    why: unsure,
    text: words,
    askAgain: z.boolean(),
    shows: z.literal('open').nullable(),
  }),
]);
export type JobState = z.output<typeof jobState>;

/**
 * A merge Lo sent, from the plan named `key`, as it goes: or another merge write, as auto-merge
 * turned off, under a key of its own. `already`: GitHub was already merging the pull request when
 * Lo asked, from Lo or from elsewhere, so Lo followed that merge, which may be of another head or
 * method, rather than starting one.
 */
export const job = z.strictObject({
  key: planKey,
  owner: text,
  repo: text,
  number,
  login: text,
  kind: writeKind,
  method: method.nullable(),
  base: text,
  head: oid,
  already: z.boolean(),
  state: jobState,
});
export type JobView = z.output<typeof job>;

const byKey = z.strictObject({ key: planKey });

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
    /** View `id`'s place in a merge queue now, which `queued` then keeps up to date. */
    queue: { input: z.strictObject({ id: tabId }), reply: reply<InQueue>() },
    /**
     * What's ahead in the merge queue of the branch view `id`'s pull request merges into, read as
     * the merge panel opens on one ready for the queue. Fails as `unavailable`, saying why, when
     * GitHub can't say now.
     */
    ahead: { input: z.strictObject({ id: tabId }), reply: reply<Ahead>() },
    /** Forgets why view `id`'s pull request left its merge queue, once the reader dismisses it. */
    forgetLeft: { input: z.strictObject({ id: tabId }), reply: reply<void>() },
    /**
     * Plans the merge the panel of view `id` offers now, from what GitHub said last, with `method`
     * when the repository allows it, and a squash's `title` and `message` as the reader typed them,
     * empty for GitHub's own: as `asked`, straight in or into the queue (`merge`, as without it),
     * by auto-merge, or past the rules. Keeps it for the reader to confirm, in place of the view's
     * last plan, or says why there's none.
     */
    plan: {
      input: z.strictObject({
        id: tabId,
        method: method.nullable(),
        title: z.string().max(1024),
        message: z.string().max(65_536),
        asked: asked.optional(),
      }),
      reply: reply<Planned>(),
    },
    /**
     * Sends the merge the plan named `key` holds, once, if it can still go as the plan says: else
     * asks again with a new plan, when something it named changed, or refuses. A merge past the
     * rules goes only with `typed`, the pull request's number as the reader typed it.
     */
    confirm: {
      input: z.strictObject({ key: planKey, typed: z.string().max(64).optional() }),
      reply: reply<Confirmed>(),
    },
    /**
     * Turns off auto-merge for view `id`'s pull request at once, asking nothing, since that merges
     * nothing: sent, as `jobs` then says, or refused.
     */
    autoMergeOff: {
      input: z.strictObject({ id: tabId }),
      reply: reply<Exclude<Confirmed, { kind: 'again' }>>(),
    },
    /** Forgets the plan named `key`, unless it was confirmed. */
    cancel: { input: byKey, reply: reply<void>() },
    /** Every merge Lo sent that it still follows or hasn't been told to forget, as `jobs` has them. */
    sent: { input: z.strictObject({}), reply: reply<JobView[]>() },
    /**
     * Asks GitHub again how the merge from the plan named `key` went, when Lo couldn't tell: about
     * the merge itself while GitHub still answers about it, or else by reading the pull request
     * again. A read: nothing is sent again.
     */
    askAgain: { input: byKey, reply: reply<void>() },
    /** Forgets the merge from the plan named `key` once it has ended, as when the reader has seen how. */
    dismiss: { input: byKey, reply: reply<void>() },
  },
  topics: {
    status,
    /** A view's pull request in a merge queue, each time it changes. */
    queued,
    /** A merge Lo sent, each time it changes. */
    jobs: job,
  },
});
