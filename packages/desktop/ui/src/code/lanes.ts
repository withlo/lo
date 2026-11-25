// Review threads' marks, in a lane of their own between the line numbers and the code: a bubble on
// the first row of each thread's last line, which says whether the thread is unresolved, resolved,
// pending or out of date, or that several end there, and a bracket up the lane from the middle of
// a range's first line to just above its bubble. The lane is there from the start, as wide with no
// marks as with them, so marks that come later change no line's width or height, and nothing on
// screen moves. The bracket runs on past what's drawn between a range's lines, such as spacers,
// threads and collapsed lines; where ranges overlap it's drawn once, over them all, each line's
// part in the colour of the shortest range over it. A file's own threads have their bubble in its
// header's row, which the header draws, since its band covers the gutters.
//
// Each editor keeps its lane's marks in its state, worked out by whoever draws the threads only
// where they change, and mapped as its text changes in between: the gutter reads them as they are,
// and asks nothing of each line as it's drawn. Its bubbles are buttons a screen reader reaches, so
// the lane is the one gutter CodeMirror's `aria-hidden` doesn't cover.

import {
  type Extension,
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  type BlockInfo,
  BlockType,
  type EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
} from '@codemirror/view';

import { type Bubble, bubbleElement, type LaneTone, sameBubble } from './bubbles.ts';
import { CollapsedWidget, FileNoteWidget, HeaderWidget } from './widgets.ts';

/**
 * A thread's range among an editor's document lines, first to last, and its colour. `tick` where
 * its first line is the range's own: not where the range runs on from the other side's lines.
 * `arriving` where its thread just came, so what's drawn of it fades in.
 */
export interface LaneRange {
  readonly from: number;
  readonly to: number;
  readonly tick: boolean;
  readonly tone: LaneTone;
  readonly arriving?: boolean | undefined;
}

/** A bubble on a line: what it says, whether its thread is open, and how it comes. */
export interface LaneBubble {
  readonly bubble: Bubble;
  readonly open: boolean;
  /** Whether its thread just came: it fades in. */
  readonly arriving?: boolean | undefined;
  /** The colour it was last drawn in, where that's changed since: it tints to its new one. */
  readonly was?: LaneTone | undefined;
}

/** Where a bracket's piece beside a line starts and ends: the cell's edge, mid-row, the bubble. */
type End = 'edge' | 'mid' | 'bubble';

/** One piece of a bracket beside a line or block, top to bottom. */
interface Piece {
  readonly from: End;
  readonly to: End;
}

/**
 * What the lane draws beside a line, a block between lines, or collapsed lines: pieces of a
 * bracket, the tick at the top of a range, and a bubble, which says whether its thread is open.
 * How it comes, fading in or tinting from the colour it had, is no part of what it draws, so a
 * cell drawn already isn't drawn again for it, and it comes so only the first time it's drawn.
 */
export class LaneMarker extends GutterMarker {
  readonly pieces: readonly Piece[];
  readonly tick: boolean;
  readonly tone: LaneTone;
  readonly bubble: Bubble | undefined;
  readonly open: boolean;
  /** Whether the bubble runs the view's command: where it doesn't, its view runs its click. */
  readonly command: boolean;
  #arriving: boolean;
  #was: LaneTone | undefined;
  override readonly elementClass = 'lo-lanecell';

  constructor(
    pieces: readonly Piece[],
    tick: boolean,
    tone: LaneTone,
    bubble: LaneBubble | undefined,
    command: boolean,
    arriving: boolean,
  ) {
    super();
    this.pieces = pieces;
    this.tick = tick;
    this.tone = tone;
    this.bubble = bubble?.bubble;
    this.open = bubble?.open ?? false;
    this.command = command;
    this.#arriving = arriving;
    this.#was = bubble?.was;
  }

  override eq(other: LaneMarker): boolean {
    return (
      other.tick === this.tick &&
      other.tone === this.tone &&
      other.open === this.open &&
      other.command === this.command &&
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
    cell.className = `lo-lanemark${this.#arriving ? ' move-swap' : ''}`;
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
      cell.append(
        bubbleElement(this.bubble, {
          open: this.open,
          className: 'lo-lanebubble',
          command: this.command,
          was: this.#was,
        }),
      );
    }
    this.#arriving = false;
    this.#was = undefined;
    return cell;
  }
}

