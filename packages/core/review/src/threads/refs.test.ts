import { describe, expect, test } from 'vitest';

import { Line } from '../threads.ts';
import { lineRefText } from './refs.ts';

describe('a line reference in words', () => {
  test('names a line, a span, the old side, the file, and the revision last', () => {
    expect(lineRefText({ lines: { end: Line.right(41) } })).toBe('Line 41');
    expect(lineRefText({ lines: { start: null, end: Line.left(30) } })).toBe('Line 30, removed');
    expect(lineRefText({ lines: { start: Line.right(39), end: Line.right(41) } })).toBe(
      'Lines 39–41',
    );
    expect(lineRefText({ lines: { start: Line.left(3), end: Line.right(5) } })).toBe(
      'Line 3, removed, to line 5',
    );
    expect(lineRefText({ lines: null })).toBe('File');
    expect(lineRefText({ lines: { end: Line.right(9) }, revision: 'r1' })).toBe('Line 9 · r1');
    // No line to name: the revision alone.
    expect(lineRefText({ lines: undefined, revision: 'r1' })).toBe('r1');
  });

  test('starts in lower case after other words on its line', () => {
    expect(lineRefText({ lines: { end: Line.right(2) } }, true)).toBe('line 2');
    expect(lineRefText({ lines: { end: Line.left(30) } }, true)).toBe('line 30, removed');
  });
});
