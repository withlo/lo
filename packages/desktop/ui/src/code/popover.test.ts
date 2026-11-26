// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { PopoverView } from './api.ts';
import {
  across,
  AGAIN,
  CROSS,
  type PopAt,
  type PopHost,
  type PopLines,
  placePop,
  popMax,
  type PopRoom,
  REST,
  ThreadPop,
} from './popover.ts';

/** A pane 600 px tall and 1200 wide, scrolled 1000 px into 5000, under a 38 px header. */
const room: PopRoom = { scroll: 1000, height: 600, width: 1200, end: 5000, header: 38 };

/** Lines 1200 to 1240 of the content, their lane at 40. */
const lines: PopLines = { first: 1200, last: 1240, lane: 40 };

describe('across', () => {
  test('it’s 520 wide on its lane, over the other side where its own hasn’t the room', () => {
    expect(across({ ...lines, lane: 940 }, 2560, 520)).toEqual({ left: 940, width: 520 });
    expect(across(lines, 1200, 520)).toEqual({ left: 40, width: 520 });
  });

  test('as wide in a narrow pane, it comes back to 8 inside the pane’s edge', () => {
    expect(across({ ...lines, lane: 400 }, 720, 520)).toEqual({ left: 192, width: 520 });
  });
});

describe('placePop', () => {
  test('a preview goes 4 under its last line where it fits on screen, and scrolls nothing', () => {
    expect(placePop(room, lines, 200, 'preview')).toMatchObject({
      top: 1244,
      side: 'under',
      scroll: 0,
    });
  });

  test('a preview with no room under goes above its first line, clear of the header', () => {
    const low = { ...lines, first: 1450, last: 1500 };
    expect(placePop(room, low, 200, 'preview')).toMatchObject({ top: 1246, side: 'above' });
  });

  test('a preview with room neither under nor above goes at the pane’s foot', () => {
    const filling = { ...lines, first: 1050, last: 1550 };
    expect(placePop(room, filling, 200, 'preview')).toMatchObject({ top: 1392, side: 'foot' });
  });

  test('one opened goes under its lines, scrolling the least that shows it and them', () => {
    const low = { ...lines, first: 1450, last: 1500 };
    // Its foot, 1704, comes 8 over the pane's: the pane scrolls 112, and the first line shows.
    expect(placePop(room, low, 200, 'opened')).toMatchObject({
      top: 1504,
      side: 'under',
      scroll: 112,
    });
  });

  test('only where the content ends does one opened go above', () => {
    const last = { ...lines, first: 4850, last: 4900 };
    const end = { ...room, scroll: 4400 };
    expect(placePop(end, last, 200, 'opened')).toMatchObject({ top: 4646, side: 'above' });
  });

  test('one open keeps its side, placed by its lines as they are now', () => {
    expect(placePop(room, { ...lines, last: 1300 }, 200, 'under').top).toBe(1304);
  });

  test('it’s at most 480 tall, or the pane under the header less 16', () => {
    expect(popMax(room, 480)).toBe(480);
    expect(popMax({ ...room, height: 400 }, 480)).toBe(346);
  });
});

interface At extends PopAt {
  readonly line: number;
}

/** A host of one popover, whose marks are elements by their keys. */
function hostOf() {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const marks = new Map<string, HTMLElement>();
  const shown: (string | undefined)[] = [];
  const focused: string[] = [];
  const host: PopHost<At> = {
    scroller,
    lines: () => lines,
    room: () => room,
    view: (at, pinned): PopoverView => ({
      threads: [
        {
          id: `t${at.line}`,
          at: { file: 'a', side: 'new', line: at.line },
          open: true,
          version: 1,
        },
      ],
      pinned,
      label: `Unresolved thread · line ${at.line}`,
    }),
    shown: (at) => shown.push(at?.key),
    focusLine: (at) => focused.push(at.key),
    scrollBy: () => {},
    onMark: (target, at) => marks.get(at.key)?.contains(target) ?? false,
  };
  const mark = (line: number): { at: At; element: HTMLElement } => {
    const element = document.createElement('span');
    scroller.append(element);
    marks.set(`l${line}`, element);
    return { at: { key: `l${line}`, line }, element };
  };
  return { host, scroller, mark, shown, focused };
}

/** What a popover draws: one button, saying whether it's pinned. */
function drawing() {
  const drawn: string[] = [];
  const render = (host: HTMLElement, popover: PopoverView) => {
    const button = document.createElement('button');
    host.append(button);
    const draw = (shown: PopoverView): void => {
      button.textContent = `${shown.threads[0]!.id} ${shown.pinned ? 'pinned' : 'preview'}`;
      drawn.push(button.textContent);
    };
    draw(popover);
    return { update: draw, destroy: () => button.remove() };
  };
  return { render, drawn };
}

