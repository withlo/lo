/** The one-line merge status in a pull request's header (`docs/design.md`, "Merge status"). */

import type { MergeSnapshot } from '../merge.ts';
import { blockers, isWait, mayNotSeeEveryRule, type Blocker } from './blockers.ts';

/**
 * Where a pull request's merge stands, for the one-line status in its tab's header. It's about the
 * pull request, not you: a pull request you can't merge can still be ready.
 */
export type MergeStatus =
  /** It's merged. */
  | { readonly kind: 'merged' }
  /** It's closed. */
  | { readonly kind: 'closed' }
  /** It's in the merge queue, at this position (`mergeQueueEntry.position`) when GitHub says. */
  | { readonly kind: 'queued'; readonly position: number | undefined }
  /** Nothing blocks it: it can merge, or join the merge queue. */
  | { readonly kind: 'ready' }
  /**
   * Only things waiting will fix block it. With `autoMerge`, auto-merge is on, so it merges, or
   * joins the queue, once they clear, while it stays on: GitHub turns it off when someone without
   * write access pushes. With `partial`, Lo may not see every rule behind GitHub's block
   * (`mayNotSeeEveryRule`), so these may be only part of why.
   */
  | {
      readonly kind: 'waiting';
      readonly blockers: readonly Blocker[];
      readonly autoMerge: boolean;
      readonly partial: boolean;
    }
  /**
   * Something waiting won't fix blocks it. The first blocker is the one to name, as `blockers`
   * orders them. With `autoMerge`, auto-merge is on, and it merges if everything clears while it
   * stays on. With `partial`, as for `waiting`.
   */
  | {
      readonly kind: 'blocked';
      readonly blockers: readonly Blocker[];
      readonly autoMerge: boolean;
      readonly partial: boolean;
    };

/** Where the pull request's merge stands. */
export function mergeStatus(snapshot: MergeSnapshot): MergeStatus {
  if (snapshot.state === 'MERGED') return { kind: 'merged' };
  if (snapshot.state === 'CLOSED') return { kind: 'closed' };
  if (snapshot.queue.inQueue) return { kind: 'queued', position: snapshot.queue.position };
  const found = blockers(snapshot);
  if (found.length === 0) return { kind: 'ready' };
  return {
    kind: found.every(isWait) ? 'waiting' : 'blocked',
    blockers: found,
    autoMerge: snapshot.autoMerge !== undefined,
    partial: mayNotSeeEveryRule(snapshot),
  };
}
