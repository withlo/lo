// The stack a pull request's tab shows: the open pull requests that sit on each other with it, found
// in main among its repository's open pull requests by base branch, by shared commits, or as a
// GitHub stack, with each layer's state and what Lo couldn't read. Main works the stack out again as
// the repository's pull requests change, and sends it on `stack`, with where the layer's diff starts
// when that came after its diff was drawn, which a banner offers. A run of layers, each sitting on
// the one before, shows as one diff in a view of its own, which main makes once the window has
// chosen it.
//
// And converting a chain to a GitHub stack: main plans it and keeps the plan under a key, the window
// shows it and confirms the key, and main sends the changes, saying how they go on `conversion`.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { oid, pullState, tabId } from '../tab/contract.ts';

/** A pull request's number. */
const number = z.number().int().min(1);

/** A count of something. */
const count = z.number().int().nonnegative();

/** A layer's review decision, as GitHub gives it. */
export const review = z.enum(['approved', 'changesRequested', 'reviewRequired']);
export type Review = z.output<typeof review>;

/** How a layer's checks stand, together: all passed, some still running, or some failed. */
export const checks = z.enum(['passing', 'running', 'failing']);
export type Checks = z.output<typeof checks>;

/**
 * Where a layer's viewed count comes from: the layer on screen's from its tab's files, which change
 * as files are marked; another's from GitHub's marks on the first 100 of its files, read with the
 * layers, so `complete` is false when it changes more.
 */
export const viewedCount = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('tab') }),
  z.strictObject({
    source: z.literal('layers'),
    viewed: count,
    files: count,
    complete: z.boolean(),
  }),
]);
export type ViewedCount = z.output<typeof viewedCount>;

/**
 * How many of a layer's review threads are unresolved, as read with the layers: among the first 100
 * of its threads, so `complete` is false when it has more.
 */
export const threadCount = z.strictObject({
  unresolved: count,
  threads: count,
  complete: z.boolean(),
});
export type ThreadCount = z.output<typeof threadCount>;

/**
 * A layer of the stack, a row of its tree, in the order `]s` walks them: from the bottom up, each
 * branch finished before the next.
 *
 * - `title`, `author`, `head` (its head branch): as GitHub gives them, from whoever opened it: text,
 *   never markup. `author` is `null` for an account GitHub deleted;
 * - `state`: `open` or `draft`, or, for the layer on screen once it merged or closed, `merged` or
 *   `closed`, its row kept where it was;
 * - `current`: whether it's the layer on screen;
 * - `branch`: whether it's a later layer on the one it sits on, which a branching stack draws a
 *   step in;
 * - `on`: the layer it sits on, when that isn't the row above;
 * - `path`: the layers from the stack's bottom up to it, bottom first, ending with it: a run of
 *   layers that ends at it starts at one of them, and one that starts at it ends at a layer whose
 *   path holds it. Empty for the layer on screen once it merged or closed, which no run holds;
 * - `review`, `checks`, `queue` (its place in the merge queue, from 1): `null` until the layers'
 *   state is read, or when there's none;
 * - `needsRebase`: whether a layer below it was squash-merged, so it still carries that one's
 *   commits;
 * - `overview`: whether it has an overview, from one read of the repository's overviews' refs:
 *   `null` until that's read, and for a layer from a fork, whose overview Lo can't see;
 * - `viewed`: where its viewed count comes from, `null` until the layers' state is read;
 * - `threads`: how many of its review threads are unresolved, `null` until the layers' state is
 *   read. The window counts the layer on screen's from its threads instead, once it has them.
 */
export const row = z.strictObject({
  number,
  title: z.string(),
  author: z.string().nullable(),
  head: z.string(),
  state: pullState,
  current: z.boolean(),
  branch: z.boolean(),
  on: number.nullable(),
  path: z.array(number),
  review: review.nullable(),
  checks: checks.nullable(),
  queue: z.number().int().positive().nullable(),
  needsRebase: z.boolean(),
  overview: z.boolean().nullable(),
  viewed: viewedCount.nullable(),
  threads: threadCount.nullable(),
});
export type Row = z.output<typeof row>;

