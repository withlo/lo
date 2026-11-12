// @vitest-environment jsdom
// What keeps an overview where it is on the page as its box moves: a banner over it coming or
// going leaves every line where it was, by the scroll, or at the very top by room above the
// article; what's above the block being read changing size leaves it where it is, by the scroll;
// a scroll the reader asks for moves it. And what keeps a block from moving what's on
// screen as its contents change size: it takes their height unseen, off screen, past the screen's
// bottom edge, above its top with the scroll taking the change, and with nothing under it; wholly
// on screen with more under it, contents grown taller are cut off until the reader asks to see
// them whole, its width changes, or taking their height moves nothing.

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

  it('keeps the first block that starts on screen where it is as what’s above it changes size', () => {
    const page = articleOf([300, 100, 400]);
    holdPlace(page.scroller);
    page.scroll(320);
    expect(page.top(2)).toBe(80);
    // The block it straddles the screen's top with, and the one above, change size.
    page.change(1, 160);
    expect(page.top(2)).toBe(80);
    page.change(1, 40);
    expect(page.top(2)).toBe(80);
    // Under it, nothing moves it.
    page.change(2, 600);
    expect(page.top(2)).toBe(80);
    expect(page.scroller.scrollTop).toBe(260);
  });

  it('keeps the block being read where it is as what’s above it gets shorter near the end, the scroll never pulled back to it', () => {
    const page = articleOf([300, 100, 400]);
    holdPlace(page.scroller);
    page.scroll(380);
    expect(page.top(2)).toBe(20);
    // The browser pulls the scroll back to the closer end: that isn't the reader's.
    page.change(1, 40);
    expect(page.pulls()).toBe(1);
    expect(page.top(2)).toBe(20);
    expect(page.scroller.scrollTop).toBe(320);
  });

  it('takes a scroll the browser makes as what changes size as the reader’s once it follows their input', () => {
    const page = articleOf([300, 100, 400]);
    holdPlace(page.scroller);
    page.scroll(380);
    window.dispatchEvent(new WheelEvent('wheel'));
    page.change(1, 40);
    expect(page.scroller.scrollTop).toBe(340);
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
 * A block in a scroller 400 pixels tall, whose content is `end` pixels tall: its top on the page,
 * its width and its contents' height, which a test changes, and the box's own height, as the block
 * holds it.
 */
function blockOf(contents: number, place: { top?: number; end?: number } = {}) {
  const scroller = document.createElement('div');
  const box = document.createElement('div');
  const inner = document.createElement('div');
  box.append(inner);
  scroller.append(box);
  const at = { top: place.top ?? 100, width: 600, contents };
  const scrolled: number[] = [];
  const height = () => Number.parseFloat(box.style.height || `${at.contents}`);
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 400 },
    scrollHeight: { get: () => place.end ?? 2000 },
    scrollTop: {
      get: () => 0,
      set: (to: number) => {
        scrolled.push(to);
      },
    },
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
    scrolled,
    /** The contents grow or shrink to `to`. */
    grow(to: number) {
      at.contents = to;
      resize(inner);
    },
    /** The block goes to `top` on the page. */
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

/**
 * An overview's article in a scroller 400 pixels tall, its blocks `heights` tall, one under the
 * other: the first a block whose height is held, around its contents, which a test changes.
 */
function articleOf(heights: number[]) {
  const scroller = document.createElement('div');
  const article = document.createElement('article');
  const blocks = heights.map(() => document.createElement('div'));
  const held = blocks[0]!;
  const inner = document.createElement('div');
  held.append(inner);
  article.append(...blocks);
  scroller.append(article);
  document.body.append(scroller);
  onTestFinished(() => scroller.remove());
  let contents = heights[0] ?? 0;
  let scrollTop = 0;
  const heightOf = (index: number) =>
    index === 0 ? Number.parseFloat(held.style.height || `${contents}`) : (heights[index] ?? 0);
  /** How tall the content is, with the room at its end. */
  const total = () =>
    heights.reduce((sum, _, index) => sum + heightOf(index), 0) +
    Number.parseFloat(scroller.style.paddingBottom || '0');
  /** How many times the scroll was pulled back to the end. */
  let pulls = 0;
  /** The scroll, pulled back to the end when the content got shorter, as a browser pulls it. */
  const scrolled = () => {
    const end = Math.max(0, total() - 400);
    if (scrollTop > end) {
      pulls += 1;
      scrollTop = end;
    }
    return scrollTop;
  };
  const top = (index: number) => {
    let at = -scrolled();
    for (let before = 0; before < index; before++) at += heightOf(before);
    return at;
  };
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 400 },
    scrollHeight: { get: () => total() },
    scrollTop: {
      get: scrolled,
      set: (to: number) => {
        scrollTop = Math.min(Math.max(0, total() - 400), Math.max(0, to));
      },
    },
    getBoundingClientRect: { value: () => new DOMRect(0, 0, 600, 400) },
  });
  blocks.forEach((block, index) => {
    Object.defineProperty(block, 'getBoundingClientRect', {
      value: () => new DOMRect(0, top(index), 600, heightOf(index)),
    });
  });
  Object.defineProperty(inner, 'getBoundingClientRect', {
    value: () => new DOMRect(0, top(0), 600, contents),
  });
  return {
    scroller,
    held,
    inner,
    top,
    pulls: () => pulls,
    /** The reader scrolls to `to`. */
    scroll(to: number) {
      scroller.scrollTop = to;
      scroller.dispatchEvent(new Event('scroll'));
    },
    /** The held block's contents grow or shrink to `to`. */
    grow(to: number) {
      contents = to;
      resize(inner);
    },
    /** Block `index`, not the held one, becomes `to` tall, as text does as its face loads. */
    change(index: number, to: number) {
      heights[index] = to;
      resize(article);
    },
  };
}

