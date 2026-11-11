import { diffText } from '@lo/diff';
import { describe, expect, test } from 'vitest';

import { InlineLayout, inlineLines, inlineText } from './inline.ts';

describe('inlineLines', () => {
  test('puts a change’s deleted lines before its added ones, and unchanged lines once', () => {
    const diff = diffText('a\nb\nc\nd\n', 'a\nx\ny\nd\n');
    const lines = inlineLines(diff);

    expect(Array.from(lines.old)).toEqual([1, 2, 3, 0, 0, 4]);
    expect(Array.from(lines.new)).toEqual([1, 0, 0, 2, 3, 4]);
    expect(Array.from(lines.ofOld)).toEqual([0, 1, 2, 3, 6]);
    expect(Array.from(lines.ofNew)).toEqual([0, 1, 4, 5, 6]);
    expect(inlineText(lines, ['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'])).toEqual([
      'a',
      'b',
      'c',
      'x',
      'y',
      'd',
    ]);
  });

  test('gives an added file its new lines alone', () => {
    const lines = inlineLines(diffText(undefined, 'a\nb\n'));

    expect(Array.from(lines.old)).toEqual([0, 0]);
    expect(Array.from(lines.new)).toEqual([1, 2]);
  });
});

describe('InlineLayout', () => {
  const twoLines = inlineLines(diffText('a\n', 'b\n'));

  test('places each file after the one before, a header and then its lines', () => {
    const layout = new InlineLayout([
      { path: 'one', lines: twoLines, text: ['a', 'b'] },
      { path: 'two' },
      { path: 'three', lines: twoLines, text: ['a', 'b'] },
    ]);

    expect(layout.text).toBe('one\na\nb\ntwo\nthree\na\nb');
    expect(layout.files).toEqual([
      { header: 1, count: 2 },
      { header: 4, count: 0 },
      { header: 5, count: 2 },
    ]);
    expect(layout.lineAt(3)).toEqual({ file: 0, old: 0, new: 1 });
    expect(layout.lineAt(4)).toEqual({ file: 1, old: 0, new: 0 });
    expect(layout.docLine(2, 'old', 1)).toBe(6);
  });

  test('moves the files after one whose lines arrive', () => {
    const layout = new InlineLayout([
      { path: 'one' },
      { path: 'two', lines: twoLines, text: ['a', 'b'] },
    ]);

    layout.setLines(0, twoLines);

    expect(layout.files).toEqual([
      { header: 1, count: 2 },
      { header: 4, count: 2 },
    ]);
    expect(layout.fileAt(5)).toBe(1);
  });
});
