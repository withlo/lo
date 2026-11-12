// @vitest-environment jsdom
// What keeps an overview where it is on the page as its box moves: a banner over it coming or
// going leaves every line where it was, by the scroll, or at the very top by room above the
// article; a scroll the reader asks for moves it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeResizeObserver, resize } from '../../test/figures.ts';
import { holdPlace } from './hold.ts';

/**
 * A scroller as a browser lays it out: its box's top on the page and its height, and as much to
 * scroll as `content` is tall, which the room above adds to.
 */
function scrollerOf(content: number) {
  const element = document.createElement('div');
  const box = { top: 100, height: 400 };
  let scrollTop = 0;
  const room = () => Number.parseFloat(element.style.paddingTop || '0');
  const end = () => Math.max(0, content + room() - box.height);
  Object.defineProperties(element, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.round(Math.min(end(), Math.max(0, value)));
      },
    },
    clientHeight: { get: () => box.height },
    scrollHeight: { get: () => content + room() },
    getBoundingClientRect: {
      value: () => new DOMRect(0, box.top, 600, box.height),
    },
  });
  return {
    element,
    /** Where the content's first line is on the page. */
    first: () => box.top + room() - scrollTop,
    /** A banner `height` pixels tall comes over the box, or goes when negative. */
    banner(height: number) {
      box.top += height;
      box.height -= height;
      scrollTop = Math.min(scrollTop, end());
      resize(element);
    },
    /** The reader scrolls to `to`. */
    scroll(to: number) {
      element.scrollTop = to;
      element.dispatchEvent(new Event('scroll'));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an overview’s place on the page', () => {
  it('stays as a banner comes and goes, by the scroll', () => {
    const view = scrollerOf(3000);
    holdPlace(view.element);
    view.scroll(800);
    const before = view.first();
    view.banner(60);
    expect(view.first()).toBe(before);
    view.banner(-60);
    expect(view.first()).toBe(before);
    expect(view.element.style.paddingTop).toBe('');
  });

  it('stays at the very top, by room above the article, which a banner coming takes away', () => {
    const view = scrollerOf(3000);
    holdPlace(view.element);
    view.banner(60);
    view.scroll(20);
    const before = view.first();
    view.banner(-60);
    expect(view.first()).toBe(before);
    expect(view.element.style.paddingTop).toBe('40px');
    view.banner(60);
    expect(view.first()).toBe(before);
    expect(view.element.style.paddingTop).toBe('');
  });

  it('moves as the reader scrolls, and stays where they left it', () => {
    const view = scrollerOf(3000);
    holdPlace(view.element);
    view.scroll(300);
    view.scroll(500);
    const before = view.first();
    view.banner(60);
    expect(view.first()).toBe(before);
  });

  it('is let go once stopped, room above and all', () => {
    const view = scrollerOf(3000);
    const stop = holdPlace(view.element);
    view.banner(60);
    view.scroll(0);
    view.banner(-60);
    expect(view.element.style.paddingTop).toBe('60px');
    stop();
    expect(view.element.style.paddingTop).toBe('');
    const before = view.first();
    view.banner(60);
    expect(view.first()).toBe(before + 60);
  });
});