/**
 * Something the stack's tree says under its rows:
 *
 * - `github`: which layers are a GitHub stack, in a stack that isn't one GitHub stack;
 * - `busy`: the repository has more open pull requests than Lo reads;
 * - `merged`: some merged pull requests are still being looked up;
 * - `mergedFailed`: looking up merged pull requests failed;
 * - `cycle`: pull requests are based on each other, and Lo put one on its own base;
 * - `start`: the layer on screen couldn't be compared with the layer below it.
 */
export const noteKind = z.enum(['github', 'busy', 'merged', 'mergedFailed', 'cycle', 'start']);
export type NoteKind = z.output<typeof noteKind>;

export const note = z.strictObject({ kind: noteKind, text: z.string() });
export type Note = z.output<typeof note>;

/**
 * The stack a pull request's tab shows:
 *
 * - `unknown` until its repository's open pull requests and rulesets have been read, and for a
 *   tab that acts as nobody, which no poller reads them for;
 * - `none` when its pull request isn't in a stack: a stack shows when it has two layers or more,
 *   when the pull request is in a GitHub stack, or when it needs a rebase;
 * - `stack`: the root branch its bottom layer sits on; where the stack's changes start, as its bottom
 *   layer's own do (`start`): its base branch's tip, or the commit the layer below it left off at,
 *   `null` when that isn't known, which the diff of the stack's overview's code starts from; whether
 *   every layer is in one GitHub stack (`githubStack`), which its head then says; its rows and its
 *   notes; `offered`, whether Lo offers
 *   to convert it to a GitHub stack at all, over its tree or in its merge panel:
 *   `stacks.offerConvert` on, and the offer not dismissed for one of its layers; and `callout`, the
 *   line the offer over the tree says, while it's offered and Lo could convert the chain through
 *   the layer on screen.
 */
export const stackView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('stack'),
    root: z.string(),
    start: oid.nullable(),
    githubStack: z.boolean(),
    rows: z.array(row).min(1),
    notes: z.array(note),
    offered: z.boolean(),
    callout: z.string().nullable(),
  }),
]);
export type StackView = z.output<typeof stackView>;

/**
 * Where the layer on screen's diff starts, worked out after its diff was drawn, which a banner
 * offers rather than moving what's on screen: what's so ("This diff includes #83’s changes"), the
 * button's words ("Hide #83’s changes"), and the commit the button compares the layer with, `null`
 * for its base branch.
 */
export const offer = z.strictObject({
  title: z.string(),
  action: z.string(),
  commit: oid.nullable(),
});
export type Offer = z.output<typeof offer>;

/**
 * A pull request's tab's stack, sent each time it changes, with a start it offers, if any: none
 * once that offer was dismissed for its layer, or turned off (`stacks.offerStart`).
 */
export const stack = z.strictObject({ id: tabId, stack: stackView, offer: offer.nullable() });
export type StackState = z.output<typeof stack>;

/**
 * An offer the stacks make unasked, which the reader can dismiss for one stack or layer, or turn
 * off: `convert`, the offer to convert it to a GitHub stack, over the stack's tree and in its merge
 * panel, dismissed for every layer it has; `start`, the banner's offer to hide the changes of the
 * layer below, dismissed for the layer.
 */
export const notice = z.enum(['convert', 'start']);
export type Notice = z.output<typeof notice>;

/** A branch's name, as GitHub gives it: text. */
const branch = z.string();

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/**
 * What names a plan main keeps for making a chain a GitHub stack: the window confirms it by this,
 * and never sends the changes themselves.
 */
export const planKey = z.string().regex(/^[0-9a-f-]{36}$/);

/**
 * A change that making a GitHub stack sends, or that putting its base branches back does:
 *
 * - `retarget`: a pull request's base branch, from `from` to `to`;
 * - `create`: a GitHub stack made of `prs`, bottom to top;
 * - `add`: `prs`, bottom to top, added at the top of GitHub stack `stack`;
 * - `unstack`: GitHub stack `stack`, which holds `prs`, taken apart.
 */
