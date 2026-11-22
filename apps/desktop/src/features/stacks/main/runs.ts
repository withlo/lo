// A run of a stack's layers, as one diff shows it: a chain, each layer sitting on the one before
// it, from where its bottom layer's own changes start to its top layer's head. Nothing here calls
// Electron or GitHub.

import { chain, layerStart, type PullRequest, type Stacks } from '@lo/stacks';

/** A run of layers to show as one diff. */
export interface Run {
  /** Its layers, bottom first, two or more. */
  readonly layers: readonly number[];
  /**
   * The commit its diff starts from: where its bottom layer's own changes start, as `layerStart`
   * says, which is its base branch's tip for a layer that starts there.
   */
  readonly start: string;
}

/**
 * The run of layers from `a` to `b`, in either order, among `stacks`, which were found among
 * `prs`; or why one diff can't show them.
 */
export function runOf(
  stacks: Stacks,
  prs: readonly PullRequest[],
  a: number,
  b: number,
): Run | { readonly why: string } {
  const layers = chain(stacks, a, b);
  if (!layers) {
    return { why: `#${b} isn’t above or below #${a}` };
  }
  const [bottom] = layers;
  if (bottom === undefined || layers.length < 2) {
    return { why: 'Select 2 layers or more' };
  }
  const start = layerStart(stacks, prs, bottom);
  const commit = start?.kind === 'baseBranch' ? start.tip : start?.commit;
  if (commit === undefined) {
    return { why: `#${bottom}’s base branch no longer exists` };
  }
  return { layers, start: commit };
}
