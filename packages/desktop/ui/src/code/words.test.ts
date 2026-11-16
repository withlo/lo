// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

import type { Rested } from './api.ts';
import { REST, watchRests, type Word } from './words.ts';

afterEach(() => {
  vi.useRealTimers();
});

const name: Word = { key: 'name', at: { file: 'a', side: 'new', line: 4, column: 6 } };
const other: Word = { key: 'other', at: { file: 'a', side: 'new', line: 4, column: 12 } };

/** A box whose pointer is on `under.word`, and what it's told of rests. */
function watched() {
  const dom = document.createElement('div');
  const under: { word: Word | undefined } = { word: name };
  const tell = vi.fn<Rested>();
  const stop = watchRests(dom, () => under.word, tell);
  const move = (pointerType = 'mouse'): void => {
    dom.dispatchEvent(Object.assign(new MouseEvent('pointermove'), { pointerType }));
  };
  return { dom, under, tell, stop, move };
}

test('a pointer that stays on a word rests there, and says so as it leaves it', () => {
  vi.useFakeTimers();
  const { under, tell, move } = watched();
  move();
  vi.advanceTimersByTime(REST - 1);
  // Moving within the word doesn't start it again.
  move();
  expect(tell).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(tell).toHaveBeenCalledWith(name.at);
  under.word = other;
  move();
  expect(tell).toHaveBeenLastCalledWith(undefined);
  vi.advanceTimersByTime(REST);
  expect(tell).toHaveBeenLastCalledWith(other.at);
  expect(tell).toHaveBeenCalledTimes(3);
});

test('leaving the box, or a scroll, takes the word away; a touch rests nowhere', () => {
  vi.useFakeTimers();
  const { dom, tell, move, stop } = watched();
  move();
  vi.advanceTimersByTime(REST);
  dom.dispatchEvent(new Event('scroll'));
  expect(tell).toHaveBeenLastCalledWith(undefined);
  // Left before it rested, it says nothing.
  move();
  dom.dispatchEvent(new MouseEvent('pointerleave'));
  vi.advanceTimersByTime(REST);
  move('touch');
  vi.advanceTimersByTime(REST);
  expect(tell).toHaveBeenCalledTimes(2);
  stop();
  move();
  vi.advanceTimersByTime(REST);
  expect(tell).toHaveBeenCalledTimes(2);
});
