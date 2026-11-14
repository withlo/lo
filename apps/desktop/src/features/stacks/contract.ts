// The stack a pull request's tab shows: the open pull requests that sit on each other with it, found
// in main among its repository's open pull requests by base branch, by shared commits, or as a
// GitHub stack, with each layer's state, how the stack was found, and what Lo couldn't read. Main
// works the stack out again as the repository's pull requests change, and sends it on `stack`, with
// where the layer's diff starts when that came after its diff was drawn, which a banner offers. A
// run of layers, each sitting on the one before, shows as one diff in a view of its own, which main
// makes once the window has chosen it.
//
// And making a chain a GitHub stack: main plans it and keeps the plan under a key, the window shows
// it and confirms the key, and main sends the changes, saying how they go on `conversion`.

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
 * - `merged`: some merged pull requests weren't looked up yet;
 * - `rulesets`: the repository's rulesets couldn't be read;
 * - `cycle`: pull requests sat on each other, and Lo put one on its own base;
 * - `needsRebase`: a layer sits on a squash-merged pull request;
 * - `start`: the layer on screen couldn't be compared with the layer below it.
 */
export const noteKind = z.enum([
  'github',
  'busy',
  'merged',
  'rulesets',
  'cycle',
  'needsRebase',
  'start',
]);
export type NoteKind = z.output<typeof noteKind>;

export const note = z.strictObject({ kind: noteKind, text: z.string() });
export type Note = z.output<typeof note>;

/**
 * How a layer was found to sit on the one below, in the order the design lists them: as the next
 * layer up in a GitHub stack, by base branch, or by shared commits.
 */
export const link = z.enum(['github', 'baseBranch', 'sharedCommits']);
export type Link = z.output<typeof link>;

/**
 * How a stack's layers were found to sit on each other: each kind of link between them, once, in
 * the order `link` lists them. A GitHub stack can't branch, so a stack that branches can hold one
 * along a path, with other links off it.
 */
export const found = z.array(link).min(1);
export type Found = z.output<typeof found>;

/**
 * The stack a pull request's tab shows:
 *
 * - `unknown` until its repository's open pull requests and rulesets have been read, and for a
 *   tab that acts as nobody, which no poller reads them for;
 * - `none` when its pull request isn't in a stack: a stack shows when it has two layers or more,
 *   when the pull request is in a GitHub stack, or when it needs a rebase;
 * - `stack`: the root branch its bottom layer sits on; whether every layer is in one GitHub stack
 *   (`githubStack`), which its head then says in place of how its layers were found (`found`,
 *   `null` for a layer alone); its rows and its notes; and `callout`, what the offer to make it a
 *   GitHub stack says, while Lo could make the chain through the layer on screen one.
 */
export const stackView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('stack'),
    root: z.string(),
    githubStack: z.boolean(),
    found: found.nullable(),
    rows: z.array(row).min(1),
    notes: z.array(note),
    callout: z.string().nullable(),
  }),
]);
export type StackView = z.output<typeof stackView>;

/**
 * Where the layer on screen's diff starts, worked out after its diff was drawn, which a banner
 * offers rather than moving what's on screen: what's so ("#84's diff includes #83's changes"), the
 * button's words ("Show only #84's"), and the commit the button compares the layer with, `null` for
 * its base branch.
 */
export const offer = z.strictObject({
  title: z.string(),
  action: z.string(),
  commit: oid.nullable(),
});
export type Offer = z.output<typeof offer>;

/** A pull request's tab's stack, sent each time it changes, with a start it offers, if any. */
export const stack = z.strictObject({ id: tabId, stack: stackView, offer: offer.nullable() });
export type StackState = z.output<typeof stack>;

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
 * - `skipped`: never sent, since what came before it stopped.
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
 * A change, as the dialog lists it: how it stands, and `detail`, what GitHub said of one that
 * failed, or, for one `left`, the base branch its pull request is on now.
 */
export const changeRow = z.strictObject({
  change,
  status: changeStatus,
  detail: z.string().nullable(),
});
export type ChangeRow = z.output<typeof changeRow>;

