/**
 * "Make this a GitHub stack": which layers it converts, and the base-branch changes and stack that
 * convert them.
 */

import { expect, test } from 'vitest';

import { expectPlan, plan, pr, reasons } from './support.ts';

test('the path runs from the bottom layer through the layer to the top', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c'), pr(4, 'c', 'd')];
  for (const layer of [1, 2, 3, 4]) {
    expectPlan(prs, layer, ['main: #1 #2 #3 #4', 'create #1 #2 #3 #4']);
  }
});

test('a fork in the tree ends the path above the layer', () => {
  // #2 has two layers on it.
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c'), pr(4, 'b', 'd')];
  expectPlan(prs, 1, ['main: #1 #2', 'create #1 #2']);
  expectPlan(prs, 2, ['main: #1 #2', 'create #1 #2']);
  expectPlan(prs, 3, ['main: #1 #2 #3', 'create #1 #2 #3']);
  expectPlan(prs, 4, ['main: #1 #2 #4', 'create #1 #2 #4']);
});

test('a fork below the layer doesnt end the path', () => {
  // #1 has two layers on it; the path through #4 passes one of them.
  const prs = [
    pr(1, 'main', 'a'),
    pr(2, 'a', 'b'),
    pr(3, 'a', 'c'),
    pr(4, 'b', 'd'),
    pr(5, 'd', 'e'),
  ];
  expectPlan(prs, 4, ['main: #1 #2 #4 #5', 'create #1 #2 #4 #5']);
});

test('layers found by shared commits move onto the branch below', () => {
  expectPlan(
    [
      pr(1, 'main', 'a').withCommits(['a.1']),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
      pr(3, 'main', 'c').withCommits(['a.1', 'b.1', 'c.1']),
    ],
    3,
    ['main: #1 #2 #3', '#2 main -> a', '#3 main -> b', 'create #1 #2 #3'],
  );
});

test('base branches change bottom to top whatever the numbers', () => {
  expectPlan(
    [
      pr(9, 'main', 'a').withCommits(['a.1']),
      pr(4, 'main', 'b').withCommits(['a.1', 'b.1']).created(10),
      pr(7, 'main', 'c').withCommits(['a.1', 'b.1', 'c.1']),
    ],
    9,
    ['main: #9 #4 #7', '#4 main -> a', '#7 main -> b', 'create #9 #4 #7'],
  );
});

test('only the layers off the branch below move', () => {
  expectPlan(
    [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'main', 'c').withCommits(['b.1', 'c.1'])],
    1,
    ['main: #1 #2 #3', '#3 main -> b', 'create #1 #2 #3'],
  );
});

test('a bottom layer on a merged pr moves to the root', () => {
  // #1 was squash-merged into main, and its branch kept.
  expectPlan([pr(1, 'main', 'a').merged(false), pr(2, 'a', 'b'), pr(3, 'b', 'c')], 2, [
    'main: #2 #3',
    '#2 a -> main',
    'create #2 #3',
  ]);
});

test('a chain on a branch no pr comes from stacks on that branch', () => {
  expectPlan([pr(1, 'feature-x', 'a'), pr(2, 'a', 'b')], 2, ['feature-x: #1 #2', 'create #1 #2']);
});

test('a pr that isnt a layer has nothing to convert', () => {
  const prs = [
    pr(1, 'main', 'a').merged(false),
    pr(2, 'a', 'b'),
    pr(3, 'b', 'c'),
    pr(4, 'main', 'd').closed(),
  ];
  for (const layer of [1, 4, 99]) {
    expect(reasons(plan(prs, layer))).toEqual([{ kind: 'notOpen' }]);
  }
});

test('a lone pr is too short to stack', () => {
  expect(reasons(plan([pr(1, 'main', 'a')], 1))).toEqual([{ kind: 'tooShort' }]);
});

test('a bottom layer where the tree forks is too short to stack', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'a', 'c')];
  expect(reasons(plan(prs, 1))).toEqual([{ kind: 'tooShort' }]);
});
