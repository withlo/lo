import { NO_TARGET } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import type { Tab } from '../contract.ts';
import { movable, saidOf, showable } from './order.ts';

const fd: Tab = { id: 'fd', kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
const bat: Tab = { id: 'bat', kind: 'pull', owner: 'sharkdp', repo: 'bat', number: 7 };
const settings: Tab = { id: 'settings', kind: 'settings' };
const recent: Tab = { id: 'recent', kind: 'recent' };

describe('moving a tab a place', () => {
  const state = { tabs: [fd, bat, settings], active: 'bat' };

  it('moves the tab on screen, or the one right-clicked, but not round the ends', () => {
    expect(movable(state, NO_TARGET, -1)).toBe(true);
    expect(movable(state, NO_TARGET, 1)).toBe(true);
    expect(movable(state, { kind: 'tab', tab: 'fd' }, -1)).toBe('Already first');
    expect(movable(state, { kind: 'tab', tab: 'settings' }, 1)).toBe('Already last');
    expect(movable(state, { kind: 'tab', tab: 'gone' }, 1)).toBe('Tab isn’t open');
  });

  it('goes no further than the tabs the strip shows', () => {
    expect(movable(state, NO_TARGET, 1, 2)).toBe('Already last');
    expect(movable(state, NO_TARGET, -1, 2)).toBe(true);
  });

  it('leaves Recent pull requests where it is', () => {
    const alone = { tabs: [recent], active: 'recent' };
    for (const by of [1, -1] as const) {
      expect(movable(alone, NO_TARGET, by)).toBe('Recent pull requests can’t move');
    }
  });

  it('says where the tab is now, by the name the strip shows', () => {
    expect(saidOf(fd, 1, 3)).toBe('Moved fd #2212 to tab 2 of 3');
    expect(saidOf(settings, 0, 3)).toBe('Moved Settings to tab 1 of 3');
    // A branch's name can't turn the words after it around.
    const queue = {
      id: 'q',
      kind: 'queue',
      owner: 'o',
      repo: 'e2e',
      branch: 'e4/\u202Equeued',
      login: 'rozed-bot',
    } as const;
    expect(saidOf(queue, 2, 3)).toBe('Moved e2e merge queue for e4/queued to tab 3 of 3');
  });
});

describe('showing a tab', () => {
  const state = { tabs: [fd, bat, settings], active: 'bat' };

  it('is there for a tab at that place, or the last, unless it’s on screen', () => {
    expect(showable(state, { position: 1 })).toBe(true);
    expect(showable(state, { position: 2 })).toBe('');
    expect(showable(state, { position: 4 })).toBe('');
    expect(showable(state, { last: true })).toBe(true);
    expect(showable({ ...state, active: 'settings' }, { last: true })).toBe('');
  });

  it('steps round the ends of the tabs the strip shows, with another to step to', () => {
    expect(showable(state, { step: 1 })).toBe(true);
    expect(showable(state, { step: -1, within: 2 })).toBe(true);
    // The tab on screen folded into "N more": a step goes to the strip's end.
    expect(showable({ ...state, active: 'settings' }, { step: 1, within: 2 })).toBe(true);
    // One tab: nowhere to step to.
    expect(showable({ tabs: [fd], active: 'fd' }, { step: 1 })).toBe('');
  });

  it('has nothing to show from Recent pull requests alone', () => {
    const alone = { tabs: [recent], active: 'recent' };
    for (const choice of [{ position: 1 }, { last: true }, { step: 1 }, { step: -1 }] as const) {
      expect(showable(alone, choice)).toBe('');
    }
  });
});