/**
 * A pull request in a plan: its title as GitHub gives it, its base branch now, and the base branch
 * the plan gives it, or `null` when that doesn't change.
 */
export const planRow = z.strictObject({
  number,
  title: z.string(),
  base: branch,
  to: branch.nullable(),
});
export type PlanRow = z.output<typeof planRow>;

/**
 * What making a chain a GitHub stack will do, for the reader to confirm before anything is sent:
 *
 * - `key`: what names the plan, which the window confirms;
 * - `title`, `description`: "Make these 3 PRs a GitHub stack?", the repository and how they were
 *   found;
 * - `heading` and `rows`: "1 · One base branch changes", then each pull request in the path, or
 *   only those added to a GitHub stack, with its base branch and the one it gets;
 * - `stack`: "#4790 → #4797 → #4803, through GitHub's Stacks API.";
 * - `warning`: who sees a diff change, when a base branch changes;
 * - `login`: the account it's done as; `confirm`: its button's label.
 */
export const plan = z.strictObject({
  kind: z.literal('plan'),
  key: planKey,
  title: z.string(),
  description: z.string(),
  heading: z.string(),
  rows: z.array(planRow).min(1),
  stack: z.string(),
  warning: z.string().nullable(),
  login: z.string(),
  confirm: z.string(),
});
export type Plan = z.output<typeof plan>;

/** Why a chain can't be made a GitHub stack now: every reason, in words, Lo's own first. */
export const notOffered = z.strictObject({
  kind: z.literal('notOffered'),
  reasons: z.array(z.string()).min(1),
});
export type NotOffered = z.output<typeof notOffered>;

/** A plan for the reader to confirm, or why there's none. */
export const planned = z.discriminatedUnion('kind', [plan, notOffered]);
export type Planned = z.output<typeof planned>;

/**
 * Where a conversion is:
 *
 * - `running`: sending its changes, in order;
 * - `done`: every change was made;
 * - `failed`: GitHub refused a change, or it failed, and nothing after it was sent;
 * - `stopped`: the reader stopped it, and nothing after the change being sent was sent;
 * - `puttingBack`: putting back the base branches it changed, last first;
 * - `putBack`: that's over, as its changes say.
 */
export const phase = z.enum(['running', 'done', 'failed', 'stopped', 'puttingBack', 'putBack']);
export type Phase = z.output<typeof phase>;

/** Something the dialog says under the changes, with GitHub's page for it, if there is one. */
export const conversionNote = z.strictObject({ text: z.string(), link: z.string().nullable() });
export type ConversionNote = z.output<typeof conversionNote>;

/**
 * Making a chain a GitHub stack, as it goes, for the plan named `key`, asked for from tab `tab`:
 *
 * - `title`, `description`: what's happening, or what happened;
 * - `waitingUntil`: while GitHub has asked Lo to hold off writing, until when;
 * - `stopping`: the reader stopped it, and the change being sent finishes first;
 * - `changes`: the plan's, in order; `putBack`: putting back's, once asked for;
 * - `putBackLabel`: "Put the base branch back", while there's something to put back, else `null`;
 * - `notes`: what Lo left, and why;
 * - `made`: once it's done, what was made, for the toast;
 * - `version`: higher each time main says it anew, so an older answer never replaces a newer one.
 */
export const conversion = z.strictObject({
  key: planKey,
  tab: tabId,
  version: z.number().int().nonnegative(),
  phase,
  title: z.string(),
  description: z.string(),
  waitingUntil: time.nullable(),
  stopping: z.boolean(),
  changes: z.array(changeRow),
  putBack: z.array(changeRow),
  putBackLabel: z.string().nullable(),
  notes: z.array(conversionNote),
  made: z.string().nullable(),
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
     * Plans making the chain the pull request in tab `id` is in a GitHub stack, from what GitHub
     * says now, and keeps the plan for the reader to confirm, in place of the tab's last one; or
     * says why it can't.
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
     * Puts back the base branches a conversion that failed or stopped changed, last first, as
     * `conversion` says.
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
  },
  topics: {
    /** A pull request's tab's stack, each time it changes. */
    stack,
    /** A conversion, each time it changes. */
    conversion,
  },
});
