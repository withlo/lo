/** What a pull request's diff compares when it opens (`docs/design.md`, "Revisions"). */

import type { Revisions } from '../revisions.ts';

/** What the pull request's diff compares. Revisions are named by head SHA. */
export type Comparison =
  /**
   * The whole pull request: from its base to the latest revision. `nothingNewSince` is the latest
   * revision's head when a marker is on it, for "Nothing new since rN" above the diff.
   */
  | { readonly kind: 'full'; readonly nothingNewSince: string | undefined }
  /** What changed from one revision to another. */
  | { readonly kind: 'between'; readonly from: string; readonly to: string };

/**
 * What to compare when the pull request opens, from two markers: the commit of your last review,
 * and the head of the newest revision on screen when you last left the pull request.
 *
 * - The more recent marker's revision is compared with the latest.
 * - With neither marker, it's the full diff. A marker no revision has ({@link Revisions.find})
 *   counts as none.
 * - With the more recent marker on the latest revision, nothing is new: it's the full diff, with
 *   "Nothing new since rN".
 * - When the marker's revision is no longer available, the comparison starts from the nearest
 *   earlier revision that is. That shows a little more than what's new rather than hiding any of
 *   it. With none, it's the full diff.
 */
export function defaultComparison(
  revisions: Revisions,
  lastReview: string | undefined,
  lastSeen: string | undefined,
): Comparison {
  const full: Comparison = { kind: 'full', nothingNewSince: undefined };
  const latest = revisions.latest();
  if (latest === undefined) return full;
  const markers = [lastReview, lastSeen].flatMap((commit) =>
    commit === undefined ? [] : (revisions.position(commit) ?? []),
  );
  if (markers.length === 0) return full;
  const marker = Math.max(...markers);
  if (marker === revisions.length - 1) return { kind: 'full', nothingNewSince: latest.head };
  const from = revisions.availableFrom(marker);
  return from === undefined ? full : { kind: 'between', from: from.head, to: latest.head };
}
