/**
 * The shared-commits rule: a pull request sits on the open one whose head commit it contains, the
 * nearest one if several.
 */

import { expect, test } from 'vitest';

import { layerOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('a pr containing another prs head sits on it', () => {
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2']),
      pr(2, 'main', 'b').withCommits(['a.1', 'a.2', 'b.1']),
    ],
    ['main', '  #1', '    #2 shared-commits'],
  );
  const layer = layerOf(stacks, 2);
  expect(layer?.parent).toEqual({ kind: 'pr', number: 1 });
  expect(layer?.rule).toBe('sharedCommits');
});

test('the nearest pr below is the parent', () => {
  // #3 contains both heads; #4's is closer to #3's head, though #5 is newer.
  expectForest(
    [
      pr(5, 'main', 'x').withCommits(['x.1']),
      pr(4, 'main', 'y').withCommits(['x.1', 'y.1']),
      pr(3, 'main', 'z').withCommits(['x.1', 'y.1', 'z.1']),
    ],
    ['main', '  #5', '    #4 shared-commits', '      #3 shared-commits'],
  );
});

test('an open lower layer links only by its head', () => {
  // #2 was cut from a.1 before #1 got a.2, so #2 doesn't contain #1's latest commit.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2']),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
    ],
    ['main', '  #1', '  #2'],
  );
});

test('a head before the commits listed links nothing', () => {
  // Only #2's recent commits are known, and #1's head is older than all of them.
  expectForest(
    [pr(1, 'main', 'a').withCommits(['a.1']), pr(2, 'main', 'b').withCommits(['b.1', 'b.2'])],
    ['main', '  #1', '  #2'],
  );
});

test('a pr with the same head commit is not below', () => {
  // #2's branch has no commits of its own yet.
  expectForest(
    [pr(1, 'main', 'a').withCommits(['a.1']), pr(2, 'release', 'b').withCommits(['a.1'])],
    ['main', '  #1', 'release', '  #2'],
  );
});

test('of two prs with the nearest head the newest is below', () => {
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']),
      pr(2, 'release', 'a-backport').withCommits(['a.1']),
      pr(3, 'main', 'c').withCommits(['a.1', 'c.1']),
    ],
    ['main', '  #1', 'release', '  #2', '    #3 shared-commits'],
  );
});

test('links to a fork head', () => {
  expectForest(
    [
      pr(1, 'main', 'feature').fork().withCommits(['f.1']),
      pr(2, 'main', 'more').fork().withCommits(['f.1', 'm.1']),
    ],
    ['main', '  #1', '    #2 shared-commits'],
  );
});

test('base branch wins over shared commits', () => {
  // #3 targets #1's branch but also contains #2's head.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']),
      pr(2, 'main', 'b').withCommits(['b.1']),
      pr(3, 'a', 'c').withCommits(['b.1', 'c.1']),
    ],
    ['main', '  #1', '    #3 base-branch', '  #2'],
  );
});

test('prs listing no commits still link by head and branch', () => {
  expectForest(
    [
      pr(1, 'main', 'a').noCommits(),
      pr(2, 'a', 'b').noCommits(),
      pr(3, 'main', 'c').noCommits(),
      pr(4, 'main', 'd').withCommits(['a.1', 'd.1']),
      pr(5, 'main', 'e').merged(false).noCommits(),
      pr(6, 'main', 'f').withCommits(['e.1', 'f.1']),
    ],
    [
      'main',
      '  #1',
      '    #2 base-branch',
      '    #4 shared-commits',
      '  #3',
      '  #6 shared-commits needs-rebase(#5 e.1)',
    ],
  );
});
