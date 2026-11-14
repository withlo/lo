import { describe, expect, it } from 'vitest';

import { spansOf } from './spans.ts';

describe('the lines a key acts on', () => {
  it('are the cursor’s line, and with a count as many from it', () => {
    const at = { file: 'd0', side: 'new' as const, line: 7 };
    expect(spansOf({ kind: 'line', at })).toEqual([{ file: 'd0', side: 'new', from: 7, to: 7 }]);
    expect(spansOf({ kind: 'line', at }, 3)).toEqual([{ file: 'd0', side: 'new', from: 7, to: 9 }]);
  });

  it('are the lines selected, across files and sides as they show', () => {
    const span = { file: 'd0', side: 'old' as const, from: 4, to: 2 };
    expect(spansOf({ kind: 'line', at: span }, 3)).toEqual([span]);
    const across = [
      { file: 'd0', side: 'new' as const, from: 40, to: 41 },
      { file: 'd1', side: 'new' as const, from: 1, to: 2 },
    ];
    const at = { file: 'd1', side: 'new' as const, line: 2 };
    expect(spansOf({ kind: 'line', at, across })).toEqual(across);
  });
});
