// What the diff shares with other features' window code: the slot over the diff, where what it
// compares is said; showing the diff, and a place in it or the file whole; how many files it shows; one file of it beside
// another view; the lines another feature explains, which the diff marks; the review threads
// another feature places under its lines, and showing one of them; and diffing texts another
// feature has, as the diff's own files are diffed.

import { createElement, type ReactNode } from 'react';

import { defineSlot, Slot } from '../../../window/slots.tsx';
import type { LocalState } from '../../tab/contract.ts';
import { showMiddle, type PullTab } from '../../tab/window/shared.ts';
import type { DiffState } from '../contract.ts';
import { FILES_PER_JOB, type FileResult } from '../jobs.ts';
import { Beside } from './Beside.tsx';
import { changed, explainWith, type Explainer } from './explained.ts';
import { diffJobs } from './main.ts';
import { showPlace as showCode, showThread as showThreadAt } from './places.ts';
import { loaderOf, useSnapshot } from './tabs.ts';
import { changed as changedThreads, threadWith, type Threader } from './threads.ts';
import { DIFF_VIEW } from './whole.ts';

export type { ExplainedLines, Explainer } from './explained.ts';
export type { DiffThreads, DrawnDiff, ThreadCounts, ThreadedFile, Threader } from './threads.ts';

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
 * How many files pull request's tab `tab`'s diff on screen shows, once it can be drawn, with whether
 * GitHub listed only some of them, and whether GitHub couldn't compare it from where it should
 * start, so it shows the pull request's own files until the local copy is ready; re-rendering as
 * that changes. It reads what the status bar reads, the files drawn, so the two agree.
 */
export function useDiffFiles(
  tab: string,
): { readonly count: number; readonly partial: boolean; readonly uncompared: boolean } | undefined {
  const { ready } = useSnapshot(loaderOf(tab));
  return (
    ready && {
      count: ready.entries.length,
      partial: ready.partial,
      uncompared: ready.uncompared,
    }
  );
}

/** What main last said of pull request's tab `tab`'s diff, re-rendering as it changes. */
export function useDiffState(tab: string): DiffState | undefined {
  return useSnapshot(loaderOf(tab)).state;
}

/** What main last said of pull request's tab `tab`'s diff, read once. */
export function diffStateOf(tab: string): DiffState | undefined {
  return loaderOf(tab).snapshot().state;
}

/** Calls `listener` each time main says pull request's tab `tab`'s diff anew. Returns a function that stops it. */
export function onDiffState(tab: string, listener: () => void): () => void {
  return loaderOf(tab).subscribe(listener);
}

/**
 * What replaces a diff that's GitHub's until the local copy is ready, as a clause for a sentence:
 * ` until the local copy is ready`, or nothing where it never will be, as without git.
 */
export function untilLocalCopy(local: LocalState | undefined): string {
  return local?.kind === 'noGit' ? '' : ' until the local copy is ready';
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
 * Gives the diffs what explains their lines, such as each pull request's overview: a diff drawn
 * asks it for the lines explained at the commit its newer side shows, marks them, and opens what
 * each says in a note under them. Returns a function that takes it back.
 */
export function setExplainer(explainer: Explainer): () => void {
  return explainWith(explainer);
}

/** Says the lines explained in tab `tab`'s diff changed, so a diff drawn asks for them again. */
export function explainedChanged(tab: string): void {
  changed(tab);
}

/**
 * Gives the diffs what places and draws their review threads, such as the comments: a diff drawn
 * asks it for its threads, saying what each column shows, has the view draw each under its line,
 * and counts what each file's hold on its header. `za` on a thread opens or collapses it, and
 * `]t` and `[t` walk them. Returns a function that takes it back.
 */
export function setThreader(threader: Threader): () => void {
  return threadWith(threader);
}

/** Says tab `tab`'s review threads changed, so a diff drawn asks for them again. */
export function threadsChanged(tab: string): void {
  changedThreads(tab);
}

/**
 * Shows review thread `thread` in pull request's tab `tab`'s diff, as the threads panel does: opens
 * it and puts its line at the top of the screen, a jump `⌃o` comes back from. Focus stays where it
 * is. With the diff on screen, it's shown at once, and this says whether the diff has it.
 * Otherwise, or with `wait`, as when another comparison that shows it is coming, the diff comes on
 * screen and shows it once it's drawn with it, unless the reader does anything else first.
 */
export function showThread(tab: string, thread: string, { wait = false } = {}): boolean {
  return showThreadAt(tab, thread, wait);
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
