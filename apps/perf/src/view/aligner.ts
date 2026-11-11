// The spacer pass: it keeps the two sides' rows level. It works only on the rows both editors
// draw, the rows in view plus the editors' own margin, so its cost doesn't grow with the pull
// request. Rows above keep the spacers they were given while they were drawn, and the first row
// drawn carries any difference left above it, so what's on screen lines up even where rows above
// were never measured. Rows on screen that one editor draws and the other doesn't yet, after a
// jump, start the region earlier; rows on one side at its end are caught up with above the next
// row with lines on both.
//
// It runs after CodeMirror has measured, and before the page is painted: an editor's measure
// schedules it, and it first has both editors finish any measuring they have waiting, so it works
// from the heights CodeMirror measured on both sides. Spacers are decorations, so CodeMirror's
// height map holds them, and decorations change only by transaction, which CodeMirror refuses
// inside its own measure; so the pass runs just after it, in the same frame. When anything changes
// a block's size where CodeMirror doesn't look, such as a thread that grows or a window resized,
// the editors' content resizes, and the pass runs then, also before the paint.
//
// It owns the scroll's anchor: a line kept at the same place on screen while heights above it
// change. CodeMirror anchors the scroll too, in an editor that has focus or was just scrolled
// with the wheel, to the line at the top of that editor, so the pass anchors to the same editor's
// line. It takes the anchor when the scroll moves, before the next measure, and again after each
// pass; a scroll it didn't make since, CodeMirror's or the user's, it takes as it finds it.

import { StateEffect, StateField } from '@codemirror/state';
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

import { alignRows, type RowHeights, type SideHeights } from './align.ts';
import type { Layout, Side } from './layout.ts';
import type { FileRows } from './rows.ts';
import { SpacerWidget } from './widgets.ts';

/** A spacer as a decoration: a block widget at `pos`, before (-1) or after (2) what's there. */
interface Placed {
  pos: number;
  side: -1 | 2;
  height: number;
}

/** Replaces the spacers between `from` and `to` with `spacers`. */
const setSpacers = StateEffect.define<{ from: number; to: number; spacers: readonly Placed[] }>();

export const spacerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(spacers, transaction) {
    let next = spacers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSpacers)) continue;
      const { from, to } = effect.value;
      next = next.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
        add: effect.value.spacers.map(({ pos, side, height }) =>
          Decoration.widget({ widget: new SpacerWidget(height), block: true, side }).range(pos),
        ),
        sort: true,
      });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A row, by its file and its index among the file's rows. */
interface RowRef {
  file: number;
  row: number;
}

/** A line the scroll keeps in place: how far below the top of the scroller it starts. */
interface Anchor {
  side: Side;
  pos: number;
  offset: number;
  /** The scroll when the anchor was taken. */
  scrollTop: number;
}

/** Rounds of measuring, lining up and restoring the scroll a pass may take to settle. */
const rounds = 6;

/** How long after a wheel event over an editor CodeMirror anchors the scroll to it, and more. */
const wheelAnchoring = 250;

/** What the pass has cost, for the measurements. */
export interface PassStats {
  passes: number;
  /** Passes that changed a spacer. */
  changed: number;
  totalMs: number;
  maxMs: number;
}

export class Aligner {
  readonly stats: PassStats = { passes: 0, changed: 0, totalMs: 0, maxMs: 0 };
  readonly #views: { old: EditorView; new: EditorView };
  readonly #layout: Layout;
  readonly #rows: (file: number) => FileRows;
  readonly #scroller: HTMLElement;
  #scheduled = false;
  /** Inside a pass, whose own transactions and measuring mustn't schedule another. */
  #running = false;
  #paused = false;
  #anchor: Anchor | undefined;
  readonly #wheel = { old: 0, new: 0 };
  readonly #resized: ResizeObserver;

  constructor(
    views: { old: EditorView; new: EditorView },
    layout: Layout,
    rows: (file: number) => FileRows,
    scroller: HTMLElement,
  ) {
    this.#views = views;
    this.#layout = layout;
    this.#rows = rows;
    this.#scroller = scroller;
    // A scroll brings rows into view that may not be drawn on both sides yet, without either
    // editor's viewport changing: take the anchor before the editors measure, and line up.
    scroller.addEventListener(
      'scroll',
      () => {
        if (this.#running || this.#scroller.scrollTop === this.#anchor?.scrollTop) return;
        this.#anchor = this.#anchorNow();
        this.schedule();
      },
      { passive: true },
    );
    for (const side of ['old', 'new'] as const) {
      views[side].dom.addEventListener('wheel', () => (this.#wheel[side] = Date.now()), {
        passive: true,
      });
    }
    // A block that grows where CodeMirror doesn't look, or a width that changes, resizes the
    // content. The observer runs after layout and before the paint, so the pass does too.
    this.#resized = new ResizeObserver(() => {
      if (!this.#running) this.run();
    });
    this.#resized.observe(views.old.contentDOM);
    this.#resized.observe(views.new.contentDOM);
  }

