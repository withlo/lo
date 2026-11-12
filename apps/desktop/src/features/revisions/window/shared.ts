// What the revisions feature shares with other features' window code: each pull request's tab's
// viewed marks, as they show, and `e`, which marks a changed file viewed or clears its mark. The
// tree and the diff draw the marks, and each moves on in its own way after `e`.

import { useTabState } from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import { markIn, shownMarks, toggle, type Mark, type ShownMarks, type Toggled } from './viewed.ts';

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
