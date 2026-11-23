// @vitest-environment jsdom
// The tips of the controls a code view draws: they come once the pointer rests on one, and come back
// once it rests again after a scroll or a move of the rows took them away.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { TIP_DELAY, tips } from './tip.ts';

let root: HTMLElement;
let ball: HTMLElement;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  root.className = 'lo-app';
  ball = document.createElement('span');
  ball.dataset.tip = 'Mark viewed';
  root.append(ball, document.createElement('p'));
  document.body.append(root);
  stop = tips(root, (control) => ({ label: control.dataset.tip ?? '', keys: ['e'] }));
});

afterEach(() => {
  stop();
  root.remove();
  vi.useRealTimers();
});

/** The tip on screen, by its words, or nothing. */
const shown = (): string | undefined => document.querySelector('.lo-tip')?.textContent ?? undefined;

function move(target: Element, type = 'mousemove', at = { clientX: 4, clientY: 4 }): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...at }));
}

test('a tip comes once the pointer has rested on its control, and goes as it leaves', () => {
  move(ball, 'mouseover');
  vi.advanceTimersByTime(TIP_DELAY - 1);
  expect(shown()).toBeUndefined();
  vi.advanceTimersByTime(1);
  expect(shown()).toBe('Mark viewede');
  ball.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }));
  expect(shown()).toBeUndefined();
});

test('a scroll that cancels the wait, with the pointer still on the control, shows it once it’s over', () => {
  move(ball, 'mouseover');
  vi.advanceTimersByTime(TIP_DELAY / 2);
  root.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(TIP_DELAY);
  // jsdom lays nothing out, so nothing is under the pointer once the scroll ends: a move arms it.
  expect(shown()).toBeUndefined();
  move(ball);
  vi.advanceTimersByTime(TIP_DELAY);
  expect(shown()).toBe('Mark viewede');
});

test('the control under the pointer once a scroll ends shows its tip, with no move', () => {
  const at = vi.fn<(x: number, y: number) => Element | null>(() => ball);
  document.elementFromPoint = at;
  try {
    move(root.querySelector('p')!, 'mouseover', { clientX: 10, clientY: 20 });
    root.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(TIP_DELAY);
    expect(at).toHaveBeenLastCalledWith(10, 20);
    expect(shown()).toBe('Mark viewede');
    // A scroll takes it away again, and the wait starts over.
    root.dispatchEvent(new Event('scroll'));
    expect(shown()).toBeUndefined();
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
});

test('a pointer that moves off the controls or leaves the view once a scroll starts shows no tip', () => {
  document.elementFromPoint = () => ball;
  try {
    const empty = root.querySelector('p')!;
    move(empty, 'mouseover');
    root.dispatchEvent(new Event('scroll'));
    move(empty, 'mousemove', { clientX: 30, clientY: 40 });
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown()).toBeUndefined();
    root.dispatchEvent(new Event('scroll'));
    empty.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown()).toBeUndefined();
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
});

for (const [what, quiet] of [
  ['a key', () => root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))],
  ['a press', () => ball.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
] as const) {
  test(`${what} takes a tip away, and it stays away until the pointer leaves`, () => {
    document.elementFromPoint = () => ball;
    try {
      move(ball, 'mouseover');
      vi.advanceTimersByTime(TIP_DELAY);
      quiet();
      expect(shown()).toBeUndefined();
      // Neither a twitch of the pointer nor a scroll brings it back.
      move(ball);
      root.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(TIP_DELAY);
      expect(shown()).toBeUndefined();
      ball.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }));
      move(ball, 'mouseover');
      vi.advanceTimersByTime(TIP_DELAY);
      expect(shown()).toBe('Mark viewede');
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
}
