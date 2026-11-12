// @vitest-environment jsdom
// What keeps an overview where it is on the page as its box moves: a banner over it coming or
// going leaves every line where it was, by the scroll, or at the very top by room above the
// article; a scroll the reader asks for moves it. And what keeps a block's height while it's on
// screen: contents grown taller are cut off until it's off screen, its width changes, or the reader
// asks to see them whole.

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { FakeIntersectionObserver, FakeResizeObserver, resize } from '../../test/figures.ts';
import { holdHeight, holdPlace } from './hold.ts';

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
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
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

/**
 * A block in a scroller 400 pixels tall: its top on the page, its width and its contents' height,
 * which a test changes, and the box's own height, as the block holds it.
 */
function blockOf(contents: number) {
  const scroller = document.createElement('div');
  const box = document.createElement('div');
  const inner = document.createElement('div');
  box.append(inner);
  scroller.append(box);
  const at = { top: 100, width: 600, contents };
  const height = () => Number.parseFloat(box.style.height || `${at.contents}`);
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 400 },
    getBoundingClientRect: { value: () => new DOMRect(0, 0, 600, 400) },
  });
  Object.defineProperty(box, 'getBoundingClientRect', {
    value: () => new DOMRect(0, at.top, at.width, height()),
  });
  Object.defineProperty(inner, 'getBoundingClientRect', {
    value: () => new DOMRect(0, at.top, at.width, at.contents),
  });
  const cuts: boolean[] = [];
  const held = holdHeight(box, inner, scroller, (cut) => cuts.push(cut));
  onTestFinished(() => held.stop());
  return {
    box,
    held,
    cuts,
    height,
    /** The contents grow or shrink to `to`. */
    grow(to: number) {
      at.contents = to;
      resize(inner);
    },
    /** The block goes to `top` on the page, off the screen or on it. */
    scroll(top: number) {
      at.top = top;
      const seen = top < 400 && top + height() > 0;
      for (const observer of FakeIntersectionObserver.all.slice()) {
        if (observer.targets.includes(box)) observer.tell(box, seen);
      }
    },
    /** The window makes the block `width` wide. */
    widen(width: number) {
      at.width = width;
      resize(box);
    },
  };
}

describe('a block’s height', () => {
  it('stays as its contents grow on screen, cut off, and follows them off screen', () => {
    const block = blockOf(100);
    expect(block.height()).toBe(100);
    block.grow(300);
    expect(block.height()).toBe(100);
    expect(block.cuts).toEqual([true]);
    block.scroll(-500);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([true, false]);
  });

  it('leaves room under contents that shrink on screen, uncut', () => {
    const block = blockOf(300);
    block.grow(100);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([]);
    block.scroll(900);
    expect(block.height()).toBe(100);
  });

  it('takes its contents’ height off screen at once', () => {
    const block = blockOf(100);
    block.scroll(900);
    block.grow(300);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([]);
  });

  it('shows its contents whole when the reader asks, or the window changes its width', () => {
    const block = blockOf(100);
    block.grow(300);
    block.held.release();
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([true, false]);
    block.grow(500);
    // Its own height changing isn't its width.
    resize(block.box);
    expect(block.height()).toBe(300);
    block.widen(500);
    expect(block.height()).toBe(500);
  });

  it('is let go once stopped', () => {
    const block = blockOf(100);
    block.held.stop();
    expect(block.box.style.height).toBe('');
    const watching = [...FakeResizeObserver.all, ...FakeIntersectionObserver.all].filter(
      (observer) => observer.targets.some((target) => block.box.contains(target)),
    );
    expect(watching).toEqual([]);
  });
});
