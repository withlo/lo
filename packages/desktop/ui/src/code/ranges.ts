// A range of lines in a code view's lane, drawn one way whatever it is: a review thread's, a draft's
// or an overview note's, each a bracket with its mark at the foot. The mark sits on the first row of
// the range's last line, centred in its lane: a thread's bubble or a draft's dashed one in the
// threads' lane, a note's ball in the overview's. A stem 2 px wide runs up the lane from 2 px above
// the mark to a tick 2 px tall at the middle of the first line's first row, which turns toward the
// code, through wrapped rows, folds and what's drawn between lines. A range on one line is its mark
// alone, and one whose first line is folded away starts in the fold.
//
// Ranges that overlap in a lane nest. Ordered by first line, then longest first, then as they came,
// each takes the first of three slots 4 px apart that's free over all its lines, and keeps it for
// its whole length, so the earliest start is outermost; a fourth over the same lines, and any
// deeper, shares the last. Each stem keeps its own colour, and skips the first row of a line that
// holds another range's mark, going on under it. Ranges that end on one line share its mark, and
// the ticks of those that start on one line are drawn once, at the outermost's width.
//
// A lane is as wide with no ranges as with them, and draws in no room of its own, so nothing that
// comes or goes in it moves a line. Each editor keeps a lane's cells in its state (`defineLane`),
// worked out by whoever draws the ranges, only where they change.
//
// One range is lit in a code view at a time (`lightOf`): a popover's pinned, else where a key
// landed, else what the pointer is on. Its stem and mark take their lit colours, and its rows the
// selected ground across the line numbers, the lanes and the code (`setLit`); the lines of a comment
// box being written take the ground `v` gives instead. The pointer's range takes its stem's lit
// colour whatever else is lit, and lights no lines while another does.

import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  type StateEffectType,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  type BlockInfo,
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  gutterLineClass,
  GutterMarker,
  type WidgetType,
} from '@codemirror/view';

import { CollapsedWidget, FileNoteWidget, HeaderWidget } from './widgets.ts';

/**
 * A range's colour: amber while its thread is unresolved or pending, grey once it's resolved or
 * out of date, muted for a draft's own, and Powder for an overview note.
 */
export type RangeTone = 'warn' | 'quiet' | 'muted' | 'note';

/**
 * The lanes ranges are drawn in: the threads', between the line numbers and the code, and the
 * overview's, last before the code on the side that shows new lines.
 */
export type LaneKind = 'threads' | 'notes';

/**
 * A range among an editor's document lines, first to last. `key` names it in its lane: a thread's
 * id, a draft's place, a note's key. `tick` where its first line is its own, not where it runs on
 * from the other side's lines, and `foot` where its last line is, its mark there, not where it runs
 * on into them. `arriving` where it just came, so what's drawn of it fades in.
 */
export interface LaneRange {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly tick: boolean;
  readonly foot: boolean;
  readonly tone: RangeTone;
  readonly arriving?: boolean | undefined;
}

/** How many slots a lane's stems sit in. */
export const SLOTS = 3;

/** How far apart a lane's slots are, in pixels. */
const SLOT_STEP = 4;

/** How wide a stem is, in pixels. */
const STEM = 2;

/** How far short of a lane's right edge a tick stops, in pixels. */
const TICK_SHORT = 2;

/**
 * Each lane's width and the left edge of its first slot, in pixels: the threads' lane is 16 px,
 * its slots at 2, 6 and 10; the overview's is 14 px, at 1, 5 and 9. The stylesheet sets the
 * widths; the stems are placed from these.
 */
const GEOMETRY: Record<LaneKind, { readonly width: number; readonly first: number }> = {
  threads: { width: 16, first: 2 },
  notes: { width: 14, first: 1 },
};

/** The left edge of slot `slot` in a `kind` lane, from the lane's left edge, in pixels. */
export function slotLeft(kind: LaneKind, slot: number): number {
  return GEOMETRY[kind].first + slot * SLOT_STEP;
}

