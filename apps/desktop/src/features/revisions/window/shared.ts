// What the revisions feature shares with other features' window code: each pull request's tab's
// viewed marks, as they show, and `e`, which marks a changed file viewed or clears its mark. The
// tree and the diff draw the marks, and each moves on in its own way after `e`. Another feature
// marks a revision for the picker to show, as the overview marks the one it describes.

import { useTabState } from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import { marked } from './store.ts';
import {
  countIn,
  markable,
  markIn,
  shownMarks,
  toggle,
  type Mark,
  type ShownMarks,
  type Toggled,
} from './viewed.ts';

export type { Mark, ShownMarks, Toggled } from './viewed.ts';

/** `tab`'s viewed marks as they show, re-rendering as they change. */
export function useViewedMarks(tab: string): ShownMarks {
  return useTabState(shownMarks, tab);
}

/** `tab`'s viewed marks as they show now. */
export function viewedMarksOf(tab: string): ShownMarks {
  return shownMarks.get(tab);
}

/**
 * The mark of the changed file at `path` in `marks`: GitHub's by that path, or by `previous`, for
 * a rename GitHub lists by its old path. None for a file GitHub has no mark for, or whose path is
 * too long to look up.
 */
export function viewedMarkOf(
  marks: ShownMarks,
  path: TreePath,
  previous?: TreePath | null,
): Mark | undefined {
  return markIn(marks, path, previous);
}

/**
 * How many of `files`, the changed files a diff shows, are viewed in `marks`, of how many there
 * are. `marks`' own count is of every file the pull request changes, which a stack's layer's diff,
 * compared with the layer below it, doesn't all show.
 */
export function viewedCountIn(
  marks: ShownMarks,
  files: readonly { readonly path: TreePath; readonly previous: TreePath | null }[],
): { readonly viewed: number; readonly total: number } {
  return countIn(marks, files);
}

/**
 * Whether moving on after `e` passes over the changed file at `path`, or `previous` for a rename
 * GitHub lists by its old path: it's viewed, or `e` can't mark it, as when its path isn't UTF-8 or
 * is longer than 1,024 bytes, so `e` never stops on one it would refuse.
 */
export function passedOver(marks: ShownMarks, path: TreePath, previous?: TreePath | null): boolean {
  return !markable(path) || markIn(marks, path, previous) === 'viewed';
}

/**
 * `e` on a changed file of `tab`'s: marks it viewed, or clears the mark of one that's viewed. The
 * new mark shows at once, and goes back to GitHub's, with a note, if GitHub doesn't take it. Says
 * which it started, or why it couldn't, so the caller moves on only once it has.
 */
export function toggleViewed(
  tab: string,
  file: { readonly path: TreePath; readonly previous: TreePath | null },
): Toggled {
  return toggle(tab, file);
}

/**
 * Marks the commit `head` in tab `tab`'s revision picker as `kind`, or clears the mark for none:
 * `overview`, the commit the overview on screen describes. The picker marks the revision whose
 * head it is, and names any other commit by its short id.
 */
export function markRevision(tab: string, kind: 'overview', head: string | undefined): void {
  if (marked.get(tab)[kind] === head) return;
  marked.update(tab, (current) => ({ ...current, [kind]: head }));
}
