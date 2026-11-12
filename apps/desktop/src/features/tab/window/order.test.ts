import { NO_TARGET } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import type { Tab } from '../contract.ts';
import { movable, saidOf } from './order.ts';

const fd: Tab = { id: 'fd', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
const bat: Tab = { id: 'bat', kind: 'pull', owner: 'sharkdp', repo: 'bat', number: 7 };
const settings: Tab = { id: 'settings', kind: 'settings' };
const recent: Tab = { id: 'recent', kind: 'recent' };

describe('moving a tab a place', () => {
  const state = { tabs: [fd, bat, settings], active: 'bat' };

  it('moves the tab on screen, or the one right-clicked, but not round the ends', () => {
    expect(movable(state, NO_TARGET, -1)).toBe(true);
    expect(movable(state, NO_TARGET, 1)).toBe(true);
    expect(movable(state, { kind: 'tab', tab: 'fd' }, -1)).toBe(
      'The tab is first in the strip already.',
    );
    expect(movable(state, { kind: 'tab', tab: 'settings' }, 1)).toBe(
      'The tab is last in the strip already.',
    );
    expect(movable(state, { kind: 'tab', tab: 'gone' }, 1)).toBe("That tab isn't open.");
  });

  it('goes no further than the tabs the strip shows', () => {
    expect(movable(state, NO_TARGET, 1, 2)).toBe('The tab is last in the strip already.');
    expect(movable(state, NO_TARGET, -1, 2)).toBe(true);
  });

  it('leaves Recent pull requests where it is', () => {
    const alone = { tabs: [recent], active: 'recent' };
    for (const by of [1, -1] as const) {
      expect(movable(alone, NO_TARGET, by)).toBe(
        "Recent pull requests can't move: it shows while no other tab is open.",
      );
    }
  });

  it('says where the tab is now, by the name the strip shows', () => {
    expect(saidOf(fd, 1, 3)).toBe('fd #2212 is now tab 2 of 3.');
    expect(saidOf(settings, 0, 3)).toBe('Settings is now tab 1 of 3.');
  });
});
