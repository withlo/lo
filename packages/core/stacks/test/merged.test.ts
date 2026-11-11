/** Merged pull requests aren't layers, but they still link the layers above them. */

import { expect, test } from 'vitest';

import { layerOf } from '../src/stacks.ts';
import { expectForest, pr } from './support.ts';

test('a layer on a squash merged pr sits on its root and needs a rebase', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a').withCommits(['a.1']).merged(false), pr(2, 'a', 'b').withCommits(['b.1'])],
    ['main', '  #2 base-branch needs-rebase(#1 a.1)'],
  );
  const layer = layerOf(stacks, 2);
  expect(layer?.parent).toEqual({ kind: 'branch', branch: 'main' });
  expect(layer?.rule).toBe('baseBranch');
  expect(layer?.needsRebase).toEqual({ merged: 1, compareAgainst: 'a.1' });
});

test('a layer retargeted after a squash merge still needs a rebase', () => {
  // GitHub pointed #2 at main when #1's branch was deleted. It still has #1's commits.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false),
      pr(2, 'main', 'b').withCommits(['a.1', 'a.2', 'b.1']),
    ],
    ['main', '  #2 shared-commits needs-rebase(#1 a.2)'],
  );
});

test('a layer cut before a squashed layers last commit still links', () => {
  // #2 was cut from a.1, then #1 got a.2 and was squash-merged, and GitHub pointed #2 at main.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
    ],
    ['main', '  #2 shared-commits needs-rebase(#1 a.1)'],
  );
});

test('a layer is compared against the newest commit it has', () => {
  // As above, but #2 still targets `a`, which ends at a.2.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false),
      pr(2, 'a', 'b').withCommits(['a.1', 'b.1']).baseAt('a.2'),
    ],
    ['main', '  #2 base-branch needs-rebase(#1 a.1)'],
  );
});

test('a rebase merged pr matches on its commits too', () => {
  // Rebase-merging copies #1's commits, so its own aren't in main either.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.2', 'a.3']).merged(false),
      pr(2, 'main', 'b').withCommits(['a.1', 'a.2', 'b.1']),
    ],
    ['main', '  #2 shared-commits needs-rebase(#1 a.2)'],
  );
});

test('a commit several merged prs list belongs to the oldest', () => {
  // #2 was stacked on #1 by commits, so it lists a.1 too. #3 was cut from #1.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']).merged(false),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']).merged(false),
      pr(3, 'main', 'c').withCommits(['a.1', 'c.1']),
    ],
    ['main', '  #3 shared-commits needs-rebase(#1 a.1)'],
  );
});

test('a merged layer links past its own commits', () => {
  // #2, stacked on #1 by commits, was squash-merged; #3 was cut from #2.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']),
      pr(2, 'main', 'm').withCommits(['a.1', 'm.1', 'm.2']).merged(false),
      pr(3, 'main', 'c').withCommits(['a.1', 'm.1', 'm.2', 'c.1']),
    ],
    ['main', '  #1', '    #3 shared-commits needs-rebase(#2 m.2)'],
  );
});

test('layers above the rebased layer stay on it', () => {
  expectForest(
    [pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b'), pr(3, 'b', 'c')],
    ['main', '  #2 base-branch needs-rebase(#1 a.1)', '    #3 base-branch'],
  );
});

test('a layer on a merge committed pr needs no rebase', () => {
  const stacks = expectForest(
    [pr(1, 'main', 'a').merged(true), pr(2, 'a', 'b')],
    ['main', '  #2 base-branch'],
  );
  expect(layerOf(stacks, 2)?.needsRebase).toBeUndefined();
});

test('a branch that moved on after its pr merged is a root', () => {
  // `develop` was merged into main in #1 and has had more commits since.
  expectForest(
    [pr(1, 'main', 'develop').merged(true), pr(2, 'develop', 'b').baseAt('develop.2')],
    ['develop', '  #2'],
  );
});

test('a deleted base branch links to no merged pr', () => {
  expectForest([pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b').baseDeleted()], ['a', '  #2']);
});

test('a chain of merged prs links whatever their tips', () => {
  // #2 was squash-merged into `a`, which moved `a` on, then #1 was squash-merged into main.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.sq']).merged(false),
      pr(2, 'a', 'b').baseAt('a.1').merged(false),
      pr(3, 'b', 'c'),
    ],
    ['main', '  #3 base-branch needs-rebase(#2 b.1)'],
  );
});

test('a chain of merge committed prs needs no rebase', () => {
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1', 'a.mc']).merged(true),
      pr(2, 'a', 'b').baseAt('a.1').merged(true),
      pr(3, 'b', 'c'),
    ],
    ['main', '  #3 base-branch'],
  );
});

test('a merge committed head is just history', () => {
  // #1's head is in main, so #2, built on main but aimed at release, isn't above it.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']).merged(true),
      pr(2, 'release', 'b').withCommits(['a.1', 'b.1']),
    ],
    ['release', '  #2'],
  );
});

test('a layer on a pr merged into another layer sits on that layer', () => {
  // #2 was squash-merged into #1's branch.
  expectForest(
    [pr(1, 'main', 'a'), pr(2, 'a', 'm').merged(false), pr(3, 'm', 'b')],
    ['main', '  #1', '    #3 base-branch needs-rebase(#2 m.1)'],
  );
});

test('after two squash merges the nearest merged head is compared against', () => {
  // #1 then #2 were squash-merged into main. #3 still has both pull requests' commits.
  expectForest(
    [
      pr(1, 'main', 'a').withCommits(['a.1']).merged(false),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']).merged(false),
      pr(3, 'b', 'c').withCommits(['a.1', 'b.1', 'c.1']),
    ],
    ['main', '  #3 base-branch needs-rebase(#2 b.1)'],
  );
});

test('an open pr wins over a merged one from the same branch', () => {
  // Branch `a` was merged in #2, then reused for #1.
  expectForest(
    [pr(1, 'main', 'a').created(1), pr(2, 'main', 'a').created(2).merged(false), pr(3, 'a', 'b')],
    ['main', '  #1', '    #3 base-branch'],
  );
});

test('a github stack layer on a merged layer needs no rebase', () => {
  // GitHub rebases a stack's layers itself when a lower one merges.
  const stacks = expectForest(
    [
      pr(1, 'main', 'a').native(100, 1).merged(false),
      pr(2, 'main', 'b').native(100, 2),
      pr(3, 'b', 'c').native(100, 3),
    ],
    ['main', '  #2 native-stack', '    #3 native-stack'],
  );
  expect(layerOf(stacks, 2)?.needsRebase).toBeUndefined();
});

test('a merged fork pr links only by commits', () => {
  // #1 came from a fork's `feature` branch, which isn't the base repository's.
  const stacks = expectForest(
    [
      pr(1, 'main', 'feature').fork().withCommits(['f.1', 'f.2']).merged(false),
      pr(2, 'main', 'more').fork().withCommits(['f.1', 'm.1']),
      pr(3, 'feature', 'x'),
    ],
    ['feature', '  #3', 'main', '  #2 shared-commits needs-rebase(#1 f.1)'],
  );
  expect(layerOf(stacks, 2)?.retargetTo).toBeUndefined();
});
