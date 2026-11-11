/** What the merge button does (`docs/design.md`, "Merging"). */

import { allowedMethods, methodList, pickedMethod, type MergeSnapshot } from '../merge.ts';
import { blockers } from './blockers.ts';
import type { MergeMethod } from './github.ts';

/** What merging the pull request does now. */
export type MergeAction =
  /**
   * Merge it now, with one of `methods`: those allowed here, in the order GitHub's merge button
   * lists them, without rebase when the base branch requires signed commits. `method` is the one
   * to pick first: the one you last used here, else GitHub's default for you. The merge carries the
   * head on screen, so GitHub refuses it if someone pushed since (`docs/design.md`, "Acting on
   * what you saw").
   */
  | {
      readonly kind: 'merge';
      readonly methods: readonly MergeMethod[];
      readonly method: MergeMethod;
    }
  /**
   * Add it to the base branch's merge queue, whose settings choose the method: `method` when GitHub
   * says which.
   */
  | { readonly kind: 'enqueue'; readonly method: MergeMethod | undefined }
  /** Neither, for this reason. */
  | { readonly kind: 'notPossible'; readonly reason: NotPossible };

/** Why the pull request can't merge or join the merge queue now. */
export type NotPossible =
  /** It's merged. */
  | { readonly kind: 'merged' }
  /** It's closed. */
  | { readonly kind: 'closed' }
  /** It's in the merge queue already, at this position when GitHub says. */
  | { readonly kind: 'queued'; readonly position: number | undefined }
  /** Something blocks it: see `blockers`. */
  | { readonly kind: 'blocked' }
  /** GitHub's rules let it merge, but you can't merge into the base branch. */
  | { readonly kind: 'noPermission' }
  /** The repository allows no merge method. */
  | { readonly kind: 'noMethod' };

function notPossible(reason: NotPossible): MergeAction {
  return { kind: 'notPossible', reason };
}

/**
 * What merging the pull request does now: merge it with a method, add it to the merge queue when
 * the base branch requires one, or neither and why. The reasons are checked in the order
 * {@link NotPossible} lists them, so a blocked pull request you can't merge is `blocked`.
 */
export function mergeAction(snapshot: MergeSnapshot): MergeAction {
  if (snapshot.state === 'MERGED') return notPossible({ kind: 'merged' });
  if (snapshot.state === 'CLOSED') return notPossible({ kind: 'closed' });
  if (snapshot.queue.inQueue) {
    return notPossible({ kind: 'queued', position: snapshot.queue.position });
  }
  if (blockers(snapshot).length > 0) return notPossible({ kind: 'blocked' });
  if (!snapshot.viewer.canMerge) return notPossible({ kind: 'noPermission' });
  if (snapshot.queue.required) return { kind: 'enqueue', method: snapshot.queue.method };
  const method = pickedMethod(snapshot);
  if (method === undefined) return notPossible({ kind: 'noMethod' });
  return { kind: 'merge', methods: methodList(allowedMethods(snapshot)), method };
}
