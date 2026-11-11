import { describe, expect, test } from 'vitest';

import { type Block, coverage, ranPast } from './recorder.ts';

/** Blocks from heights, top to bottom from 0, a negative height for one that shows nothing. */
function blocks(...heights: number[]): Block[] {
  let top = 0;
  return heights.map((height) => {
    const block = { top, bottom: top + Math.abs(height), blank: height < 0 };
    top = block.bottom;
    return block;
  });
}

function cover(drawn: Block[], top: number, bottom: number) {
  return coverage(drawn.length, (index) => drawn[index]!, top, bottom, 4000);
}

describe('coverage', () => {
  test('finds nothing undrawn when the screen is all drawn, and what runs on past it', () => {
    // A gap, 1,000 px drawn, a gap: the screen from 300 to 700.
    const drawn = blocks(-200, ...Array.from({ length: 50 }, () => 20), -5000);
    expect(cover(drawn, 300, 700)).toEqual({ undrawn: 0, above: 100, below: 500 });
  });

  test('counts the part of the screen a gap covers', () => {
    const drawn = blocks(...Array.from({ length: 20 }, () => 20), -1000, 400);
    // Lines from the start of the content end at 400; the gap runs to 1,400.
    expect(cover(drawn, 300, 700)).toEqual({ undrawn: 300, above: 4000, below: 0 });
  });

  test('counts a gap between drawn blocks, and stops what runs on at it', () => {
    const drawn = blocks(-100, 500, -100, 500, -100, 500);
    expect(cover(drawn, 500, 1000)).toEqual({ undrawn: 100, above: 400, below: 200 });
  });

  test('counts the start and the end of the content as drawn as far as anyone could scroll', () => {
    const drawn = blocks(300, 300);
    expect(cover(drawn, 0, 400)).toEqual({ undrawn: 0, above: 4000, below: 4000 });
    expect(cover([], 0, 400)).toEqual({ undrawn: 0, above: 4000, below: 4000 });
  });

  test('leaves the screen below the end of the content alone', () => {
    const drawn = blocks(-300, 200);
    expect(cover(drawn, 350, 900)).toEqual({ undrawn: 0, above: 50, below: 4000 });
  });

  test('stops looking past what it can reach', () => {
    const drawn = blocks(...Array.from({ length: 1000 }, () => 20));
    expect(cover(drawn, 10_000, 10_500).above).toBe(4000);
    expect(cover(drawn, 10_000, 10_500).below).toBe(4000);
  });
});

describe('ranPast', () => {
  test('is how far the scroll ran past what was drawn beyond the screen, either way', () => {
    expect(ranPast(480, { above: 1000, below: 38 })).toBe(442);
    expect(ranPast(30, { above: 1000, below: 38 })).toBe(0);
    expect(ranPast(-600, { above: 500, below: 0 })).toBe(100);
    expect(ranPast(0, { above: 0, below: 0 })).toBe(0);
  });
});
