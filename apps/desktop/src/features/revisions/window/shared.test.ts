// How another feature reads what a pull request's tab compares, and how a place in the tab's
// history names it, to compare it again on going back.

import { describe, expect, it } from 'vitest';

import type { ComparisonView } from '../contract.ts';
import { comparedIn, comparisonName, comparisonNamed, sameCompared } from './shared.ts';

const FIRST = 'f'.repeat(40);
const HEAD = 'h'.repeat(40);

function view(overrides: Partial<ComparisonView> = {}): ComparisonView {
  return {
    id: 'tab',
    status: 'ready',
    revisions: [],
    base: null,
    markers: { review: null, lastSeen: null },
    shown: HEAD,
    comparison: null,
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
    ...overrides,
  };
}

describe('what a tab compares', () => {
  it('is the comparison on screen, or the whole pull request at the head shown', () => {
    expect(comparedIn(view())).toEqual({ from: null, to: HEAD });
    const between = { from: FIRST, to: HEAD };
    expect(comparedIn(view({ comparison: between, pending: { from: null, to: FIRST } }))).toEqual(
      between,
    );
    expect(comparedIn(view({ shown: null }))).toBeUndefined();
    expect(comparedIn(undefined)).toBeUndefined();
  });

  it('is named for the history, and the name compares it again', () => {
    const shown = view();
    for (const compared of [
      { from: null, to: HEAD },
      { from: null, to: FIRST },
      { from: FIRST, to: HEAD },
    ]) {
      expect(comparisonNamed(shown, comparisonName(shown, compared))).toEqual(compared);
    }
    // The whole pull request is whichever head is shown when it's compared again.
    expect(comparisonName(shown, { from: null, to: HEAD })).toBe('whole');
    expect(comparisonNamed(view({ shown: FIRST }), 'whole')).toEqual({ from: null, to: FIRST });
    expect(comparisonNamed(shown, 'nothing')).toBeUndefined();
  });

  it('is the same as another with the same two ends', () => {
    expect(sameCompared({ from: null, to: HEAD }, { from: null, to: HEAD })).toBe(true);
    expect(sameCompared({ from: FIRST, to: HEAD }, { from: null, to: HEAD })).toBe(false);
    expect(sameCompared(undefined, { from: null, to: HEAD })).toBe(false);
  });
});
