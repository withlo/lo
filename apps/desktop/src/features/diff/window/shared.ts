// What the diff shares with other features' window code: the slot over the diff, where what it
// compares is said; showing the diff, and a place in it or the file whole; one file of it beside
// another view; and diffing texts another feature has, as the diff's own files are diffed.

import { createElement, type ReactNode } from 'react';

import { defineSlot, Slot } from '../../../window/slots.tsx';
import { showMiddle, type PullTab } from '../../tab/window/shared.ts';
import { FILES_PER_JOB, type FileResult } from '../jobs.ts';
import { Beside } from './Beside.tsx';
import { diffJobs } from './main.ts';
import { showPlace as showCode } from './places.ts';
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
 * Shows line `line` of the file at `path` in pull request's tab `tab`, as following a reference to
 * code does: in the diff on screen, its cursor on the line, when the comparison has the file;
 * otherwise the file whole, at the head the diff shows, with lines `marked` picked out. Without a
 * line, the file's top. The line is the head's: a caller with a place at another commit maps it
 * there first. Where the tab was is recorded in its history, so `⌃o` comes back, and focus goes to
 * the code.
 */
export function showPlace(
  tab: string,
  path: string,
  line: number | undefined,
  marked?: { from: number; to: number },
): void {
  showCode(tab, path, line, marked);
}

/**
 * One file of pull request's tab `tab`'s diff, as the comparison on screen shows it, inline, with
 * line `line` of it at the head near the top: for the code beside another view. Under its bar,
 * which names the file and ends with `end`, the diff's own note says what's compared. While it has
 * focus the diff's keys act on it, and it records nothing in the tab's history: the view it's
 * beside does.
 */
export function DiffBeside(props: {
  tab: PullTab;
  path: string;
  line: number | undefined;
  end?: ReactNode;
}): ReactNode {
  return createElement(Beside, {
    ...props,
    note: createElement(Slot, { slot: notes, props: { tab: props.tab } }),
  });
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
