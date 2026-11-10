// The spacer pass's arithmetic: given each row's heights on both sides, the spacers that make
// every row with lines on both sides start at the same height on both sides.

/** A row's heights on one side, in pixels, without any spacers. */
export interface SideHeights {
  /** Blocks drawn above the row's lines, such as a moved block's label. */
  above: number;
  /** The row's lines, wrapped, and blocks drawn below them, such as threads. */
  body: number;
}

/** A row, with its heights on each side it has lines on. */
export interface RowHeights {
  old?: SideHeights | undefined;
  new?: SideHeights | undefined;
}

/** A spacer: empty space on one side, above or below a row's lines. */
export interface Spacer {
  side: 'old' | 'new';
  /** The row's index in the rows passed in. */
  row: number;
  place: 'above' | 'below';
  height: number;
}

/** Less than this is rounding, not a gap. */
const epsilon = 0.01;

/**
 * The spacers that line up `rows`, which start at height `oldTop` on the old side and `newTop` on
 * the new. Every row with lines on both sides then starts at the same height on both sides, and
 * ends at the same height. A row with lines on one side only pushes that side down, and the other
 * side catches up above the next row with lines on both. Where the rows end on a side ahead, the
 * other side catches up below its last row, as `end`.
 */
export function alignRows(
  rows: readonly RowHeights[],
  oldTop: number,
  newTop: number,
): { spacers: Spacer[]; end?: { side: 'old' | 'new'; height: number } } {
  const spacers: Spacer[] = [];
  let oldAt = oldTop;
  let newAt = newTop;
  rows.forEach((row, index) => {
    if (row.old && row.new) {
      // The tops of the lines, then the bottoms of what's under them.
      oldAt += row.old.above;
      newAt += row.new.above;
      catchUp(index, 'above');
      oldAt += row.old.body;
      newAt += row.new.body;
      catchUp(index, 'below');
    } else if (row.old) {
      oldAt += row.old.above + row.old.body;
    } else if (row.new) {
      newAt += row.new.above + row.new.body;
    }
  });
  const gap = oldAt - newAt;
  if (Math.abs(gap) < epsilon) return { spacers };
  return { spacers, end: { side: gap > 0 ? 'new' : 'old', height: Math.abs(gap) } };

  function catchUp(row: number, place: 'above' | 'below'): void {
    const ahead = oldAt - newAt;
    if (ahead > epsilon) {
      spacers.push({ side: 'new', row, place, height: ahead });
      newAt = oldAt;
    } else if (ahead < -epsilon) {
      spacers.push({ side: 'old', row, place, height: -ahead });
      oldAt = newAt;
    } else {
      newAt = oldAt;
    }
  }
}