/** A range with the slot its stem takes. */
export interface Slotted extends LaneRange {
  readonly slot: number;
}

/**
 * The slots of `ranges`, given oldest first. Ordered by first line, then longest first, then as
 * they came, each takes the lowest slot free over all its lines, and the last where none is. A
 * range on one line has no stem, and takes none.
 */
export function slotted(ranges: readonly LaneRange[]): Slotted[] {
  const order = ranges
    .map((range, index) => ({ range, index }))
    .filter(({ range }) => range.from < range.to)
    .toSorted(
      (a, b) =>
        a.range.from - b.range.from ||
        b.range.to - b.range.from - (a.range.to - a.range.from) ||
        a.index - b.index,
    );
  // The last line each slot is taken to, by the ranges in it so far: all start before the next.
  const taken: number[] = [];
  return order.map(({ range }) => {
    let slot = taken.findIndex((last) => last < range.from);
    if (slot < 0) slot = Math.min(taken.length, SLOTS - 1);
    taken[slot] = Math.max(taken[slot] ?? -Infinity, range.to);
    return { ...range, slot };
  });
}

/**
 * Where a stem's piece beside a row starts and ends: the cell's edge; the middle of its first row,
 * a range's own first line, with its tick; under its first row, past another range's mark there;
 * or 2 px above the row's own mark.
 */
export type End = 'edge' | 'mid' | 'under' | 'mark';

/** One piece of a range's stem beside a row, top to bottom, and whether it's lit. */
export interface Stem {
  readonly key: string;
  readonly slot: number;
  readonly tone: RangeTone;
  readonly from: End;
  readonly to: End;
  readonly lit: boolean;
}

/**
 * The tick where ranges start on a row: from the outermost's stem to 2 px short of the lane's
 * edge, in the lit one's colour where one of them is lit, else the outermost's. `under` the row's
 * mark, at the foot of its first row, where it has one, as a range starts on the line another
 * ends on.
 */
export interface Tick {
  readonly slot: number;
  readonly tone: RangeTone;
  readonly lit: boolean;
  readonly under: boolean;
}

/** What a lane draws beside a row: the pieces of the stems that pass it, and the tick. */
export interface Cell {
  readonly stems: readonly Stem[];
  readonly tick: Tick | undefined;
}

/**
 * A row of a lane: document lines `first` to `last`, one line or those a fold holds, or a block
 * drawn between two lines, half a line from them (4.5 between lines 4 and 5).
 */
export interface Row {
  readonly first: number;
  readonly last: number;
}

/**
 * What a lane draws beside `row`, from the `ranges` that cover it, `marked` where the row holds a
 * mark, and `above` where the line just above it does, with the ranges `lit` names in their lit
 * colours.
 */
export function cellOf(
  ranges: Iterable<Slotted>,
  row: Row,
  { marked, above }: { readonly marked: boolean; readonly above: boolean },
  lit: ReadonlySet<string>,
): Cell {
  const stems: Stem[] = [];
  const ticks: { slot: number; tone: RangeTone; lit: boolean }[] = [];
  for (const range of ranges) {
    if (range.from > row.last || range.to < row.first) continue;
    const starts = range.from >= row.first;
    const ends = range.to <= row.last;
    // Its lines are the row's: its mark alone.
    if (starts && ends) continue;
    const stem = { key: range.key, slot: range.slot, tone: range.tone, lit: lit.has(range.key) };
    const ticked = starts && range.tick;
    if (ticked) ticks.push({ slot: stem.slot, tone: stem.tone, lit: stem.lit });
    if (ends && range.foot) {
      // Down to 2 px above its mark, unless it skipped the row above, past another's mark: there
      // it would be a stub of a pixel, alone.
      const skipped = above && !(range.tick && range.from === row.first - 1);
      if (!skipped) stems.push({ ...stem, from: 'edge', to: 'mark' });
    } else if (marked) {
      // Past another range's mark, or from a tick under it: on under the row it's on.
      stems.push({ ...stem, from: 'under', to: 'edge' });
    } else stems.push({ ...stem, from: ticked ? 'mid' : 'edge', to: 'edge' });
  }
  const outer = ticks.reduce<(typeof ticks)[number] | undefined>(
    (best, each) => (best && best.slot <= each.slot ? best : each),
    undefined,
  );
  const shown = ticks.find((each) => each.lit) ?? outer;
  const tick = outer &&
    shown && { slot: outer.slot, tone: shown.tone, lit: shown.lit, under: marked };
  return { stems: stems.toSorted((a, b) => a.slot - b.slot), tick };
}

