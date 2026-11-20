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
// on `jobs`. A GitHub stack's layer merges with the open layers below it, which its plan names; a
// chain that isn't one merges from its bottom layer alone, and main then moves the layers on it, as
// the plan's moves say. `place` says which, for the panel. `a` plans auto-merge the same way, and
// `⌥⏎` a merge past the base branch's rules, which the reader confirms with the pull request's
// number typed; either goes only alone or from a GitHub stack's bottom layer. `a` with auto-merge
// on turns it off at once (`autoMergeOff`), asking nothing, since that merges nothing.
//
// And approve and ship: `⌘⇧⏎` asks main for a plan (`ship`), what it approves and what it expects
// to follow, kept under a key for the reader to confirm (`shipConfirm`) in one confirmation. Main
// reads GitHub again as it's confirmed, approves, then merges, adds to the queue or turns on
// auto-merge through the same jobs as the panel, and says how it goes on `ships`. Auto-merge it
// turned on after your approval is watched, and what Lo does about a push after that approval is
// said on `watched`.

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
      'stackLayer',
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
 * What the confirmation of auto-merge, or of a merge past the rules, names beyond the plan itself,
 * as Lo read it when it planned: what's in the way, the rules Lo can't check and whether it may not
 * see every rule, what a push before it merges does to the approvals, and the base branch's merge
 * queue. The press asks again when any of it changed.
 */
export const named = z.strictObject({
  blockers: z.array(blocker),
  unchecked: z.array(unchecked),
  partial: z.boolean(),
  afterPush,
  queue: z.strictObject({ required: z.boolean(), method: method.nullable() }),
});
export type Named = z.output<typeof named>;

/**
 * A layer of a GitHub stack that merges with the pull request: its title as GitHub has it, and its
 * head as GitHub's Stacks API gave it as the confirmation opened, which GitHub merges only while
 * it's still the layer's head. `review` and `checks` are its review decision and how its checks
 * stand together, as the stack's layers were last read: `null` before they were, or when it has
 * none.
 */
export const stackLayer = z.strictObject({
  number,
  title: text,
  head: oid,
  review: z.enum(['approved', 'changesRequested', 'reviewRequired']).nullable(),
  checks: z.enum(['passing', 'running', 'failing']).nullable(),
});
export type StackLayer = z.output<typeof stackLayer>;

/** A change to pull request `pr`'s base branch, from `from` to `to`. */
export const baseMove = z.strictObject({ pr: number, from: text, to: text });
export type BaseMove = z.output<typeof baseMove>;

/**
 * What a merge takes with it, beyond its pull request:
 *
 * - `stack`: the open layers of GitHub stack `stack` below it, bottom first, which merge with it;
 *   `above` are its open layers above, which stay open and move onto the base;
 * - `chain`: a chain that can't be a GitHub stack, merged a layer at a time from its bottom one:
 *   `before` moves that onto the root first, when it isn't there; once it has merged, `after` move
 *   the layers on it onto the root, and those layers, `needsRebase`, then need a rebase.
 */
export const together = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stack'),
    stack: number,
    below: z.array(stackLayer).min(1),
    above: z.array(number),
  }),
  z.strictObject({
    kind: z.literal('chain'),
    before: baseMove.nullable(),
    after: z.array(baseMove),
    needsRebase: z.array(number),
  }),
]);
export type Together = z.output<typeof together>;

/**
 * Where a pull request sits, as the merge panel says it before anything is planned:
 *
 * - `alone`: it merges by itself, alone or as a GitHub stack's bottom layer;
 * - `stack`: a layer of GitHub stack `stack`, which merges with its open layers `below` it;
 * - `convert`: in a chain that isn't a GitHub stack and could be one, as `offer` says, which Lo
 *   makes before it merges any of it;
 * - `chain`: the bottom layer of a chain that can't be a GitHub stack, for `reasons`: it merges
 *   into `into` alone, and then Lo moves the `above` layers on it onto `into`;
 * - `refused`: Lo doesn't merge it from here, for `why`; `again` when Lo is listing the open pull
 *   requests again, which may settle it, so asking again soon may say otherwise.
 */
