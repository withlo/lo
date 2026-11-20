// What a merge takes with it, once Lo knows where the pull request sits, among stacks made up here
// on `main`, the only trunk: GitHub stack #90 of #10, #11 and #12, with GitHub's Stacks API's answer
// winning over Lo's list; a chain by base branch, #2 on main and #3 on #2, which stacks could make a
// GitHub stack unless the Stacks API isn't there; #5 on main with #6 and #7 on it, a tree too short
// to make one from #5; and #31 on the branch of #30, squash-merged, so it needs a rebase.

import type { GithubStack } from '@lo/github';
import { findStacks, planConversion, type PullRequest, type Stacks } from '@lo/stacks';
import { describe, expect, it } from 'vitest';

import type { Forest } from '../../stacks/service.ts';
import type { Together } from '../contract.ts';
import {
  layerState,
  namesOf,
  placementOf,
  takingOf,
  togetherChanged,
  togetherOf,
  type TakingView,
} from './together.ts';
import type { Where } from './where.ts';

/** An open pull request from `head` into `base`. */
function pull(
  number: number,
  base: string,
  head: string,
  more: Partial<PullRequest> = {},
): PullRequest {
  return {
    number,
    state: { kind: 'open' },
    baseRef: base,
    baseTip: undefined,
    headRef: head,
    headInBaseRepo: true,
    headOid: String(number).padStart(40, '0'),
    commits: [],
    createdAt: number,
    nativeStack: undefined,
    ...more,
  };
}

const SQUASHED = pull(30, 'main', 'm30', { state: { kind: 'merged', headInBase: false } });

const STACKS: Stacks = {
  ...findStacks(
    [
      pull(10, 'main', 's10', { nativeStack: { stack: 90, position: 1 } }),
      pull(11, 's10', 's11', { nativeStack: { stack: 90, position: 2 } }),
      pull(12, 's11', 's12', { nativeStack: { stack: 90, position: 3 } }),
      pull(2, 'main', 'c2'),
      pull(3, 'c2', 'c3'),
      pull(5, 'main', 't5'),
      pull(6, 't5', 't6'),
      pull(7, 't5', 't7'),
      SQUASHED,
      pull(31, 'm30', 'm31', { baseTip: SQUASHED.headOid, commits: [SQUASHED.headOid] }),
    ],
    ['main'],
  ),
  gaps: [],
};

/** The forest, its conversions planned by `@lo/stacks`, each reason in its kind's name. */
const FOREST: Pick<Forest, 'stacks' | 'conversion'> = {
  stacks: STACKS,
  conversion(number, facts) {
    const conversion = planConversion(STACKS, number, facts);
    return conversion.kind === 'plan'
      ? { ...conversion, offer: 'These PRs sit on each other’s branches.' }
      : { ...conversion, words: conversion.reasons.map((reason) => reason.kind) };
  },
};

/** A layer of a GitHub stack, as the Stacks API answers. */
function stacked(number: number, state = 'open', merged = false) {
  return {
    number,
    state,
    draft: false,
    merged_at: merged ? '2026-11-16T10:00:00Z' : undefined,
    head: { ref: `s${number}`, sha: String(number).padStart(40, 'f').toUpperCase() },
  };
}

/** GitHub stack #90, as the Stacks API answers, with these layers. */
function stack90(layers: ReturnType<typeof stacked>[]): GithubStack[] {
  return [
    { number: 90, node_id: 'S_90', base: { ref: 'main' }, open: true, pull_requests: layers },
  ];
}

function view(number: number, where: Where, more: Partial<TakingView> = {}): TakingView {
  return {
    number,
    where,
    forest: FOREST,
    github: [],
    title: (pr) => `Layer ${pr}`,
    state: (pr) =>
      pr === 10 ? { review: 'approved', checks: 'passing' } : { review: null, checks: null },
    queued: [],
    ...more,
  };
}

describe('a GitHub stack’s layer', () => {
  it('takes the open layers below it, as GitHub’s Stacks API names them, at their heads', () => {
    const github = stack90([stacked(10), stacked(11), stacked(12)]);
    const taking = takingOf(
      view(12, { kind: 'githubStack', stack: 90, below: [10, 11] }, { github }),
    );
    expect(taking).toEqual({
      kind: 'stack',
      stack: 90,
      below: [
        {
          number: 10,
          title: 'Layer 10',
          head: '10'.padStart(40, 'f'),
          review: 'approved',
          checks: 'passing',
        },
        { number: 11, title: 'Layer 11', head: '11'.padStart(40, 'f'), review: null, checks: null },
      ],
      above: [],
    });
    expect(togetherOf(taking)).toMatchObject({ kind: 'stack', stack: 90 });
    expect(placementOf(taking)).toEqual({ kind: 'stack', stack: 90, below: [10, 11] });

    // From the middle, the one above stays open, and moves onto main.
    expect(
      takingOf(view(11, { kind: 'githubStack', stack: 90, below: [10] }, { github })),
    ).toMatchObject({ kind: 'stack', below: [{ number: 10 }], above: [12] });
  });

  it('goes by what the Stacks API says over Lo’s list: a merged layer is left out', () => {
    const github = stack90([stacked(10, 'closed', true), stacked(11), stacked(12)]);
    expect(
      takingOf(view(12, { kind: 'githubStack', stack: 90, below: [10, 11] }, { github })),
    ).toMatchObject({ kind: 'stack', below: [{ number: 11 }] });
    // The bottom layer, as GitHub has it, merges alone.
    expect(
      takingOf(
        view(
          11,
          { kind: 'githubStack', stack: 90, below: [10] },
          { github: stack90([stacked(10, 'closed', true), stacked(11)]) },
        ),
      ),
    ).toEqual({ kind: 'alone' });
  });

  it('refuses when GitHub’s stack no longer holds it, or the Stacks API doesn’t answer', () => {
    const where: Where = { kind: 'githubStack', stack: 90, below: [10, 11] };
    expect(takingOf(view(12, where, { github: [] }))).toMatchObject({
      kind: 'refused',
      why: expect.stringContaining('GitHub stack #90 changed since Lo listed it.'),
    });
    expect(takingOf(view(12, where, { github: undefined }))).toMatchObject({
      kind: 'refused',
      why: expect.stringContaining('Merge it on GitHub.'),
    });
  });

  it('merges alone at the bottom', () => {
    expect(takingOf(view(10, { kind: 'githubStack', stack: 90, below: [] }))).toEqual({
      kind: 'alone',
    });
  });
});