/** Whether two cells draw the same. */
function sameCell(a: Cell, b: Cell): boolean {
  const ticks =
    a.tick === b.tick ||
    (a.tick !== undefined &&
      b.tick !== undefined &&
      a.tick.slot === b.tick.slot &&
      a.tick.tone === b.tick.tone &&
      a.tick.lit === b.tick.lit &&
      a.tick.under === b.tick.under);
  return (
    ticks &&
    a.stems.length === b.stems.length &&
    a.stems.every((stem, index) => {
      const other = b.stems[index]!;
      return (
        stem.key === other.key &&
        stem.slot === other.slot &&
        stem.tone === other.tone &&
        stem.from === other.from &&
        stem.to === other.to &&
        stem.lit === other.lit
      );
    })
  );
}

/**
 * The range a pointer `x` pixels from a `kind` lane's left edge means, of `stems` drawn beside its
 * row: the nearest across the lane, the row split halfway between neighbouring stems. Of several
 * in one slot, the one drawn last, over the rest. None where there's no stem.
 */
export function nearestStem(
  stems: readonly { readonly key: string; readonly slot: number }[],
  x: number,
  kind: LaneKind,
): string | undefined {
  let best: { key: string; off: number } | undefined;
  for (const { key, slot } of stems) {
    const off = Math.abs(x - (slotLeft(kind, slot) + STEM / 2));
    if (!best || off <= best.off) best = { key, off };
  }
  return best?.key;
}

/**
 * A mark on a lane's row, where ranges end: what it stands for, and how it's drawn. `keys` are
 * the ranges that end there, in the order they open, so the first is what the pointer on it lights.
 */
export interface LaneMark {
  readonly keys: readonly string[];
  /** Whether what it stands for just came, so it fades in. */
  readonly arriving?: boolean | undefined;
  /** Whether it draws the same as `other`. */
  same(other: LaneMark): boolean;
  /** Its element, `lit` while one of its ranges is; `first` the first time its cell draws it. */
  draw(lit: boolean, first: boolean): HTMLElement;
}

/** The attribute a lane's stems and marks name their ranges by, for the pointer on them. */
export const RANGE_ATTRIBUTE = 'data-range';

/**
 * What a lane draws beside a line, a fold or a block between lines: the stems' pieces, the tick,
 * and the mark. `target` where the cell is the pointer's to open what it means, and tints under it.
 * How it comes, fading in, is no part of what it draws, so a cell drawn already isn't drawn again
 * for it, and comes so only the first time it's drawn.
 */
export class RangeMarker extends GutterMarker {
  readonly kind: LaneKind;
  readonly cell: Cell;
  readonly mark: LaneMark | undefined;
  readonly markLit: boolean;
  readonly target: boolean;
  #arriving: boolean;
  #first = true;
  override readonly elementClass = 'lo-lanecell';

  constructor(
    kind: LaneKind,
    cell: Cell,
    mark: LaneMark | undefined,
    { lit = false, target = false, arriving = false } = {},
  ) {
    super();
    this.kind = kind;
    this.cell = cell;
    this.mark = mark;
    this.markLit = lit;
    this.target = target;
    this.#arriving = arriving;
  }

