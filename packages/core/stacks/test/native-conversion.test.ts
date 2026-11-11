/** Converting a path that's already a GitHub stack, or starts as one. */

import { expect, test } from 'vitest';

import { expectPlan, plan, pr, reasons } from './support.ts';

test('a github stack has nothing to convert', () => {
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'b', 'c').native(100, 3),
  ];
  for (const layer of [1, 2, 3]) {
    expect(reasons(plan(prs, layer))).toEqual([{ kind: 'alreadyStacked', stack: 100 }]);
  }
});

test('a path ending inside a github stack has nothing to convert', () => {
  // #2 has two layers on it, so the path through it ends there.
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'b', 'c').native(100, 3),
    pr(4, 'b', 'd'),
  ];
  expect(reasons(plan(prs, 2))).toEqual([{ kind: 'alreadyStacked', stack: 100 }]);
});

test('the last open layer of a github stack has nothing to convert', () => {
  // GitHub merged the two layers below #3.
  const prs = [pr(3, 'main', 'c').native(100, 3)];
  expect(reasons(plan(prs, 3))).toEqual([{ kind: 'alreadyStacked', stack: 100 }]);
});

test('layers on a github stack are added to it', () => {
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'b', 'c'),
    pr(4, 'main', 'd').withCommits(['c.1', 'd.1']),
  ];
  for (const layer of [1, 2, 3, 4]) {
    expectPlan(prs, layer, ['main: #1 #2 #3 #4', '#4 main -> c', 'add #3 #4 to stack 100']);
  }
});

test('the first added layer moves onto the stacks top', () => {
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'main', 'c').withCommits(['b.1', 'c.1']),
  ];
  expectPlan(prs, 3, ['main: #1 #2 #3', '#3 main -> b', 'add #3 to stack 100']);
});

test('a github stack whose bottom merged still takes layers', () => {
  // GitHub merged #1 and pointed #2 at main.
  const prs = [
    pr(1, 'main', 'a').native(100, 1).merged(false),
    pr(2, 'main', 'b').native(100, 2),
    pr(3, 'b', 'c'),
  ];
  expectPlan(prs, 3, ['main: #2 #3', 'add #3 to stack 100']);
});

test('layers already in the stack keep their base branches', () => {
  // #2 was closed but is still in the stack, and #3 still targets its branch. A layer `findStacks`
  // found would move #3 onto #1's branch; a GitHub stack's own layers are left alone.
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2).closed(),
    pr(3, 'b', 'c').native(100, 3),
    pr(4, 'c', 'd'),
  ];
  expectPlan(prs, 4, ['main: #1 #3 #4', 'add #4 to stack 100']);
  expect(reasons(plan(prs.slice(0, 3), 3))).toEqual([{ kind: 'alreadyStacked', stack: 100 }]);
});

test('not offered with a github stack above the bottom layer', () => {
  // #2 and #3 are a GitHub stack on #1's branch. A pull request can be in only one stack.
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b').native(200, 1), pr(3, 'b', 'c').native(200, 2)];
  expect(reasons(plan(prs, 1))).toEqual([
    { kind: 'inAnotherStack', pr: 2, stack: 200 },
    { kind: 'inAnotherStack', pr: 3, stack: 200 },
  ]);
});

test('not offered with a second github stack on the first', () => {
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'b', 'c').native(200, 1),
    pr(4, 'c', 'd'),
  ];
  expect(reasons(plan(prs, 4))).toEqual([{ kind: 'inAnotherStack', pr: 3, stack: 200 }]);
});

test('not offered when the github stack goes on off the path', () => {
  // #2 has two layers on it: #3, the stack's next layer, and #4. Layers join a stack at its top.
  const prs = [
    pr(1, 'main', 'a').native(100, 1),
    pr(2, 'a', 'b').native(100, 2),
    pr(3, 'b', 'c').native(100, 3),
    pr(4, 'b', 'd'),
    pr(5, 'd', 'e'),
  ];
  expect(reasons(plan(prs, 4))).toEqual([{ kind: 'stackGoesOn', stack: 100, past: 2 }]);
});
