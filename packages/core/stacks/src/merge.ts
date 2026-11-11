/**
 * Merges a chain that can't become a GitHub stack one layer at a time (`docs/design.md`, "Stacks"
 * under "Merging and the merge queue"): its bottom layer merges, and the layers on it move to the
 * root branch and need a rebase.
 *
 * The plan is data: running it is up to the caller.
 */

import { layerOf, stackOf, type Gap, type Retarget, type Stacks } from './stacks.ts';

/**
 * Merging a stack's bottom layer. Run it in field order: move the bottom layer onto the root branch
 * if it needs to, merge it, then move the layers on it.
 */
export interface MergeBottom {
  /** The stack's bottom layer: the only one that merges now. */
  readonly pr: number;
  /** The root branch it merges into. */
  readonly into: string;
  /**
   * Moves it onto the root branch before it merges, when its base branch is still a merged pull
   * request's.
   */
  readonly retargetBefore: Retarget | undefined;
  /**
   * Once it has merged, moves each layer on it onto the root branch, oldest first. A layer already
   * based there needs no change.
   */
  readonly retargetAfter: readonly Retarget[];
  /**
   * The layers on it, oldest first, to mark "needs rebase" once it has merged: they still carry its
   * commits, which a squash or rebase merge leaves out of the root branch.
   */
  readonly needsRebase: readonly number[];
}

/**
 * Why there's no plan: the reads the stacks were found from left something out (`gaps`), so a
 * layer may sit on a merged pull request's dead branch, which the plan would merge it into.
 */
export interface Incomplete {
  readonly refusal: 'incomplete';
  readonly gaps: readonly Gap[];
}

/**
 * Plans merging the stack under `layer` one layer at a time, for a chain that can't become a GitHub
 * stack: its bottom layer merges now, and every layer on it moves to the root branch, the one on the
 * way to `layer` and any others. `layer` can be any layer of the stack. Nothing when it isn't a
 * layer, and {@link Incomplete} while the stacks are.
 *
 * A layer on it that's in the same GitHub stack is left out: GitHub moves and rebases a stack's own
 * layers itself when a lower one merges. Whether the bottom layer can merge, including whether it
 * needs a rebase itself (its `needsRebase`), isn't checked here.
 */
export function mergeOneLayerAtATime(
  stacks: Stacks,
  layer: number,
): MergeBottom | Incomplete | undefined {
  if (stacks.gaps.length > 0) return { refusal: 'incomplete', gaps: stacks.gaps };
  const stack = stackOf(stacks, layer);
  // The walk starts at the bottom layer.
  const bottomNumber = stack?.layers[0];
  const bottom = bottomNumber === undefined ? undefined : layerOf(stacks, bottomNumber);
  if (!stack || !bottom) return undefined;
  const into = stack.root;
  const retargetBefore =
    bottom.retargetTo === undefined
      ? undefined
      : { pr: bottom.number, from: bottom.baseRef, to: bottom.retargetTo };
  const retargetAfter: Retarget[] = [];
  const needsRebase: number[] = [];
  for (const number of bottom.children) {
    const above = layerOf(stacks, number);
    if (!above) return undefined;
    if (above.rule === 'nativeStack') continue;
    if (above.baseRef !== into) retargetAfter.push({ pr: number, from: above.baseRef, to: into });
    needsRebase.push(number);
  }
  return { pr: bottom.number, into, retargetBefore, retargetAfter, needsRebase };
}
