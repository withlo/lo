// What the diff shares with other features' window code: the slot over the diff, where what it
// compares is said; showing the diff; and diffing texts another feature has, as the diff's own
// files are diffed.

import { defineSlot } from '../../../window/slots.tsx';
import { showMiddle, type PullTab } from '../../tab/window/shared.ts';
import { FILES_PER_JOB, type FileResult } from '../jobs.ts';
import { diffJobs } from './main.ts';
import { DIFF_VIEW } from './whole.ts';

/**
 * Over a pull request's tab's diff, the same height from its first frame on: a note on what it
 * compares, such as "r3 → r5, since you last looked". A view here draws one line, so what's below
 * never moves when its text changes.
 */
export const notes = defineSlot<{ tab: PullTab }>('diff.notes');

/**
 * Shows pull request's tab `tab`'s diff in its middle, as `` ` `` and `~` step to it, such as when
 * the tab opens on it. Says whether the tab has a diff.
 */
export function showDiff(tab: string): boolean {
  return showMiddle(tab, DIFF_VIEW);
}

/**
 * A file `diffTexts` diffed: its line and word diff and each side's highlighting, or why it
 * couldn't be.
 */
export type DiffedText = FileResult;

/** How long one file's diff may take before it settles for a coarser one, in milliseconds. */
const TEXTS_BUDGET = 5000;

/**
 * Diffs texts another feature has, in the background process, as the diff's own files are: each
 * file's line and word diff from `old` to `new`, `null` for a side it isn't on, both sides
 * highlighted as `path` says unless `highlight` is false, in the order given. Changes to whitespace
 * alone show, as GitHub shows them. Stopped once `signal` aborts.
 */
export async function diffTexts(
  files: readonly { path: string; old: string | null; new: string | null }[],
  signal?: AbortSignal,
  { highlight = true }: { readonly highlight?: boolean } = {},
): Promise<DiffedText[]> {
  const results: DiffedText[] = [];
  for (let at = 0; at < files.length; at += FILES_PER_JOB) {
    const batch = files
      .slice(at, at + FILES_PER_JOB)
      .map((file) => ({ kind: 'texts' as const, ...file }));
    results.push(
      ...(await diffJobs().files(
        { files: batch, whitespace: true, highlight, budget: TEXTS_BUDGET },
        { signal },
      )),
    );
  }
  return results;
}