export const change = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('retarget'), pr: number, from: branch, to: branch }),
  z.strictObject({ kind: z.literal('create'), prs: z.array(number) }),
  z.strictObject({ kind: z.literal('add'), stack: number, prs: z.array(number) }),
  z.strictObject({ kind: z.literal('unstack'), stack: number, prs: z.array(number) }),
]);
export type Change = z.output<typeof change>;

/**
 * How a change stands:
 *
 * - `todo`: not sent yet; `now`: being sent, or waiting for GitHub to allow it;
 * - `done`: GitHub did it; `unchanged`: it was so already, so nothing was sent;
 * - `failed`: GitHub refused it, or it failed, and it wasn't done;
 * - `unknown`: GitHub's answer was lost, so it may have been done;
 * - `left`: it was changed elsewhere since, so Lo left it;
 * - `skipped`: never sent, since what came before it stopped; or, for a stack step whose answer
 *   was lost, found by undoing not to have been made, as its `detail` says.
 */
export const changeStatus = z.enum([
  'todo',
  'now',
  'done',
  'unchanged',
  'failed',
  'unknown',
  'left',
  'skipped',
]);
export type ChangeStatus = z.output<typeof changeStatus>;

/**
 * A change, as the dialog lists it: how it stands, and `detail`: for one that failed, or whose
 * answer was lost, what GitHub said; for one `left`, the base branch its pull request is on now,
 * or, for an unstack, why it was left; for a stack step `skipped` once undoing found it wasn't
 * made, that it wasn't: "Not created.".
 */
export const changeRow = z.strictObject({
  change,
  status: changeStatus,
  detail: z.string().nullable(),
});
export type ChangeRow = z.output<typeof changeRow>;

/**
 * What converting a chain to a GitHub stack will do, for the reader to confirm before anything is
 * sent:
 *
 * - `key`: what names the plan, which the window confirms;
 * - `description`: the repository and how many layers it converts: "e2e · 3 layers";
 * - `changes`: what it sends, in order, the steps the dialog lists;
 * - `warning`: what GitHub will show once a layer moves, when one does;
 * - `login`: the account it's done as.
 */
export const plan = z.strictObject({
  kind: z.literal('plan'),
  key: planKey,
  description: z.string(),
  changes: z.array(change).min(1),
  warning: z.string().nullable(),
  login: z.string(),
});
export type Plan = z.output<typeof plan>;

/** Why a chain can't be converted to a GitHub stack now: every reason, Lo's own first. */
export const notOffered = z.strictObject({
  kind: z.literal('notOffered'),
  reasons: z.array(z.string()).min(1),
});
export type NotOffered = z.output<typeof notOffered>;

/**
 * The stack couldn't be checked, so there's no plan: why, in a line, when that's known, and
 * GitHub's own words.
 */
export const unchecked = z.strictObject({
  kind: z.literal('unchecked'),
  reason: z.string().nullable(),
  details: z.string().nullable(),
});
export type Unchecked = z.output<typeof unchecked>;

/** A plan for the reader to confirm, why there's none, or why the stack couldn't be checked. */
export const planned = z.discriminatedUnion('kind', [plan, notOffered, unchecked]);
export type Planned = z.output<typeof planned>;

/**
 * Where a conversion is:
 *
 * - `running`: sending its changes, in order;
 * - `done`: every change was made;
 * - `failed`: GitHub refused a change, or it failed, and nothing after it was sent;
 * - `stopped`: the reader stopped it, and nothing after the change being sent was sent;
 * - `puttingBack`: undoing the changes it made, last first;
 * - `putBack`: that's over, as its changes say.
 */
export const phase = z.enum(['running', 'done', 'failed', 'stopped', 'puttingBack', 'putBack']);
export type Phase = z.output<typeof phase>;

/**
 * What went wrong, shown above the dialog's buttons: what failed or isn't confirmed, why in a line
 * when that's known, GitHub's own words, and GitHub's page for what isn't confirmed.
 */
export const conversionProblem = z.strictObject({
  title: z.string(),
  reason: z.string().nullable(),
  details: z.string().nullable(),
  link: z.string().nullable(),
});
export type ConversionProblem = z.output<typeof conversionProblem>;

