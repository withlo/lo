import { diffText } from '@lo/diff';
import { describe, expect, test } from 'vitest';

import { collapsedRuns, type FileRows, fileRows, runAt, shownRuns } from './rows.ts';

/** Lines `first` to `last` as `a-b`, `a` for one line, or `.` for none. */
function side(first: number, last: number): string {
  return first === -1 ? '.' : first === last ? `${first}` : `${first}-${last}`;
}

/** Each row as `old -> new`, with `a-b` for a range of lines, `.` for none and `*` if collapsed. */
function describeRows(rows: FileRows): string[] {
  return Array.from(rows.oldFirst, (_, row) => {
    const text = `${side(rows.oldFirst[row]!, rows.oldLast[row]!)} -> ${side(rows.newFirst[row]!, rows.newLast[row]!)}`;
    return rows.collapsed[row] ? `${text} *` : text;
  });
}

function numbered(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join('');
}

describe('fileRows', () => {
  test('pairs unchanged lines one for one and a change’s lines by index', () => {
    const diff = diffText('a\nb\nc\n', 'a\nx\ny\nc\n');
    // The header is on document line 10 on the old side and 20 on the new.
    const rows = fileRows(
      { header: 10, count: 3 },
      { header: 20, count: 4 },
      { kind: 'diff', diff },
    );

    expect(describeRows(rows)).toEqual(['10 -> 20', '11 -> 21', '12 -> 22', '. -> 23', '13 -> 24']);
  });

  test('makes each collapsed run one row', () => {
    const old = numbered(20);
    const diff = diffText(old, old.replace('line 10\n', 'ten\n'));
    const rows = fileRows(
      { header: 1, count: 20 },
      { header: 1, count: 20 },
      { kind: 'diff', diff },
    );

    expect(describeRows(rows)).toEqual([
      '1 -> 1',
      '2-7 -> 2-7 *',
      '8 -> 8',
      '9 -> 9',
      '10 -> 10',
      '11 -> 11',
      '12 -> 12',
      '13 -> 13',
      '14 -> 14',
      '15-21 -> 15-21 *',
    ]);
  });

  test('gives an added file no lines on the old side', () => {
    const diff = diffText(undefined, 'a\nb\n');
    const rows = fileRows({ header: 5, count: 0 }, { header: 7, count: 2 }, { kind: 'diff', diff });

    expect(describeRows(rows)).toEqual(['5 -> 7', '. -> 8', '. -> 9']);
  });

  test('collapses a whole file into one row until its diff is ready', () => {
    const rows = fileRows({ header: 1, count: 3 }, { header: 1, count: 0 }, { kind: 'collapsed' });

    expect(describeRows(rows)).toEqual(['1 -> 1', '2-4 -> . *']);
  });
});

describe('collapsedRuns', () => {
  test('keep a line with a thread shown', () => {
    const old = numbered(30);
    const diff = diffText(old, old.replace('line 5\n', 'five\n'));

    expect(collapsedRuns(diff, { old: new Set([20]), new: new Set() })).toEqual([
      { old: { first: 9, last: 19 }, new: { first: 9, last: 19 } },
      { old: { first: 21, last: 30 }, new: { first: 21, last: 30 } },
    ]);
  });

  test('are the unchanged lines outside every hunk', () => {
    const old = numbered(30);
    const diff = diffText(old, old.replace('line 5\n', 'five\n').replace('line 25\n', 'x\n'));

    expect(collapsedRuns(diff)).toEqual([
      { old: { first: 9, last: 21 }, new: { first: 9, last: 21 } },
      { old: { first: 29, last: 30 }, new: { first: 29, last: 30 } },
    ]);
  });
});

describe('shownRuns', () => {
  test('leaves out the runs opened, by their first old line', () => {
    const old = numbered(30);
    const diff = diffText(old, old.replace('line 5\n', 'five\n').replace('line 25\n', 'x\n'));

    expect(shownRuns(diff, undefined, new Set([9]))).toEqual([
      { old: { first: 29, last: 30 }, new: { first: 29, last: 30 } },
    ]);
  });

  test('gives rows that show an opened run line by line', () => {
    const old = numbered(12);
    const diff = diffText(old, old.replace('line 1\n', 'one\n'));
    const rows = fileRows(
      { header: 1, count: 12 },
      { header: 1, count: 12 },
      { kind: 'diff', diff, open: new Set([5]) },
    );

    // A header on document line 1, then the file's lines: the run of lines 5 to 12 is open.
    expect(describeRows(rows)).toHaveLength(13);
    expect(describeRows(rows).slice(5, 8)).toEqual(['6 -> 6', '7 -> 7', '8 -> 8']);
  });
});

describe('runAt', () => {
  test('finds the run with a line on either side', () => {
    const runs = [
      { old: { first: 3, last: 6 }, new: { first: 5, last: 8 } },
      { old: { first: 10, last: 12 }, new: { first: 12, last: 14 } },
    ];

    expect(runAt(runs, 'old', 4)).toBe(runs[0]);
    expect(runAt(runs, 'new', 12)).toBe(runs[1]);
    expect(runAt(runs, 'new', 9)).toBeUndefined();
  });
});