export const placement = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('alone') }),
  z.strictObject({ kind: z.literal('stack'), stack: number, below: z.array(number).min(1) }),
  z.strictObject({ kind: z.literal('convert'), offer: words }),
  z.strictObject({
    kind: z.literal('chain'),
    into: text,
    above: z.array(number),
    reasons: z.array(words),
  }),
  z.strictObject({ kind: z.literal('refused'), why: words, again: z.boolean() }),
]);
export type Placement = z.output<typeof placement>;

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
 *   GitHub's own, which `squashTitle` is, when Lo read it. Auto-merge keeps them only for the merge
 *   Lo may offer in its place: GitHub's own go with auto-merge;
 * - `named`: what its confirmation names, for auto-merge and a merge past the rules; nothing for
 *   a merge or a queue entry;
 * - `together`: the layers of a GitHub stack it merges with, or a chain's base branches it moves;
 *   nothing for auto-merge or a merge past the rules, which take nothing with them.
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
  named: named.nullable(),
  together: together.nullable(),
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

/** How a layer of a GitHub stack's merge stands, as GitHub's Stacks API last said. */
export const layerState = z.enum(['open', 'merged', 'closed']);
export type LayerState = z.output<typeof layerState>;

/**
 * How a base branch change of a chain's merge stands: not sent yet, being sent, made, already so,
 * refused or failed, sent with its answer lost, or never sent since what came before it stopped.
 */
export const moveStatus = z.enum([
  'todo',
  'now',
  'done',
  'unchanged',
  'failed',
  'unknown',
  'skipped',
]);
export type MoveStatus = z.output<typeof moveStatus>;

/**
 * How what a merge takes with it goes:
 *
 * - `stack`: each layer that merges, bottom first and the pull request last, as GitHub's Stacks API
 *   said at the merge's last change, `null` until it's read; `above`, the open layers above;
 *   `takenAt`, when GitHub took the merge; and `landed`, for one that failed, the layers below that
 *   merged all the same, bottom first, or `null` when Lo couldn't read them;
 * - `chain`: `phase`, moving its bottom layer onto the root, merging it, waiting for GitHub to say
 *   it merged, as after a queue entry or a lost answer, moving the layers on it, or over, done or
 *   stopped; each base branch change, `before` the merge or after it, with what GitHub said of one
 *   that didn't go; the layers that then need a rebase; and `text`, what it waits for or why it
 *   stopped.
 */
export const progress = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stack'),
    layers: z.array(z.strictObject({ number, title: text, state: layerState.nullable() })),
    above: z.array(number),
    takenAt: time.nullable(),
    landed: z.array(number).nullable(),
  }),
  z.strictObject({
    kind: z.literal('chain'),
    phase: z.enum(['before', 'merging', 'waiting', 'moving', 'done', 'stopped']),
    moves: z.array(
      z.strictObject({
        move: baseMove,
        before: z.boolean(),
        status: moveStatus,
        detail: words.nullable(),
      }),
    ),
    needsRebase: z.array(number),
    text: words.nullable(),
  }),
]);
export type Progress = z.output<typeof progress>;

/**
 * A merge Lo sent, from the plan named `key`, as it goes: or another merge write, as auto-merge
 * turned off, under a key of its own. `already`: GitHub was already merging the pull request when
 * Lo asked, from Lo or from elsewhere, so Lo followed that merge, which may be of another head or
 * method, rather than starting one. `together`: how what it takes with it goes, for a stack's merge
 * or a chain's.
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
  together: progress.nullable(),
  /**
   * Lo turned auto-merge off by itself, after a push that followed your approval: `watched` says
   * so, rather than a toast.
   */
  watch: z.literal(true).optional(),
});
export type JobView = z.output<typeof job>;

