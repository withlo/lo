/** When "Make this a GitHub stack" isn't offered, and the reasons it gives. */

import { expect, test } from 'vitest';

import { planConversion, type Facts } from '../src/convert.ts';
import { findStacks, type PullRequest } from '../src/stacks.ts';
import { pr } from './support.ts';

/** The path converted, or the reasons it isn't offered. */
function planWith(prs: readonly PullRequest[], layer: number, facts: Facts) {
  const conversion = planConversion(findStacks(prs, []), layer, facts);
  return conversion.kind === 'plan' ? { path: conversion.plan.path } : conversion.reasons;
}

const OFFERED: Facts = { stacksApi: true, queued: [] };

test('not offered without the stacks api', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b')];

  expect(planWith(prs, 2, { ...OFFERED, stacksApi: false })).toEqual([{ kind: 'noStacksApi' }]);
});

test('not offered with a pr from a fork at the bottom', () => {
  // A fork's branch can't be a base, so #2 sits on #1 by shared commits.
  const prs = [
    pr(1, 'main', 'feature').fork().withCommits(['f.1']),
    pr(2, 'main', 'more').withCommits(['f.1', 'm.1']),
  ];

  expect(planWith(prs, 2, OFFERED)).toEqual([{ kind: 'fromFork', pr: 1 }]);
});

test('not offered with a pr from a fork at the top', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b').fork()];

  expect(planWith(prs, 1, OFFERED)).toEqual([{ kind: 'fromFork', pr: 2 }]);
});

test('not offered with a pr in a merge queue', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')];

  expect(planWith(prs, 3, { ...OFFERED, queued: [2] })).toEqual([{ kind: 'queued', pr: 2 }]);
});

test('prs off the path dont matter', () => {
  // #3, a fork's pull request in the queue, is on another branch of the tree.
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'a', 'c').fork()];

  expect(planWith(prs, 2, { ...OFFERED, queued: [3] })).toEqual({ path: [1, 2] });
});

test('every reason is listed bottom to top', () => {
  const prs = [
    pr(1, 'main', 'feature').fork().withCommits(['f.1']),
    pr(2, 'main', 'b').withCommits(['f.1', 'b.1']),
    pr(3, 'b', 'c').fork(),
  ];

  expect(planWith(prs, 1, { stacksApi: false, queued: [3, 2] })).toEqual([
    { kind: 'noStacksApi' },
    { kind: 'fromFork', pr: 1 },
    { kind: 'queued', pr: 2 },
    { kind: 'fromFork', pr: 3 },
    { kind: 'queued', pr: 3 },
  ]);
});

test('a short path lists its other reasons too', () => {
  expect(planWith([pr(1, 'main', 'a')], 1, { stacksApi: false, queued: [1] })).toEqual([
    { kind: 'noStacksApi' },
    { kind: 'tooShort' },
    { kind: 'queued', pr: 1 },
  ]);
});

test('a pr that isnt a layer gives only that reason', () => {
  expect(planWith([pr(1, 'main', 'a')], 9, { stacksApi: false, queued: [9] })).toEqual([
    { kind: 'notOpen' },
  ]);
});
