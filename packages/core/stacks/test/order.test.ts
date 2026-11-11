/** The forest doesn't depend on the order pull requests are passed in. */

import { expect, test } from 'vitest';

import { findStacks, layerOf, type PullRequest } from '../src/stacks.ts';
import { pr } from './support.ts';

/** Pull requests that exercise every rule, the tie-breaks between equally good matches, and cycles. */
function tangledRepo(): PullRequest[] {
  return [
    // A deploy pull request from a trunk, which nothing sits on.
    pr(1, 'production', 'main'),
    // A base-branch chain with two children created at the same time.
    pr(2, 'main', 'a'),
    pr(3, 'a', 'b').created(50),
    pr(4, 'a', 'c').created(50),
    // Two open pull requests from one branch, with the same head commit, and a layer on each tie.
    pr(5, 'main', 'd').created(60),
    pr(6, 'release', 'd').created(60),
    pr(7, 'd', 'e'),
    pr(8, 'main', 'f').withCommits(['d.1', 'f.1']),
    // Squash-merged layers that list each other's commits, and a layer cut from the lower.
    pr(9, 'main', 'g').withCommits(['g.1', 'g.2']).merged(false),
    pr(10, 'main', 'h').withCommits(['g.1', 'g.2', 'h.1']).merged(false),
    pr(11, 'main', 'i').withCommits(['g.1', 'i.1']),
    // A GitHub stack with a closed middle layer.
    pr(12, 'main', 'j').native(500, 1),
    pr(13, 'j', 'k').native(500, 2).closed(),
    pr(14, 'k', 'l').native(500, 3),
    // Cycles: two open pull requests, three open ones, and one through a merged one.
    pr(15, 'n', 'm').created(90),
    pr(16, 'm', 'n').created(80),
    pr(17, 'q', 'o'),
    pr(18, 'o', 'p'),
    pr(19, 'p', 'q'),
    pr(20, 's', 'r').merged(false),
    pr(21, 'r', 's'),
    // A fork's pull request, and a layer whose base is a fork branch's name.
    pr(22, 'main', 't').fork().withCommits(['t.1']),
    pr(23, 't', 'u').withCommits(['t.1', 'u.1']),
    // A duplicate number: the open copy wins wherever it's passed.
    pr(24, 'main', 'v').closed(),
    pr(24, 'main', 'v'),
  ];
}

/** `prs`, shuffled by a seeded linear congruential generator, so runs repeat. */
function shuffled(prs: readonly PullRequest[], seed: number): PullRequest[] {
  const out = [...prs];
  const mask = (1n << 64n) - 1n;
  let state = BigInt(seed);
  for (let i = out.length - 1; i >= 1; i--) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & mask;
    const j = Number((state >> 33n) % BigInt(i + 1));
    const [first, second] = [out[i], out[j]];
    if (first === undefined || second === undefined) throw new Error('shuffled past the end');
    [out[i], out[j]] = [second, first];
  }
  return out;
}

test('the forest is the same in any input order', () => {
  const prs = tangledRepo();
  const trunks = ['main', 'production'];
  const expected = findStacks(prs, trunks);
  expect(expected.cycles).toHaveLength(3);
  expect(layerOf(expected, 4)?.depth).toBe(1);
  expect(layerOf(expected, 24)).toBeDefined();

  const differing = Array.from({ length: 200 }, (_, seed) => seed).filter(
    (seed) => JSON.stringify(findStacks(shuffled(prs, seed), trunks)) !== JSON.stringify(expected),
  );
  expect(differing).toEqual([]);
});
