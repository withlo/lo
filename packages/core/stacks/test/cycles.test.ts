/** Links that loop back are broken at one link, and reported. */

import { expect, test } from 'vitest';

import { findStacks, layerOf, stackOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('a cycle is broken at the oldest prs link', () => {
  // Each targets the other's head branch. #2 is older.
  const stacks = expectForest(
    [pr(1, 'b', 'a').created(9), pr(2, 'a', 'b').created(1)],
    ['a', '  #2', '    #1 base-branch'],
  );
  expect(stacks.cycles).toEqual([{ prs: [2, 1] }]);
  const layer = layerOf(stacks, 2);
  expect(layer?.parent).toEqual({ kind: 'branch', branch: 'a' });
  expect(layer?.rule).toBeUndefined();
});

test('a cycle through a merged pr lists only open prs', () => {
  // #1 was squash-merged into #2's branch, which targets #1's.
  const stacks = expectForest([pr(1, 'b', 'a').merged(false), pr(2, 'a', 'b')], ['a', '  #2']);
  expect(stacks.cycles).toEqual([{ prs: [2] }]);
});

test('a cycle of merged prs is broken but not reported', () => {
  const stacks = expectForest(
    [pr(1, 'b', 'a').merged(false), pr(2, 'a', 'b').merged(false), pr(3, 'b', 'c')],
    ['b', '  #3 base-branch needs-rebase(#2 b.1)'],
  );
  expect(stacks.cycles).toEqual([]);
});

test('a longer cycle is reported in link order', () => {
  const stacks = expectForest(
    [pr(1, 'c', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')],
    ['c', '  #1', '    #2 base-branch', '      #3 base-branch'],
  );
  // #1 links to #3, #3 to #2, and #2 back to #1.
  expect(stacks.cycles).toEqual([{ prs: [1, 3, 2] }]);
});

test('the link found by the weakest rule is broken', () => {
  // #1's commits are stale and contain #2's head, though GitHub says #2 is above #1. #2 is older,
  // so only the rule decides.
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').native(100, 1).withCommits(['b.1', 'a.1']).created(5),
      pr(2, 'a', 'b').native(100, 2).withCommits(['a.1', 'b.1']).created(1),
    ],
    ['main', '  #1', '    #2 native-stack'],
  );
  expect(stacks.cycles).toEqual([{ prs: [1, 2] }]);
});

test('layers above a cycle are kept', () => {
  const stacks = expectForest(
    [pr(1, 'b', 'a'), pr(2, 'a', 'b'), pr(3, 'a', 'c')],
    ['b', '  #1', '    #2 base-branch', '    #3 base-branch'],
  );
  expect(stacks.cycles).toHaveLength(1);
  expect(stackOf(stacks, 3)?.layers).toEqual([1, 2, 3]);
});

test('separate cycles are each reported', () => {
  const stacks = findStacks(
    [pr(1, 'b', 'a'), pr(2, 'a', 'b'), pr(3, 'd', 'c'), pr(4, 'c', 'd')],
    [],
  );
  expect(stacks.cycles).toEqual([{ prs: [1, 2] }, { prs: [3, 4] }]);
});

test('a forest without cycles reports none', () => {
  const stacks = findStacks([pr(1, 'main', 'a'), pr(2, 'a', 'b')], []);
  expect(stacks.cycles).toEqual([]);
});
