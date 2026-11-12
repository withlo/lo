// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { nextUnviewed } from './viewed.ts';

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
