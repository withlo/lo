// @vitest-environment jsdom
// The overview's scroll commands, as the window wires them: each runs the scroll its name says, on
// the overview drawn in the tab on screen, and none runs with no overview there.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Follow from './follow.ts';
import type { Scroll } from './follow.ts';
import feature from './index.ts';
import type * as TabShared from '../../tab/window/shared.ts';

const drawn = vi.hoisted(() => ({ overview: undefined as unknown, scrolls: [] as unknown[][] }));

vi.mock('./follow.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Follow>()),
  drawnIn: () => drawn.overview,
  scroll: (...given: unknown[]) => drawn.scrolls.push(given),
}));

vi.mock('../../tab/window/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof TabShared>()),
  activeTab: () => ({ kind: 'pull', id: 'tab' }),
}));

const overview = { tab: 'tab' } as const;

beforeEach(() => {
  drawn.overview = overview;
  drawn.scrolls.length = 0;
});

/** The handler the feature gives the command called `name`. */
function handlerOf(name: string) {
  const handler = feature.commands.find((command) => command.name === name)?.handler;
  if (!handler) throw new Error(`overview.${name} has no handler.`);
  return handler;
}

describe('the scroll commands', () => {
  it('each scroll the overview on screen the way their name says', () => {
    const wired: [string, Scroll][] = [
      ['scrollDown', 'down'],
      ['scrollUp', 'up'],
      ['top', 'top'],
      ['bottom', 'bottom'],
      ['pageDown', 'pageDown'],
      ['pageUp', 'pageUp'],
    ];
    for (const [name] of wired) void handlerOf(name).run({ kind: 'none' });
    expect(drawn.scrolls).toEqual(wired.map(([, how]) => [overview, how]));
  });

  it('are available only with an overview on screen', () => {
    const target = { kind: 'none' } as const;
    expect(handlerOf('pageUp').enabled?.(target)).toBe(true);
    drawn.overview = undefined;
    expect(handlerOf('pageUp').enabled?.(target)).toBe('There’s no overview on screen.');
  });
});
