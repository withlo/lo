// What a tab that opened on the overview stays on, and its bound: the overview once it's known to
// show, the timeline once it's known not to, and the timeline when nothing is known by the bound.

import { describe, expect, it } from 'vitest';

import { HOLD_LIMIT } from '../../revisions/contract.ts';
import { offered, openingOf, overviewPlace, type Opened } from './opening.ts';

describe('what a tab that opened on the overview stays on', () => {
  it('waits while nothing is known, up to the bound', () => {
    expect(HOLD_LIMIT).toBe(1_000);
    expect(openingOf('unknown', 0)).toBe('waiting');
    expect(openingOf('unknown', HOLD_LIMIT - 1)).toBe('waiting');
  });

  it('goes to the timeline at the bound, whatever is still to come', () => {
    expect(openingOf('unknown', HOLD_LIMIT)).toBe('timeline');
    expect(openingOf('unknown', HOLD_LIMIT * 60)).toBe('timeline');
  });

  it('stays on the overview as soon as it’s known to show, within the bound', () => {
    expect(openingOf('shown', 0)).toBe('overview');
    expect(openingOf('shown', HOLD_LIMIT - 1)).toBe('overview');
  });

  it('goes to the timeline, where the description is first, as soon as there’s no overview', () => {
    expect(openingOf('other', 0)).toBe('timeline');
  });
});

/** A tab that went to the timeline for want of an overview, as `change` has it otherwise. */
function opened(change: Partial<Opened> = {}): Opened {
  return { since: 0, on: 'timeline', seen: false, chose: false, handing: false, ...change };
}

describe('a late overview', () => {
  it('is offered once it shows, after the tab went to the timeline for want of one', () => {
    expect(offered(opened(), 'shown')).toBe(true);
    expect(offered(opened(), 'unknown')).toBe(false);
    expect(offered(opened(), 'other')).toBe(false);
  });

  it('isn’t offered once it’s been seen, nor where the tab stayed on it or never chose', () => {
    expect(offered(opened({ seen: true }), 'shown')).toBe(false);
    expect(offered(opened({ on: 'overview' }), 'shown')).toBe(false);
    expect(offered(opened({ on: undefined }), 'shown')).toBe(false);
  });
});

describe('history’s place at the overview itself', () => {
  const choosing: Opened = { since: 0, on: undefined, seen: false, chose: true, handing: false };

  it('is the overview while the tab chooses, and once it stayed on the overview', () => {
    expect(overviewPlace(choosing)).toBe('overview');
    expect(overviewPlace({ ...choosing, on: 'overview', seen: true })).toBe('overview');
  });

  it('is the timeline where the tab went there, until its overview is seen', () => {
    expect(overviewPlace({ ...choosing, on: 'timeline' })).toBe('timeline');
    expect(overviewPlace({ ...choosing, on: 'timeline', seen: true })).toBe('overview');
  });
});