describe('a chain that isn’t a GitHub stack', () => {
  it('is made one first, when stacks could make it one', () => {
    expect(takingOf(view(2, { kind: 'chainBottom' }))).toEqual({
      kind: 'convert',
      offer: 'These PRs sit on each other’s branches.',
    });
    expect(takingOf(view(3, { kind: 'chainAbove', bottom: 2 }))).toEqual({
      kind: 'convert',
      offer: 'These PRs sit on each other’s branches.',
    });
  });

  it('merges a layer at a time from its bottom one when it can’t, with each reason', () => {
    // Without the Stacks API, which answers 404.
    const taking = takingOf(view(2, { kind: 'chainBottom' }, { github: undefined }));
    expect(taking).toEqual({
      kind: 'chain',
      plan: {
        pr: 2,
        into: 'main',
        retargetBefore: undefined,
        retargetAfter: [{ pr: 3, from: 'c2', to: 'main' }],
        needsRebase: [3],
      },
      reasons: ['noStacksApi'],
    });
    expect(togetherOf(taking)).toEqual({
      kind: 'chain',
      before: null,
      after: [{ pr: 3, from: 'c2', to: 'main' }],
      needsRebase: [3],
    });
    expect(placementOf(taking)).toEqual({
      kind: 'chain',
      into: 'main',
      above: [3],
      reasons: ['noStacksApi'],
    });

    // A tree that forks right above its bottom layer is too short a path to be one.
    expect(takingOf(view(5, { kind: 'chainBottom' }))).toMatchObject({
      kind: 'chain',
      plan: { retargetAfter: [{ pr: 6 }, { pr: 7 }], needsRebase: [6, 7] },
      reasons: ['tooShort'],
    });
  });

  it('refuses above the bottom layer, and a bottom layer that needs a rebase', () => {
    expect(takingOf(view(3, { kind: 'chainAbove', bottom: 2 }, { queued: [2] }))).toEqual({
      kind: 'refused',
      why: 'Merge #2 first: it’s this chain’s bottom layer.',
    });
    expect(takingOf(view(31, { kind: 'chainBottom' }, { github: undefined }))).toEqual({
      kind: 'refused',
      why: 'Change #31’s base to main on GitHub, then merge it here.',
    });
  });

  it('waits for the Stacks API’s answer before it merges a layer at a time', () => {
    expect(takingOf(view(2, { kind: 'chainBottom' }, { github: 'unread' }))).toMatchObject({
      kind: 'refused',
    });
  });
});

describe('a layer’s state, as the stack’s layers were read', () => {
  it('is its review decision and how its checks stand together', () => {
    expect(
      layerState({ reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: { state: 'ERROR' } }),
    ).toEqual({ review: 'changesRequested', checks: 'failing' });
    expect(
      layerState({ reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: { state: 'EXPECTED' } }),
    ).toEqual({ review: 'reviewRequired', checks: 'running' });
    // Not read yet, or without checks.
    expect(layerState(undefined)).toEqual({ review: null, checks: null });
    expect(layerState({ reviewDecision: null, statusCheckRollup: null })).toEqual({
      review: null,
      checks: null,
    });
  });
});

describe('what a merge names', () => {
  const stack: Together = {
    kind: 'stack',
    stack: 90,
    below: [
      { number: 10, title: '', head: 'a'.repeat(40), review: null, checks: null },
      { number: 11, title: '', head: 'b'.repeat(40), review: null, checks: null },
    ],
    above: [13],
  };
  const chain: Together = {
    kind: 'chain',
    before: null,
    after: [{ pr: 6, from: 't5', to: 'main' }],
    needsRebase: [6, 7],
  };

  it('holds every pull request it changes', () => {
    expect(namesOf(12, null)).toEqual([12]);
    expect(namesOf(12, stack)).toEqual([12, 10, 11, 13]);
    expect(namesOf(5, chain)).toEqual([5, 6, 7]);
  });

  it('says what changed since the confirmation named it', () => {
    expect(togetherChanged(stack, stack)).toBeUndefined();
    expect(
      togetherChanged(stack, {
        ...stack,
        below: [
          stack.below[0]!,
          { number: 11, title: '', head: 'c'.repeat(40), review: null, checks: null },
        ],
      }),
    ).toBe('The layers that merge with it changed.');
    expect(togetherChanged(stack, { ...stack, above: [] })).toBe('The layers above it changed.');
    expect(togetherChanged(null, stack)).toBe('The layers that merge with it changed.');
    expect(togetherChanged(chain, { ...chain, needsRebase: [6] })).toBe(
      'The base branches Lo moves changed.',
    );
  });
});