let pop: ThreadPop<At> | undefined;

afterEach(() => {
  pop?.destroy();
  pop = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('ThreadPop', () => {
  test('the pointer at rest on a mark previews it after REST, and nothing before', () => {
    vi.useFakeTimers();
    const { host, mark } = hostOf();
    const { render, drawn } = drawing();
    pop = new ThreadPop(host);
    pop.render = render;
    const { at } = mark(5);
    pop.hover(at);
    // Built ahead, unseen.
    expect(drawn).toEqual(['t5 preview']);
    vi.advanceTimersByTime(REST - 100);
    expect(pop.open).toBe(false);
    expect(pop.dom.hidden).toBe(true);
    vi.advanceTimersByTime(100);
    expect(pop.open).toBe(true);
    expect(pop.pinned).toBe(false);
    expect(pop.dom.hidden).toBe(false);
  });

  test('the next preview, within AGAIN of the last closing, opens at once', () => {
    vi.useFakeTimers();
    const { host, mark } = hostOf();
    pop = new ThreadPop(host);
    pop.render = drawing().render;
    const first = mark(5);
    const second = mark(9);
    pop.hover(first.at);
    vi.advanceTimersByTime(REST);
    pop.hover(undefined);
    vi.advanceTimersByTime(CROSS);
    expect(pop.open).toBe(false);
    vi.advanceTimersByTime(AGAIN - CROSS - 50);
    pop.hover(second.at);
    vi.advanceTimersByTime(0);
    expect(pop.at?.key).toBe('l9');
  });

  test('a preview waits for the pointer crossing into it, and closes once it’s left both', () => {
    vi.useFakeTimers();
    const { host, mark } = hostOf();
    pop = new ThreadPop(host);
    pop.render = drawing().render;
    pop.hover(mark(5).at);
    vi.advanceTimersByTime(REST);
    pop.hover(undefined);
    pop.dom.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(CROSS * 2);
    expect(pop.open).toBe(true);
    pop.dom.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(CROSS);
    expect(pop.open).toBe(false);
  });

  test('a click pins it in place, and a click on its mark again closes it', () => {
    vi.useFakeTimers();
    const { host, mark, shown } = hostOf();
    const { render, drawn } = drawing();
    pop = new ThreadPop(host);
    pop.render = render;
    const { at } = mark(5);
    pop.hover(at);
    vi.advanceTimersByTime(REST);
    expect(pop.clicked(at)).toBe(true);
    expect(pop.pinned).toBe(true);
    expect(drawn.at(-1)).toBe('t5 pinned');
    expect(shown.at(-1)).toBe('l5');
    // Pinned, the pointer leaving changes nothing.
    pop.hover(undefined);
    vi.advanceTimersByTime(CROSS * 2);
    expect(pop.pinned).toBe(true);
    expect(pop.clicked(at)).toBe(false);
    expect(pop.open).toBe(false);
    expect(shown.at(-1)).toBeUndefined();
  });

  test('a press in a preview pins it; a press elsewhere closes it, but not on its mark', () => {
    const { host, mark, scroller } = hostOf();
    pop = new ThreadPop(host);
    pop.render = drawing().render;
    const { at, element } = mark(5);
    pop.pin(at);
    element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(pop.pinned).toBe(true);
    scroller.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(pop.open).toBe(false);
    vi.useFakeTimers();
    pop.hover(at);
    vi.advanceTimersByTime(REST);
    pop.dom.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(pop.pinned).toBe(true);
  });

  test('a key closes a preview, never a pinned one', () => {
    vi.useFakeTimers();
    const { host, mark } = hostOf();
    pop = new ThreadPop(host);
    pop.render = drawing().render;
    const { at } = mark(5);
    pop.hover(at);
    vi.advanceTimersByTime(REST);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    expect(pop.open).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(pop.open).toBe(false);
    pop.pin(at);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(pop.pinned).toBe(true);
  });

  test('closing with focus in it hands focus to its line', () => {
    const { host, mark, focused } = hostOf();
    pop = new ThreadPop(host);
    pop.render = drawing().render;
    const { at } = mark(5);
    pop.pin(at);
    pop.dom.querySelector('button')!.focus();
    pop.close();
    expect(focused).toEqual(['l5']);
    expect(pop.dom.hidden).toBe(true);
  });

  test('focus goes into it on its first comment, the ring the keys move', () => {
    const { host, mark } = hostOf();
    pop = new ThreadPop(host);
    pop.render = (element, popover) => {
      element.innerHTML = `<div data-thread-id="${popover.threads[0]!.id}"><p data-comment="c2" tabindex="-1">text</p></div>`;
      return { update() {}, destroy() {} };
    };
    pop.pin(mark(5).at);
    pop.focus();
    expect(document.activeElement?.getAttribute('data-comment')).toBe('c2');
  });
});
