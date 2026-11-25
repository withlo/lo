// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThreadSizes } from './widgets.ts';

const real = globalThis.ResizeObserver;

/** The observer `ThreadSizes` makes, and what it calls, which the test tells what was drawn. */
let observer: { told: ResizeObserverCallback; itself: ResizeObserver } | undefined;

beforeEach(() => {
  // jsdom has no resize observer: the test hands the sizes what one would have seen.
  globalThis.ResizeObserver = class {
    constructor(told: ResizeObserverCallback) {
      observer = { told, itself: this };
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  globalThis.ResizeObserver = real;
  document.documentElement.removeAttribute('data-lo-resizing');
  document.body.replaceChildren();
});

/** What a resize observer says of `target`, `width` wide and `height` tall. */
function sized(target: Element, width: number, height: number): ResizeObserverEntry {
  const size = { blockSize: height, inlineSize: width };
  return {
    target,
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
    contentRect: new DOMRect(0, 0, width, height),
  };
}

/** Tells the sizes the content was drawn `width` wide, and, with `thread`, it `height` tall. */
function draw(content: HTMLElement, width: number, thread?: HTMLElement, height = 0): void {
  const entries = [sized(content, width, 800)];
  if (thread) entries.push(sized(thread, width, height));
  if (observer) observer.told(entries, observer.itself);
}

describe('ThreadSizes', () => {
  it('keeps the heights a drag passes through only at the width it ends at', () => {
    const content = document.body.appendChild(document.createElement('div'));
    const thread = content.appendChild(document.createElement('div'));
    thread.dataset.thread = 't1';
    const sizes = new ThreadSizes(content);
    draw(content, 600, thread, 120);
    expect(sizes.drawn('t1')).toBe(120);

    document.documentElement.dataset.loResizing = 'col';
    for (let width = 601; width <= 700; width += 1) draw(content, width, thread, 220 - width / 10);
    // Mid-drag, the height it was drawn at a moment ago.
    expect(sizes.drawn('t1')).toBe(150);
    document.documentElement.removeAttribute('data-lo-resizing');
    expect(sizes.drawn('t1')).toBe(150);

    // Back at widths it passed through, nothing was kept; where it started, what was drawn then.
    draw(content, 650);
    expect(sizes.drawn('t1')).toBeUndefined();
    draw(content, 600);
    expect(sizes.drawn('t1')).toBe(120);
    sizes.destroy();
  });
});