/**
 * Converting a chain to a GitHub stack, as it goes, for the plan named `key`, asked for from tab
 * `tab`:
 *
 * - `waitingUntil`: while GitHub has asked Lo to hold off writing, until when;
 * - `stopping`: the reader stopped it, and the change being sent finishes first;
 * - `changes`: the plan's, in order; `putBack`: undoing's, once asked for;
 * - `line`: what the dialog says above its buttons once it's over: "Converted to GitHub stack";
 * - `problem`: what went wrong, if something did;
 * - `undo`: whether its changes can be undone now;
 * - `version`: higher each time main says it anew, so an older answer never replaces a newer one.
 */
export const conversion = z.strictObject({
  key: planKey,
  tab: tabId,
  version: z.number().int().nonnegative(),
  phase,
  waitingUntil: time.nullable(),
  stopping: z.boolean(),
  changes: z.array(changeRow),
  putBack: z.array(changeRow),
  line: z.string().nullable(),
  problem: conversionProblem.nullable(),
  undo: z.boolean(),
});
export type ConversionView = z.output<typeof conversion>;

const byKey = z.strictObject({ key: planKey });

export const contract = defineContract('stacks', {
  requests: {
    /**
     * The stack a pull request's tab shows now, which `stack` then keeps up to date: nothing for a
     * tab that isn't a pull request's.
     */
    state: { input: z.strictObject({ id: tabId }), reply: reply<StackState | undefined>() },
    /**
     * Compares the layer on screen in tab `id` with the commit its banner offers, `null` for its
     * base branch, and starts its diff again from there. Fails as `moved` once that's no longer
     * what's offered.
     */
    useStart: {
      input: z.strictObject({ id: tabId, commit: oid.nullable() }),
      reply: reply<void>(),
    },
    /**
     * Dismisses `notice` for the stack the layer on screen in tab `id` is in, or for its layer, as
     * {@link notice} says, so it doesn't come back there, through restarts. Fails as `missing` for
     * a tab that isn't a pull request's, or has no stack yet.
     */
    dismiss: { input: z.strictObject({ id: tabId, notice }), reply: reply<void>() },
    /**
     * Plans converting the chain the pull request in tab `id` is in to a GitHub stack, from what
     * GitHub says now, and keeps the plan for the reader to confirm, in place of the tab's last
     * one; or says why it can't.
     */
    plan: { input: z.strictObject({ id: tabId }), reply: reply<Planned>() },
    /**
     * Runs the plan named `key`, once: its changes go to GitHub in order, as `conversion` says.
     * A plan that's gone or ran already, or one for a repository with a conversion running, is
     * refused.
     */
    convert: { input: byKey, reply: reply<ConversionView>() },
    /**
     * Ends what `key` names: a plan not run is forgotten; a conversion, or putting it back, stops
     * before its next change is sent; one that's over is forgotten.
     */
    stop: { input: byKey, reply: reply<void>() },
    /**
     * Undoes the changes a conversion that failed or stopped made, last first, as `conversion`
     * says.
     */
    putBack: { input: byKey, reply: reply<ConversionView>() },
    /**
     * Shows the run of layers from `bottom` to `top` of the stack in tab `id` as one diff, in a view
     * of its own in place of the layer on screen, which it goes back to, and replies with the view's
     * id. It goes from where `bottom`'s own changes start to `top`'s head. Refused as `refused`,
     * saying why, when they aren't two layers of one chain, or where `bottom` starts isn't known.
     */
    run: {
      input: z.strictObject({ id: tabId, bottom: number, top: number }),
      reply: reply<string>(),
    },
    /**
     * The layer of the stack tab `id` shows whose head is `commit`, as its repository's stacks were
     * last worked out: none when no layer's is, or they aren't known yet. A stack overview's code
     * goes up to the layer whose head it describes.
     */
    layerAt: {
      input: z.strictObject({ id: tabId, commit: oid }),
      reply: reply<number | null>(),
    },
  },
  topics: {
    /** A pull request's tab's stack, each time it changes. */
    stack,
    /** A conversion, each time it changes. */
    conversion,
  },
});
