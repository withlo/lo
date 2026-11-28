// Picking lines with the pointer: where a range's far end rests, and when the pane scrolls under a
// pointer held near its top or foot. The drag itself, which needs the page's layout, is in
// `e2e/code.spec.ts`.

import { expect, test } from 'vitest';

import { restingEnd, SCROLL_REACH, SCROLL_STEP, scrollFor } from './pick.ts';

test('a far end rests on the nearest line it may, going back toward the start, or on the start', () => {
  const rests = (line: number): boolean => [3, 4, 9, 10].includes(line);
  // Down from line 2: line 12 can't, so 10; in the fold at 7, back to 4.
  expect(restingEnd(2, 12, rests)).toBe(10);
  expect(restingEnd(2, 7, rests)).toBe(4);
  expect(restingEnd(2, 9, rests)).toBe(9);
  // Up from line 12, the same way round.
  expect(restingEnd(12, 1, rests)).toBe(3);
  expect(restingEnd(12, 6, rests)).toBe(9);
  // None between: the start itself.
  expect(restingEnd(5, 8, rests)).toBe(5);
  expect(restingEnd(5, 5, rests)).toBe(5);
});

test('the pane scrolls a step a frame with the pointer near its top or its foot, or past them', () => {
  const band = { top: 100, bottom: 500 };
  expect(scrollFor(300, band)).toBe(0);
  expect(scrollFor(band.top + SCROLL_REACH, band)).toBe(0);
  expect(scrollFor(band.top + SCROLL_REACH - 1, band)).toBe(-SCROLL_STEP);
  expect(scrollFor(20, band)).toBe(-SCROLL_STEP);
  expect(scrollFor(band.bottom - SCROLL_REACH, band)).toBe(0);
  expect(scrollFor(band.bottom - SCROLL_REACH + 1, band)).toBe(SCROLL_STEP);
  expect(scrollFor(700, band)).toBe(SCROLL_STEP);
});
