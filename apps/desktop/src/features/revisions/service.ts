import type { Comparison, ComparisonRefused, Oid } from '@lo/git';

import { defineService } from '../../main/services.ts';

/** One side of a comparison between revisions: a head, and where its changes start. */
export interface Side {
  readonly head: Oid;
  /** Where the revision branched off its base branch: its head's merge base with the tip then. */
  readonly base: Oid;
}

/** A comparison between two revisions of a pull request, in its local copy. */
export interface Comparing {
  /** Names the comparison: another comparison has another key. */
  readonly key: string;
  readonly old: Side;
  readonly new: Side;
  /**
   * What changed from the old side to the new, worked out once from the local copy, across a rebase
   * when the base moved, for every feature that shows it.
   */
  compared(): Promise<Comparison | ComparisonRefused>;
}

/**
 * What a pull request's tab compares now:
 *
 * - `head`: the whole pull request, from its base to the head on screen, as the tab has it, from
 *   GitHub until the local copy is ready;
 * - `waiting`: a comparison of revisions, once the local copy has both, which nothing should be
 *   drawn before, so nothing moves under the reader; `why` says what it waits for;
 * - `revisions`: two revisions, from the local copy.
 */
export type OnScreen =
  | { readonly kind: 'head' }
  | { readonly kind: 'waiting'; readonly why: string }
  | { readonly kind: 'revisions'; readonly comparing: Comparing };

/** What pull requests' tabs compare, for the features that show it. */
export interface ComparisonService {
  /** What tab `id` compares now: the whole pull request for a tab the feature doesn't follow. */
  onScreen(id: string): OnScreen;
  /**
   * Calls `listener` with a tab's id each time what {@link ComparisonService.onScreen} says of it
   * may have changed. Returns a function that stops it.
   */
  onChange(listener: (id: string) => void): () => void;
  /** Tab `id`'s diff was drawn with `head` as its newer side, so the reader has seen it. */
  drawn(id: string, head: string): void;
}

export const comparisons = defineService<ComparisonService>('revisions.comparisons');
