/** Merging a chain that can't become a GitHub stack one layer at a time. */

import { expect, test } from 'vitest';

import { mergeOneLayerAtATime } from '../src/merge.ts';
import { findStacks, type PullRequest } from '../src/stacks.ts';
import { pr, renderRetarget } from './support.ts';

/**
 * Plans merging the stack under `layer`, among `prs` with no trunk branches, and renders it as its
 * confirmation lists it, in the order it runs.
 */
function render(prs: readonly PullRequest[], layer: number): string[] {
  const merge = mergeOneLayerAtATime(findStacks(prs, []), layer);
  if (!merge) throw new Error('the pull request is not a layer');
  return [
    ...(merge.retargetBefore ? [renderRetarget(merge.retargetBefore)] : []),
    `merge #${merge.pr} into ${merge.into}`,
    ...merge.retargetAfter.map(renderRetarget),
    ...merge.needsRebase.map((number) => `#${number} needs rebase`),
  ];
}

test('the bottom layer merges and the next moves to the root', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')];
  for (const layer of [1, 2, 3]) {
    expect(render(prs, layer)).toEqual(['merge #1 into main', '#2 a -> main', '#2 needs rebase']);
  }
});

test('a layer already based on the root only needs a rebase', () => {
  const prs = [
    pr(1, 'main', 'a').withCommits(['a.1']),
    pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
  ];

  expect(render(prs, 2)).toEqual(['merge #1 into main', '#2 needs rebase']);
});

test('every layer on the bottom one moves to the root', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'a', 'c'), pr(4, 'c', 'd')];

  expect(render(prs, 4)).toEqual([
    'merge #1 into main',
    '#2 a -> main',
    '#3 a -> main',
    '#2 needs rebase',
    '#3 needs rebase',
  ]);
});

test('a lone pr just merges', () => {
  expect(render([pr(1, 'main', 'a')], 1)).toEqual(['merge #1 into main']);
});

test('a bottom layer still on a merged prs branch moves to the root first', () => {
  // #1 was squash-merged into main, and its branch kept.
  const prs = [pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b'), pr(3, 'b', 'c')];

  expect(render(prs, 3)).toEqual([
    '#2 a -> main',
    'merge #2 into main',
    '#3 b -> main',
    '#3 needs rebase',
  ]);
});

test('a chain on a branch no pr comes from merges into that branch', () => {
  const prs = [pr(1, 'feature-x', 'a'), pr(2, 'a', 'b')];

  expect(render(prs, 2)).toEqual([
    'merge #1 into feature-x',
    '#2 a -> feature-x',
    '#2 needs rebase',
  ]);
});

test('github moves a github stacks own layers', () => {
  // #1 and #2 are a GitHub stack. #3 sits on #1 too, so the path through it can't join the stack.
  const prs = [pr(1, 'main', 'a').native(100, 1), pr(2, 'a', 'b').native(100, 2), pr(3, 'a', 'c')];

  expect(render(prs, 3)).toEqual(['merge #1 into main', '#3 a -> main', '#3 needs rebase']);
});

test('a pr that isnt a layer has nothing to merge', () => {
  const stacks = findStacks([pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b')], []);

  expect(mergeOneLayerAtATime(stacks, 1)).toBeUndefined();
  expect(mergeOneLayerAtATime(stacks, 9)).toBeUndefined();
});