  override eq(other: RangeMarker): boolean {
    return (
      other.kind === this.kind &&
      other.markLit === this.markLit &&
      other.target === this.target &&
      sameCell(other.cell, this.cell) &&
      (other.mark === this.mark ||
        (other.mark !== undefined && this.mark !== undefined && other.mark.same(this.mark)))
    );
  }

  override toDOM(): Node {
    const drawn = document.createElement('span');
    drawn.className = `lo-lanemark${this.#arriving ? ' move-swap' : ''}${this.target ? ' is-target move-tint' : ''}`;
    for (const stem of this.cell.stems) {
      const piece = document.createElement('span');
      piece.className = `lo-stem lo-stem--${stem.tone} lo-stem--from-${stem.from} lo-stem--to-${stem.to}${stem.lit ? ' is-lit' : ''}`;
      piece.style.left = `${slotLeft(this.kind, stem.slot)}px`;
      piece.setAttribute(RANGE_ATTRIBUTE, stem.key);
      piece.dataset.slot = String(stem.slot);
      drawn.append(piece);
    }
    const { tick } = this.cell;
    if (tick) {
      const line = document.createElement('span');
      line.className = `lo-tick lo-stem--${tick.tone}${tick.lit ? ' is-lit' : ''}${tick.under ? ' is-under' : ''}`;
      const left = slotLeft(this.kind, tick.slot);
      line.dataset.slot = String(tick.slot);
      line.style.left = `${left}px`;
      line.style.width = `${GEOMETRY[this.kind].width - TICK_SHORT - left}px`;
      drawn.append(line);
    }
    if (this.mark) {
      const mark = this.mark.draw(this.markLit, this.#first);
      if (this.mark.keys[0] !== undefined) mark.setAttribute(RANGE_ATTRIBUTE, this.mark.keys[0]);
      drawn.append(mark);
    }
    this.#arriving = false;
    this.#first = false;
    return drawn;
  }
}

/**
 * The range the pointer `event` is on in a lane means, and the lane: anywhere in a cell with a
 * mark, the mark's first, with `mark`; else the stem nearest it across the cell. Only the ranges
 * `accept` takes count, where it's given. None off a lane's cell, or on one beside no range.
 */
export function rangeUnder(
  event: { readonly target: EventTarget | null; readonly clientX: number },
  accept: (key: string) => boolean = () => true,
): { kind: LaneKind; key: string; mark: boolean } | undefined {
  const { target } = event;
  if (!(target instanceof Element)) return undefined;
  const cell = target.closest<HTMLElement>('.lo-lanemark');
  const lane = cell?.closest('.lo-threadlane, .lo-ovcolumn');
  if (!cell || !lane) return undefined;
  const kind: LaneKind = lane.classList.contains('lo-ovcolumn') ? 'notes' : 'threads';
  const mark = [...cell.children].find(
    (each) => each.hasAttribute(RANGE_ATTRIBUTE) && !each.classList.contains('lo-stem'),
  );
  const marked = mark?.getAttribute(RANGE_ATTRIBUTE);
  if (marked && accept(marked)) return { kind, key: marked, mark: true };
  const stems = [...cell.querySelectorAll<HTMLElement>(`.lo-stem[${RANGE_ATTRIBUTE}]`)]
    .map((stem) => ({ key: stem.getAttribute(RANGE_ATTRIBUTE)!, slot: Number(stem.dataset.slot) }))
    .filter((stem) => accept(stem.key));
  const key = nearestStem(stems, event.clientX - cell.getBoundingClientRect().left, kind);
  return key === undefined ? undefined : { kind, key, mark: false };
}

/** A range's stem in an editor's text, from its first line's start to its last line's end. */
class LaneSpan extends RangeValue {
  readonly key: string;
  readonly slot: number;
  readonly tone: RangeTone;
  readonly tick: boolean;
  readonly foot: boolean;
  readonly lit: boolean;
  readonly target: boolean;

