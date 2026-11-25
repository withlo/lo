// Review threads' marks, in a lane of their own between the line numbers and the code: a bubble on
// the first row of each thread's last line, which says whether the thread is unresolved, resolved,
// pending or out of date, or that several end there, and a bracket up the lane from the middle of
// a range's first line to just above its bubble. The lane is there from the start, as wide with no
// marks as with them, so marks that come later change no line's width or height, and nothing on
// screen moves. The bracket runs on past what's drawn between a range's lines, such as spacers,
// threads and collapsed lines; where ranges overlap it's drawn once, over them all, each line's
// part in the colour of the shortest range over it. A file's own threads have their bubble in its
// header's row, which the header draws, since its band covers the gutters.

import { StateEffect, type Extension } from '@codemirror/state';
import { type BlockInfo, type EditorView, gutter, GutterMarker } from '@codemirror/view';

import { type Bubble, bubbleElement, type LaneTone, sameBubble } from './bubbles.ts';
import { marksChanged } from './marks.ts';
import { CollapsedWidget, FileNoteWidget, HeaderWidget } from './widgets.ts';

/** The threads' marks changed, as when one is resolved or opened: the lane is drawn again. */
export const lanesChanged = StateEffect.define();

/**
 * A thread's range among an editor's document lines, first to last, and its colour. `tick` where
 * its first line is the range's own: not where the range runs on from the other side's lines.
 */
export interface LaneRange {
  readonly from: number;
  readonly to: number;
  readonly tick: boolean;
  readonly tone: LaneTone;
}

/** Where a bracket's piece beside a line starts and ends: the cell's edge, mid-row, or the bubble. */
type End = 'edge' | 'mid' | 'bubble';

/** One piece of a bracket beside a line or block, top to bottom. */
interface Piece {
  readonly from: End;
  readonly to: End;
}

/**
 * What the lane draws beside a line, a block between lines, or collapsed lines: pieces of a
 * bracket, the tick at the top of a range, and a bubble. `arriving` fades it in, as a thread comes;
 * it's no part of what it draws, so a cell drawn already isn't drawn again for it.
 */
export class LaneMarker extends GutterMarker {
  readonly pieces: readonly Piece[];
  readonly tick: boolean;
  readonly tone: LaneTone;
  readonly bubble: Bubble | undefined;
  readonly open: () => boolean;
  readonly arriving: boolean;
  /** Whether the bubble runs the view's command: where it doesn't, its view runs its click. */
  readonly command: boolean;
  override readonly elementClass = 'lo-lanecell';

  constructor(
    pieces: readonly Piece[],
    tick: boolean,
    tone: LaneTone,
    bubble: Bubble | undefined,
    open: () => boolean,
    arriving: boolean,
    command = true,
  ) {
    super();
    this.pieces = pieces;
    this.tick = tick;
    this.tone = tone;
    this.bubble = bubble;
    this.open = open;
    this.arriving = arriving;
    this.command = command;
  }

  override eq(other: LaneMarker): boolean {
    return (
      other.tick === this.tick &&
      other.tone === this.tone &&
      other.pieces.length === this.pieces.length &&
      other.pieces.every(
        (piece, index) =>
          piece.from === this.pieces[index]!.from && piece.to === this.pieces[index]!.to,
      ) &&
      sameBubble(other.bubble, this.bubble)
    );
  }

  override toDOM(): Node {
    const cell = document.createElement('span');
    cell.className = `lo-lanemark${this.arriving ? ' move-swap' : ''}`;
    for (const piece of this.pieces) {
      const drawn = document.createElement('span');
      drawn.className = `lo-bracket lo-bracket--${this.tone} lo-bracket--from-${piece.from} lo-bracket--to-${piece.to}`;
      cell.append(drawn);
    }
    if (this.tick) {
      const tick = document.createElement('span');
      tick.className = `lo-bracket lo-bracket--${this.tone} lo-bracket--tick`;
      cell.append(tick);
    }
    if (this.bubble) {
      cell.append(bubbleElement(this.bubble, this.open(), 'lo-lanebubble', this.command));
    }
    return cell;
  }
}

/** What a line, a block or a collapsed run has beside it in the lane. */
export interface LaneLine {
  readonly ranges: readonly LaneRange[];
  readonly bubble?: Bubble | undefined;
  /** Whether the bubble's thread is drawn open. */
  readonly open?: (() => boolean) | undefined;
  /** Whether what's beside it just came, and fades in. */
  readonly arriving?: boolean | undefined;
  /** Whether its bubble runs the view's command: by default it does. */
  readonly command?: boolean | undefined;
}

