// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { marksFrom, nextUnviewed } from './viewed.ts';

const order = ['d0', 'd1', 'd2', 'd3'];

/** Says `ids` are viewed. */
const viewed = (ids: string[]) => (id: string) => ids.includes(id);

describe('where e goes after marking a file viewed', () => {
  it('to the next file that isn’t viewed, in the order the diff shows them', () => {
    expect(nextUnviewed(order, 'd0', viewed(['d0', 'd1']))).toBe('d2');
  });

  it('round the end to the start', () => {
    expect(nextUnviewed(order, 'd2', viewed(['d2', 'd3']))).toBe('d0');
  });

  it('nowhere when every other file is viewed', () => {
    expect(nextUnviewed(order, 'd1', viewed(['d0', 'd1', 'd2', 'd3']))).toBeUndefined();
    expect(nextUnviewed(order, 'd1', viewed(['d0', 'd2', 'd3']))).toBeUndefined();
    expect(nextUnviewed(order, 'gone', viewed([]))).toBeUndefined();
  });
});

describe('what 3e marks', () => {
  it('that many files from the one at the cursor, and goes to the one after them', () => {
    expect(marksFrom(order, 'd0', 2, viewed([]))).toEqual({ marks: ['d0', 'd1'], next: 'd2' });
  });

  it('past files that are viewed, the one at the cursor too, and round the end', () => {
    expect(marksFrom(order, 'd1', 2, viewed(['d1', 'd3']))).toEqual({
      marks: ['d2', 'd0'],
      next: undefined,
    });
  });

  it('as many as there are when the count is more', () => {
    expect(marksFrom(order, 'd2', 10, viewed(['d0']))).toEqual({
      marks: ['d2', 'd3', 'd1'],
      next: undefined,
    });
  });
});
