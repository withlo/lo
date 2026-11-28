// @vitest-environment jsdom
// Where the element that holds a pane's end is put, by what the pane says of its scroll: jsdom lays
// nothing out, so the pane says it here, and the spec in Chromium (`e2e/ends.spec.ts`) checks that
// nothing on screen moves.

import { afterEach, beforeEach, expect, it } from 'vitest';

import { keepEnd } from './ends.ts';

let pane: HTMLElement;
/** What the pane scrolls: as tall as `content`, `height` of it on screen, from `top`. */
const scroll = { top: 0, height: 400, content: 1000 };
/** What the pane's size is told to. */
let resized: (() => void) | undefined;

beforeEach(() => {
  pane = document.body.appendChild(document.createElement('div'));
  pane.append(document.createElement('p'));
  Object.defineProperties(pane, {
    scrollTop: {
      get: () => scroll.top,
      set: (to: number) => {
        scroll.top = to;
      },
    },
    clientHeight: { get: () => scroll.height },
    scrollHeight: { get: () => scroll.content },
  });
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resized = () => callback([], this);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      resized = undefined;
    }
  };
  Object.assign(scroll, { top: 0, height: 400, content: 1000 });
});

afterEach(() => {
  document.body.replaceChildren();
  resized = undefined;
});

/** The element that holds the end, and how far down its foot is. */
function held(): { element: HTMLElement; foot: number } {
  const element = pane.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('Nothing holds the end.');
  return { element, foot: Number.parseFloat(element.style.top) + 1 };
}

it('holds the end at the screen’s foot, first in the pane and out of its flow', () => {
  const stop = keepEnd(pane);
  const { element, foot } = held();
  expect(element.dataset['loEnd']).toBe('');
  expect(element.getAttribute('aria-hidden')).toBe('true');
  expect(element.style.position).toBe('absolute');
  expect(element.nextElementSibling?.tagName).toBe('P');
  expect(foot).toBe(400);
  stop();
  expect(pane.querySelector('[data-lo-end]')).toBeNull();
});

it('follows the screen’s foot as the pane scrolls, either way, and as it changes height', () => {
  keepEnd(pane);
  scroll.top = 600;
  pane.dispatchEvent(new Event('scroll'));
  expect(held().foot).toBe(1000);
  // Scrolled back up, room held under the screen goes with it.
  scroll.top = 450;
  pane.dispatchEvent(new Event('scroll'));
  expect(held().foot).toBe(850);
  scroll.height = 300;
  resized?.();
  expect(held().foot).toBe(750);
});

it('is never further down than what the pane scrolls, so it makes no room of its own', () => {
  keepEnd(pane);
  scroll.top = 600.4;
  pane.dispatchEvent(new Event('scroll'));
  expect(held().foot).toBe(1000);
});

it('lets go once stopped: the pane’s scroll moves it no more', () => {
  const stop = keepEnd(pane);
  const { element } = held();
  stop();
  scroll.top = 600;
  pane.dispatchEvent(new Event('scroll'));
  expect(element.style.top).toBe('399px');
  expect(resized).toBeUndefined();
});
