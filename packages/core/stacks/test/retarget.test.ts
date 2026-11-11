/**
 * The base branch each layer needs for "Make this a GitHub stack": the head branch of the pull
 * request below, or the root.
 */

import { expect, test } from 'vitest';

import { findStacks, layerOf, type PullRequest } from '../src/stacks.ts';
import { pr } from './support.ts';

function retargetTo(prs: readonly PullRequest[], number: number): string | undefined {
  const layer = layerOf(findStacks(prs, []), number);
  if (!layer) throw new Error(`#${number} is not a layer`);
  return layer.retargetTo;
}

test('a layer already on the branch below stays', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b')];

  expect(retargetTo(prs, 1)).toBeUndefined();
  expect(retargetTo(prs, 2)).toBeUndefined();
});

test('a layer found by shared commits moves to the branch below', () => {
  const prs = [
    pr(1, 'main', 'a').withCommits(['a.1']),
    pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
  ];

  expect(retargetTo(prs, 2)).toBe('a');
});

test('a github stack layer on another branch moves', () => {
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'x', 'b').native(100, 2),
    pr(3, 'main', 'x'),
  ];

  expect(retargetTo(prs, 2)).toBe('a');
});

test('a layer on a merged pr moves to where it now sits', () => {
  // #1 was merged into main.
  expect(retargetTo([pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b')], 2)).toBe('main');

  // #2 was merged into #1's branch.
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'm').merged(false), pr(3, 'm', 'b')];
  expect(retargetTo(prs, 3)).toBe('a');
});

test('a layer on a fork pr has no branch to move to', () => {
  const prs = [
    pr(1, 'main', 'feature').fork().withCommits(['f.1']),
    pr(2, 'main', 'more').withCommits(['f.1', 'm.1']),
  ];

  expect(retargetTo(prs, 2)).toBeUndefined();
});