/** The shortest of `ranges`, whose colour a bracket's piece takes. */
function shortest(ranges: readonly LaneRange[]): LaneRange | undefined {
  let best: LaneRange | undefined;
  for (const range of ranges) {
    if (!best || range.to - range.from < best.to - best.from) best = range;
  }
  return best;
}

const CLOSED = (): boolean => false;

/**
 * The lane beside document line `line`: a bubble where threads end on it, and the bracket of the
 * ranges over it. A range on one line has none. A range's own first line starts it mid-row, with
 * the tick; a line it runs on past starts it at the cell's top. Above a bubble it ends 2 px over
 * the bubble's top, and a range that runs on past the bubble's line goes on under it.
 */
export function laneAt(
  line: number,
  { ranges, bubble, open, arriving, command }: LaneLine,
): LaneMarker | null {
  let above = false;
  let below = false;
  let starts = false;
  const over: LaneRange[] = [];
  for (const range of ranges) {
    if (range.from === range.to || range.from > line || range.to < line) continue;
    over.push(range);
    if (range.from < line || !range.tick) above = true;
    else starts = true;
    if (range.to > line) below = true;
  }
  if (over.length === 0 && !bubble) return null;
  const tone = shortest(over)?.tone ?? 'quiet';
  const pieces: Piece[] = [];
  let tick = false;
  if (bubble) {
    if (above) pieces.push({ from: 'edge', to: 'bubble' });
    if (below) pieces.push({ from: 'bubble', to: 'edge' });
  } else if (above) {
    pieces.push({ from: 'edge', to: 'edge' });
  } else if (starts) {
    pieces.push({ from: 'mid', to: 'edge' });
    tick = true;
  }
  return new LaneMarker(pieces, tick, tone, bubble, open ?? CLOSED, arriving ?? false, command);
}

/**
 * The lane beside what's drawn from `first` to `last` that isn't a line of its own: collapsed
 * lines, or, at a half, a block between two lines, as 4.5 between lines 4 and 5. The bracket runs
 * past it whole where a range goes on past it both ways; a range whose first line it hides starts
 * at the first line shown.
 */
export function laneThrough(
  first: number,
  last: number,
  ranges: readonly LaneRange[],
): LaneMarker | null {
  const over = ranges.filter((range) => range.from < first && range.to > last);
  if (over.length === 0) return null;
  return new LaneMarker(
    [{ from: 'edge', to: 'edge' }],
    false,
    shortest(over)!.tone,
    undefined,
    CLOSED,
    false,
  );
}

/** Where an editor's lane marks come from, by its document lines. */
export interface LaneSource {
  /** Whether there are any threads: without them, the lane asks no more. */
  active(): boolean;
  /** The mark beside document line `line`. */
  markerAt(line: number): GutterMarker | null;
  /** The mark beside document lines `first` to `last`, which a collapsed block holds. */
  markerThrough(first: number, last: number): GutterMarker | null;
  /** The mark beside a block drawn between lines: before document line `line`, or after it. */
  markerBetween(line: number, after: boolean): GutterMarker | null;
}

/** The document lines a line block covers, first to last. */
function linesOf(view: EditorView, block: BlockInfo): { first: number; last: number } {
  const { doc } = view.state;
  return { first: doc.lineAt(block.from).number, last: doc.lineAt(block.to).number };
}

/** Whether `event` is on a bubble. */
function onBubble(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.lo-bubble') !== null;
}

/**
 * The threads' lane, from `source`, drawn again whenever a code view's marks or threads change. A
 * press on a bubble leaves focus, and what's selected, where they are; its click is the view's,
 * which runs the bubble's command.
 */
export function threadLane(source: LaneSource): Extension {
  return gutter({
    class: 'lo-threadlane',
    lineMarker: (view, line) => {
      if (!source.active()) return null;
      const { first, last } = linesOf(view, line);
      return first === last ? source.markerAt(first) : source.markerThrough(first, last);
    },
    widgetMarker: (view, widget, block) => {
      if (!source.active()) return null;
      if (widget instanceof CollapsedWidget) {
        const { first, last } = linesOf(view, block);
        return source.markerThrough(first, last);
      }
      // A file's own blocks, in place of its lines, aren't between them.
      if (widget instanceof HeaderWidget || widget instanceof FileNoteWidget) return null;
      // A block at a line's start is drawn before it; one at its end, after it.
      const line = view.state.doc.lineAt(block.from);
      return source.markerBetween(line.number, block.from > line.from || line.from === line.to);
    },
    lineMarkerChange: (update) =>
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(marksChanged) || effect.is(lanesChanged)),
      ),
    domEventHandlers: {
      mousedown: (_view, _line, event) => {
        if (!onBubble(event)) return false;
        event.preventDefault();
        return true;
      },
    },
  });
}
