// The stack a pull request's tab shows: the open pull requests that sit on each other with it, found
// in main among its repository's open pull requests by base branch, by shared commits, or as a
// GitHub stack, with each layer's state, how the stack was found, and what Lo couldn't read. Main
// works the stack out again as the repository's pull requests change, and sends it on `stack`.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { pullState, tabId } from '../tab/contract.ts';

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
 * A layer of the stack, a row of its tree, in the order `]s` walks them: from the bottom up, each
 * branch finished before the next.
 *
 * - `title`, `author`: as GitHub gives them, from whoever opened it: text, never markup. `author`
 *   is `null` for an account GitHub deleted;
 * - `state`: `open` or `draft`, or, for the layer on screen once it merged or closed, `merged` or
 *   `closed`, its row kept where it was;
 * - `current`: whether it's the layer on screen;
 * - `branch`: whether it's a later layer on the one it sits on, which a branching stack draws a
 *   step in;
 * - `on`: the layer it sits on, when that isn't the row above;
 * - `review`, `checks`, `queue` (its place in the merge queue, from 1): `null` until the layers'
 *   state is read, or when there's none;
 * - `needsRebase`: whether a layer below it was squash-merged, so it still carries that one's
 *   commits;
 * - `viewed`: where its viewed count comes from, `null` until the layers' state is read.
 */
export const row = z.strictObject({
  number,
  title: z.string(),
  author: z.string().nullable(),
  state: pullState,
  current: z.boolean(),
  branch: z.boolean(),
  on: number.nullable(),
  review: review.nullable(),
  checks: checks.nullable(),
  queue: z.number().int().positive().nullable(),
  needsRebase: z.boolean(),
  viewed: viewedCount.nullable(),
});
export type Row = z.output<typeof row>;

/**
 * Something the stack's tree says under its rows:
 *
 * - `busy`: the repository has more open pull requests than Lo reads;
 * - `merged`: some merged pull requests weren't looked up yet;
 * - `rulesets`: the repository's rulesets couldn't be read;
 * - `cycle`: pull requests sat on each other, and Lo put one on its own base;
 * - `needsRebase`: a layer sits on a squash-merged pull request.
 */
export const noteKind = z.enum(['busy', 'merged', 'rulesets', 'cycle', 'needsRebase']);
export type NoteKind = z.output<typeof noteKind>;

export const note = z.strictObject({ kind: noteKind, text: z.string() });
export type Note = z.output<typeof note>;

/**
 * The stack a pull request's tab shows:
 *
 * - `unknown` until its repository's open pull requests and rulesets have been read, and for a
 *   tab that acts as nobody, which no poller reads them for;
 * - `none` when its pull request isn't in a stack: a stack shows when it has two layers or more,
 *   or when the pull request is in a GitHub stack;
 * - `stack`: the root branch its bottom layer sits on, its head ("4 layers · by base branch"), its
 *   rows and its notes.
 */
export const stackView = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('stack'),
    root: z.string(),
    head: z.string(),
    rows: z.array(row).min(1),
    notes: z.array(note),
  }),
]);
export type StackView = z.output<typeof stackView>;

/** A pull request's tab's stack, sent each time it changes. */
export const stack = z.strictObject({ id: tabId, stack: stackView });
export type StackState = z.output<typeof stack>;

export const contract = defineContract('stacks', {
  requests: {
    /**
     * The stack a pull request's tab shows now, which `stack` then keeps up to date: nothing for a
     * tab that isn't a pull request's.
     */
    state: { input: z.strictObject({ id: tabId }), reply: reply<StackState | undefined>() },
  },
  topics: {
    /** A pull request's tab's stack, each time it changes. */
    stack,
  },
});