/** The shortest of `ranges`, whose colour a bracket's piece takes. */
function shortest(ranges: readonly LaneRange[]): LaneRange | undefined {
  let best: LaneRange | undefined;
  for (const range of ranges) {
    if (!best || range.to - range.from < best.to - best.from) best = range;
  }
  return best;
}

/**
 * The lane beside document line `line`: `bubble`, where threads end on it, and the bracket of the
 * `ranges` over it. A range on one line has none. A range's own first line starts it mid-row, with
 * the tick; a line it runs on past starts it at the cell's top. Above a bubble it ends 2 px over
 * the bubble's top, and a range that runs on past the bubble's line goes on under it.
 */
export function laneAt(
  line: number,
  ranges: readonly LaneRange[],
  bubble: LaneBubble | undefined,
  command = true,
): LaneMarker | null {
  let above = false;
  let below = false;
  let starts = false;
  let arriving = bubble?.arriving ?? false;
  const over: LaneRange[] = [];
  for (const range of ranges) {
    if (range.from === range.to || range.from > line || range.to < line) continue;
    over.push(range);
    if (range.from < line || !range.tick) above = true;
    else starts = true;
    if (range.to > line) below = true;
    arriving ||= range.arriving ?? false;
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
  return new LaneMarker(pieces, tick, tone, bubble, command, arriving);
}

/** A range's bracket in an editor's text, from its first line's start to its last line's end. */
class LaneSpan extends RangeValue {
  readonly tone: LaneTone;
  /** How many lines it runs past its first: the shortest over a block colours it. */
  readonly lines: number;

  constructor(tone: LaneTone, lines: number) {
    super();
    this.tone = tone;
    this.lines = lines;
  }

  override eq(other: RangeValue): boolean {
    return other instanceof LaneSpan && other.tone === this.tone && other.lines === this.lines;
  }
}

/**
 * What the lane draws in part of an editor's text, `from` to `to`, such as a file's, in place of
 * what it drew there.
 */
export interface LaneUpdate {
  readonly from: number;
  readonly to: number;
  readonly marks: readonly Range<LaneMarker>[];
  readonly spans: readonly Range<LaneSpan>[];
}

/** The lane draws, in each part of the text, what each update says, as for a file's threads. */
export const setLane = StateEffect.define<readonly LaneUpdate[]>();

/**
 * The lane's marks for the part of `doc` from `from` to `to`, by document line: a bubble on each
 * line of `bubbles`, and the bracket of `ranges` beside each line they cover. `command` is false
 * where the bubbles' view runs their clicks itself.
 */
export function laneUpdate(
  doc: Text,
  { from, to }: { readonly from: number; readonly to: number },
  ranges: readonly LaneRange[],
  bubbles: ReadonlyMap<number, LaneBubble>,
  command = true,
): LaneUpdate {
  const lines = new Set(bubbles.keys());
  const spans: Range<LaneSpan>[] = [];
  for (const range of ranges) {
    if (range.from >= range.to) continue;
    for (let line = range.from; line <= range.to; line++) lines.add(line);
    spans.push(
      new LaneSpan(range.tone, range.to - range.from).range(
        doc.line(range.from).from,
        doc.line(range.to).to,
      ),
    );
  }
  const marks: Range<LaneMarker>[] = [];
  for (const line of [...lines].toSorted((a, b) => a - b)) {
    const marker = laneAt(line, ranges, bubbles.get(line), command);
    if (marker) marks.push(marker.range(doc.line(line).from));
  }
  return { from, to, marks, spans };
}

/** An editor's lane: the marks beside its lines, and the brackets that run past its blocks. */
interface Lane {
  readonly marks: RangeSet<LaneMarker>;
  readonly spans: RangeSet<LaneSpan>;
}

const laneField = StateField.define<Lane>({
  create: () => ({ marks: RangeSet.empty, spans: RangeSet.empty }),
  update(lane, transaction) {
    let { marks, spans } = lane;
    if (transaction.docChanged) {
      marks = marks.map(transaction.changes);
      spans = spans.map(transaction.changes);
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setLane)) continue;
      for (const { from, to, marks: drawn, spans: run } of effect.value) {
        const outside = (start: number): boolean => start < from || start > to;
        marks = marks.update({
          filterFrom: from,
          filterTo: to,
          filter: outside,
          add: drawn,
          sort: true,
        });
        spans = spans.update({
          filterFrom: from,
          filterTo: to,
          filter: outside,
          add: run,
          sort: true,
        });
      }
    }
    return marks === lane.marks && spans === lane.spans ? lane : { marks, spans };
  },
});

