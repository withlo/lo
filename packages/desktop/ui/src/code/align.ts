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
  /**
   * The row after the last, with lines on both sides: only its top is lined up, so that rows on
   * one side at the end are caught up with on the other.
   */
  end?: boolean;
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
 * How far a spacer already there may be from the height worked out before it's changed. Heights
 * measured a fraction differently from one pass to the next would otherwise change spacers back
 * and forth, each change a transaction, every frame.
 */
export const tolerance = 0.25;

/** The height of the spacer already at a row's place on one side, if there is one. */
export type CurrentSpacer = (
  side: 'old' | 'new',
  row: number,
  place: 'above' | 'below',
) => number | undefined;

/** Whether the spacer below a row's lines on one side has to stay as it is. */
export type HeldBelow = (side: 'old' | 'new', row: number) => boolean;

/**
 * The spacers that line up `rows`, which start at height `oldTop` on the old side and `newTop` on
 * the new. Every row with lines on both sides then starts at the same height on both sides, and
 * ends at the same height. A row with lines on one side only pushes that side down, and the other
 * side catches up above the next row with lines on both. Where `current` has a spacer within
 * `tolerance` of the height needed, it stays, and what it leaves over is caught up at the next
 * place. Where `held` says the spacer below a row's lines stays, it does, and that side catches up
 * at the next place.
 */
export function alignRows(
  rows: readonly RowHeights[],
  oldTop: number,
  newTop: number,
  current: CurrentSpacer = () => undefined,
  held: HeldBelow = () => false,
): Spacer[] {
  const spacers: Spacer[] = [];
  let oldAt = oldTop;
  let newAt = newTop;
  rows.forEach((row, index) => {
    if (row.old && row.new) {
      // The tops of the lines, then the bottoms of what's under them.
      oldAt += row.old.above;
      newAt += row.new.above;
      catchUp(index, 'above');
      if (row.end) return;
      oldAt += row.old.body;
      newAt += row.new.body;
      catchUp(index, 'below');
    } else if (row.old) {
      oldAt += row.old.above + row.old.body;
    } else if (row.new) {
      newAt += row.new.above + row.new.body;
    }
  });
  return spacers;

  function catchUp(row: number, place: 'above' | 'below'): void {
    if (place === 'below') {
      for (const side of ['old', 'new'] as const) {
        if (!held(side, row)) continue;
        const height = current(side, row, place) ?? 0;
        if (height > 0) spacers.push({ side, row, place, height });
        if (side === 'new') newAt += height;
        else oldAt += height;
      }
    }
    const ahead = oldAt - newAt;
    const side = ahead > 0 ? 'new' : 'old';
    if (place === 'below' && held(side, row)) return;
    const kept = current(side, row, place);
    const height =
      kept !== undefined && Math.abs(kept - Math.abs(ahead)) < tolerance
        ? kept
        : Math.abs(ahead) < epsilon
          ? 0
          : Math.abs(ahead);
    if (height > 0) spacers.push({ side, row, place, height });
    if (side === 'new') newAt += height;
    else oldAt += height;
  }
}

/** A spacer on one side, where it's drawn in that side's document, for finding runs of them. */
export interface SpacerSpot {
  /** The line it's drawn against: its row's first line when it's above, its last when below. */
  line: number;
  place: 'above' | 'below';
  height: number;
  /** It's drawn flat whatever its run, as beside folded lines, and so is its run. */
  flat: boolean;
}

/**
 * Which of one side's spacers keep their hatch: those in a run of adjacent empty space `limit`
 * tall or less, with nothing in it drawn flat. A run is spacers with no line between them, such
 * as the one below a row's lines and the one above the next row's. So a run is hatched or flat
 * throughout, never both.
 */
export function hatchedSpots(spots: readonly SpacerSpot[], limit: number): boolean[] {
  const order = spots
    .map((spot, at) => ({ spot, at }))
    .toSorted(
      (a, b) =>
        a.spot.line - b.spot.line ||
        (a.spot.place === b.spot.place ? 0 : a.spot.place === 'above' ? -1 : 1),
    );
  const hatched = spots.map(() => false);
  let run: typeof order = [];
  const close = () => {
    const height = run.reduce((sum, { spot }) => sum + spot.height, 0);
    const keeps = height <= limit + epsilon && run.every(({ spot }) => !spot.flat);
    for (const { at } of run) hatched[at] = keeps;
    run = [];
  };
  for (const each of order) {
    const last = run.at(-1)?.spot;
    const joins =
      last !== undefined &&
      last.place === 'below' &&
      each.spot.place === 'above' &&
      each.spot.line === last.line + 1;
    if (!joins) close();
    run.push(each);
  }
  close();
  return hatched;
}