  constructor({ key, slot, tone, tick, foot }: Slotted, lit: boolean, target: boolean) {
    super();
    this.key = key;
    this.slot = slot;
    this.tone = tone;
    this.tick = tick;
    this.foot = foot;
    this.lit = lit;
    this.target = target;
  }

  override eq(other: RangeValue): boolean {
    return (
      other instanceof LaneSpan &&
      other.key === this.key &&
      other.slot === this.slot &&
      other.tone === this.tone &&
      other.tick === this.tick &&
      other.foot === this.foot &&
      other.lit === this.lit &&
      other.target === this.target
    );
  }
}

/** A mark at a line's start, for a fold that holds the line. */
class MarkSpot extends RangeValue {
  readonly mark: LaneMark;
  readonly lit: boolean;

  constructor(mark: LaneMark, lit: boolean) {
    super();
    this.mark = mark;
    this.lit = lit;
  }

  override eq(other: RangeValue): boolean {
    return other instanceof MarkSpot && other.lit === this.lit && other.mark.same(this.mark);
  }
}

/**
 * What a lane draws in part of an editor's text, `from` to `to`, such as a file's, in place of
 * what it drew there: each line's cell, each range's stem for the rows between lines, and each
 * mark, for the folds.
 */
export interface LaneUpdate {
  readonly from: number;
  readonly to: number;
  readonly cells: readonly Range<RangeMarker>[];
  readonly spans: readonly Range<LaneSpan>[];
  readonly marks: readonly Range<MarkSpot>[];
}

/** How a lane's ranges are drawn: which are lit, and which cells are the pointer's to open. */
export interface LaneDrawing {
  /** The ranges drawn in their lit colours. */
  readonly lit: ReadonlySet<string>;
  /** Whether the pointer opens what a range's stem means, which tints its cell. */
  readonly target: (range: LaneRange) => boolean;
  /** Whether a mark's cell tints under the pointer, as one whose mark has no ground of its own. */
  readonly markTarget?: boolean | undefined;
}

/**
 * A `kind` lane's cells for the part of `doc` from `from` to `to`, by document line: the stems of
 * `ranges` beside each line they cover, and a mark on each line of `marks`.
 */
export function laneUpdate(
  doc: Text,
  kind: LaneKind,
  { from, to }: { readonly from: number; readonly to: number },
  ranges: readonly LaneRange[],
  marks: ReadonlyMap<number, LaneMark>,
  { lit, target, markTarget = false }: LaneDrawing,
): LaneUpdate {
  const placed = slotted(ranges);
  const lines = new Set(marks.keys());
  const spans: Range<LaneSpan>[] = [];
  for (const range of placed) {
    for (let line = range.from; line <= range.to; line++) lines.add(line);
    spans.push(
      new LaneSpan(range, lit.has(range.key), target(range)).range(
        doc.line(range.from).from,
        doc.line(range.to).to,
      ),
    );
  }
  const arriving = new Set(ranges.filter((range) => range.arriving).map((range) => range.key));
  const cells: Range<RangeMarker>[] = [];
  const spots: Range<MarkSpot>[] = [];
  for (const line of [...lines].toSorted((a, b) => a - b)) {
    const mark = marks.get(line);
    const over = placed.filter((range) => range.from <= line && range.to >= line);
    const cell = cellOf(
      over,
      { first: line, last: line },
      { marked: mark !== undefined, above: marks.has(line - 1) },
      lit,
    );
    const markLit = mark?.keys.some((key) => lit.has(key)) ?? false;
    if (cell.stems.length === 0 && !cell.tick && !mark) continue;
    const at = doc.line(line).from;
    cells.push(
      new RangeMarker(kind, cell, mark, {
        lit: markLit,
        target: over.some((range) => target(range)) || (mark !== undefined && markTarget),
        arriving: over.some((range) => arriving.has(range.key)) || (mark?.arriving ?? false),
      }).range(at),
    );
    if (mark) spots.push(new MarkSpot(mark, markLit).range(at));
  }
  return { from, to, cells, spans, marks: spots };
}

/** An editor's lane: each line's cell, each range's stem, and each mark. */
interface LaneState {
  readonly cells: RangeSet<RangeMarker>;
  readonly spans: RangeSet<LaneSpan>;
  readonly marks: RangeSet<MarkSpot>;
}

/** How a lane draws what's between its lines and its folds, beside what the state field keeps. */
export interface LaneOptions {
  /** The mark of a fold, from the marks of the lines it holds: none where it draws none. */
  readonly foldMark?: ((marks: readonly LaneMark[]) => LaneMark | undefined) | undefined;
  /** Whether a mark's cell tints under the pointer, as in `LaneDrawing`. */
  readonly markTarget?: boolean | undefined;
}

/**
 * A `kind` lane kept in each editor's state: `set` draws what each update says in its part of the
 * text, `cells` gives the gutter each line's cell, and `widgetMarker` what's beside a fold or a block
 * between lines, from the stems that pass it.
 */
export interface Lane {
  readonly set: StateEffectType<readonly LaneUpdate[]>;
  readonly field: StateField<LaneState>;
  readonly cells: (view: EditorView) => RangeSet<RangeMarker>;
  readonly widgetMarker: (
    view: EditorView,
    widget: WidgetType,
    block: BlockInfo,
  ) => GutterMarker | null;
}

/** A `kind` lane for each editor to keep in its state. */
export function defineLane(kind: LaneKind, options: LaneOptions = {}): Lane {
  const set = StateEffect.define<readonly LaneUpdate[]>();
  const field = StateField.define<LaneState>({
    create: () => ({ cells: RangeSet.empty, spans: RangeSet.empty, marks: RangeSet.empty }),
    update(lane, transaction) {
      let { cells, spans, marks } = lane;
      if (transaction.docChanged) {
        cells = cells.map(transaction.changes);
        spans = spans.map(transaction.changes);
        marks = marks.map(transaction.changes);
      }
      for (const effect of transaction.effects) {
        if (!effect.is(set)) continue;
        for (const update of effect.value) {
          const outside = (start: number): boolean => start < update.from || start > update.to;
          const take = <T extends RangeValue>(ranges: RangeSet<T>, add: readonly Range<T>[]) =>
            ranges.update({
              filterFrom: update.from,
              filterTo: update.to,
              filter: outside,
              add,
              sort: true,
            });
          cells = take(cells, update.cells);
          spans = take(spans, update.spans);
          marks = take(marks, update.marks);
        }
      }
      return cells === lane.cells && spans === lane.spans && marks === lane.marks
        ? lane
        : { cells, spans, marks };
    },
  });
  /** The cell beside `row`, from the stems that pass the text from `from` to `to`. */
  const cellBeside = (
    view: EditorView,
    row: Row,
    from: number,
    to: number,
    fold: boolean,
  ): GutterMarker | null => {
    const lane = view.state.field(field);
    const { doc } = view.state;
    const over: Slotted[] = [];
    const lit = new Set<string>();
    let target = false;
    lane.spans.between(from, to, (start, end, span) => {
      const { key, slot, tone, tick, foot } = span;
      const range = {
        key,
        slot,
        tone,
        tick,
        foot,
        from: doc.lineAt(start).number,
        to: doc.lineAt(end).number,
      };
      if (range.from > row.last || range.to < row.first) return;
      over.push(range);
      if (span.lit) lit.add(range.key);
      target ||= span.target;
    });
    let mark: LaneMark | undefined;
    let markLit = false;
    if (fold && options.foldMark) {
      const held: LaneMark[] = [];
      lane.marks.between(from, to, (start, _end, spot) => {
        if (start < from || start > to) return;
        held.push(spot.mark);
        markLit ||= spot.lit;
      });
      mark = held.length > 0 ? options.foldMark(held) : undefined;
    }
    // Whether the line above a fold holds a mark, which the stems that end in the fold skipped.
    let above = false;
    if (fold && row.first > 1) {
      const at = doc.line(row.first - 1).from;
      lane.marks.between(at, at, (start) => {
        if (start === at) above = true;
      });
    }
    const cell = cellOf(over, row, { marked: mark !== undefined, above }, lit);
    if (cell.stems.length === 0 && !cell.tick && !mark) return null;
    return new RangeMarker(kind, cell, mark, {
      lit: markLit,
      target: target || (mark !== undefined && (options.markTarget ?? false)),
    });
  };
  return {
    set,
    field,
    cells: (view) => view.state.field(field).cells,
    widgetMarker: (view, widget, block) => {
      // A file's own blocks, in place of its lines, aren't between them.
      if (widget instanceof HeaderWidget || widget instanceof FileNoteWidget) return null;
      const { doc } = view.state;
      // Lines a block stands in for, as a fold: stems start, end and run past in it.
      if (widget instanceof CollapsedWidget || block.to > block.from) {
        const row = { first: doc.lineAt(block.from).number, last: doc.lineAt(block.to).number };
        return cellBeside(view, row, block.from, block.to, true);
      }
      const { line, after } = lineBeside(view, block);
      const half = after ? line + 0.5 : line - 0.5;
      const { from, to } = doc.line(line);
      return cellBeside(view, { first: half, last: half }, from, to, false);
    },
  };
}

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

// Lit rows -------------------------------------------------------------------------------------

/**
 * The document lines a code view's lit range covers in an editor, as runs of lines: the selected
 * ground, or with `picked`, the lines of a comment box being written, the ground `v` gives.
 */
export interface LitRows {
  readonly rows: readonly { readonly from: number; readonly to: number }[];
  readonly picked: boolean;
}

/** The editor's lit rows are these, or none. */
export const setLit = StateEffect.define<LitRows | null>();

/** A gutter cell beside a lit row, or a picked one. */
const litCell = new (class extends GutterMarker {
  override readonly elementClass = 'is-lit move-tint';
})();
const pickedCell = new (class extends GutterMarker {
  override readonly elementClass = 'is-picked move-tint';
})();
const litLine = Decoration.line({ class: 'lo-lit move-tint' });
const pickedLine = Decoration.line({ class: 'lo-picked move-tint' });

/**
 * Rows lit before the text changed: mapped, they may no longer be the range's, so they're the same
 * as no rows, and the next lighting sets them again.
 */
const STALE: LitRows = Object.freeze({ rows: [], picked: false });

/** Whether two sets of lit rows are the same. */
export function sameLit(a: LitRows | null, b: LitRows | null): boolean {
  if (a === STALE || b === STALE) return false;
  if (!a || !b) return a === b;
  return (
    a.picked === b.picked &&
    a.rows.length === b.rows.length &&
    a.rows.every((run, index) => run.from === b.rows[index]!.from && run.to === b.rows[index]!.to)
  );
}

/**
 * The lit rows as they were set, and their gutter cells and lines, mapped as the text changes until
 * they're set again; once it's changed, the rows are stale, which the next lighting sets anew.
 */
const litField = StateField.define<{
  rows: LitRows | null;
  cells: RangeSet<GutterMarker>;
  lines: DecorationSet;
}>({
  create: () => ({ rows: null, cells: RangeSet.empty, lines: Decoration.none }),
  update(lit, transaction) {
    let next = transaction.docChanged
      ? {
          rows: lit.rows === null ? null : STALE,
          cells: lit.cells.map(transaction.changes),
          lines: lit.lines.map(transaction.changes),
        }
      : lit;
    for (const effect of transaction.effects) {
      if (!effect.is(setLit)) continue;
      const { doc } = transaction.state;
      const cells: Range<GutterMarker>[] = [];
      const lines: Range<Decoration>[] = [];
      const cell = effect.value?.picked ? pickedCell : litCell;
      const line = effect.value?.picked ? pickedLine : litLine;
      for (const run of effect.value?.rows ?? []) {
        const last = Math.min(run.to, doc.lines);
        for (let number = Math.max(1, run.from); number <= last; number++) {
          const at = doc.line(number).from;
          cells.push(cell.range(at));
          lines.push(line.range(at));
        }
      }
      next = {
        rows: effect.value,
        cells: RangeSet.of(cells, true),
        lines: Decoration.set(lines, true),
      };
    }
    return next;
  },
  provide: (field) => [
    gutterLineClass.from(field, (lit) => lit.cells),
    EditorView.decorations.from(field, (lit) => lit.lines),
  ],
});

/** The rows a code view's lit range covers in an editor, from `setLit`. */
export function litRows(): Extension {
  return litField;
}

/** The rows lit in an editor's state, as they were last set, or stale ones once the text changed. */
export function litOf(state: EditorState): LitRows | null {
  return state.field(litField, false)?.rows ?? null;
}

// Lighting -------------------------------------------------------------------------------------

/** A range a code view lights, by its lane and its key there. */
export interface LitRange {
  readonly lane: LaneKind;
  readonly key: string;
}

/** Whether two lit ranges are the same, or both none. */
export function sameRange(a: LitRange | undefined, b: LitRange | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.lane === b.lane && a.key === b.key);
}

