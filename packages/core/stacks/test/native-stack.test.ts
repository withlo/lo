/** The GitHub stack rule: a layer of a GitHub stack sits on the layer one position below it. */

import { expect, test } from 'vitest';

import { layerOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('adjacent layers of a github stack are linked', () => {
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').native(100, 1),
      pr(2, 'a', 'b').native(100, 2),
      pr(3, 'b', 'c').native(100, 3),
    ],
    ['main', '  #1', '    #2 native-stack', '      #3 native-stack'],
  );
  const layer = layerOf(stacks, 3);
  expect(layer?.parent).toEqual({ kind: 'pr', number: 2 });
  expect(layer?.rule).toBe('nativeStack');
});

test('native stack wins over base branch', () => {
  // #2 targets #3's branch, but GitHub says it's above #1.
  expectForest(
    [pr(1, 'main', 'a').native(100, 1), pr(2, 'x', 'b').native(100, 2), pr(3, 'main', 'x')],
    ['main', '  #1', '    #2 native-stack', '  #3'],
  );
});

test('native stack wins over shared commits', () => {
  // #2 contains #3's head, but GitHub says it's above #1.
  expectForest(
    [
      pr(1, 'main', 'a').native(100, 1).withCommits(['a.1']),
      pr(2, 'main', 'b').native(100, 2).withCommits(['x.1', 'b.1']),
      pr(3, 'main', 'x').withCommits(['x.1']),
    ],
    ['main', '  #1', '    #2 native-stack', '  #3'],
  );
});

test('a bottom layer links by the other rules', () => {
  // A GitHub stack whose trunk is another pull request's head branch.
  expectForest(
    [pr(1, 'main', 'a'), pr(2, 'a', 'b').native(100, 1), pr(3, 'b', 'c').native(100, 2)],
    ['main', '  #1', '    #2 base-branch', '      #3 native-stack'],
  );
});

test('layers of different stacks are not linked', () => {
  expectForest(
    [pr(1, 'main', 'a').native(100, 1), pr(2, 'x', 'b').native(200, 2)],
    ['main', '  #1', 'x', '  #2'],
  );
});

test('a closed middle layer doesnt split the stack', () => {
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').native(100, 1),
      pr(2, 'a', 'b').native(100, 2).closed(),
      pr(3, 'b', 'c').native(100, 3),
    ],
    ['main', '  #1', '    #3 native-stack'],
  );
  expect(layerOf(stacks, 3)?.retargetTo).toBe('a');
});

test('a middle layer not passed is skipped too', () => {
  expectForest(
    [pr(1, 'main', 'a').native(100, 1), pr(3, 'b', 'c').native(100, 3)],
    ['main', '  #1', '    #3 native-stack'],
  );
});

test('the lowest layer passed links by the other rules', () => {
  // GitHub merged position 1 and pointed #2 at main; #1 wasn't passed.
  expectForest(
    [pr(2, 'main', 'b').native(100, 2), pr(3, 'b', 'c').native(100, 3)],
    ['main', '  #2', '    #3 native-stack'],
  );
});

test('a layer on a merged middle layer sits on the layer below it', () => {
  // #2 was squash-merged into #1's branch. GitHub rebases the layers above.
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').native(100, 1),
      pr(2, 'a', 'b').native(100, 2).merged(false),
      pr(3, 'b', 'c').native(100, 3),
    ],
    ['main', '  #1', '    #3 native-stack'],
  );
  expect(layerOf(stacks, 3)?.needsRebase).toBeUndefined();
});
