/** Putting base branches back after a conversion fails partway. */

import { expect, test } from 'vitest';

import { rollback, type Plan } from '../src/convert.ts';
import { expectPlan, pr, renderRetarget } from './support.ts';

/** The base-branch changes that put back the first `done` steps of `plan`. */
function putBack(plan: Plan, done: number): string[] {
  return rollback(plan, done).steps.map(renderRetarget);
}

/** A plan that moves two layers, then creates the stack. */
function movesTwoThenCreates(): Plan {
  return expectPlan(
    [
      pr(1, 'main', 'a').withCommits(['a.1']),
      pr(2, 'main', 'b').withCommits(['a.1', 'b.1']),
      pr(3, 'main', 'c').withCommits(['a.1', 'b.1', 'c.1']),
    ],
    3,
    ['main: #1 #2 #3', '#2 main -> a', '#3 main -> b', 'create #1 #2 #3'],
  );
}

test('after each failing step the base branches changed go back last first', () => {
  const plan = movesTwoThenCreates();
  // The first base-branch change failed.
  expect(putBack(plan, 0)).toEqual([]);
  // The second failed.
  expect(putBack(plan, 1)).toEqual(['#2 a -> main']);
  // Creating the stack failed.
  expect(putBack(plan, 2)).toEqual(['#3 b -> main', '#2 a -> main']);
  for (const done of [0, 1, 2]) {
    expect(rollback(plan, done).kept).toBeUndefined();
  }
});

test('a created stack is kept and can be unstacked', () => {
  const undone = rollback(movesTwoThenCreates(), 3);

  expect(undone.kept).toEqual({ kind: 'created', prs: [1, 2, 3] });
  expect(undone.steps.map(renderRetarget)).toEqual(['#3 b -> main', '#2 a -> main']);
});

test('layers added to a github stack are kept', () => {
  const plan = expectPlan(
    [
      pr(1, 'main', 'a').native(100, 1),
      pr(2, 'a', 'b').native(100, 2),
      pr(3, 'main', 'c').withCommits(['b.1', 'c.1']),
    ],
    3,
    ['main: #1 #2 #3', '#3 main -> b', 'add #3 to stack 100'],
  );
  // Moving #3 failed.
  expect(putBack(plan, 0)).toEqual([]);
  // Adding it failed.
  expect(putBack(plan, 1)).toEqual(['#3 b -> main']);
  expect(rollback(plan, 1).kept).toBeUndefined();
  // Everything ran.
  expect(putBack(plan, 2)).toEqual(['#3 b -> main']);
  expect(rollback(plan, 2).kept).toEqual({ kind: 'added', stack: 100, prs: [3] });
});

test('a plan that moves nothing has nothing to put back', () => {
  const plan = expectPlan([pr(1, 'main', 'a'), pr(2, 'a', 'b')], 2, [
    'main: #1 #2',
    'create #1 #2',
  ]);

  expect(putBack(plan, 0)).toEqual([]);
  expect(rollback(plan, 0).kept).toBeUndefined();
  expect(putBack(plan, 1)).toEqual([]);
  expect(rollback(plan, 1).kept).toEqual({ kind: 'created', prs: [1, 2] });
});

test('more steps done than the plan has counts as all of them', () => {
  const plan = movesTwoThenCreates();

  expect(rollback(plan, 99)).toEqual(rollback(plan, 3));
});
