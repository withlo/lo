/**
 * The base-branch rule: a pull request sits on the open one whose head branch is its base branch.
 * Also the trees and walks it builds.
 */

import { expect, test } from 'vitest';

import { findStacks, layerOf, nextLayer, previousLayer, stackOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('a pr targeting another prs head branch sits on it', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')],
    ['main', '  #1', '    #2 base-branch', '      #3 base-branch'],
  );
  const layer = layerOf(stacks, 2);
  expect(layer?.parent).toEqual({ kind: 'pr', number: 1 });
  expect(layer?.rule).toBe('baseBranch');
  expect(layer?.depth).toBe(1);
  expect(layerOf(stacks, 1)?.rule).toBeUndefined();
  expect(layerOf(stacks, 1)?.children).toEqual([2]);

  const stack = stackOf(stacks, 3);
  expect(stack?.root).toBe('main');
  expect(stack?.layers).toEqual([1, 2, 3]);
  expect(stackOf(stacks, 1)).toEqual(stack);
});

test('a base branch with no pr is a root', () => {
  expectForest(
    [pr(1, 'feature-x', 'a'), pr(2, 'a', 'b')],
    ['feature-x', '  #1', '    #2 base-branch'],
  );
});

test('children are oldest first and the walk finishes each branch first', () => {
  const stacks = expectForest(
    [
      pr(1, 'main', 'a'),
      pr(2, 'a', 'b').created(20),
      pr(3, 'a', 'c').created(10),
      pr(4, 'b', 'd'),
      pr(5, 'c', 'e'),
      pr(6, 'c', 'f'),
    ],
    [
      'main',
      '  #1',
      '    #3 base-branch',
      '      #5 base-branch',
      '      #6 base-branch',
      '    #2 base-branch',
      '      #4 base-branch',
    ],
  );
  expect(layerOf(stacks, 1)?.children).toEqual([3, 2]);
  expect(stackOf(stacks, 4)?.layers).toEqual([1, 3, 5, 6, 2, 4]);
});

test('next and previous step through the walk', () => {
  const stacks = findStacks(
    [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c'), pr(4, 'a', 'd')],
    [],
  );
  const stack = stackOf(stacks, 1);
  if (!stack) throw new Error('no stack');
  expect(stack.layers).toEqual([1, 2, 3, 4]);
  expect(nextLayer(stack, 1)).toBe(2);
  expect(nextLayer(stack, 3)).toBe(4);
  expect(nextLayer(stack, 4)).toBeUndefined();
  expect(previousLayer(stack, 4)).toBe(3);
  expect(previousLayer(stack, 2)).toBe(1);
  expect(previousLayer(stack, 1)).toBeUndefined();
  expect(nextLayer(stack, 9)).toBeUndefined();
  expect(previousLayer(stack, 9)).toBeUndefined();
});

test('separate trees on one root are separate stacks', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a'), pr(2, 'main', 'b'), pr(3, 'a', 'c'), pr(4, 'b', 'd')],
    ['main', '  #1', '    #3 base-branch', '  #2', '    #4 base-branch'],
  );
  expect(stackOf(stacks, 3)?.layers).toEqual([1, 3]);
  expect(stackOf(stacks, 4)?.layers).toEqual([2, 4]);
});

test('never links to a fork head', () => {
  // A fork's `feature` branch isn't the base repository's `feature` branch.
  expectForest(
    [pr(1, 'main', 'feature').fork(), pr(2, 'feature', 'b')],
    ['feature', '  #2', 'main', '  #1'],
  );
});

test('a fork pr can sit on a base repo branch', () => {
  expectForest(
    [pr(1, 'main', 'a'), pr(2, 'a', 'patch').fork()],
    ['main', '  #1', '    #2 base-branch'],
  );
});

test('of two open prs from one branch the newest is below', () => {
  expectForest(
    [pr(1, 'main', 'feature'), pr(2, 'release', 'feature'), pr(3, 'feature', 'b')],
    ['main', '  #1', 'release', '  #2', '    #3 base-branch'],
  );
});

test('a pr never sits on itself', () => {
  expectForest([pr(1, 'a', 'a')], ['a', '  #1']);
});
