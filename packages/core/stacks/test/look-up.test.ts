/** Which merged pull requests the caller still has to read: those from the branches open ones sit on. */

import { expect, test } from 'vitest';

import { branchesToLookUp } from '../src/stacks.ts';
import { pr } from './support.ts';

test('lists base branches no pr comes from', () => {
  const prs = [pr(1, 'b', 'c'), pr(2, 'a', 'd'), pr(3, 'a', 'e'), pr(4, 'main', 'f')];

  expect(branchesToLookUp(prs, ['main'])).toEqual(['a', 'b']);
});

test('skips branches an open or merged pr comes from', () => {
  const prs = [
    pr(1, 'main', 'a'),
    pr(2, 'a', 'b'),
    pr(3, 'main', 'x').merged(false),
    pr(4, 'x', 'y'),
  ];

  expect(branchesToLookUp(prs, ['main'])).toEqual([]);
});

test('still lists branches only a closed or fork pr comes from', () => {
  const prs = [
    pr(1, 'main', 'a').closed(),
    pr(2, 'a', 'b'),
    pr(3, 'main', 'x').fork(),
    pr(4, 'x', 'y'),
  ];

  expect(branchesToLookUp(prs, ['main'])).toEqual(['a', 'x']);
});

test('follows merged prs down to a trunk', () => {
  // #3 sits on #2, which was merged into `a`.
  const prs = [pr(2, 'a', 'b').merged(false), pr(3, 'b', 'c')];
  expect(branchesToLookUp(prs, ['main'])).toEqual(['a']);
  expect(branchesToLookUp([...prs, pr(1, 'main', 'a').merged(false)], ['main'])).toEqual([]);
});

test('ignores merged prs no open pr sits on', () => {
  const prs = [pr(1, 'release-1', 'x').merged(true), pr(2, 'main', 'y')];

  expect(branchesToLookUp(prs, ['main'])).toEqual([]);
});
