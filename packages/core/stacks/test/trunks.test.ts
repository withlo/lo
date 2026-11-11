/**
 * Trunk branches, such as the default branch and protected ones, are always roots: a pull request
 * from a trunk is never below another, by any rule.
 */

import { expect, test } from 'vitest';

import { layerOf } from '../src/stacks.ts';
import { expectTrunkForest, pr } from './support.ts';

test('an open pr from a trunk is never below', () => {
  // A deploy pull request from main into production.
  const stacks = expectTrunkForest(
    [
      pr(100, 'production', 'main').withCommits(['m.1', 'm.2']),
      pr(1, 'main', 'f1'),
      pr(2, 'main', 'f2'),
      pr(3, 'main', 'f3'),
    ],
    ['main', 'production'],
    ['main', '  #1', '  #2', '  #3', 'production', '  #100'],
  );
  expect(layerOf(stacks, 1)?.parent).toEqual({ kind: 'branch', branch: 'main' });
});

test('a merged pr from a trunk is never below', () => {
  // #90 merged main into production, and main hasn't moved since.
  expectTrunkForest(
    [pr(90, 'production', 'main').withCommits(['x.1', 'main.1']).merged(true), pr(1, 'main', 'f1')],
    ['main', 'production'],
    ['main', '  #1'],
  );
});

test('a trunk head among a prs commits links nothing', () => {
  // #2 is aimed at release but built on main's tip, which #1 is deploying.
  expectTrunkForest(
    [
      pr(1, 'production', 'main').withCommits(['m.1']),
      pr(2, 'release', 'b').withCommits(['m.1', 'b.1']),
    ],
    ['main'],
    ['production', '  #1', 'release', '  #2'],
  );
});

test('a back merge pr is never below', () => {
  // Gitflow: develop is the default branch, and main's hotfixes are merged back into it.
  expectTrunkForest(
    [
      pr(50, 'develop', 'main').withCommits(['h.1']),
      pr(51, 'main', 'hotfix-1'),
      pr(52, 'main', 'hotfix-2'),
      pr(60, 'develop', 'feat-1'),
    ],
    ['develop', 'main'],
    ['develop', '  #50', '  #60', 'main', '  #51', '  #52'],
  );
});

test('a release and its back merge stay on their trunks', () => {
  // Without trunks, #40 and #41 would target each other's head branch.
  const stacks = expectTrunkForest(
    [
      pr(40, 'main', 'develop').withCommits(['d.1']),
      pr(41, 'develop', 'main').withCommits(['h.1']),
      pr(50, 'develop', 'feat-1'),
      pr(51, 'develop', 'feat-2'),
      pr(60, 'main', 'hotfix-1'),
    ],
    ['main', 'develop'],
    ['main', '  #40', '  #60', 'develop', '  #41', '  #50', '  #51'],
  );
  expect(stacks.cycles).toEqual([]);
});

test('a forks branch named like a trunk is not a trunk', () => {
  // A contributor's pull requests from their fork's main, the second built on the first.
  expectTrunkForest(
    [
      pr(1, 'main', 'main').fork().withCommits(['f.1']),
      pr(2, 'main', 'more').fork().withCommits(['f.1', 'f.2']),
    ],
    ['main'],
    ['main', '  #1', '    #2 shared-commits'],
  );
});

test('roots list trunks first in the order given', () => {
  expectTrunkForest(
    [pr(1, 'zeta', 'a'), pr(2, 'develop', 'b'), pr(3, 'alpha', 'c'), pr(4, 'main', 'd')],
    ['main', 'release', 'develop'],
    ['main', '  #4', 'develop', '  #2', 'alpha', '  #3', 'zeta', '  #1'],
  );
});