  /** Stops the pass, or starts it again. */
  set paused(paused: boolean) {
    this.#paused = paused;
    this.#anchor = undefined;
    if (!paused) this.schedule();
  }

  /** The extension that tells the aligner when an editor's heights or viewport change. */
  plugin(): ViewPlugin<object> {
    return ViewPlugin.define(() => ({
      update: (update: ViewUpdate) => {
        // Lines added to the document move the anchor with the text after it.
        const anchor = this.#anchor;
        if (update.docChanged && anchor && update.view === this.#views[anchor.side]) {
          this.#anchor = { ...anchor, pos: update.changes.mapPos(anchor.pos) };
        }
        if (this.#running) return;
        if (update.heightChanged || update.viewportChanged || update.geometryChanged) {
          this.schedule();
        }
      },
    }));
  }

  /** Runs the pass once the editors' current update or measure is done, before the paint. */
  schedule(): void {
    if (this.#scheduled || this.#paused) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.run();
    });
  }

  destroy(): void {
    this.#resized.disconnect();
  }

  /**
   * Lines up the drawn rows now: both editors finish measuring, the spacers change where they
   * must, and the anchored line goes back where it was on screen. That can move what's drawn, so
   * it goes round again, until nothing changes.
   */
  run(): void {
    if (this.#paused || this.#running) return;
    const started = performance.now();
    this.#running = true;
    let changed = false;
    try {
      const side = this.#anchorSide();
      let anchor = this.#anchor;
      if (
        !anchor ||
        anchor.side !== side ||
        Math.abs(anchor.scrollTop - this.#scroller.scrollTop) > 0.5
      ) {
        anchor = this.#anchorNow();
      }
      for (let turn = 0; turn <= rounds; turn++) {
        const scrolled = this.#scroller.scrollTop;
        this.#measure();
        // CodeMirror scrolled as it measured, to bring the cursor into view or to anchor an editor
        // it anchors: that scroll stands, so the anchor is taken again from where it left things.
        if (Math.abs(this.#scroller.scrollTop - scrolled) > 0.5) anchor = this.#anchorNow();
        // The last round only measures, so what's drawn covers where the scroll ended up.
        if (turn === rounds) break;
        const spaced = this.#align();
        const moved = this.#restore(anchor);
        anchor = this.#anchor!;
        changed ||= spaced;
        if (!spaced && !moved) break;
      }
    } finally {
      this.#running = false;
      const ms = performance.now() - started;
      this.stats.passes++;
      if (changed) this.stats.changed++;
      this.stats.totalMs += ms;
      this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    }
  }

  /** Has both editors do the measuring they have waiting, now. */
  #measure(): void {
    for (const view of [this.#views.old, this.#views.new]) {
      view.requestMeasure();
      // Reading the layout makes the editor do the measuring it has waiting.
      view.lineBlockAtHeight(0);
    }
  }

  /**
   * The rows to line up: those both editors draw, from the first with lines on both sides, and
   * any above it on screen that one editor draws and the other doesn't. A line an editor doesn't
   * draw has only an estimated height, which CodeMirror estimates again whenever a decoration next
   * to it changes, so measuring it or putting a spacer by it would leave the pass chasing its own
   * changes. Only when no row with lines on both sides is drawn on both, as while a jump has the
   * sides far apart, does the pass work from the rows either editor draws.
   */
  #region(): { refs: RowRef[]; end?: RowRef | undefined } {
    const lines = (side: Side): { first: number; last: number } => {
      const { state, viewport } = this.#views[side];
      return {
        first: state.doc.lineAt(viewport.from).number,
        last: state.doc.lineAt(viewport.to).number,
      };
    };
    const old = lines('old');
    const added = lines('new');
    const layout = this.#layout;
    const firstFile = Math.min(layout.fileAt('old', old.first), layout.fileAt('new', added.first));
    const lastFile = Math.max(layout.fileAt('old', old.last), layout.fileAt('new', added.last));
    const files = { first: firstFile, last: Math.min(lastFile + 1, layout.files.length - 1) };
    const drawn = this.#drawn(files, old, added);
    if (!drawn) return { refs: this.#either(files, old, added) };
    return { refs: [...this.#leading(drawn[0]!, old, added), ...drawn], end: this.#endOf(drawn) };
  }

  /** The rows both editors draw, from the first with lines on both sides, if there's one. */
  #drawn(
    files: { first: number; last: number },
    old: { first: number; last: number },
    added: { first: number; last: number },
  ): RowRef[] | undefined {
    const refs: RowRef[] = [];
    for (let file = files.first; file <= files.last; file++) {
      const rows = this.#rows(file);
      for (let row = 0; row < rows.oldFirst.length; row++) {
        const drawn =
          within(rows.oldFirst[row]!, rows.oldLast[row]!, old) &&
          within(rows.newFirst[row]!, rows.newLast[row]!, added);
        if (!drawn) {
          if (refs.length > 0) return refs;
          continue;
        }
        if (refs.length === 0 && !this.#paired({ file, row })) continue;
        refs.push({ file, row });
      }
    }
    return refs.length > 0 ? refs : undefined;
  }

  /**
   * The rows on screen above `first`, the first row both editors draw, that one side draws and the
   * other doesn't: that side is far out of line, its rows above the other's margin. The pass then
   * starts at the row with lines on both sides above them, above the screen, so the side that
   * doesn't draw them catches up there, out of sight, and draws them in its next measure.
   */
  #leading(
    first: RowRef,
    old: { first: number; last: number },
    added: { first: number; last: number },
  ): RowRef[] {
    const screen = this.#scroller.getBoundingClientRect().top;
    const onScreen = (
      side: Side,
      line: number,
      range: { first: number; last: number },
    ): boolean => {
      if (line === -1 || line < range.first || line > range.last) return false;
      const view = this.#views[side];
      const block = view.lineBlockAt(view.state.doc.line(line).from);
      return block.bottom + view.documentTop > screen;
    };
    const rows: RowRef[] = [];
    let shown = false;
    for (let ref = this.#step(first, -1), count = 0; ref && count < 2000; count++) {
      const fileRows = this.#rows(ref.file);
      const here =
        onScreen('old', fileRows.oldLast[ref.row]!, old) ||
        onScreen('new', fileRows.newLast[ref.row]!, added);
      rows.unshift(ref);
      if (here) shown = true;
      else if (this.#paired(ref)) return shown ? rows : [];
      ref = this.#step(ref, -1);
    }
    return [];
  }

  /** The rows either editor draws, widened to start and end on rows with lines on both sides. */
  #either(
    files: { first: number; last: number },
    old: { first: number; last: number },
    added: { first: number; last: number },
  ): RowRef[] {
    const refs: RowRef[] = [];
    let start = -1;
    let end = -1;
    for (let file = files.first; file <= files.last; file++) {
      const rows = this.#rows(file);
      for (let row = 0; row < rows.oldFirst.length; row++) {
        const inView =
          overlaps(rows.oldFirst[row]!, rows.oldLast[row]!, old) ||
          overlaps(rows.newFirst[row]!, rows.newLast[row]!, added);
        const paired = rows.oldFirst[row] !== -1 && rows.newFirst[row] !== -1;
        if (inView && start === -1) {
          // Back to the last row with lines on both sides.
          start = refs.length;
          while (start > 0 && !this.#paired(refs[start - 1]!)) start--;
          if (start > 0) start--;
        }
        refs.push({ file, row });
        if (inView) end = -1;
        else if (start !== -1 && end === -1 && paired) end = refs.length;
        if (start !== -1 && end !== -1) return refs.slice(start, end);
      }
    }
    return start === -1 ? [] : refs.slice(start);
  }

  /** The row `by` rows after `ref`, across files, if there is one. */
  #step(ref: RowRef, by: 1 | -1): RowRef | undefined {
    let { file, row } = ref;
    row += by;
    while (row < 0 || row >= this.#rows(file).oldFirst.length) {
      file += by;
      if (file < 0 || file >= this.#layout.files.length) return undefined;
      row = by > 0 ? 0 : this.#rows(file).oldFirst.length - 1;
    }
    return { file, row };
  }

  /**
   * When the region ends on rows with lines on one side only, the next row with lines on both:
   * the other side catches up above it, where it's drawn on that side, though the side with the
   * rows doesn't draw it yet.
   */
  #endOf(refs: readonly RowRef[]): RowRef | undefined {
    const last = refs.at(-1)!;
    if (this.#paired(last)) return undefined;
    for (let ref = this.#step(last, 1), count = 0; ref && count < 5000; count++) {
      if (this.#paired(ref)) return ref;
      ref = this.#step(ref, 1);
    }
    return undefined;
  }

  #paired({ file, row }: RowRef): boolean {
    const rows = this.#rows(file);
    return rows.oldFirst[row] !== -1 && rows.newFirst[row] !== -1;
  }

  /** Works out the region's spacers and puts any that changed in place. Says whether any did. */
  #align(): boolean {
    const region = this.#region();
    const { end } = region;
    const refs = end ? [...region.refs, end] : region.refs;
    if (refs.length === 0) return false;
    const lines = (ref: RowRef, side: Side): { first: number; last: number } => {
      const rows = this.#rows(ref.file);
      return side === 'old'
        ? { first: rows.oldFirst[ref.row]!, last: rows.oldLast[ref.row]! }
        : { first: rows.newFirst[ref.row]!, last: rows.newLast[ref.row]! };
    };
    const measured: RowHeights[] = [];
    const tops = { old: 0, new: 0 };
    refs.forEach((ref, index) => {
      const heights: RowHeights = {};
      for (const side of ['old', 'new'] as const) {
        const { first, last } = lines(ref, side);
        if (first === -1) continue;
        const { top, ...rest } = this.#heights(side, first, last);
        heights[side] = rest;
        if (index === 0) tops[side] = top;
      }
      if (end && index === refs.length - 1) heights.end = true;
      measured.push(heights);
    });
    const current = { old: this.#current('old'), new: this.#current('new') };
    const spacers = alignRows(measured, tops.old, tops.new, (side, row, place) => {
      const { first, last } = lines(refs[row]!, side);
      if (first === -1) return undefined;
      const doc = this.#views[side].state.doc;
      return place === 'above'
        ? current[side].get(`${doc.line(first).from}:-1`)
        : current[side].get(`${doc.line(last).to}:2`);
    });

    let changed = false;
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const doc = view.state.doc;
      const { viewport } = view;
      let firstLine = -1;
      let lastLine = -1;
      for (const ref of refs) {
        const { first, last } = lines(ref, side);
        // The end row counts only where this side draws it.
        if (first === -1 || (ref === end && doc.line(first).from > viewport.to)) continue;
        if (firstLine === -1) firstLine = first;
        lastLine = ref === end ? first : last;
      }
      if (firstLine === -1) continue;
      const placed = spacers
        // The end row's spacer goes only where this side draws it.
        .filter(
          (spacer) =>
            spacer.side === side &&
            (!end ||
              refs[spacer.row] !== end ||
              doc.line(lines(end, side).first).from <= viewport.to),
        )
        .map(({ row, place, height }): Placed => {
          const { first, last } = lines(refs[row]!, side);
          return place === 'above'
            ? { pos: doc.line(first).from, side: -1, height: round(height) }
            : { pos: doc.line(last).to, side: 2, height: round(height) };
        });
      const from = doc.line(firstLine).from;
      const to = doc.line(lastLine).to;
      if (!sameSpacers(view, from, to, placed)) {
        view.dispatch({ effects: setSpacers.of({ from, to, spacers: placed }) });
        changed = true;
      }
    }
    return changed;
  }

  /** The spacers `side`'s editor draws now, by position and side. */
  #current(side: Side): Map<string, number> {
    const current = new Map<string, number>();
    const { from, to } = this.#views[side].viewport;
    this.#views[side].state.field(spacerField).between(from, to, (pos, _to, decoration) => {
      const widget: unknown = decoration.spec.widget;
      if (widget instanceof SpacerWidget) {
        current.set(`${pos}:${decoration.startSide < 0 ? -1 : 2}`, widget.height);
      }
    });
    return current;
  }

  /**
   * A row's heights on one side without its spacers, from CodeMirror's height map: what's drawn
   * above its lines, and its lines with what's drawn below them, and where its first line's block
   * starts.
   */
  #heights(side: Side, first: number, last: number): SideHeights & { top: number } {
    const view = this.#views[side];
    const doc = view.state.doc;
    let top: number | undefined;
    let above = 0;
    let body = 0;
    let started = false;
    for (let line = first; line <= last;) {
      const block = view.lineBlockAt(doc.line(line).from);
      top ??= block.top;
      const parts = Array.isArray(block.type) ? block.type : [block];
      for (const part of parts) {
        if (part.widget instanceof SpacerWidget) continue;
        if (!started && part.type === BlockType.WidgetBefore) {
          above += part.height;
        } else {
          started = true;
          body += part.height;
        }
      }
      line = doc.lineAt(block.to).number + 1;
    }
    return { top: top!, above, body };
  }

  /** The editor CodeMirror anchors the scroll to: the focused one, else one just wheeled. */
  #anchorSide(): Side {
    if (this.#views.old.hasFocus) return 'old';
    if (this.#views.new.hasFocus) return 'new';
    const now = Date.now();
    const recent = (side: Side): boolean => now - this.#wheel[side] < wheelAnchoring;
    if (recent('old') && (!recent('new') || this.#wheel.old > this.#wheel.new)) return 'old';
    return 'new';
  }

  /**
   * The anchoring editor's line at the top of the scroller, and how far below the top it starts,
   * from the height map as it is: taking it doesn't make the editor measure.
   */
  #anchorNow(): Anchor {
    const side = this.#anchorSide();
    const view = this.#views[side];
    const screen = this.#scroller.getBoundingClientRect();
    const y = screen.top - view.documentTop;
    let block = blockAtHeight(view, Math.max(0, y));
    // In a focused editor, the cursor's line, where the cursor is on screen: a motion's jump keeps
    // the cursor where CodeMirror scrolled it.
    if (view.hasFocus) {
      const cursor = view.lineBlockAt(view.state.selection.main.head);
      if (cursor.top >= y && cursor.top < y + screen.height) block = cursor;
    }
    return { side, pos: block.from, offset: block.top - y, scrollTop: this.#scroller.scrollTop };
  }

  /** Puts the anchored line back where it was on screen. Says whether the scroll moved. */
  #restore(anchor: Anchor): boolean {
    const view = this.#views[anchor.side];
    if (anchor.pos > view.state.doc.length) {
      this.#anchor = this.#anchorNow();
      return false;
    }
    const y = this.#scroller.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAt(anchor.pos);
    const shift = block.top - anchor.offset - y;
    const moved = Math.abs(shift) > 0.5;
    if (moved) this.#scroller.scrollTop += shift;
    this.#anchor = { ...anchor, scrollTop: this.#scroller.scrollTop };
    return moved;
  }
}

/** The block at `height` among the editor's drawn blocks, without making it measure. */
function blockAtHeight(view: EditorView, height: number): { from: number; top: number } {
  const blocks = view.viewportLineBlocks;
  let low = 0;
  let high = blocks.length - 1;
  if (high < 0 || height < blocks[0]!.top || height > blocks[high]!.bottom) {
    return view.lineBlockAtHeight(height);
  }
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (blocks[middle]!.top <= height) low = middle;
    else high = middle - 1;
  }
  return blocks[low]!;
}

function overlaps(first: number, last: number, range: { first: number; last: number }): boolean {
  return first !== -1 && first <= range.last && last >= range.first;
}

/** Whether lines `first` to `last` all lie in `range`, or there are none (`first` is -1). */
function within(first: number, last: number, range: { first: number; last: number }): boolean {
  return first === -1 || (first >= range.first && last <= range.last);
}

/** Heights to a hundredth of a pixel, past which they're noise. */
function round(height: number): number {
  return Math.round(height * 100) / 100;
}

/** Whether the spacers between `from` and `to` already are `placed`. */
function sameSpacers(
  view: EditorView,
  from: number,
  to: number,
  placed: readonly Placed[],
): boolean {
  const current: Placed[] = [];
  view.state.field(spacerField).between(from, to, (pos, _to, decoration) => {
    const widget: unknown = decoration.spec.widget;
    if (widget instanceof SpacerWidget) {
      current.push({ pos, side: decoration.startSide < 0 ? -1 : 2, height: widget.height });
    }
  });
  if (current.length !== placed.length) return false;
  const key = (spacer: Placed): string => `${spacer.pos}:${spacer.side}:${spacer.height}`;
  const sorted = (list: Placed[]): string[] => list.map(key).toSorted();
  return sorted(current).join() === sorted([...placed]).join();
}