/** What approve and ship approves first, as `@lo/review`'s `Approval` says. */
export const shipApproval = z.discriminatedUnion('kind', [
  /** Approve the revision on screen. */
  z.strictObject({ kind: z.literal('approve') }),
  /** Approve it again: your approval of it was dismissed. */
  z.strictObject({ kind: z.literal('reapproveDismissed') }),
  /** Submit your pending review, recorded on it, as the approval, with its comments. */
  z.strictObject({ kind: z.literal('submitPending'), comments: count }),
  /** Nothing: it's your pull request, which GitHub doesn't let you approve. */
  z.strictObject({ kind: z.literal('ownPullRequest') }),
  /** Nothing: your latest review approves it already. */
  z.strictObject({ kind: z.literal('alreadyApproved') }),
]);
export type ShipApproval = z.output<typeof shipApproval>;

/**
 * Why approve and ship stops after approving, as `@lo/review`'s `Stop` says: or that it sits
 * where approve and ship doesn't merge from, a stack's layer above its bottom one, say, which
 * `text` says as the merge panel does.
 */
export const shipStop = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('headMoved'), head: oid }),
  z.strictObject({ kind: z.literal('headUnknown') }),
  z.strictObject({
    kind: z.literal('blocked'),
    blockers: z.array(blocker),
    autoMerge: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('noAutoMerge'), blockers: z.array(blocker) }),
  z.strictObject({ kind: z.literal('noPermission') }),
  z.strictObject({ kind: z.literal('noMethod') }),
  z.strictObject({
    kind: z.literal('incomplete'),
    incomplete: z.enum(['readAgain', 'checksCutShort']),
  }),
  z.strictObject({ kind: z.literal('where'), text: words }),
]);
export type ShipStop = z.output<typeof shipStop>;

/**
 * What approve and ship does after approving, as `@lo/review`'s `Ship` says: merge with `method`;
 * join the merge queue, whose settings choose the method (`method` when the account may read
 * them); turn on auto-merge, or on a branch with a merge queue merge when ready, while `waitingOn`
 * clears; nothing more, as auto-merge is on or it's queued already; or stop.
 */
export const shipStep = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('merge'), method }),
  z.strictObject({ kind: z.literal('enqueue'), method: method.nullable() }),
  z.strictObject({ kind: z.literal('autoMerge'), method, waitingOn: z.array(blocker) }),
  z.strictObject({
    kind: z.literal('enqueueWhenReady'),
    method: method.nullable(),
    waitingOn: z.array(blocker),
  }),
  z.strictObject({ kind: z.literal('autoMergeAlreadyOn'), waitingOn: z.array(blocker) }),
  z.strictObject({ kind: z.literal('alreadyQueued') }),
  z.strictObject({ kind: z.literal('stop'), stop: shipStop }),
]);
export type ShipStep = z.output<typeof shipStep>;

/**
 * What approve and ship will do, for the reader to confirm before anything is sent:
 *
 * - `key`: what names it, which the window confirms; `id`: the view it was asked from;
 * - `owner`, `repo`, `number`: the pull request; `login`: the account it approves and merges as;
 *   `base`: the branch it merges into;
 * - `head`: the revision on screen, which is GitHub's head too: what it approves, and what the
 *   merge expects;
 * - `approval`: what it approves first; `summary`: whether the summary kept for the submit dialog
 *   goes with the approval;
 * - `likely`: what Lo expects to follow, which GitHub's answer after the approval decides;
 *   `together`: what its merge takes with it, as the merge panel's would: the layers of a GitHub
 *   stack below it, or a chain's base branches it moves once it has merged;
 * - `warning`: whether a push before it merges could merge with your approval, as auto-merge may
 *   follow and the base branch's rules keep approvals, or require no review (`afterPush`).
 */
export const shipPlan = z.strictObject({
  key: planKey,
  id: tabId,
  owner: text,
  repo: text,
  number,
  login: text,
  base: text,
  head: oid,
  approval: shipApproval,
  summary: z.boolean(),
  likely: shipStep,
  together: together.nullable(),
  warning: z.boolean(),
  afterPush,
});
export type ShipPlan = z.output<typeof shipPlan>;

/** Approve and ship's plan to confirm, or why there's none. */
export const shipPlanned = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('plan'), plan: shipPlan }),
  z.strictObject({ kind: z.literal('refused'), refusal }),
]);
export type ShipPlanned = z.output<typeof shipPlanned>;

