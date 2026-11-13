/** Where a layer's own changes start, so its diff leaves out the layers below it. */

import { expect, test } from 'vitest';

import { layerStart } from '../src/diffs.ts';
import { findStacks } from '../src/stacks.ts';
import { expectForest, expectTrunkForest, pr } from './support.ts';

test("a stack's bottom layer starts at its base branch", () => {
  const prs = [pr(1, 'main', 'a')];
  const stacks = expectForest(prs, ['main', '  #1']);
  expect(layerStart(stacks, prs, 1)).toEqual({ kind: 'baseBranch', branch: 'main', tip: 'main.1' });
});

test('a layer on the head branch of the one below starts at its base branch', () => {
  // GitHub's own diff of #2 already starts there.
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b')];
  const stacks = expectForest(prs, ['main', '  #1', '    #2 base-branch']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'baseBranch', branch: 'a', tip: 'a.1' });
});

test('a layer of a GitHub stack starts at its base branch', () => {
  const prs = [pr(1, 'main', 'a').native(9, 1), pr(2, 'a', 'b').native(9, 2)];
  const stacks = expectForest(prs, ['main', '  #1', '    #2 native-stack']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'baseBranch', branch: 'a', tip: 'a.1' });
});

test('a layer holding the head of the one below starts at that head', () => {
  // #2 was cut from #1's head but targets main, so GitHub's diff of it shows #1's changes too.
  const prs = [
    pr(1, 'main', 'a').withCommits(['a.1', 'a.2']),
    pr(2, 'main', 'b').withCommits(['a.1', 'a.2', 'b.1']),
  ];
  const stacks = expectForest(prs, ['main', '  #1', '    #2 shared-commits']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'sharedCommits', below: 1, commit: 'a.2' });
});

test("a layer on a fork's pull request starts at that one's head, which it holds", () => {
  // A fork's branch is never a base, so #2's `t` is the base repository's own branch of that name,
  // not #1's, which doesn't hold #1's head.
  const prs = [
    pr(1, 'main', 't').fork().withCommits(['t.1']),
    pr(2, 't', 'u').withCommits(['t.1', 'u.1']).baseAt('t.0'),
  ];
  const stacks = expectForest(prs, ['main', '  #1', '    #2 shared-commits']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'sharedCommits', below: 1, commit: 't.1' });
});

test('a layer on a squash-merged one starts at its last commit the layer lists', () => {
  // #2 was cut from a.1; #1 then got a.2 and was squash-merged, so #2 sits on main, at the bottom.
  const prs = [
    pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false),
    pr(2, 'a', 'b').withCommits(['a.1', 'b.1']).baseAt('a.2'),
  ];
  const stacks = expectForest(prs, ['main', '  #2 base-branch needs-rebase(#1 a.1)']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'needsRebase', merged: 1, commit: 'a.1' });
});

test("a layer on a squash-merged one's branch starts at its base branch, which holds that one's head", () => {
  // #1 was squash-merged, and its branch kept: #2's commits, as GitHub lists a pull request's,
  // leave out #1's, which its base branch has, so GitHub's diff of #2 already leaves them out.
  const prs = [
    pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false),
    pr(2, 'a', 'b').withCommits(['b.1']).baseAt('a.2'),
  ];
  const stacks = expectForest(prs, ['main', '  #2 base-branch needs-rebase(#1 a.2)']);
  expect(layerStart(stacks, prs, 2)).toEqual({ kind: 'baseBranch', branch: 'a', tip: 'a.2' });
  // Nor does it start there when it lists that head too.
  const listing = [prs[0]!, pr(2, 'a', 'b').withCommits(['a.1', 'a.2', 'b.1']).baseAt('a.2')];
  expect(layerStart(stacks, listing, 2)).toEqual({ kind: 'baseBranch', branch: 'a', tip: 'a.2' });
});

test('a layer rebased since the forest was built starts at its base branch, not the merged one', () => {
  // #2 needed a rebase on squash-merged #1, then was rebased onto main: it no longer holds a.1, so
  // a diff from a.1 would show what main gained since as #2's own.
  const merged = pr(1, 'main', 'a').withCommits(['a.1', 'a.2']).merged(false);
  const before = pr(2, 'a', 'b').withCommits(['a.1', 'b.1']).baseAt('a.2');
  const stacks = expectForest([merged, before], ['main', '  #2 base-branch needs-rebase(#1 a.1)']);
  const rebased = pr(2, 'a', 'b').withCommits(['main.2', 'b.2']).baseAt('a.2');
  const base = { kind: 'baseBranch', branch: 'a', tip: 'a.2' };
  expect(layerStart(stacks, [merged, rebased], 2)).toEqual(base);
  // Nor does a layer the pull requests don't list start at the merged one.
  expect(layerStart(stacks, [merged], 2)).toEqual({ ...base, tip: undefined });
});

test('a layer that needs a rebase above an open one starts at the merged one, not the open one', () => {
  // #2 sat on #1 and was squash-merged into #1's branch, which deleted its own; #3 sat on #2.
  const prs = [
    pr(1, 'main', 'p'),
    pr(2, 'p', 'a').withCommits(['p.1', 'a.1']).merged(false),
    pr(3, 'a', 'b').withCommits(['p.1', 'a.1', 'b.1']).baseDeleted(),
  ];
  const stacks = expectForest(prs, ['main', '  #1', '    #3 shared-commits needs-rebase(#2 a.1)']);
  expect(layerStart(stacks, prs, 3)).toEqual({ kind: 'needsRebase', merged: 2, commit: 'a.1' });
});

test('a layer kept on its trunk starts at its base branch', () => {
  // A backport cut from a feature's branch shares its commits, but isn't a layer of it.
  const prs = [
    pr(1, 'main', 'feat'),
    pr(2, 'release', 'backport').withCommits(['feat.1', 'backport.1']),
  ];
  const stacks = expectTrunkForest(prs, ['main', 'release'], ['main', '  #1', 'release', '  #2']);
  expect(layerStart(stacks, prs, 2)).toEqual({
    kind: 'baseBranch',
    branch: 'release',
    tip: 'release.1',
  });
});

test("a layer starts at its base branch when the pull requests don't say what linked it", () => {
  const lower = pr(1, 'main', 'a');
  const upper = pr(2, 'main', 'b').withCommits(['a.1', 'b.1']);
  const stacks = expectForest([lower, upper], ['main', '  #1', '    #2 shared-commits']);
  const base = { kind: 'baseBranch', branch: 'main', tip: 'main.1' };
  // Read after the forest was built: #1 was pushed to since, so #2 no longer holds its head.
  expect(layerStart(stacks, [lower.withCommits(['a.1', 'a.2']), upper], 2)).toEqual(base);
  // Or #1 isn't among them.
  expect(layerStart(stacks, [upper], 2)).toEqual(base);
  // Nor #2 itself, so they don't say where its base branch is.
  expect(layerStart(stacks, [lower], 2)).toEqual({ ...base, tip: undefined });
});

test("a pull request that isn't a layer has no start", () => {
  const prs = [pr(1, 'main', 'a').merged(true), pr(2, 'main', 'b').closed(), pr(3, 'main', 'c')];
  const stacks = findStacks(prs, []);
  expect([1, 2, 4].map((number) => layerStart(stacks, prs, number))).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});
