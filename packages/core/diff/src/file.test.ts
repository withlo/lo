import { describe, expect, test } from 'vitest';

import { diffLines, diffText, linesOf, rowCount, rowOf, splitLines } from './file.ts';

/** Lines `line 1` to `line count`. */
function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

describe('splitLines', () => {
  test('splits at every kind of line break', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
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

  test('doesn’t compare line breaks', () => {
    expect(diffText('a\r\nb\r\n', 'a\nb\n').changes).toEqual([]);
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