/** What the reader's confirmation of approve and ship came to. */
export const shipConfirmed = z.discriminatedUnion('kind', [
  /** It passed the checks at the press and runs, as `ships` says. */
  z.strictObject({ kind: z.literal('started') }),
  /** Something the confirmation named changed, as `why` says: the new plan is to confirm. */
  z.strictObject({ kind: z.literal('again'), plan: shipPlan, why: words }),
  /** Nothing was sent, for `refusal`. */
  z.strictObject({ kind: z.literal('refused'), refusal }),
]);
export type ShipConfirmed = z.output<typeof shipConfirmed>;

/**
 * Where approve and ship stands, once confirmed:
 *
 * - `approving`: the approval is sent, or waits its turn, or its answer was lost and Lo reads your
 *   reviews to tell whether GitHub took it;
 * - `reading`: approved, or approving skipped, Lo reads GitHub again, until it shows the approval;
 * - `sending`: `step` went through the merge jobs, as the merge from the plan named `job`, which
 *   `jobs` follows;
 * - `done`: nothing more to send, as `step` says;
 * - `stopped`: it stopped `at` approving, so nothing was approved, or after approving, at the
 *   `ship` step, for `refusal`, or `stop`, `@lo/review`'s reason.
 */
export const shipPhase = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approving') }),
  z.strictObject({ kind: z.literal('reading') }),
  z.strictObject({ kind: z.literal('sending'), step: shipStep, job: planKey }),
  z.strictObject({ kind: z.literal('done'), step: shipStep }),
  z.strictObject({
    kind: z.literal('stopped'),
    at: z.enum(['approve', 'ship']),
    refusal,
    stop: shipStop.nullable(),
  }),
]);
export type ShipPhase = z.output<typeof shipPhase>;

/** Approve and ship from the plan named `key`, as it goes; `approved`, once the approval went. */
export const ship = z.strictObject({
  key: planKey,
  owner: text,
  repo: text,
  number,
  login: text,
  base: text,
  head: oid,
  approval: shipApproval,
  approved: z.boolean(),
  phase: shipPhase,
});
export type ShipView = z.output<typeof ship>;

/**
 * What the auto-merge watch did about a push, `head`, after you approved `approved`, on a pull
 * request whose auto-merge approve and ship turned on: turned auto-merge off; couldn't
 * (`notTurnedOff`, for `why`); or couldn't tell whether the push would merge with your approval
 * (`cantTell`), so it reads again.
 */
export const watched = z.strictObject({
  key: planKey,
  owner: text,
  repo: text,
  number,
  login: text,
  kind: z.enum(['turnedOff', 'notTurnedOff', 'cantTell']),
  approved: oid,
  head: oid,
  why: words.nullable(),
});
export type Watched = z.output<typeof watched>;

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
    /**
     * Where view `id`'s pull request sits, as the merge panel says it as it opens: what merges with
     * it, or why Lo doesn't merge it from there. Read afresh from GitHub's Stacks API and the open
     * pull requests from the branches it merges into.
     */
    place: { input: z.strictObject({ id: tabId }), reply: reply<Placement>() },
    /**
     * Plans approve and ship for view `id`, from what GitHub said last: what it approves and what
     * Lo expects to follow. Keeps it for the reader to confirm, in place of the view's last one, or
     * says why there's none, before anything is sent.
     */
    ship: { input: z.strictObject({ id: tabId }), reply: reply<ShipPlanned>() },
    /**
     * Runs approve and ship from the plan named `key`, once, if it still holds as GitHub says now,
     * read again: else asks again with a new plan, when something it named changed, or refuses.
     * `ships` then says how it goes. `cancel` forgets the plan, as a merge's.
     */
    shipConfirm: { input: byKey, reply: reply<ShipConfirmed>() },
  },
  topics: {
    status,
    /** A view's pull request in a merge queue, each time it changes. */
    queued,
    /** A merge Lo sent, each time it changes. */
    jobs: job,
    /** Approve and ship, each time it moves on. */
    ships: ship,
    /** What the auto-merge watch did about a push after your approval. */
    watched,
  },
});
