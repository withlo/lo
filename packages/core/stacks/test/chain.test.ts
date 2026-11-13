/** The layers between two layers: one chain, which one diff can show, never across a fork. */

import { expect, test } from 'vitest';

import { chain } from '../src/diffs.ts';
import { stackOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

/** A tree that forks at #1 and at #2, and a stack of its own beside it. */
function tree() {
  return expectForest(
    [
      pr(1, 'main', 'a'),
      pr(2, 'a', 'b'),
      pr(3, 'b', 'c'),
      pr(4, 'a', 'd'),
      pr(5, 'b', 'e'),
      pr(6, 'main', 'x'),
      pr(7, 'x', 'y'),
      pr(8, 'main', 'm').merged(true),
    ],
    [
      'main',
      '  #1',
      '    #2 base-branch',
      '      #3 base-branch',
      '      #5 base-branch',
      '    #4 base-branch',
      '  #6',
      '    #7 base-branch',
    ],
  );
}

test('runs from the lower layer to the upper, either way round', () => {
  const stacks = tree();
  expect(chain(stacks, 1, 3)).toEqual([1, 2, 3]);
  expect(chain(stacks, 3, 1)).toEqual([1, 2, 3]);
  expect(chain(stacks, 2, 5)).toEqual([2, 5]);
  expect(chain(stacks, 4, 1)).toEqual([1, 4]);
});

test('a layer alone is a run of one', () => {
  expect(chain(tree(), 3, 3)).toEqual([3]);
});

test('never crosses a fork in the tree', () => {
  const stacks = tree();
  // Each sits on #2, and neither on the other.
  expect(chain(stacks, 3, 5)).toBeUndefined();
  // #4 sits on #1, beside #2.
  expect(chain(stacks, 3, 4)).toBeUndefined();
  expect(chain(stacks, 4, 2)).toBeUndefined();
});

test('never joins two stacks', () => {
  const stacks = tree();
  expect(chain(stacks, 1, 6)).toBeUndefined();
  expect(chain(stacks, 3, 7)).toBeUndefined();
});

test("has no layers that aren't open pull requests", () => {
  const stacks = tree();
  // #8 merged, and there's no #9.
  expect(chain(stacks, 8, 1)).toBeUndefined();
  expect(chain(stacks, 1, 9)).toBeUndefined();
});

test('from a layer, reaches the layers below it and those on its own branch above', () => {
  const stacks = tree();
  const walk = stackOf(stacks, 1)?.layers ?? [];
  expect(walk).toEqual([1, 2, 3, 5, 4]);
  const reach = (from: number) => walk.filter((to) => chain(stacks, from, to) !== undefined);
  expect(reach(2)).toEqual([1, 2, 3, 5]);
  expect(reach(3)).toEqual([1, 2, 3]);
  expect(reach(4)).toEqual([1, 4]);
});
