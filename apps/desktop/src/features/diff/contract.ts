// A pull request's diff: the versions of each file the comparison on screen holds, how each starts
// out, and their texts. Main reads them from the tab's local copy, or GitHub's patches until the
// copy is ready, and says each time what it has changed. A file a push changed since the reader
// marked it viewed shows only what changed since. The window draws them, and says once it has, so
// the head it drew stays on screen. It also reads a file whole, changed or not, for the whole-file
// view.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { oid, tabId } from '../tab/contract.ts';
import { change, treePath } from '../tree/contract.ts';

/** One side of a changed file in the local copy: its blob and size, once the copy has it. */
export const side = z.strictObject({ blob: oid, size: z.number().int().nonnegative().nullable() });
export type FileSide = z.output<typeof side>;

/**
 * How a file starts out in the diff:
 *
 * - `shown`: its diff, unchanged code collapsed;
 * - `collapsed`: its diff closed into one block, as a generated file starts;
 * - `large`: kept out, too large to load at once, until it's asked for;
 * - `binary`: no text to diff, so only its sizes;
 * - `unchanged`: nothing in its text changed, as for a rename, a change of mode or a submodule.
 */
export const start = z.enum(['shown', 'collapsed', 'large', 'binary', 'unchanged']);
export type Start = z.output<typeof start>;

/**
 * A changed file, as the comparison holds it: its path (in the head; a deleted file's in the
 * base), a rename's old path, how it changed, its lines added and deleted, each side's blob from
 * the local copy (`null` for a side it isn't on, and both `null` from GitHub), how it starts out
 * and why: it's generated, and how, and why it's too large to load at once. `submodule` says which
 * sides are another repository's commit, which has no text: a file that becomes a submodule shows
 * its lines deleted, and one that was a submodule its lines added.
 */
export const fileVersions = z.strictObject({
  path: treePath,
  previous: treePath.nullable(),
  change,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  old: side.nullable(),
  new: side.nullable(),
  start,
  generated: z.enum(['attribute', 'lockfile']).nullable(),
  large: z.string().nullable(),
  submodule: z.enum(['old', 'new', 'both']).nullable(),
  /**
   * How many lines GitHub's diff of it draws on the side that reaches further, its placeholders
   * included: as far as its patch's hunks reach. None for the local copy's.
   */
  reach: z.number().int().nonnegative(),
  /**
   * Whether replaying the older revision onto the newer base conflicted on it, so the author
   * resolved a conflict in it: in a comparison of revisions across a rebase.
   */
  conflicted: z.boolean(),
  /**
   * For a file a push changed since the reader marked it viewed, the revision it shows from, in
   * place of where the comparison starts: where it was viewed on this computer (`viewed`), or, for
   * one viewed elsewhere, the reader's last review (`review`). Its sides and counts are from there.
   */
  since: z
    .strictObject({ label: z.string().min(1).max(64), why: z.enum(['viewed', 'review']) })
    .nullable(),
});
export type FileVersions = z.output<typeof fileVersions>;

/** Where the files came from: the local copy, or GitHub's API until it's ready. */
export const source = z.enum(['local', 'github']);
export type Source = z.output<typeof source>;

/** Names a comparison of two revisions, as the revisions feature keys it. */
export const comparisonKey = z.string().min(1).max(1024);

/** Names which files show from where they left off, as the revisions feature keys it. */
export const sinceKey = z.string().min(1).max(1024);

/**
 * A pull request's tab's diff, each time it changes: the head it's of, which is the head on
 * screen, or the newer revision of the two compared, named by `comparison`; which files show from
 * where they left off, named by `since`, which changes their versions but not the list; where its
 * files came from, and the files, in git's order, none until they're known. `partial` when GitHub
 * listed only some of them. `problem` says what couldn't be read, and `waiting` what the diff waits
 * for before anything is drawn: a comparison of revisions the local copy doesn't have yet.
 */
export const diffState = z.strictObject({
  id: tabId,
  at: oid.nullable(),
  comparison: comparisonKey.nullable(),
  since: sinceKey.nullable(),
  waiting: z.string().nullable(),
  from: source.nullable(),
  files: z.array(fileVersions).nullable(),
  partial: z.boolean(),
  problem: z.string().nullable(),
});
export type DiffState = z.output<typeof diffState>;

/**
 * A file's texts, as `diff.texts` replies: both sides from the local copy, `null` for a side it
 * isn't on; GitHub's patch of it; or why it can't be had.
 */
export type FileText =
  | { kind: 'texts'; old: string | null; new: string | null }
  | { kind: 'patch'; patch: string }
  | { kind: 'missing'; why: string };

/** The most files one `diff.texts` asks for. */
export const TEXTS_LIMIT = 2000;

/** Which version of a file: the base's, `old`, or the head's, `new`, as a diff's sides are. */
export const version = z.enum(['old', 'new']);
export type Version = z.output<typeof version>;

/**
 * A whole file, as `diff.whole` replies: its text; or what its whole-file view says in place of
 * its lines. A file larger than Lo loads at once is `large` until it's asked for anyway; one that
 * isn't text is `binary`; one too large to show even then, or with a line too long to lay out, is
 * `refused`, with why; and until the local copy has the head on screen, it's `waiting`.
 */
export type WholeText =
  | { kind: 'text'; text: string }
  | { kind: 'large'; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'refused'; why: string }
  | { kind: 'waiting' };

export const contract = defineContract('diff', {
  requests: {
    /** What main has of a pull request's tab's diff now, which `state` then keeps up to date. */
    versions: { input: z.strictObject({ id: tabId }), reply: reply<DiffState | undefined>() },
    /**
     * The texts of files of the diff at `at`, of `comparison`, with `since`'s files from where they
     * left off, from `from`, by their places in its list, in the order asked: both sides from the
     * local copy, downloading those it lacks first, or GitHub's patches. Fails as `moved` once the
     * diff is of another head, comparison, set of such files or source.
     */
    texts: {
      input: z.strictObject({
        id: tabId,
        at: oid,
        comparison: comparisonKey.nullable(),
        since: sinceKey.nullable(),
        from: source,
        files: z.array(z.number().int().nonnegative()).min(1).max(TEXTS_LIMIT),
      }),
      reply: reply<FileText[]>(),
    },
    /**
     * A whole file from the local copy, for its whole-file view: the head's version of the file at
     * `path` in the head on screen, `at`, or, for `old`, the base's version of a file the
     * comparison changes, by its path in the base. Main reads only those: a path the head's tree
     * doesn't hold, or that no changed file had in the base, fails as `invalid`, and a head other
     * than the one on screen as `moved`. A file larger than Lo loads at once comes only when
     * `large` asks for it anyway.
     */
    whole: {
      input: z.strictObject({ id: tabId, at: oid, version, path: treePath, large: z.boolean() }),
      reply: reply<WholeText>(),
    },
    /**
     * The window drew the diff at `at`: from now on that head stays on screen until the reader
     * loads a newer one, even if Lo took it from what it saved before GitHub answered.
     */
    drawn: { input: z.strictObject({ id: tabId, at: oid }), reply: reply<void>() },
  },
  topics: {
    /** A pull request's tab's diff, each time it changes. */
    state: diffState,
  },
});