/** What lights a code view's ranges, each where it says one. */
export interface Lights {
  /**
   * A popover pinned: the ranges of the cards it shows, in its order. Or a comment box open on
   * lines, which counts as pinned: its own range, if its draft has one in the lane.
   */
  readonly pinned?:
    { readonly cards: readonly LitRange[] } | { readonly picked: LitRange | undefined } | undefined;
  /** The card the keyboard is on in what's pinned. */
  readonly focused?: LitRange | undefined;
  /** Where a key landed, while the cursor stays on its lines. */
  readonly keyed?: LitRange | undefined;
  /** What the pointer is on: a mark, a stem, a card. */
  readonly pointed?: LitRange | undefined;
}

/** What a code view lights: the range whose rows are lit, if any, and the stems in lit colours. */
export interface Lit {
  /** The range whose rows take the selected ground. */
  readonly range: LitRange | undefined;
  /** Whether its rows are a comment box's lines, which take the ground `v` gives. */
  readonly picked: boolean;
  /** The ranges drawn in their lit colours, by lane. */
  readonly stems: Readonly<Record<LaneKind, ReadonlySet<string>>>;
}

/** Nothing lit. */
export const UNLIT: Lit = {
  range: undefined,
  picked: false,
  stems: { threads: new Set(), notes: new Set() },
};

/**
 * What `lights` light, one range at a time: what's pinned, else where a key landed, else the
 * pointer's. Of a pinned popover's cards, the one the pointer or the keyboard is on, else its
 * first. The pointer's range takes its lit colour whatever else is lit.
 */
export function lightOf({ pinned, focused, keyed, pointed }: Lights): Lit {
  let range: LitRange | undefined;
  let picked = false;
  if (pinned && 'picked' in pinned) {
    picked = true;
    range = pinned.picked;
  } else if (pinned && pinned.cards.length > 0) {
    const shown = (each: LitRange | undefined): boolean =>
      each !== undefined && pinned.cards.some((card) => sameRange(card, each));
    range = shown(pointed) ? pointed : shown(focused) ? focused : pinned.cards[0];
  } else {
    range = keyed ?? pointed;
  }
  const stems: Record<LaneKind, Set<string>> = { threads: new Set(), notes: new Set() };
  for (const each of [range, pointed]) if (each) stems[each.lane].add(each.key);
  return { range, picked, stems };
}

/** Whether two sets of keys are the same. */
export function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}
