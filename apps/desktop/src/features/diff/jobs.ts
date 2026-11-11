// The diff's jobs in the background process: each file's line and word diff with both sides
// highlighted, from its two texts or from GitHub's patch, and the code the pull request moves. The
// window sends them what main read, as it arrives, and draws what comes back.

import type { FileDiff, MovedBlock } from '@lo/diff';
import { z } from 'zod';

import { reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';

/** The most files one `diff.files` job takes. */
export const FILES_PER_JOB = 64;

/** The longest a file's diff may take, in milliseconds, before it settles for a coarser one. */
export const MAX_BUDGET = 20_000;

/**
 * A file to diff: its two texts, `null` for a side it isn't on, or GitHub's patch of it, whose
 * hunks are drawn as GitHub gives them.
 */
export const fileJob = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('texts'),
    /** Its path, for the language it's highlighted as. */
    path: z.string(),
    old: z.string().nullable(),
    new: z.string().nullable(),
  }),
  z.strictObject({ kind: z.literal('patch'), path: z.string(), patch: z.string() }),
]);
export type FileJob = z.output<typeof fileJob>;

/** Changed lines in a row, from line `start`, their texts joined with `\n`. */
export const lineRun = z.strictObject({ start: z.number().int().min(1), text: z.string() });
export type LineRun = z.output<typeof lineRun>;

/** A file's changed lines, for finding moves: deleted ones by old number, added ones by new. */
export const changedRuns = z.strictObject({ deleted: z.array(lineRun), added: z.array(lineRun) });
export type ChangedRuns = z.output<typeof changedRuns>;

/** Lines, first to last, that a file shown from GitHub's patch has only as placeholders. */
export interface Gap {
  side: 'old' | 'new';
  from: number;
  to: number;
}

/** What `diff.files` says of each file it was given, in the order given. */
export type FileResult =
  | {
      ok: true;
      diff: FileDiff;
      /**
       * Each side's lines, for a patch: GitHub's lines, with empty placeholders in the gaps
       * between its hunks. A file diffed from its texts has the lines its texts split into.
       */
      lines?: { old: string[]; new: string[] } | undefined;
      gaps?: Gap[] | undefined;
      /** `@lo/syntax`'s `[from, to, token]` triples for each side, where it could highlight. */
      tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
      /** The changed lines moves are found among: none in a diff that came out approximate. */
      changes: ChangedRuns;
    }
  | { ok: false; why: string };

export const contract = defineJobs('diff', {
  /**
   * Diffs and highlights files, a batch at a time: the highlighter takes a moment to start, and
   * each job starts its own. `whitespace: false` hides changes to whitespace alone, as
   * `git diff -w` does, in files diffed from their texts; GitHub's patches are drawn as they are.
   * `budget` is how long each file's diff may take before it comes out approximate.
   */
  files: {
    input: z.strictObject({
      files: z.array(fileJob).min(1).max(FILES_PER_JOB),
      whitespace: z.boolean(),
      highlight: z.boolean(),
      budget: z.number().int().min(0).max(MAX_BUDGET),
    }),
    reply: reply<FileResult[]>(),
  },
  /** The code the pull request moves, among every file's changed lines, files by their place. */
  moves: {
    input: z.strictObject({ files: z.array(changedRuns).max(100_000) }),
    reply: reply<MovedBlock[]>(),
  },
});
