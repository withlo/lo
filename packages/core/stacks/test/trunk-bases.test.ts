/** Lo never moves a pull request off a trunk, such as a protected release branch. */

import { expect, test } from 'vitest';

import { planConversion } from '../src/convert.ts';
import { mergeOneLayerAtATime } from '../src/merge.ts';
import { findStacks, layerOf, type Stacks } from '../src/stacks.ts';
import { expectTrunkForest, pr } from './support.ts';

const OFFERED = { stacksApi: true, queued: [] };

/** A feature into `main`, and a backport of it into the protected `release`, cut from its branch. */
const BACKPORT = [
  pr(1, 'main', 'feat'),
  pr(2, 'release', 'backport').withCommits(['feat.1', 'backport.1']),
];

test('a backport into a protected branch sits on it, not on the feature it shares commits with', () => {
  const stacks = expectTrunkForest(
    BACKPORT,
    ['main', 'release'],
    ['main', '  #1', 'release', '  #2'],
  );
  const backport = layerOf(stacks, 2);
  expect(backport?.onTrunk).toBe(true);
  expect([backport?.rule, backport?.retargetTo]).toEqual([undefined, undefined]);
});

test('without the trunk the backport is a layer of the feature', () => {
  // As before: nothing says `release` is long-lived.
  expectTrunkForest(BACKPORT, ['main'], ['main', '  #1', '    #2 shared-commits']);
});

test('merging the feature leaves the backport where it is', () => {
  const merge = mergeOneLayerAtATime(findStacks(BACKPORT, ['main', 'release']), 1);
  expect(merge).toEqual({
    pr: 1,
    into: 'main',
    retargetBefore: undefined,
    retargetAfter: [],
    needsRebase: [],
  });
});

test('converting the backport moves nothing', () => {
  const conversion = planConversion(findStacks(BACKPORT, ['main', 'release']), 2, OFFERED);
  expect(conversion).toEqual({ kind: 'notOffered', reasons: [{ kind: 'tooShort' }] });
});

test('a layer into the stacks own trunk still moves onto the layer below', () => {
  // #2 targets `main` but was cut from #1's branch: the usual layer not yet based on the one below.
  const prs = [pr(1, 'main', 'a'), pr(2, 'main', 'b').withCommits(['a.1', 'b.1'])];
  const stacks = expectTrunkForest(prs, ['main'], ['main', '  #1', '    #2 shared-commits']);
  expect(layerOf(stacks, 2)?.retargetTo).toBe('a');
});

test('a backport on a squash merged feature stays on its trunk', () => {
  // The feature merged into `main`; a layer on it would move to `main`.
  const prs = [
    pr(1, 'main', 'feat').withCommits(['f.1', 'f.2']).merged(false),
    pr(2, 'release', 'backport').withCommits(['f.2', 'backport.1']),
    pr(3, 'feat', 'more').withCommits(['f.2', 'more.1']),
  ];
  const stacks = expectTrunkForest(
    prs,
    ['main', 'release'],
    ['main', '  #3 shared-commits needs-rebase(#1 f.2)', 'release', '  #2'],
  );
  expect(layerOf(stacks, 3)?.retargetTo).toBe('main');
  expect(layerOf(stacks, 2)?.retargetTo).toBeUndefined();
});

test('layers on a backport go with it to its trunk', () => {
  const prs = [...BACKPORT, pr(3, 'backport', 'fixup')];
  expectTrunkForest(
    prs,
    ['main', 'release'],
    ['main', '  #1', 'release', '  #2', '    #3 base-branch'],
  );
});

test('neither plan moves a layer off a trunk other than its root', () => {
  // Stacks no read gives: #2, into the protected `release`, on #1's stack rooted at `main`.
  const found = findStacks([pr(1, 'main', 'a'), pr(2, 'a', 'b')], ['main']);
  const two = layerOf(found, 2);
  if (!two) throw new Error('#2 is a layer');
  const stacks: Stacks = {
    ...found,
    layers: { ...found.layers, 2: { ...two, baseRef: 'release', onTrunk: true, retargetTo: 'a' } },
  };
  expect(mergeOneLayerAtATime(stacks, 1)).toMatchObject({ retargetAfter: [], needsRebase: [] });
  expect(planConversion(stacks, 1, OFFERED)).toEqual({
    kind: 'notOffered',
    reasons: [{ kind: 'onTrunk', pr: 2, base: 'release' }],
  });
});
