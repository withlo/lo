// A pull request's revisions, one per push to its branch, and what its tab compares: the whole pull
// request, or one revision with another. Main builds the revisions from GitHub's push history and
// the heads Lo's pollers saw, marks where the reader left off, and compares revisions in the local
// copy, across a rebase. The window shows them in the revision picker, and asks for a comparison.
// Main also marks files viewed on GitHub, and keeps the head each was marked at, so a file a later
// push changed shows what changed since.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { oid, tabId } from '../tab/contract.ts';
import { PATH_LIMIT, pathBytes } from '../tree/contract.ts';

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/**
 * How long a pull request's tab holds back what it shows first, as it opens, for something that
 * may change it, in milliseconds: about as long as a large pull request's diff takes to load and
 * draw anyway. The diff waits this long for the comparison "last seen here" asks for; past it, the
 * whole pull request is drawn, and the comparison is offered, never put in its place.
 */
export const HOLD_LIMIT = 1_000;

/**
 * When a revision was pushed: exactly, by a time (a review, a check or Lo's poller saw it then), or
 * not known.
 */
export const pushedAt = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exact'), at: time }),
  z.strictObject({ kind: z.literal('by'), at: time }),
  z.strictObject({ kind: z.literal('unknown') }),
]);
export type PushedAt = z.output<typeof pushedAt>;

/**
 * One revision: its head, its number (r1 for the first push; none for a commit a review was made
 * on that was never pushed), when it was pushed and by whom, whether the push was forced and moved
 * it onto a newer base, and whether Lo can still get it. One GitHub no longer has, which Lo never
 * fetched, is no longer available.
 */
export const revision = z.strictObject({
  head: oid,
  number: z.number().int().positive().nullable(),
  pushedAt,
  forced: z.boolean().nullable(),
  /** Who pushed it, when GitHub says. */
  pusher: z.string().nullable(),
  /** Whether it starts from another base than the revision before it. */
  rebased: z.boolean(),
  available: z.boolean(),
});
export type RevisionRow = z.output<typeof revision>;

/** What's compared: from a revision's head, or from the base (`null`), to a revision's head. */
export const comparison = z.strictObject({ from: oid.nullable(), to: oid });
export type Compared = z.output<typeof comparison>;

/**
 * How a comparison of revisions went, when the base moved between them: the older one's changes,
 * replayed onto the newer base, are compared with the newer one (`clean`); so too, though the base
 * changed in a way a rebase doesn't explain, as when the pull request was retargeted
 * (`retargeted`); or the replay conflicted, so it compares the heads, which shows what came with the
 * base too (`conflicted`). `sameBase` when the base didn't move.
 */
export const replay = z.enum(['sameBase', 'clean', 'retargeted', 'conflicted']);
export type Replay = z.output<typeof replay>;

/**
 * A pull request's tab's revisions and what it compares, sent each time they change:
 *
 * - `status`: `signIn` for a tab that acts as nobody, which can't read revisions; `loading` until
 *   GitHub's push history is read; `ready`; `failed` when it couldn't be read, with why in
 *   `problem`.
 * - `revisions`, oldest first, and the base branch with its tip as the local copy last fetched it.
 * - `markers`: the commit of the account's last review, and the newest revision on screen when the
 *   account last left the pull request here, each when there is one.
 * - `shown`: the head on screen. `comparison`: what's compared, once it's known. `pending`: a
 *   comparison asked for, or due when the tab opened, that waits for the local copy. `offered`: the
 *   comparison a marker asks for, which came too late to be drawn first, and shows only once the
 *   reader asks for it.
 * - `waitingFor`: why revisions can't be compared yet: `local`, the local copy isn't ready, or
 *   `git`, Lo has no git.
 * - `nothingNewSince`: the revision a marker is on, when it's the newest and the whole pull request
 *   shows.
 * - `replay`, `conflicted` (the files the replay conflicted on) and `uncertain` (a side's base may
 *   be wrong, as after a force-push of its base branch) say how the comparison on screen was made.
 * - `problem`: what went wrong reading or comparing, if anything.
 */
export const comparisonView = z.strictObject({
  id: tabId,
  status: z.enum(['signIn', 'loading', 'ready', 'failed']),
  revisions: z.array(revision),
  base: z.strictObject({ branch: z.string(), tip: oid.nullable() }).nullable(),
  markers: z.strictObject({ review: oid.nullable(), lastSeen: oid.nullable() }),
  shown: oid.nullable(),
  comparison: comparison.nullable(),
  pending: comparison.nullable(),
  offered: comparison.nullable(),
  waitingFor: z.enum(['local', 'git']).nullable(),
  nothingNewSince: oid.nullable(),
  replay: replay.nullable(),
  conflicted: z.number().int().nonnegative(),
  uncertain: z.boolean(),
  problem: z.string().nullable(),
});
export type ComparisonView = z.output<typeof comparisonView>;

/**
 * A changed file's path, as GitHub lists it: no longer than the tree's limit, the longest path Lo
 * keys anything by.
 */
const githubPath = z
  .string()
  .min(1)
  .max(PATH_LIMIT)
  .refine((text) => pathBytes({ text }) <= PATH_LIMIT, `A path longer than ${PATH_LIMIT} bytes.`);

/**
 * How marking a file viewed, or clearing its mark, went: `done`, GitHub took it; `paused`, GitHub
 * has asked Lo to hold off writing until `until`, so nothing was sent; `moved`, GitHub's newest head
 * isn't the one the diff shows, `latest`, so marking the file would say the reader saw what they
 * haven't.
 */
export type Marked =
  { kind: 'done' } | { kind: 'paused'; until: number } | { kind: 'moved'; latest: string | null };

export const contract = defineContract('revisions', {
  requests: {
    /** What main has of a pull request's tab's revisions now, which `comparison` keeps up to date. */
    list: { input: z.strictObject({ id: tabId }), reply: reply<ComparisonView | undefined>() },
    /**
     * Compares revision `from`, or the base for `null`, with revision `to`, a newer one, in a pull
     * request's tab: at once when the local copy has both, or once it has. Fails as `invalid` for a
     * head that's no revision, or a `from` that isn't older than `to`; as `unavailable` for one Lo
     * can't get, or while Lo has no git; and as `refused` for a tab that can't read revisions.
     */
    compare: {
      input: z.strictObject({ id: tabId, from: oid.nullable(), to: oid }),
      reply: reply<void>(),
    },
    /**
     * Marks a changed file viewed on GitHub (`viewed`), or clears its mark, as the tab's account, in
     * the account's turn: `at` is the head of what the diff shows. Marking refuses as `moved` when
     * that isn't GitHub's newest head, and both refuse as `paused` while GitHub has asked Lo to hold
     * off. Fails as `refused` for a tab that acts as nobody, and as `failed`, with why, when GitHub
     * didn't take it. A file marked is noted at `at`, and its note forgotten as its mark is cleared.
     */
    markViewed: {
      input: z.strictObject({ id: tabId, path: githubPath, viewed: z.boolean(), at: oid }),
      reply: reply<Marked>(),
    },
  },
  topics: {
    /** A pull request's tab's revisions and what it compares, each time they change. */
    comparison: comparisonView,
  },
});
