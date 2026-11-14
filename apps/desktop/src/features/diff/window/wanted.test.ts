// @vitest-environment jsdom
// What a tab's diff waits to show: the last thing asked for, until the reader does anything else.

import { afterEach, describe, expect, it } from 'vitest';

import { drawnName, keepWanted, shown, wantedIn, wantPlace, wantThread } from './wanted.ts';

const PLACE = { kind: 'line', at: { file: 'd0', side: 'new', line: 8 } } as const;

afterEach(() => keepWanted(new Set()));

describe('what the diff waits to show', () => {
  it('is the last thing asked for', () => {
    wantThread('tab', 'T1');
    wantPlace('tab', PLACE, drawnName('h', null));
    expect(wantedIn('tab')).toEqual({ kind: 'place', target: PLACE, left: 'h|' });
    wantThread('tab', 'T2');
    expect(wantedIn('tab')).toEqual({ kind: 'thread', thread: 'T2' });
    expect(wantedIn('other')).toBeUndefined();
  });

  it('goes once it’s shown, the reader does anything else, or its tab closes', () => {
    wantThread('tab', 'T1');
    shown('tab');
    expect(wantedIn('tab')).toBeUndefined();
    for (const event of [new KeyboardEvent('keydown'), new MouseEvent('pointerdown')]) {
      wantThread('tab', 'T1');
      window.dispatchEvent(event);
      expect(wantedIn('tab')).toBeUndefined();
    }
    wantThread('tab', 'T1');
    wantThread('kept', 'T2');
    keepWanted(new Set(['kept']));
    expect(wantedIn('tab')).toBeUndefined();
    expect(wantedIn('kept')).toEqual({ kind: 'thread', thread: 'T2' });
  });

  it('names the diff it was asked for in front of by its head and comparison', () => {
    expect(drawnName('h', 'k')).not.toBe(drawnName('h', null));
    expect(drawnName(undefined, undefined)).toBe('|');
  });
});
