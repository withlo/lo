// The spacer pass: it keeps the two sides' rows level as the editors draw and measure them. It
// works only on the rows both editors draw, the rows in view plus the editors' own margin, so its
// cost doesn't grow with the pull request. Rows above keep the spacers they were given while they
// were drawn, and the first row drawn carries any difference left above it, so what's on screen
// lines up even where rows above were never measured. It measures drawn lines on the page, which
// is what has to line up. The scroll is anchored to a row, so when a measurement or a spacer
// changes a height above it, what's on screen stays put.

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

export class Aligner {
  readonly #views: { old: EditorView; new: EditorView };
  readonly #layout: Layout;
  readonly #rows: (file: number) => FileRows;
  readonly #scroller: HTMLElement;
  #scheduled = false;
  /** A new-side position, and how far below the top of the scroller its line starts. */
  #anchor: { pos: number; offset: number } | undefined;

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
    scroller.addEventListener('scroll', () => (this.#anchor = this.#anchorNow()), {
      passive: true,
    });
  }

  /** The extension that tells the aligner when an editor's heights or viewport change. */
  plugin(): ViewPlugin<object> {
    return ViewPlugin.define(() => ({
      update: (update: ViewUpdate) => {
        if (update.heightChanged || update.viewportChanged || update.geometryChanged) {
          this.schedule();
        }
      },
    }));
  }

  /** Runs the pass after the editors' current update and measurement. */
  schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    requestAnimationFrame(() => {
      this.#scheduled = false;
      this.run();
    });
  }

  /** Lines up the rows in view, then puts the anchored row back where it was on screen. */
  run(): void {
    const anchor = this.#anchor ?? this.#anchorNow();
    const refs = this.#region();
    if (refs.length > 0) this.#align(refs);
    this.#restore(anchor);
  }

  /**
   * The rows to line up: those both editors draw, from the first with lines on both sides. A line
   * an editor doesn't draw has only an estimated height, which CodeMirror estimates again whenever
   * a decoration next to it changes, so measuring it or putting a spacer by it would leave the pass
   * chasing its own changes. Only when no row with lines on both sides is drawn on both, as while a
   * jump has the sides far apart, does the pass work from the rows either editor draws.
   */
  #region(): RowRef[] {
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
    return this.#drawn(files, old, added) ?? this.#either(files, old, added);
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

  #paired({ file, row }: RowRef): boolean {
    const rows = this.#rows(file);
    return rows.oldFirst[row] !== -1 && rows.newFirst[row] !== -1;
  }

  #align(refs: RowRef[]): void {
    const measured: RowHeights[] = [];
    const tops = { old: 0, new: 0 };
    // How far each side's first drawn line sits from where CodeMirror's height map puts it.
    const drift: { old?: number; new?: number } = {};
    refs.forEach((ref, index) => {
      const rows = this.#rows(ref.file);
      const heights: RowHeights = {};
      for (const side of ['old', 'new'] as const) {
        const first = side === 'old' ? rows.oldFirst[ref.row]! : rows.newFirst[ref.row]!;
        const last = side === 'old' ? rows.oldLast[ref.row]! : rows.newLast[ref.row]!;
        if (first === -1) continue;
        const { top, drawn, ...rest } = this.#measure(side, first, last);
        heights[side] = rest;
        if (index === 0) tops[side] = top;
        if (drift[side] === undefined && drawn) drift[side] = drawn.top - drawn.mapped;
      }
      measured.push(heights);
    });
    const oldTop = tops.old + (drift.old ?? 0);
    const newTop = tops.new + (drift.new ?? 0);
    const { spacers, end } = alignRows(measured, oldTop, newTop);

    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const doc = view.state.doc;
      const placed: Placed[] = [];
      let lastLine = -1;
      let firstLine = -1;
      for (const ref of refs) {
        const rows = this.#rows(ref.file);
        const first = side === 'old' ? rows.oldFirst[ref.row]! : rows.newFirst[ref.row]!;
        const last = side === 'old' ? rows.oldLast[ref.row]! : rows.newLast[ref.row]!;
        if (first === -1) continue;
        if (firstLine === -1) firstLine = first;
        lastLine = last;
      }
      if (firstLine === -1) continue;
      for (const spacer of spacers) {
        if (spacer.side !== side) continue;
        const ref = refs[spacer.row]!;
        const rows = this.#rows(ref.file);
        const line =
          spacer.place === 'above'
            ? side === 'old'
              ? rows.oldFirst[ref.row]!
              : rows.newFirst[ref.row]!
            : side === 'old'
              ? rows.oldLast[ref.row]!
              : rows.newLast[ref.row]!;
        placed.push(
          spacer.place === 'above'
            ? { pos: doc.line(line).from, side: -1, height: round(spacer.height) }
            : { pos: doc.line(line).to, side: 2, height: round(spacer.height) },
        );
      }
      if (end?.side === side) {
        placed.push({ pos: doc.line(lastLine).to, side: 2, height: round(end.height) });
      }
      const from = doc.line(firstLine).from;
      const to = doc.line(lastLine).to;
      if (!sameSpacers(view, from, to, placed)) {
        view.dispatch({ effects: setSpacers.of({ from, to, spacers: placed }) });
      }
    }
  }

  /**
   * A row's heights on one side without its spacers: what's drawn above its lines, and its lines
   * with what's drawn below them, and where CodeMirror's height map starts its first line's block.
   * A drawn line's height comes from the page: the height map can lag the page by a wrap, and the
   * page is what has to line up. `drawn` is where the row's first drawn line is, on the page and in
   * the height map.
   */
  #measure(
    side: Side,
    first: number,
    last: number,
  ): SideHeights & { top: number; drawn?: { top: number; mapped: number } } {
    const view = this.#views[side];
    const doc = view.state.doc;
    let top: number | undefined;
    let drawn: { top: number; mapped: number } | undefined;
    let above = 0;
    let body = 0;
    let started = false;
    for (let line = first; line <= last;) {
      const block = view.lineBlockAt(doc.line(line).from);
      top ??= block.top;
      const parts = Array.isArray(block.type) ? block.type : [block];
      for (const part of parts) {
        let { height } = part;
        if (part.type === BlockType.Text) {
          const element = this.#lineElement(view, part.from);
          if (element) {
            const rect = element.getBoundingClientRect();
            height = rect.height;
            drawn ??= { top: rect.top - view.documentTop, mapped: part.top };
          }
        }
        if (part.widget instanceof SpacerWidget) continue;
        if (!started && part.type === BlockType.WidgetBefore) {
          above += height;
        } else {
          started = true;
          body += height;
        }
      }
      line = doc.lineAt(block.to).number + 1;
    }
    return drawn ? { top: top!, above, body, drawn } : { top: top!, above, body };
  }

  /** The element that draws the line starting at `pos`, if the editor draws it. */
  #lineElement(view: EditorView, pos: number): Element | undefined {
    if (pos < view.viewport.from || pos > view.viewport.to) return undefined;
    const { node } = view.domAtPos(pos);
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest('.cm-line') ?? undefined;
  }

  /** The new side's line at the top of the scroller, and how far below the top it starts. */
  #anchorNow(): { pos: number; offset: number } {
    const view = this.#views.new;
    const y = this.#scroller.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAtHeight(Math.max(0, y));
    return { pos: block.from, offset: block.top - y };
  }

  #restore(anchor: { pos: number; offset: number }): void {
    const view = this.#views.new;
    if (anchor.pos > view.state.doc.length) return;
    const y = this.#scroller.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAt(anchor.pos);
    const shift = block.top - anchor.offset - y;
    if (Math.abs(shift) > 0.5) this.#scroller.scrollTop += shift;
    this.#anchor = { pos: anchor.pos, offset: anchor.offset };
  }
}

function overlaps(first: number, last: number, range: { first: number; last: number }): boolean {
  return first !== -1 && first <= range.last && last >= range.first;
}

/** Whether lines `first` to `last` all lie in `range`, or there are none (`first` is -1). */
function within(first: number, last: number, range: { first: number; last: number }): boolean {
  return first === -1 || (first >= range.first && last <= range.last);
}

/** Heights to a tenth of a pixel, so measurements that wobble don't churn the spacers. */
function round(height: number): number {
  return Math.round(height * 10) / 10;
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