describe('a block’s height', () => {
  it('stays as its contents grow wholly on screen with more under it, cut off, until it’s off screen', () => {
    const block = blockOf(100);
    expect(block.height()).toBe(100);
    block.grow(300);
    expect(block.height()).toBe(100);
    expect(block.cuts).toEqual([true]);
    block.scroll(-500);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([true, false]);
  });

  it('leaves room under contents that shrink wholly on screen, uncut, until it’s off screen', () => {
    const block = blockOf(300);
    block.grow(100);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([]);
    block.scroll(900);
    expect(block.height()).toBe(100);
  });

  it('takes its contents’ height at once while it can’t be seen, as before the overview is shown', () => {
    const block = blockOf(100);
    let seen = false;
    Object.defineProperty(block.box, 'checkVisibility', { value: () => seen });
    block.grow(150);
    expect(block.height()).toBe(150);
    seen = true;
    block.grow(250);
    expect(block.height()).toBe(150);
    expect(block.cuts).toEqual([true]);
  });

  it('takes its contents’ height off screen at once', () => {
    const block = blockOf(100, { top: 900 });
    block.grow(300);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([]);
  });

  it('grows on past the screen’s bottom edge, which moves only what’s under it', () => {
    const block = blockOf(100, { top: 320 });
    block.grow(300);
    expect(block.height()).toBe(300);
    // It shrinks while it stays past the edge, but not so that what's under it comes on screen.
    block.grow(200);
    expect(block.height()).toBe(200);
    block.grow(40);
    expect(block.height()).toBe(200);
    expect(block.cuts).toEqual([]);
  });

  it('is cut where growing would take it past the edge from above it', () => {
    const block = blockOf(100, { top: 250 });
    block.grow(300);
    expect(block.height()).toBe(100);
    expect(block.cuts).toEqual([true]);
  });

  it('grows above the screen’s top, the scroll taking the change so what’s under it stays', () => {
    const page = articleOf([300, 100, 400]);
    holdPlace(page.scroller);
    // The reader scrolls the block's top off screen: the paragraph under it is what they read.
    page.scroll(250);
    expect(page.top(1)).toBe(50);
    const cuts: boolean[] = [];
    const held = holdHeight(page.held, page.inner, page.scroller, (cut) => cuts.push(cut));
    onTestFinished(() => held.stop());
    page.grow(380);
    expect(page.top(1)).toBe(50);
    expect(page.scroller.scrollTop).toBe(330);
    expect(cuts).toEqual([]);
  });

  it('gets shorter above the screen at the end with room there first, which goes once it’s off screen', () => {
    const page = articleOf([300, 100, 400]);
    holdPlace(page.scroller);
    page.scroll(400);
    expect(page.top(2)).toBe(0);
    const held = holdHeight(page.held, page.inner, page.scroller, () => {});
    onTestFinished(() => held.stop());
    page.grow(100);
    expect(page.top(2)).toBe(0);
    expect(page.scroller.scrollTop).toBe(200);
    expect(page.scroller.style.paddingBottom).toBe('');
    expect(page.pulls()).toBe(0);
  });

  it('grows when nothing is under it on screen', () => {
    const block = blockOf(100, { end: 200 });
    block.grow(300);
    expect(block.height()).toBe(300);
    expect(block.cuts).toEqual([]);
  });

  it('shows its contents whole when the reader asks, or the window changes its width', () => {
    const block = blockOf(100, { top: 50 });
    block.grow(200);
    block.held.release();
    expect(block.height()).toBe(200);
    expect(block.cuts).toEqual([true, false]);
    block.grow(300);
    // Its own height changing isn't its width.
    resize(block.box);
    expect(block.height()).toBe(200);
    block.widen(500);
    expect(block.height()).toBe(300);
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
