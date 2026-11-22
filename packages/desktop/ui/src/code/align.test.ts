import { describe, expect, test } from 'vitest';

import { alignRows, hatchedSpots, type SpacerSpot } from './align.ts';

const line = { above: 0, body: 20 };

/** A spacer of 20.2 below the first row on the old side. */
function closeSpacer(side: string, row: number, place: string): number | undefined {
  return side === 'old' && row === 0 && place === 'below' ? 20.2 : undefined;
}

/** A spacer of 25 everywhere. */
function heldSpacer(side: string, row: number, place: string): number | undefined {
  return side === 'old' && row === 0 && place === 'below' ? 5 : undefined;
}

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

  test('keeps a spacer below lines it has to leave alone, and catches up at the next place', () => {
    expect(
      alignRows(
        [
          { old: line, new: { above: 0, body: 40 } },
          { old: line, new: line },
        ],
        0,
        0,
        heldSpacer,
        (side, row) => side === 'old' && row === 0,
      ),
    ).toEqual([
      { side: 'old', row: 0, place: 'below', height: 5 },
      { side: 'old', row: 1, place: 'above', height: 15 },
    ]);
  });
});

/** A spacer against line `at`, for `hatchedSpots`. */
function spot(at: number, place: 'above' | 'below', height: number, flat = false): SpacerSpot {
  return { line: at, place, height, flat };
}

describe('alignRows at the end of the last file', () => {
  const tail = [{ old: line, new: line }, { new: line }, { new: line }, { new: line }];

  test('catches up below the last row on both sides, as above the next file it would', () => {
    expect(alignRows(tail, 0, 0, undefined, undefined, true)).toEqual([
      { side: 'old', row: 0, place: 'below', height: 60 },
    ]);
  });

  test('leaves it to the rows after, short of the end', () => {
    expect(alignRows(tail, 0, 0)).toEqual([]);
  });

  test('adds to what the row itself catches up with there', () => {
    expect(
      alignRows(
        [{ old: line, new: { above: 0, body: 30 } }, { new: line }],
        0,
        0,
        undefined,
        undefined,
        true,
      ),
    ).toEqual([{ side: 'old', row: 0, place: 'below', height: 30 }]);
  });
});

describe('hatchedSpots', () => {
  test('keeps the hatch on a short gap, and drops it on a tall one', () => {
    expect(hatchedSpots([spot(3, 'below', 40), spot(9, 'above', 80)], 60)).toEqual([true, false]);
  });

  test('weighs a run of adjacent gaps as one, so it is hatched or flat throughout', () => {
    // Below line 4 and above line 5 touch: 40 and 40 is a run of 80.
    expect(hatchedSpots([spot(5, 'above', 40), spot(4, 'below', 40)], 60)).toEqual([false, false]);
    // Below line 4 and above line 6 have line 5 between them.
    expect(hatchedSpots([spot(4, 'below', 40), spot(6, 'above', 40)], 60)).toEqual([true, true]);
  });

  test('a run with a flat part in it is flat throughout', () => {
    expect(hatchedSpots([spot(1, 'below', 24, true), spot(2, 'above', 20)], 60)).toEqual([
      false,
      false,
    ]);
  });

  test('equal runs look equal, the last in the document too', () => {
    expect(hatchedSpots([spot(4, 'above', 60), spot(20, 'below', 60)], 60)).toEqual([true, true]);
  });

  test('a run of exactly the limit keeps its hatch', () => {
    expect(hatchedSpots([spot(2, 'below', 20), spot(3, 'above', 40)], 60)).toEqual([true, true]);
  });
});
