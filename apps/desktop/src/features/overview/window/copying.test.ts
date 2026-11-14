// Copying from a code block: a span's lines on its side, either way round, from the block's code
// view while it's drawn.

import { describe, expect, it } from 'vitest';

import { blockCode, drawnLines, spanLines } from './copying.ts';

const lines = { old: ['gone', 'kept'], new: ['kept', 'added', 'more'] };

describe('copying from a code block', () => {
  it('takes a span’s lines on its side, either way round, within the file', () => {
    expect(spanLines(lines, { file: 'f', side: 'new', from: 2, to: 3 })).toEqual(['added', 'more']);
    expect(spanLines(lines, { file: 'f', side: 'new', from: 3, to: 2 })).toEqual(['added', 'more']);
    expect(spanLines(lines, { file: 'f', side: 'old', from: 1, to: 1 })).toEqual(['gone']);
    // `4yy` on the last line takes what's left.
    expect(spanLines(lines, { file: 'f', side: 'new', from: 3, to: 6 })).toEqual(['more']);
  });

  it('reads a block’s lines while it’s drawn, and none once it’s gone', () => {
    const gone = drawnLines('overview-code1', lines);
    expect(blockCode.has('overview-code1')).toBe(true);
    expect(blockCode.lines({ file: 'overview-code1', side: 'new', from: 1, to: 2 })).toEqual([
      'kept',
      'added',
    ]);
    gone();
    expect(blockCode.has('overview-code1')).toBe(false);
  });
});
