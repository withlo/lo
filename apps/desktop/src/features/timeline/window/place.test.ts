// @vitest-environment jsdom
// Where the reader is in a timeline, kept as what main sent goes on screen: the box at its end only
// while they write in it or the list is at its end, else the keyboard's row on screen, else the
// first row on screen.

import { afterEach, describe, expect, it } from 'vitest';

import { keepPlace, readingPlace } from './place.ts';

/** Gives `element` a fixed box on screen, from `top`, `height` tall. */
function at(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: top, width: 100, height });
}

/**
 * A timeline 300 pixels tall on screen, scrolled to `scrollTop` of `scrollHeight`, holding rows
 * `keys` at the tops `tops`, 100 tall each, and the box at its end at `box`.
 */
function timeline(tops: Record<string, number>, box: number, scrollTop = 0, scrollHeight = 2000) {
  const root = document.createElement('div');
  at(root, 0, 300);
  Object.defineProperty(root, 'clientHeight', { value: 300 });
  Object.defineProperty(root, 'scrollHeight', { value: scrollHeight });
  root.scrollTop = scrollTop;
  const list = document.createElement('ol');
  for (const [key, top] of Object.entries(tops)) {
    const row = document.createElement('li');
    row.dataset['key'] = key;
    at(row, top, 100);
    list.append(row);
  }
  const end = document.createElement('div');
  end.dataset['loTimeline'] = 'box';
  const editor = document.createElement('textarea');
  end.append(editor);
  at(end, box, 120);
  root.append(list, end);
  document.body.append(root);
  return { root, editor };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('readingPlace', () => {
  it('keeps the keyboard’s row on screen, not the box beside it, while the list isn’t at its end', () => {
    const { root } = timeline({ a: -150, b: -50, c: 50, d: 150 }, 250);
    expect(readingPlace(root, 'c')).toEqual({ key: 'c', offset: 50 });
    // The keyboard's row is off screen: the first row on screen.
    expect(readingPlace(root, 'a')).toEqual({ key: 'b', offset: -50 });
    expect(readingPlace(root, undefined)).toEqual({ key: 'b', offset: -50 });
  });

  it('keeps the box while the list is at its end, or while focus is in it', () => {
    const atEnd = timeline({ c: 50, d: 150 }, 250, 1700, 2000);
    expect(readingPlace(atEnd.root, 'c')).toEqual({ key: 'box', offset: 250 });
    document.body.replaceChildren();
    const writing = timeline({ c: 50, d: 150 }, 250);
    writing.editor.focus();
    expect(readingPlace(writing.root, 'c')).toEqual({ key: 'box', offset: 250 });
  });

  it('puts back what it kept where it was, as what came above it moved it down', () => {
    const { root } = timeline({ b: -50, c: 50 }, 250, 400);
    const kept = readingPlace(root, 'c');
    const row = root.querySelector('li[data-key="c"]');
    if (!kept || !row) throw new Error('No place.');
    // A comment came above it: it's 80 pixels further down.
    at(row, 130, 100);
    keepPlace(root, kept);
    expect(root.scrollTop).toBe(480);
  });
});
