/**
 * What a file shows when GitHub says it changed since you viewed it (`docs/design.md`, "Viewed
 * marks").
 */

import type { FileViewedState } from '@lo/github';

import type { Revisions } from '../revisions.ts';

/**
 * What to show of a file GitHub says changed since you viewed it. Revisions are named by head SHA,
 * and `to` is always the latest.
 */
export type FileComparison =
  /** What changed since the revision this computer recorded when you marked the file viewed. */
  | { readonly kind: 'sinceViewed'; readonly from: string; readonly to: string }
  /**
   * What changed since your last review: the file was marked viewed elsewhere, or this computer's
   * record of it is no use.
   */
  | { readonly kind: 'sinceLastReview'; readonly from: string; readonly to: string }
  /** The file's whole diff in the pull request, with no marker to compare from. */
  | { readonly kind: 'full' };

/**
 * What to show of a file, given its viewed mark on GitHub (`PullRequestChangedFile`'s
 * `viewerViewedState`, which is per viewer), the head this computer recorded when you marked it
 * viewed (`viewedAt`), and the commit of your last review. Nothing for a file GitHub doesn't say
 * changed since viewed (`DISMISSED`): a viewed file stays collapsed, and an unviewed one shows the
 * pull request's comparison.
 *
 * - This computer's record wins, since it's where you actually viewed the file. It's no use when
 *   no revision has that head, or when it's on the latest revision, which GitHub's mark says the
 *   file changed after.
 * - Without a usable record, the file was marked viewed elsewhere: compare from your last review,
 *   unless that's on the latest revision too.
 * - With neither, it's the file's whole diff.
 * - As for the pull request's own comparison, a marker on a revision Lo can no longer get compares
 *   from the nearest earlier one it can, or shows the whole diff when there's none, rather than
 *   falling back to a later marker that could hide changes.
 */
export function viewedFileComparison(
  revisions: Revisions,
  state: FileViewedState,
  viewedAt: string | undefined,
  lastReview: string | undefined,
): FileComparison | undefined {
  if (state !== 'DISMISSED') return undefined;
  const latest = revisions.latest();
  if (latest === undefined) return { kind: 'full' };
  const to = latest.head;
  const beforeLatest = (commit: string | undefined): number | undefined => {
    const position = commit === undefined ? undefined : revisions.position(commit);
    return position !== undefined && position + 1 < revisions.length ? position : undefined;
  };
  const viewed = beforeLatest(viewedAt);
  if (viewed !== undefined) {
    const from = revisions.availableFrom(viewed);
    return from === undefined ? { kind: 'full' } : { kind: 'sinceViewed', from: from.head, to };
  }
  const review = beforeLatest(lastReview);
  if (review !== undefined) {
    const from = revisions.availableFrom(review);
    return from === undefined ? { kind: 'full' } : { kind: 'sinceLastReview', from: from.head, to };
  }
  return { kind: 'full' };
}
