/** Finding stacks stays fast on a busy repository. */

import { expect, test } from 'vitest';

import { findStacks, layerOf, stackOf, type PullRequest } from '../src/stacks.ts';
import { pr } from './support.ts';

/**
 * How long finding the stacks may take, in milliseconds: three times the slower of the two on a
 * Linux CI runner, 40 ms for the long merged chain. Faster machines pass easily.
 */
const LIMIT = 125;

const STACKS = 250;
const LAYERS = 4;
/**
 * Each layer's own commits. With the head of the layer below, that's what `commits(last: 100)`
 * lists, so shared commits only find the layer below after checking every other commit.
 */
const COMMITS_PER_LAYER = 99;
const COMMITS_LISTED = 100;

/** A commit SHA, 40 hex digits like a real one, made from a pull request's number and a commit's. */
function oid(number: number, commit: number): string {
  const mask = (1n << 64n) - 1n;
  const seed = (((BigInt(number) << 16n) | BigInt(commit)) * 0x9e3779b97f4a7c15n) & mask;
  const rotated = ((seed << 17n) | (seed >> 47n)) & mask;
  return `${seed.toString(16).padStart(16, '0')}${rotated.toString(16).padStart(24, '0')}`;
}

/**
 * 1,000 pull requests in 250 four-layer stacks, linked by each rule in turn, each listing up to 100
 * commits. Every 25th stack's bottom layer was squash-merged.
 */
function busyRepo(): PullRequest[] {
  const prs: PullRequest[] = [];
  for (let stack = 0; stack < STACKS; stack++) {
    const commits: string[] = [];
    for (let layer = 0; layer < LAYERS; layer++) {
      const number = stack * LAYERS + layer + 1;
      // The shared-commits rule links a layer of every third stack: it targets main, and only its
      // commits say what's below.
      const onLayerBelow = layer > 0 && stack % 3 !== 1;
      const base = onLayerBelow ? `s${stack}-l${layer - 1}` : 'main';
      const belowHead = commits.at(-1);
      for (let commit = 0; commit < COMMITS_PER_LAYER; commit++) commits.push(oid(number, commit));
      let built = pr(number, base, `s${stack}-l${layer}`).withCommits(
        commits.slice(-COMMITS_LISTED),
      );
      if (belowHead !== undefined && onLayerBelow) built = built.baseAt(belowHead);
      if (stack % 3 === 2) built = built.native(100_000 + stack, layer + 1);
      if (layer === 0 && stack % 25 === 0) built = built.merged(false);
      prs.push(built);
    }
  }
  return prs;
}

/** How long `find` took, in milliseconds, and what it gave. */
function timed<T>(find: () => T): { found: T; elapsed: number } {
  const start = performance.now();
  const found = find();
  return { found, elapsed: performance.now() - start };
}

test('finds stacks among 1000 prs within budget', () => {
  const prs = busyRepo();
  expect(prs).toHaveLength(1000);
  const merged = prs.filter((built) => built.state.kind !== 'open').length;
  expect(merged).toBe(10);

  const { found: stacks, elapsed } = timed(() => findStacks(prs, []));

  // Every open pull request is placed, and the stacks are the ones built.
  const layers = stacks.roots
    .flatMap((root) => root.stacks)
    .reduce((sum, stack) => sum + stack.layers.length, 0);
  expect(layers).toBe(1000 - merged);
  expect(stacks.cycles).toEqual([]);
  expect(stackOf(stacks, 8)?.layers).toEqual([5, 6, 7, 8]);
  expect(layerOf(stacks, 8)?.rule).toBe('sharedCommits');
  expect(layerOf(stacks, 12)?.rule).toBe('nativeStack');
  expect(layerOf(stacks, 4)?.rule).toBe('baseBranch');
  expect(stackOf(stacks, 2)?.layers).toEqual([2, 3, 4]);
  expect(layerOf(stacks, 2)?.needsRebase).toBeDefined();

  expect(elapsed, `took ${elapsed} ms to find stacks among 1,000 pull requests`).toBeLessThan(
    LIMIT,
  );
});

test('walks a long merged chain within budget', () => {
  // 5,000 squash-merged pull requests, each stacked on the one before by commits, and 1,000 open
  // ones on the last.
  const MERGED = 5000;
  const OPEN = 1000;
  const prs: PullRequest[] = [];
  const commits: string[] = [];
  for (let number = 1; number <= MERGED; number++) {
    commits.push(`m${number}`);
    prs.push(
      pr(number, 'main', `m${number}`).withCommits(commits.slice(-COMMITS_LISTED)).merged(false),
    );
  }
  const top = `m${MERGED}`;
  for (let number = MERGED + 1; number <= MERGED + OPEN; number++) {
    const head = `o${number}`;
    prs.push(pr(number, 'main', head).withCommits([top, head]));
  }

  const { found: stacks, elapsed } = timed(() => findStacks(prs, ['main']));

  const root = stacks.roots[0];
  expect(root?.branch).toBe('main');
  expect(root?.stacks).toHaveLength(OPEN);
  const layer = layerOf(stacks, MERGED + 1);
  expect(layer?.parent).toEqual({ kind: 'branch', branch: 'main' });
  expect(layer?.needsRebase).toEqual({ merged: MERGED, compareAgainst: top });
  expect(elapsed, `took ${elapsed} ms to walk ${MERGED} merged pull requests`).toBeLessThan(LIMIT);
});
