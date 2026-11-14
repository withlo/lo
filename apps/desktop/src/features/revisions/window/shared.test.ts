// How another feature reads what a pull request's tab compares and what's coming, compares
// another pair, the last asked for winning, and how a place in the tab's history names a
// comparison, to compare it again on going back.

import { describe, expect, it, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import type { ComparisonView } from '../contract.ts';
import {
  comparedIn,
  comparisonComing,
  comparisonName,
  comparisonNamed,
  compareTo,
  sameCompared,
} from './shared.ts';
import { views } from './store.ts';

/** Main's answers to each comparison asked for, which the test gives when it likes. */
const answers: (() => void)[] = [];
vi.mock('./main.ts', () => ({
  main: () => ({
    compare: () =>
      new Promise<void>((resolve) => {
        answers.push(resolve);
      }),
  }),
}));

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

describe('comparing another pair', () => {
  const whole = { from: null, to: HEAD };
  const first = { from: null, to: FIRST };

  it('is coming as soon as it’s asked for, and asking for what’s on screen calls it off', async () => {
    views.set('asking', view({ id: 'asking', comparison: whole }));
    expect(compareTo('asking', whole, 'Show the thread')).toBe('now');
    expect(compareTo('asking', first, 'Show the thread')).toBe('coming');
    // Before main says so.
    expect(comparisonComing('asking')).toEqual(first);
    expect(compareTo('asking', first, 'Show the thread')).toBe('coming');
    expect(compareTo('asking', whole, 'Show the thread')).toBe('now');
    expect(comparisonComing('asking')).toBeUndefined();
    // Main took both; what it says from then on is what's coming.
    for (const answer of answers.splice(0)) answer();
    await Promise.resolve();
    views.set('asking', view({ id: 'asking', comparison: whole, pending: first }));
    expect(comparisonComing('asking')).toEqual(first);
  });

  it('says so as it’s asked for, and takes it back once it’s called off', () => {
    views.set('saying', view({ id: 'saying', comparison: whole }));
    const say = { title: 'Comparing base → r1', body: 'This thread is on r1.' };
    expect(compareTo('saying', first, 'Show the thread', say)).toBe('coming');
    expect(notice()).toMatchObject(say);
    // Asked for again, it stands.
    expect(compareTo('saying', first, 'Back')).toBe('coming');
    expect(notice()).toMatchObject(say);
    expect(compareTo('saying', whole, 'Back')).toBe('now');
    expect(notice()).toBeUndefined();
  });

  it('can’t be before the revisions are read', () => {
    expect(compareTo('unread', first, 'Show the thread')).toEqual({
      why: 'Lo hasn’t read the pull request’s revisions yet.',
    });
  });
});
