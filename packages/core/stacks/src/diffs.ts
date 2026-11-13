/**
 * What a layer's diff compares (`docs/design.md`, "Layer diffs"): where a layer's own changes
 * start, so its diff leaves out the layers below it, and the layers a run between two layers holds,
 * which show as one diff.
 *
 * Both read the forest {@link findStacks} built, and change nothing.
 */

import { layerOf, type PullRequest, type Stacks } from './stacks.ts';

/** Where a layer's own changes start: what its head is compared with. */
export type LayerStart =
  /**
   * The last commit of `merged`, a squash- or rebase-merged pull request below, that the layer
   * lists ({@link NeedsRebase.compareAgainst}), so the changes that already landed stay hidden
   * until the layer is rebased.
   */
  | { readonly kind: 'needsRebase'; readonly merged: number; readonly commit: string }
  /**
   * The head of `below`, the open pull request below, which the layer's head holds: a layer linked
   * by shared commits still has its lower layers' changes over its base branch.
   */
  | { readonly kind: 'sharedCommits'; readonly below: number; readonly commit: string }
  /**
   * Its base branch, where GitHub's own diff of the pull request already starts: for a stack's
   * bottom layer, a layer linked by its base branch or by a GitHub stack, and one whose link was
   * dropped. `tip` is the branch's tip now, as the pull requests passed say, or nothing once it's
   * deleted.
   */
  | { readonly kind: 'baseBranch'; readonly branch: string; readonly tip: string | undefined };

/**
 * Where the layer `number` starts in `stacks`, which {@link findStacks} built from `prs`. Nothing
 * when `number` isn't a layer.
 *
 * A layer that needs a rebase starts at the merged layer's last commit it lists, while it still
 * lists it, or at the merged layer's head while its base branch is still there. One linked by
 * shared commits starts at the head of the open pull request below, while its own commits hold
 * that head. Any other starts at its base branch, and so does a layer whose
 * pull requests in `prs` don't say what its link does, such as ones read after the forest was
 * built.
 */
export function layerStart(
  stacks: Stacks,
  prs: readonly PullRequest[],
  number: number,
): LayerStart | undefined {
  const layer = layerOf(stacks, number);
  if (!layer) return undefined;
  const own = openPr(prs, number);
  if (layer.needsRebase) {
    const { merged, compareAgainst } = layer.needsRebase;
    // Rebased since the forest was built, the layer no longer holds the merged layer's commit, and
    // a diff from it would show what its base branch gained since as the layer's own. A layer lists
    // none of the merged one's commits while its base branch still holds them, at that branch's
    // tip: GitHub's own diff already starts there.
    if (own?.commits.includes(compareAgainst) || own?.baseTip === compareAgainst) {
      return { kind: 'needsRebase', merged, commit: compareAgainst };
    }
  }
  const { parent } = layer;
  if (layer.rule === 'sharedCommits' && parent.kind === 'pr') {
    const below = openPr(prs, parent.number);
    if (below && own?.commits.includes(below.headOid)) {
      return { kind: 'sharedCommits', below: below.number, commit: below.headOid };
    }
  }
  return { kind: 'baseBranch', branch: layer.baseRef, tip: own?.baseTip };
}

/** The open pull request `number` in `prs`, as {@link findStacks} picks it when several have it. */
function openPr(prs: readonly PullRequest[], number: number): PullRequest | undefined {
  return prs.find((pr) => pr.number === number && pr.state.kind === 'open');
}

/**
 * The layers from `a` to `b`, bottom to top, when one sits on the other, directly or on the layers
 * between them: a run one diff can show. `a` and `b` come in either order, and may be the same
 * layer. Nothing when either isn't a layer, or neither sits on the other, as across a fork in the
 * tree or between stacks.
 */
export function chain(stacks: Stacks, a: number, b: number): number[] | undefined {
  const first = layerOf(stacks, a);
  const second = layerOf(stacks, b);
  if (!first || !second) return undefined;
  const [lower, upper] = first.depth <= second.depth ? [first, second] : [second, first];
  const run = [upper.number];
  // Each step goes one layer down, so the walk ends at the lower layer's depth.
  for (let at = upper; at.depth > lower.depth;) {
    if (at.parent.kind !== 'pr') return undefined;
    const below = layerOf(stacks, at.parent.number);
    if (!below || below.depth !== at.depth - 1) return undefined;
    run.push(below.number);
    at = below;
  }
  return run.at(-1) === lower.number ? run.toReversed() : undefined;
}
