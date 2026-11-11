/** The forest's shape when nothing links pull requests: roots, order and which are layers. */

import { expect, test } from 'vitest';

import { findStacks, layerOf, stackOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('unlinked prs sit on their base branch', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a'), pr(2, 'feature-x', 'b'), pr(3, 'main', 'c')],
    ['feature-x', '  #2', 'main', '  #1', '  #3'],
  );
  const layer = layerOf(stacks, 2);
  expect(layer?.parent).toEqual({ kind: 'branch', branch: 'feature-x' });
  expect(layer?.depth).toBe(0);
  expect(layer?.children).toEqual([]);
});

test('each unlinked pr is its own stack', () => {
  const stacks = findStacks([pr(1, 'main', 'a'), pr(2, 'main', 'b')], []);
  const one = stackOf(stacks, 1);
  expect(one?.root).toBe('main');
  expect(one?.layers).toEqual([1]);
  expect(stackOf(stacks, 2)?.layers).toEqual([2]);
});

test('stacks on a root are in creation order', () => {
  expectForest(
    [
      pr(1, 'main', 'a').created(30),
      pr(2, 'main', 'b').created(10),
      pr(3, 'main', 'c').created(20),
      // Same time as #2: the lower number first.
      pr(4, 'main', 'd').created(10),
    ],
    ['main', '  #2', '  #4', '  #3', '  #1'],
  );
});

test('closed and merged prs are not layers', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a'), pr(2, 'main', 'b').merged(true), pr(3, 'main', 'c').closed()],
    ['main', '  #1'],
  );
  expect(layerOf(stacks, 2)).toBeUndefined();
  expect(stackOf(stacks, 3)).toBeUndefined();
});

test('unknown prs have no stack', () => {
  const stacks = findStacks([pr(1, 'main', 'a')], []);
  expect(layerOf(stacks, 9)).toBeUndefined();
  expect(stackOf(stacks, 9)).toBeUndefined();
});

test('no prs make an empty forest', () => {
  expect(findStacks([], []).roots).toEqual([]);
});

test('a repeated number keeps the first of the same state', () => {
  const stacks = expectForest([pr(1, 'main', 'a'), pr(1, 'release', 'a')], ['main', '  #1']);
  expect(layerOf(stacks, 1)?.parent).toEqual({ kind: 'branch', branch: 'main' });
});

test('a repeated number prefers open then merged then closed', () => {
  expectForest([pr(1, 'release', 'a').closed(), pr(1, 'main', 'a')], ['main', '  #1']);
  // The merged #1 links #2; the closed one wouldn't.
  expectForest(
    [
      pr(1, 'main', 'a').closed(),
      pr(1, 'main', 'a').merged(false),
      pr(1, 'main', 'a').closed(),
      pr(2, 'a', 'b'),
    ],
    ['main', '  #2 base-branch needs-rebase(#1 a.1)'],
  );
});
