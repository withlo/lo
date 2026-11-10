import { describe, expect, test, vi } from 'vitest';

import { diffLines, diffText, linesOf, lineWords, rowCount, rowOf, splitLines } from './file.ts';
import { DefaultLinesDiffComputer } from './vscode/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts';

/** Lines `line 1` to `line count`. */
function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

describe('splitLines', () => {
  test('splits at each line break, leaving out the \\r of a \\r\\n', () => {
    expect(splitLines('a\r\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  test('keeps a \\r on its own in its line, as git does', () => {
    expect(splitLines('a\rb\nc')).toEqual(['a\rb', 'c']);
  });

  test('ends the last line at a final line break', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('diffText', () => {
  test('finds nothing in a file that didn’t change', () => {
    const diff = diffText('a\nb\n', 'a\nb\n');

    expect(diff.changes).toEqual([]);
    expect(diff.rows).toEqual([
      { row: 0, old: 1, new: 1, oldCount: 2, newCount: 2, changed: false },
    ]);
    expect(diff.hunks).toEqual([]);
  });

  test('highlights a changed word as a whole word', () => {
    const diff = diffText('const total = price + tax;\n', 'const total = price + taxes;\n');

    expect(diff.changes).toEqual([
      {
        old: { start: 1, end: 2 },
        new: { start: 1, end: 2 },
        oldWords: [{ line: 1, from: 22, to: 25 }],
        newWords: [{ line: 1, from: 22, to: 27 }],
      },
    ]);
  });

  test('extends a change to the whole word in any script, with underscores', () => {
    const [accent] = diffText('const café = 1;\n', 'const cafè = 1;\n').changes;
    const [snake] = diffText('foo_bar();\n', 'foo_baz();\n').changes;

    expect(accent?.oldWords).toEqual([{ line: 1, from: 6, to: 10 }]);
    expect(snake?.oldWords).toEqual([{ line: 1, from: 0, to: 7 }]);
    expect(snake?.newWords).toEqual([{ line: 1, from: 0, to: 7 }]);
  });

  test('never splits a character people see', () => {
    // An emoji is two UTF-16 units, and a family of emoji joined is one character.
    const [emoji] = diffText('x \u{1F600} y\n', 'x \u{1F601} y\n').changes;
    const [joined] = diffText(
      'a \u{1F469}\u200D\u{1F4BB} b\n',
      'a \u{1F469}\u200D\u{1F52C} b\n',
    ).changes;
    const [accent] = diffText('(e\u0301)\n', '(e\u0300)\n').changes;

    expect(emoji?.oldWords).toEqual([{ line: 1, from: 2, to: 4 }]);
    expect(emoji?.newWords).toEqual([{ line: 1, from: 2, to: 4 }]);
    expect(joined?.newWords).toEqual([{ line: 1, from: 2, to: 7 }]);
    expect(accent?.newWords).toEqual([{ line: 1, from: 1, to: 3 }]);
  });

  test('never splits a character in a moved line’s words', () => {
    expect(lineWords('x \u{1F600} y', 'x \u{1F601} y')).toEqual({
      old: [{ line: 1, from: 2, to: 4 }],
      new: [{ line: 1, from: 2, to: 4 }],
    });
  });

  test('highlights no words in a line that changed completely', () => {
    const [change] = diffText('one\ntwo\n', 'uno\ndos\n').changes;

    expect(change).toEqual({
      old: { start: 1, end: 3 },
      new: { start: 1, end: 3 },
      oldWords: [],
      newWords: [],
    });
  });

  test('highlights a change of indentation', () => {
    const [change] = diffText('  a\n', 'a\n').changes;

    expect(change?.oldWords).toEqual([{ line: 1, from: 0, to: 2 }]);
    expect(change?.newWords).toEqual([]);
  });

  test('can leave out changes of indentation', () => {
    expect(diffText('  a\n', 'a\n', { whitespace: false }).changes).toEqual([]);
  });

  test('changes a line whose ending alone changed', () => {
    const diff = diffText('a\r\nb\r\nc\r\n', 'a\r\nb\nc\r\n');

    expect(diff.changes).toEqual([
      { old: { start: 2, end: 3 }, new: { start: 2, end: 3 }, oldWords: [], newWords: [] },
    ]);
    expect(diff.lineEndings).toEqual({ old: 'crlf', new: 'mixed' });
  });

  test('changes every line when a file’s line endings change', () => {
    const diff = diffText('a\r\nb\r\n', 'a\nb\n');

    expect(diff.changes).toEqual([
      { old: { start: 1, end: 3 }, new: { start: 1, end: 3 }, oldWords: [], newWords: [] },
    ]);
    expect(diff.lineEndings).toEqual({ old: 'crlf', new: 'lf' });
  });

  test('can leave out changes of line endings with whitespace', () => {
    expect(diffText('a\r\nb\r\n', 'a\nb\n', { whitespace: false }).changes).toEqual([]);
  });

  test('counts lines as git does, with a \\r on its own inside a line', () => {
    const diff = diffText('a\rb\nc\n', 'a\rb\nd\n');

    expect(diff.oldLineCount).toBe(2);
    expect(diff.changes[0]?.new).toEqual({ start: 2, end: 3 });
  });

  test('treats a single blank line as a line, not as an empty file', () => {
    expect(diffText('\n', '\nfoo\n').changes).toEqual([
      { old: { start: 2, end: 2 }, new: { start: 2, end: 3 }, oldWords: [], newWords: [] },
    ]);
    expect(diffText('\nfoo\n', 'foo\n').changes).toEqual([
      { old: { start: 1, end: 2 }, new: { start: 1, end: 1 }, oldWords: [], newWords: [] },
    ]);
    expect(diffText('\n', 'foo\n').changes).toHaveLength(1);
    expect(diffText('\n', '\n').changes).toEqual([]);
  });

  test('finds the change in a last line that holds a NUL', () => {
    const diff = diffText('a\nb', 'a\nb\0\n');

    expect(diff.changes.map(({ old, new: added }) => [old, added])).toEqual([
      [
        { start: 2, end: 3 },
        { start: 2, end: 3 },
      ],
    ]);
  });

  test('comes out whole when VS Code’s diff fails, so other files go on', () => {
    const spy = vi
      .spyOn(DefaultLinesDiffComputer.prototype, 'computeDiff')
      .mockImplementationOnce(() => {
        throw new Error('Assertion Failed');
      });
    try {
      const diff = diffText('a\nb\n', 'a\nc\n');

      expect(diff.approximate).toBe(true);
      expect(diff.changes).toEqual([
        { old: { start: 1, end: 3 }, new: { start: 1, end: 3 }, oldWords: [], newWords: [] },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  test('takes a budget of 0 as no limit, and refuses a negative one', () => {
    const old = Array.from({ length: 500 }, (_, index) => `old ${index}`);
    const added = Array.from({ length: 500 }, (_, index) => `new ${index}`);

    expect(diffLines(old, added, { budget: 0 }).approximate).toBe(false);
    expect(() => diffLines(old, added, { budget: -1 })).toThrow(RangeError);
    expect(() => diffLines(old, added, { budget: Number.NaN })).toThrow(RangeError);
  });

  test('changes the last line when only one side ends with a line break', () => {
    const diff = diffText('a\nb', 'a\nb\n');

    expect(diff.noNewlineAtEnd).toEqual({ old: true, new: false });
    expect(diff.changes).toEqual([
      { old: { start: 2, end: 3 }, new: { start: 2, end: 3 }, oldWords: [], newWords: [] },
    ]);
  });

  test('gives an added file every line as added', () => {
    const diff = diffText(undefined, 'a\nb\n');

    expect(diff).toMatchObject({ oldLineCount: 0, newLineCount: 2 });
    expect(diff.changes).toEqual([
      { old: { start: 1, end: 1 }, new: { start: 1, end: 3 }, oldWords: [], newWords: [] },
    ]);
    expect(diff.rows).toEqual([
      { row: 0, old: 1, new: 1, oldCount: 0, newCount: 2, changed: true },
    ]);
  });

  test('gives a removed file every line as removed', () => {
    expect(diffText('a\n', undefined).changes).toEqual([
      { old: { start: 1, end: 2 }, new: { start: 1, end: 1 }, oldWords: [], newWords: [] },
    ]);
  });

  test('settles for a coarser diff past its budget', () => {
    // Two long files with nothing in common take the line diff far past a millisecond.
    const old = Array.from({ length: 5000 }, (_, index) => `old ${index}`);
    const added = Array.from({ length: 5000 }, (_, index) => `new ${index}`);

    const diff = diffLines(old, added, { budget: 1 });

    expect(diff.approximate).toBe(true);
    expect(diff.changes).toHaveLength(1);
  });
});

describe('rows', () => {
  // Line 3 becomes three lines, so the new side has two more rows' worth of lines from there.
  const diff = diffText(
    numbered(5).join('\n'),
    [...numbered(2), 'x', 'y', 'z', 'line 4', 'line 5'].join('\n'),
  );

  test('pair unchanged lines one for one, and a change’s lines by index', () => {
    expect(diff.rows).toEqual([
      { row: 0, old: 1, new: 1, oldCount: 2, newCount: 2, changed: false },
      { row: 2, old: 3, new: 3, oldCount: 1, newCount: 3, changed: true },
      { row: 5, old: 4, new: 6, oldCount: 2, newCount: 2, changed: false },
    ]);
    expect(rowCount(diff)).toBe(7);
  });

  test('find the row of a line on either side', () => {
    expect(rowOf(diff, 'old', 3)).toBe(2);
    expect(rowOf(diff, 'old', 4)).toBe(5);
    expect(rowOf(diff, 'new', 5)).toBe(4);
    expect(rowOf(diff, 'new', 6)).toBe(5);
    expect(rowOf(diff, 'old', 6)).toBeUndefined();
  });

  test('find the lines on a row', () => {
    expect(linesOf(diff, 2)).toEqual({ old: 3, new: 3 });
    expect(linesOf(diff, 3)).toEqual({ new: 4 });
    expect(linesOf(diff, 6)).toEqual({ old: 5, new: 7 });
    expect(linesOf(diff, 7)).toEqual({});
  });
});

describe('hunks', () => {
  test('keep three unchanged lines around each change', () => {
    const old = numbered(20);
    const diff = diffLines(old, old.with(9, 'changed'));

    expect(diff.hunks).toEqual([
      { old: { start: 7, end: 14 }, new: { start: 7, end: 14 }, changes: { start: 0, end: 1 } },
    ]);
  });

  test('join changes whose context meets', () => {
    // Six unchanged lines between two changes are all context; seven leave one to collapse.
    const old = numbered(20);
    const near = diffLines(old, old.with(4, 'a').with(11, 'b'));
    const far = diffLines(old, old.with(4, 'a').with(12, 'b'));

    expect(near.hunks).toEqual([
      { old: { start: 2, end: 16 }, new: { start: 2, end: 16 }, changes: { start: 0, end: 2 } },
    ]);
    expect(far.hunks).toHaveLength(2);
  });

  test('stop at the ends of the file', () => {
    const old = numbered(4);
    const diff = diffLines(old, old.with(0, 'first').with(3, 'last'));

    expect(diff.hunks).toEqual([
      { old: { start: 1, end: 5 }, new: { start: 1, end: 5 }, changes: { start: 0, end: 2 } },
    ]);
  });
});
