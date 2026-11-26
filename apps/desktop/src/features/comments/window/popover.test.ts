// @vitest-environment jsdom
// The keys of a thread's popover, beside lines: a key from the line on a thread pins its popover
// before it changes the thread, and changes nothing where the popover can't pin.

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';

const state = vi.hoisted(() => ({
  mode: 'beside' as 'beside' | 'between',
  pinned: [] as string[],
  pins: true,
  asked: [] as string[],
}));

vi.mock('./mode.ts', () => ({ threadsMode: () => state.mode }));

vi.mock('./boxes.ts', () => ({ takeOffer: () => false }));

vi.mock('./acts.ts', () => ({ threadFor: () => ({ id: 'one' }) }));

vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: () => ({
    pinned: () => state.pinned,
    pinThread: (id: string) => {
      state.asked.push(id);
      return state.pins;
    },
  }),
}));

vi.mock('../../tab/window/shared.ts', () => ({ activeTab: () => undefined }));

const { pinFirst } = await import('./popover.ts');

const TAB = { id: 'tab', kind: 'pull' } as PullTab;

/** A key on the cursor's line, line 5 of `a`'s new side. */
const LINE = { kind: 'line', at: { file: 'a', side: 'new', line: 5 } } as const;

beforeEach(() => {
  state.mode = 'beside';
  state.pinned = [];
  state.pins = true;
  state.asked = [];
});

describe('pinFirst', () => {
  test('beside lines, from the line, it pins the thread’s popover first', () => {
    expect(pinFirst(TAB, LINE)).toBe('pinned');
    expect(state.asked).toEqual(['one']);
  });

  test('where the popover can’t pin, the key goes no further', () => {
    state.pins = false;
    expect(pinFirst(TAB, LINE)).toBe('hidden');
  });

  test('with its popover pinned, or from the popover, the key acts at once', () => {
    state.pinned = ['one'];
    expect(pinFirst(TAB, LINE)).toBe('shown');
    state.pinned = [];
    expect(pinFirst(TAB, { kind: 'thread', thread: 'one' })).toBe('shown');
    expect(state.asked).toEqual([]);
  });

  test('between lines the thread is on screen, and nothing pins', () => {
    state.mode = 'between';
    expect(pinFirst(TAB, LINE)).toBe('shown');
    expect(state.asked).toEqual([]);
  });
});
