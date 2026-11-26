// @vitest-environment jsdom
// The keys of a thread's popover, beside lines: a key from the line on a thread pins its popover
// before it changes the thread, and changes nothing where the popover can't pin; and the popover's
// keys go to a code block with focus before the diff.

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';

const state = vi.hoisted(() => ({
  mode: 'beside' as 'beside' | 'between',
  pinned: [] as string[],
  pins: true,
  asked: [] as string[],
  tab: undefined as unknown,
  block: undefined as unknown,
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
    openDraft: () => state.asked.push('diff draft'),
    closePopover: () => state.asked.push('diff closed'),
    popoverPinned: () => false,
  }),
}));

vi.mock('../../overview/window/shared.ts', () => ({ blockWithFocus: () => state.block }));

vi.mock('../../tab/window/shared.ts', () => ({ activeTab: () => state.tab }));

const { closePopover, pinFirst, popoverPinned, showPopover } = await import('./popover.ts');

const TAB: PullTab = { id: 'tab', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 94 };

/** A key on the cursor's line, line 5 of `a`'s new side. */
const LINE = { kind: 'line', at: { file: 'a', side: 'new', line: 5 } } as const;

beforeEach(() => {
  state.mode = 'beside';
  state.pinned = [];
  state.pins = true;
  state.asked = [];
  state.tab = undefined;
  state.block = undefined;
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

describe('the popover’s keys', () => {
  test('go to a code block with focus in its code or its popover, before the diff', () => {
    state.tab = TAB;
    state.block = {
      pinThread: (id: string, focus: boolean) => state.asked.push(`block ${id} ${focus}`),
      closePopover: () => state.asked.push('block closed'),
      popoverPinned: () => true,
    };
    showPopover({ kind: 'thread', thread: 'one' });
    closePopover();
    expect(popoverPinned()).toBe(true);
    expect(state.asked).toEqual(['block one true', 'block closed']);
    // With no block's, the diff's.
    state.block = undefined;
    showPopover({ kind: 'thread', thread: 'one' });
    closePopover();
    expect(popoverPinned()).toBe('');
    expect(state.asked).toEqual([
      'block one true',
      'block closed',
      'one',
      'diff draft',
      'diff closed',
    ]);
  });
});
