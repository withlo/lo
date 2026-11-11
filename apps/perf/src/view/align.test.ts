import { describe, expect, test } from 'vitest';

import { alignRows } from './align.ts';

const line = { above: 0, body: 20 };

/** A spacer of 20.2 below the first row on the old side. */
function closeSpacer(side: string, row: number, place: string): number | undefined {
  return side === 'old' && row === 0 && place === 'below' ? 20.2 : undefined;
}

/** A spacer of 25 everywhere. */
function farSpacer(): number {
  return 25;
}

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
    ).toEqual([]);
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
    ).toEqual([{ side: 'old', row: 0, place: 'below', height: 20 }]);
  });

  test('fills above the next paired row for lines on one side only', () => {
    const rows = [{ old: line, new: line }, { new: line }, { new: line }, { old: line, new: line }];

    expect(alignRows(rows, 0, 0)).toEqual([{ side: 'old', row: 3, place: 'above', height: 40 }]);
  });

  test('lines up a thread on one side with a spacer on the other', () => {
    const threaded = { above: 0, body: 20 + 96 };

    expect(alignRows([{ old: threaded, new: line }], 0, 0)).toEqual([
      { side: 'new', row: 0, place: 'below', height: 96 },
    ]);
  });

  test('lines up a label above one side’s lines', () => {
    const labelled = { above: 26, body: 20 };

    expect(alignRows([{ old: line, new: labelled }], 0, 0)).toEqual([
      { side: 'old', row: 0, place: 'above', height: 26 },
    ]);
  });

  test('carries a difference in where the rows start', () => {
    expect(alignRows([{ old: line, new: line }], 100, 140)).toEqual([
      { side: 'old', row: 0, place: 'above', height: 40 },
    ]);
  });

  test('leaves the last rows on one side as they are', () => {
    expect(alignRows([{ old: line, new: line }, { old: line }], 0, 0)).toEqual([]);
  });

  test('keeps a spacer already there that is close enough, and catches up the rest later', () => {
    const wrapped = { above: 0, body: 40 };

    expect(
      alignRows(
        [
          { old: line, new: wrapped },
          { old: line, new: line },
        ],
        0,
        0,
        closeSpacer,
      ),
    ).toEqual([
      { side: 'old', row: 0, place: 'below', height: 20.2 },
      { side: 'new', row: 1, place: 'above', height: expect.closeTo(0.2) },
    ]);
  });

  test('changes a spacer already there that is too far off', () => {
    expect(alignRows([{ old: line, new: { above: 0, body: 40 } }], 0, 0, farSpacer)).toEqual([
      { side: 'old', row: 0, place: 'below', height: 20 },
    ]);
  });
});
