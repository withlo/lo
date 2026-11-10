import { describe, expect, test } from 'vitest';

import { alignRows } from './align.ts';

const line = { above: 0, body: 20 };

describe('alignRows', () => {
  test('adds nothing where both sides are as tall', () => {
    expect(
      alignRows(
        [
          { old: line, new: line },
          { old: line, new: line },
        ],
        0,
        0,
      ),
    ).toEqual({
      spacers: [],
    });
  });

  test('fills under the shorter side of a row, such as a line that wraps on one side only', () => {
    const wrapped = { above: 0, body: 40 };

    expect(
      alignRows(
        [
          { old: line, new: wrapped },
          { old: line, new: line },
        ],
        0,
        0,
      ),
    ).toEqual({
      spacers: [{ side: 'old', row: 0, place: 'below', height: 20 }],
    });
  });

  test('fills above the next paired row for lines on one side only', () => {
    const rows = [{ old: line, new: line }, { new: line }, { new: line }, { old: line, new: line }];

    expect(alignRows(rows, 0, 0)).toEqual({
      spacers: [{ side: 'old', row: 3, place: 'above', height: 40 }],
    });
  });

  test('lines up a thread on one side with a spacer on the other', () => {
    const threaded = { above: 0, body: 20 + 96 };

    expect(alignRows([{ old: threaded, new: line }], 0, 0).spacers).toEqual([
      { side: 'new', row: 0, place: 'below', height: 96 },
    ]);
  });

  test('lines up a label above one side’s lines', () => {
    const labelled = { above: 26, body: 20 };

    expect(alignRows([{ old: line, new: labelled }], 0, 0).spacers).toEqual([
      { side: 'old', row: 0, place: 'above', height: 26 },
    ]);
  });

  test('carries a difference in where the rows start', () => {
    expect(alignRows([{ old: line, new: line }], 100, 140).spacers).toEqual([
      { side: 'old', row: 0, place: 'above', height: 40 },
    ]);
  });

  test('says how far behind a side ends when the last rows are on one side', () => {
    expect(alignRows([{ old: line, new: line }, { old: line }], 0, 0)).toEqual({
      spacers: [],
      end: { side: 'new', height: 20 },
    });
  });
});