/**
 * The document line a block drawn between lines is beside, and whether it's drawn after it. A
 * block at a line's end is after it, and one at its start before it; on an empty line, where the
 * two are one place, by where it's drawn against the line's text.
 */
export function lineBeside(view: EditorView, block: BlockInfo): { line: number; after: boolean } {
  const line = view.state.doc.lineAt(block.from);
  if (block.from > line.from) return { line: line.number, after: true };
  if (line.from < line.to) return { line: line.number, after: false };
  const whole = view.lineBlockAt(line.from);
  const text = Array.isArray(whole.type)
    ? whole.type.find((each) => each.type === BlockType.Text)
    : whole;
  return { line: line.number, after: text !== undefined && block.top >= text.bottom };
}

/** A bracket's piece past a block, in the colour of the shortest span `covers` takes. */
function past(
  spans: RangeSet<LaneSpan>,
  from: number,
  to: number,
  covers: (start: number, end: number) => boolean,
): LaneMarker | null {
  let best: LaneSpan | undefined;
  spans.between(from, to, (start, end, span) => {
    if (covers(start, end) && (!best || span.lines < best.lines)) best = span;
  });
  if (!best) return null;
  return new LaneMarker([{ from: 'edge', to: 'edge' }], false, best.tone, undefined, true, false);
}

/** Whether `event` is on a bubble. */
function onBubble(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.lo-bubble') !== null;
}

/**
 * CodeMirror hides its gutters from screen readers: what's in the lane, the bubbles, is theirs to
 * reach, so the lane alone is let out, and every other gutter is hidden on its own.
 */
const exposed = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.#expose(view);
    }

    update(update: { view: EditorView }): void {
      this.#expose(update.view);
    }

    #expose(view: EditorView): void {
      const gutters = view.contentDOM.previousElementSibling;
      if (!gutters?.classList.contains('cm-gutters')) return;
      if (gutters.hasAttribute('aria-hidden')) gutters.removeAttribute('aria-hidden');
      for (const each of gutters.children) {
        const hidden = !each.classList.contains('lo-threadlane');
        if (each.hasAttribute('aria-hidden') === hidden) continue;
        if (hidden) each.setAttribute('aria-hidden', 'true');
        else each.removeAttribute('aria-hidden');
      }
    }
  },
);

/**
 * The threads' lane, drawn from what the editor's state keeps of it (`setLane`). A press on a
 * bubble leaves focus, and what's selected, where they are; its click is the view's, which runs the
 * bubble's command.
 */
export function threadLane(): Extension {
  return [
    laneField,
    gutter({
      class: 'lo-threadlane',
      markers: (view) => view.state.field(laneField).marks,
      widgetMarker: (view, widget, block) => {
        const { spans } = view.state.field(laneField);
        if (spans.size === 0) return null;
        // A file's own blocks, in place of its lines, aren't between them.
        if (widget instanceof HeaderWidget || widget instanceof FileNoteWidget) return null;
        // Lines a block stands in for: the bracket runs past it where a range goes on both ways.
        if (widget instanceof CollapsedWidget || block.to > block.from) {
          return past(
            spans,
            block.from,
            block.to,
            (start, end) => start < block.from && end > block.to,
          );
        }
        const { line, after } = lineBeside(view, block);
        const { from, to } = view.state.doc.line(line);
        return past(spans, from, to, (start, end) =>
          after ? start <= from && end > to : start < from && end >= to,
        );
      },
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setLane)),
        ),
      domEventHandlers: {
        mousedown: (_view, _line, event) => {
          if (!onBubble(event)) return false;
          event.preventDefault();
          return true;
        },
      },
    }),
    exposed,
  ];
}
