// What a pull request's tab opens on, and its bound: the overview once it's known to show, the diff
// once it's known not to or Settings says so, and the diff when nothing is known by the bound.

import { describe, expect, it } from 'vitest';

import { HOLD_LIMIT } from '../../revisions/contract.ts';
import { offered, openingOf, type Opened } from './opening.ts';

describe('what a tab opens on', () => {
  it('waits while nothing is known, up to the bound', () => {
    expect(HOLD_LIMIT).toBe(1_000);
    expect(openingOf('overview', 'unknown', 0)).toBe('waiting');
    expect(openingOf('overview', 'unknown', HOLD_LIMIT - 1)).toBe('waiting');
  });

  it('opens on the diff at the bound, whatever is still to come', () => {
    expect(openingOf('overview', 'unknown', HOLD_LIMIT)).toBe('diff');
    expect(openingOf('overview', 'unknown', HOLD_LIMIT * 60)).toBe('diff');
  });

  it('opens on the overview as soon as it’s known to show, within the bound', () => {
    expect(openingOf('overview', 'shown', 0)).toBe('overview');
    expect(openingOf('overview', 'shown', HOLD_LIMIT - 1)).toBe('overview');
  });

  it('opens on the diff as soon as there’s no overview to show', () => {
    expect(openingOf('overview', 'other', 0)).toBe('diff');
  });

  it('opens on the diff at once when Settings says so, overview or not', () => {
    for (const known of ['unknown', 'shown', 'other'] as const) {
      expect(openingOf('diff', known, 0)).toBe('diff');
    }
  });

  it('waits for what Settings says, up to the bound, and then opens on the diff', () => {
    for (const known of ['unknown', 'shown', 'other'] as const) {
      expect(openingOf(undefined, known, 0)).toBe('waiting');
      expect(openingOf(undefined, known, HOLD_LIMIT - 1)).toBe('waiting');
      expect(openingOf(undefined, known, HOLD_LIMIT)).toBe('diff');
    }
  });
});

/** A tab that opened late on the diff, as `change` has it otherwise. */
function opened(change: Partial<Opened> = {}): Opened {
  return { since: 0, on: 'diff', late: true, seen: false, chose: false, ...change };
}

describe('a late overview', () => {
  it('is offered once it shows, after the tab opened on the diff for want of one', () => {
    expect(offered(opened(), 'shown', 'overview')).toBe(true);
    expect(offered(opened(), 'unknown', 'overview')).toBe(false);
    expect(offered(opened(), 'other', 'overview')).toBe(false);
  });

  it('isn’t offered once it’s been seen, nor when Settings chose the diff, nor on the overview', () => {
    expect(offered(opened({ seen: true }), 'shown', 'overview')).toBe(false);
    expect(offered(opened({ late: false }), 'shown', 'overview')).toBe(false);
    expect(offered(opened({ on: 'overview' }), 'shown', 'overview')).toBe(false);
    expect(offered(opened({ on: undefined }), 'shown', 'overview')).toBe(false);
  });

  it('isn’t offered while Settings is unknown, or says the diff, as for a tab that opened first', () => {
    expect(offered(opened(), 'shown', undefined)).toBe(false);
    expect(offered(opened(), 'shown', 'diff')).toBe(false);
  });
});
