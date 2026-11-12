// The spacer pass: it keeps the two sides' rows level. It works only on the rows both editors
// draw, the rows in view plus the editors' own margin, so its cost doesn't grow with the pull
// request. Rows above keep the spacers they were given while they were drawn, and the first row
// drawn carries any difference left above it, so what's on screen lines up even where rows above
// were never measured. Rows on screen that one editor draws and the other doesn't yet, after a
// jump, start the region earlier; rows on one side at its end are caught up with above the next
// row with lines on both. When no row is drawn on both, the anchored editor's rows are lined up
// from the other's estimates, which brings the other's on screen. The shorter document gets space
// after its end, so its editor always reaches the screen. Spacers far from what's drawn are let go,
// and the heights measured far from it forgotten, so a long session costs no more than a short one.
//
// It runs after CodeMirror has measured, and before the page is painted: an editor's measure
// schedules it, and it first has both editors finish any measuring they have waiting, so it works
// from the heights CodeMirror measured on both sides. Spacers are decorations, so CodeMirror's
// height map holds them, and decorations change only by transaction, which CodeMirror refuses
// inside its own measure; so the pass runs just after it, in the same frame. When anything changes
// a block's size where CodeMirror doesn't look, such as a thread that grows or a window resized,
// the editors' content resizes, and the pass runs then, also before the paint.
//
// It owns the scroll's anchor: a line kept at the same place on screen while heights change, by
// its own top as drawn, below any spacers and labels. It's the line on screen furthest from where
// rows come into view, the top one on the way down and the bottom one on the way up, since rows
// coming in are where spacers change and heights are first measured; or, in a focused editor, the
// cursor's. It takes the anchor when the scroll moves, before the editors measure (they measure as
// they hear of the scroll, so it listens first), and again after each pass. CodeMirror anchors the
// scroll too, as it measures, to the top of an editor that has focus or was just wheeled, and its
// tops take in the pass's spacers; the pass puts that right, but for the scroll that brings a
// moved cursor into view. For a second after a key moves a cursor, until the wheel, a pointer or
// the scrollbar takes the scroll, the pass keeps the cursor's line on screen, which CodeMirror's
// measuring after a far jump can leave it off.

import { type Extension, StateEffect, StateField } from '@codemirror/state';
import {
  type BlockInfo,
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

import { alignRows, type RowHeights, type SideHeights } from './align.ts';
import type { PassStats } from './api.ts';
import type { Layout, Side } from './layout.ts';
import type { FileRows } from './rows.ts';
import { heldByScreenKey, screenKeyPin } from './screen.ts';
import { SpacerWidget } from './widgets.ts';

/** A spacer as a decoration: a block widget at `pos`, before (-1) or after (2) what's there. */
interface Placed {
  pos: number;
  side: -1 | 2;
  height: number;
}

/** Replaces the spacers between `from` and `to` with `spacers`. */
const setSpacers = StateEffect.define<{ from: number; to: number; spacers: readonly Placed[] }>();

/** The aligner's fields, which every editor it lines up needs. */
export function alignerFields(): Extension {
  return [spacerField, endField, forgottenField];
}

/** Sets the height of the space after the document's end. */
const setEnd = StateEffect.define<number>();

/**
 * Space after the end of the shorter document, so its editor reaches as far down as the other's:
 * an editor that ended above the screen would draw nothing there, and the pass would have nothing
 * of it to line up.
 */
const endField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(end, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setEnd)) continue;
      const height = effect.value;
      const at = transaction.state.doc.length;
      return height > 0
        ? Decoration.set(
            Decoration.widget({ widget: new SpacerWidget(height), block: true, side: 3 }).range(at),
          )
        : Decoration.none;
    }
    return end.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The height of `view`'s document without the space after its end. */
function ownHeight(view: EditorView): number {
  return view.contentHeight - endHeight(view);
}

/** The height of the space after `view`'s document. */
function endHeight(view: EditorView): number {
  const widget: unknown = view.state.field(endField).iter().value?.spec.widget;
  return widget instanceof SpacerWidget ? widget.height : 0;
}

const spacerField = StateField.define<DecorationSet>({
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

/**
 * Lines far from the screen, forgotten: each stretch is replaced by one block as tall as its lines
 * were, so CodeMirror's height map holds one entry for it, not one for every line it measured, and
 * no height changes, so the scroll doesn't move. CodeMirror keeps every line it has measured, and
 * every transaction walks them all, so without this a long session makes every transaction
 * slower. A stretch comes back, as CodeMirror's estimates of lines it hasn't drawn, when the
 * screen nears it, the cursor goes into it, or its text changes.
 */
const forget = StateEffect.define<readonly { from: number; to: number; height: number }[]>();
const remember = StateEffect.define<{ from: number; to: number }>();

const forgottenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(forgotten, transaction) {
    let next = forgotten;
    // A change inside a stretch leaves its height wrong: it comes back.
    transaction.changes.iterChangedRanges((fromA, toA) => {
      next = next.update({ filterFrom: fromA, filterTo: toA, filter: () => false });
    });
    next = next.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(forget)) {
        next = next.update({
          add: effect.value.map(({ from, to, height }) =>
            Decoration.replace({ widget: new ForgottenWidget(height), block: true }).range(
              from,
              to,
            ),
          ),
          sort: true,
        });
      } else if (effect.is(remember)) {
        const { from, to } = effect.value;
        next = next.update({ filterFrom: from, filterTo: to, filter: () => false });
      }
    }
    if (transaction.selection) {
      const { head } = transaction.selection.main;
      next = next.update({ filterFrom: head, filterTo: head, filter: () => false });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A stretch of forgotten lines, as tall as they were. */
class ForgottenWidget extends WidgetType {
  readonly height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }

  override eq(other: ForgottenWidget): boolean {
    return other.height === this.height;
  }

  toDOM(): HTMLElement {
    const block = document.createElement('div');
    block.style.height = `${this.height}px`;
    return block;
  }

  override get estimatedHeight(): number {
    return this.height;
  }
}

/** How far the scroll travels, in pixels, between forgetting the lines far from the screen. */
const forgetEvery = 100_000;

/** How many lines around the drawn ones keep their measured heights when the rest are forgotten. */
const keptLines = 2000;

/** How near what's drawn, in lines, forgotten lines come back: nearer than they're forgotten. */
const rememberedLines = 1000;

/** How many lines are forgotten at a time, while the page is idle. */
const forgetChunk = 2000;

/** How long forgetting waits for the page to be idle before it does a chunk anyway, in ms. */
const forgetWait = 250;

/** A row, by its file and its index among the file's rows. */
interface RowRef {
  file: number;
  row: number;
}

/** A line the scroll keeps in place: how far below the top of the scroller it starts. */
interface Anchor {
  /** The editor the scroll was anchored to when it was taken. */
  for: Side;
  /** The editor the line is in: that one, unless it had no line on screen. */
  side: Side;
  pos: number;
  offset: number;
  /** The scroll when the anchor was taken. */
  scrollTop: number;
}

/** Rounds of measuring, lining up and restoring the scroll a pass may take to settle. */
const rounds = 3;

/** How long after a key moves a cursor the pass sees that it ends up on screen, in ms. */
const cursorFollow = 1000;

/** How long after a key is pressed a cursor that moves was moved by it, in ms. */
const keyMove = 100;

/** How far inside the screen's edges a cursor brought into view sits, as CodeMirror's own does. */
const cursorMargin = 5;

/** How long after a wheel event over an editor CodeMirror anchors the scroll to it, and more. */
const wheelAnchoring = 250;

/**
 * The spacer pass: keeps the rows the two sides draw level, the scroll where it was, and a cursor a
 * key moved on screen.
 */
export class Aligner {
  readonly stats: PassStats = { passes: 0, changed: 0, totalMs: 0, maxMs: 0, forgetMaxMs: 0 };
  readonly #views: { old: EditorView; new: EditorView };
  readonly #layout: Layout;
  readonly #rows: (file: number) => FileRows;
  readonly #scroller: HTMLElement;
  #scheduled = false;
  /** Inside a pass, whose own transactions and measuring mustn't schedule another. */
  #running = false;
  #paused = false;
  #anchor: Anchor | undefined;
  /** Whether `anchorTop` has taken the anchor the coming pass restores. */
  #topTaken = false;
  /** Which way the scroll last went: down (1) or up (-1). */
  #direction: 1 | -1 = 1;
  /**
   * Whether the anchor was taken as the scroll moved, before the editors measured: it stands,
   * though CodeMirror's own anchoring may have scrolled since.
   */
  #scrolled = false;
  readonly #wheel = { old: 0, new: 0 };
  /** How far the scroll has gone since lines were last forgotten, and where it was then. */
  #travel = 0;
  #travelledFrom = 0;
  /** The chunks of lines still to forget, and the idle callback that forgets them. */
  #forgetting: { view: EditorView; first: number; last: number }[] = [];
  #idle = 0;
  /** The lines each editor has drawn since it last forgot, which are all it has measured. */
  readonly #seen: { old?: { first: number; last: number }; new?: { first: number; last: number } } =
    {};
  /** Whether a cursor moved since the last pass, so a scroll CodeMirror makes is the cursor's. */
  #selected = false;
  /**
   * When a key last moved a cursor, while the pass keeps it on screen, and how often it has had
   * CodeMirror scroll to it since: after a far jump, CodeMirror keeps the top of the screen still
   * as it measures what it drew, and the cursor can end up off screen. The wheel, a pointer or the
   * scrollbar takes the scroll back.
   */
  #following = 0;
  #cursorTries = 0;
  /** The side a move the view made itself, without focus, keeps on screen. */
  #followSide: Side | undefined;
  /** When a key was last pressed in the view, until the wheel or a pointer comes after it. */
  #keyed = -Infinity;
  /** The lines the last pass lined up on each side, which keep their spacers when others go. */
  #lined: { old?: { from: number; to: number }; new?: { from: number; to: number } } = {};
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
    // editor's viewport changing: take the anchor before the editors measure, and line up. The
    // editors measure as they hear of the scroll, so the pass hears of it first, as it captures.
    scroller.addEventListener(
      'scroll',
      () => {
        const top = this.#scroller.scrollTop;
        if (this.#running || top === this.#anchor?.scrollTop) return;
        if (this.#anchor) this.#direction = top > this.#anchor.scrollTop ? 1 : -1;
        this.#anchor = this.#anchorNow();
        this.#scrolled = true;
        this.schedule();
      },
      { capture: true, passive: true },
    );
    for (const side of ['old', 'new'] as const) {
      views[side].dom.addEventListener('wheel', () => (this.#wheel[side] = Date.now()), {
        passive: true,
      });
    }
    // A key that moves a cursor has the pass keep it on screen for a while; the wheel, a pointer
    // or the scrollbar, which a pointer drags, stops it.
    scroller.addEventListener('keydown', () => (this.#keyed = performance.now()), {
      capture: true,
    });
    const stop = (): void => this.unfollow();
    scroller.addEventListener('wheel', stop, { capture: true, passive: true });
    scroller.addEventListener('pointerdown', stop, { capture: true });
    // A block that grows where CodeMirror doesn't look, or a width that changes, resizes the
    // content. The observer runs after layout and before the paint, so the pass does too.
    this.#resized = new ResizeObserver(() => {
      if (!this.#running) this.run();
    });
    this.#resized.observe(views.old.contentDOM);
    this.#resized.observe(views.new.contentDOM);
  }

  /**
   * Has the pass keep the cursor on screen after the move that comes next, as after a key: for a
   * move the view makes itself, from a key the registry took before it reached the view.
   */
  follow(side?: Side): void {
    this.#keyed = performance.now();
    this.#followSide = side;
  }

  /**
   * Stops keeping the cursor on screen after the last move, as the wheel or a pointer does: the
   * view has put something else at the top of the screen, and the cursor stays where that leaves
   * it.
   */
  unfollow(): void {
    this.#keyed = -Infinity;
    this.#following = 0;
    this.#followSide = undefined;
  }

  /**
   * Takes what's on screen now as where things belong, as after the view moved everything on its
   * own: the pass keeps it there from now on, rather than put back what it held before.
   */
  anchorHere(): void {
    if (!this.#paused) this.#anchor = this.#anchorNow();
  }

  /**
   * Takes the first line drawn on screen as where things belong, not the cursor's: the view is
   * about to change heights itself, as when a note opens, and what's on screen above the change
   * stays where it is, the cursor's line too if it's below it. The pass keeps it there until the
   * scroll moves.
   *
   * It's taken once, before the first change, and stands until the pass runs: a change already
   * made has moved what's drawn, and the pass that puts it back is still to come, so reading where
   * lines are now would keep the move. When a change has been made since the last pass, the anchor
   * that pass left, or the scroll took, stands.
   */
  anchorTop(): void {
    if (this.#paused || this.#topTaken) return;
    this.#topTaken = true;
    if (this.#scheduled) return;
    const side = this.#anchorSide();
    const found = this.#screenLine(side, true) ?? this.#screenLine(otherSide(side), true);
    if (found) this.#anchor = { for: side, ...found };
  }

  /** Stops the pass, or starts it again. */
  set paused(paused: boolean) {
    this.#paused = paused;
    this.#anchor = undefined;
    this.#topTaken = false;
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
        if (update.selectionSet) {
          this.#selected = true;
          if (performance.now() - this.#keyed < keyMove) {
            this.#following = Date.now();
            this.#cursorTries = 0;
          }
        }
        if (this.#running) return;
        if (update.heightChanged || update.viewportChanged || update.geometryChanged) {
          this.schedule();
        } else if (update.selectionSet) {
          // A moved cursor can scroll the editor in its next measure, without its viewport
          // changing: line up after that measure, before the paint, so the other side follows.
          update.view.requestMeasure({ key: this, read: () => null, write: () => this.schedule() });
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
    this.#paused = true;
    if (this.#idle !== 0) cancelIdleCallback(this.#idle);
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
        anchor.for !== side ||
        (!this.#scrolled && Math.abs(anchor.scrollTop - this.#scroller.scrollTop) > 0.5)
      ) {
        anchor = this.#anchorNow();
      }
      this.#scrolled = false;
      for (const seenSide of ['old', 'new'] as const) {
        const { state, viewport } = this.#views[seenSide];
        const first = state.doc.lineAt(viewport.from).number;
        const last = state.doc.lineAt(viewport.to).number;
        const seen = this.#seen[seenSide];
        this.#seen[seenSide] = seen
          ? { first: Math.min(seen.first, first), last: Math.max(seen.last, last) }
          : { first, last };
      }
      this.#travel += Math.abs(this.#scroller.scrollTop - this.#travelledFrom);
      this.#travelledFrom = this.#scroller.scrollTop;
      if (this.#travel > forgetEvery) {
        this.#travel = 0;
        this.#planForgetting();
      }
      this.#remember();
      this.#trim();
      for (let turn = 0; turn <= rounds; turn++) {
        const scrolled = this.#scroller.scrollTop;
        this.#measure();
        // CodeMirror scrolled as it measured. To bring a moved cursor into view, that scroll stands,
        // so the anchor is taken again from where it left things. Otherwise it's CodeMirror's own
        // anchoring, from the top of a block that can hold the pass's spacers, and the pass's
        // anchor, taken before CodeMirror measured, puts it right: as after a screen key, which
        // holds back the scroll to the cursor.
        if (
          turn === 0 &&
          this.#selected &&
          !heldByScreenKey(this.#views.old) &&
          !heldByScreenKey(this.#views.new) &&
          Math.abs(this.#scroller.scrollTop - scrolled) > 0.5
        ) {
          anchor = this.#anchorNow();
        } else if (
          turn === 0 &&
          (anchor.offset < 0 || anchor.offset >= this.#scroller.clientHeight)
        ) {
          // After a jump, neither editor drew anything on screen yet when the scroll moved, so the
          // anchor was a line off it: take one on screen, now that they've drawn there.
          anchor = this.#anchorNow();
        }
        // The last round only measures, so what's drawn covers where the scroll ended up.
        if (turn === rounds) {
          this.#restore(anchor);
          // What it measured may have drawn rows it hasn't lined up yet, and the editors told
          // no one while it ran: go round again next frame.
          requestAnimationFrame(() => this.schedule());
          break;
        }
        const spaced = this.#align();
        this.#extend();
        const moved = this.#restore(anchor);
        anchor = this.#anchor!;
        changed ||= spaced;
        if (!spaced && !moved) break;
      }
    } finally {
      this.#running = false;
      this.#selected = false;
      this.#topTaken = false;
      const ms = performance.now() - started;
      this.stats.passes++;
      if (changed) this.stats.changed++;
      this.stats.totalMs += ms;
      this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    }
    if (Date.now() - this.#following < cursorFollow) this.#cursorInView();
  }

  /**
   * Brings a focused editor's cursor back on screen, the least scroll that shows it, when the
   * measuring after a key's far jump left it off: in a line it draws by scrolling, in one it doesn't
   * by having CodeMirror scroll there again, a few times at most.
   */
  #cursorInView(): void {
    const focused = (['old', 'new'] as const).find((each) => this.#views[each].hasFocus);
    const side = focused ?? this.#followSide;
    if (side === undefined) return;
    const view = this.#views[side];
    // A screen key scrolled as far as it means to, and put the cursor where it wants it.
    if (heldByScreenKey(view)) return;
    const head = view.state.selection.main.head;
    const line = drawnRect(view, head);
    const screen = this.#scroller.getBoundingClientRect();
    if (!line) {
      if (this.#cursorTries++ < 3) {
        const following = this.#following;
        requestAnimationFrame(() => {
          if (this.#following === following && view.state.selection.main.head === head) {
            view.dispatch({ effects: EditorView.scrollIntoView(head, { yMargin: cursorMargin }) });
          }
        });
      }
      return;
    }
    // The cursor's own row of text, as CodeMirror scrolls to it, not the whole of a line that
    // wraps: a cursor on screen is left where it is, as a key that scrolls, such as `zt`, put it.
    const cursor = cursorRow(view, head, line);
    if (cursor.top >= screen.top - 1 && cursor.bottom <= screen.bottom + 1) return;
    let shift = 0;
    if (cursor.bottom > screen.bottom) shift = cursor.bottom - screen.bottom + cursorMargin;
    if (cursor.top - shift < screen.top) shift = cursor.top - screen.top - cursorMargin;
    this.#scroller.scrollTop += shift;
    const offset = drawnRect(view, head)!.top - screen.top;
    this.#anchor = {
      for: side,
      side,
      pos: view.lineBlockAt(head).from,
      offset,
      scrollTop: this.#scroller.scrollTop,
    };
    this.#scrolled = true;
    this.schedule();
  }

  /**
   * Plans for both editors to forget the heights they measured far from what they draw, a chunk
   * of lines at a time while the page is idle: forgetting the whole rest of a large document at
   * once takes long enough to drop frames.
   */
  #planForgetting(): void {
    this.#forgetting = [];
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const { doc } = view.state;
      const seen = this.#seen[side];
      if (!seen) continue;
      const used = this.#usedLines(side);
      const first = used.first - keptLines;
      const last = used.last + keptLines;
      // Only what it drew since it last forgot: the rest it never measured.
      for (let line = seen.first; line < Math.min(first, seen.last + 1); line += forgetChunk) {
        this.#forgetting.push({
          view,
          first: line,
          last: Math.min(first - 1, line + forgetChunk - 1),
        });
      }
      for (let line = Math.max(last + 1, seen.first); line <= seen.last; line += forgetChunk) {
        this.#forgetting.push({
          view,
          first: line,
          last: Math.min(seen.last, line + forgetChunk - 1),
        });
      }
      this.#seen[side] = { first: Math.max(1, first), last: Math.min(doc.lines, last) };
    }
    this.#forgetWhenIdle();
  }

  /**
   * Forgets the chunks planned while the page is idle, or one at a time if it stays busy, as through
   * a long fling, so the height map can't grow without end while the scroll keeps moving.
   */
  #forgetWhenIdle(): void {
    if (this.#idle !== 0 || this.#forgetting.length === 0 || this.#paused) return;
    this.#idle = requestIdleCallback(
      (deadline) => {
        this.#idle = 0;
        // Planning again, as the scroll travels, can empty the list before this runs.
        for (let chunk = this.#forgetting.pop(); chunk; chunk = this.#forgetting.pop()) {
          this.#forget(chunk);
          if (deadline.timeRemaining() <= 8) break;
        }
        this.#forgetWhenIdle();
      },
      { timeout: forgetWait },
    );
  }

  /**
   * Has an editor forget the heights it measured for lines `first` to `last`, unless it draws near
   * them now: each stretch of them it hasn't forgotten already, whole rows at a time, becomes one
   * block as tall as it was, and nothing moves.
   */
  #forget({ view, first, last }: { view: EditorView; first: number; last: number }): void {
    const started = performance.now();
    const { doc } = view.state;
    if (last > doc.lines) return;
    const used = this.#usedLines(view === this.#views.old ? 'old' : 'new');
    if (last >= used.first - keptLines && first <= used.last + keptLines) return;
    const anchor = this.#anchorNow();
    // The stretches between those already forgotten, which a new one mustn't overlap.
    const stretches: { from: number; to: number }[] = [];
    let from = doc.line(first).from;
    const to = doc.line(last).to;
    view.state.field(forgottenField).between(from, to, (start, end) => {
      if (start > from) stretches.push({ from, to: start - 1 });
      from = Math.max(from, end + 1);
    });
    if (from <= to) stretches.push({ from, to });
    const head = view.state.selection.main.head;
    const forgotten = [];
    for (const stretch of stretches) {
      // Whole rows: a collapsed run or a header is one block, which a stretch can't cut.
      const firstRow = view.lineBlockAt(stretch.from);
      const lastRow = view.lineBlockAt(stretch.to);
      let taken = false;
      view.state.field(forgottenField).between(firstRow.from, lastRow.to, () => {
        taken = true;
        return false;
      });
      if (taken || (head >= firstRow.from && head <= lastRow.to)) continue;
      // The blocks drawn before its first line and after its last stay, outside it.
      const top = ownParts(firstRow).at(0)?.top;
      const bottom = ownParts(lastRow).at(-1)?.bottom;
      if (top === undefined || bottom === undefined || bottom <= top) continue;
      forgotten.push({ from: firstRow.from, to: lastRow.to, height: bottom - top });
    }
    if (forgotten.length === 0) return;
    // The spacers inside stay, hidden, so the lines come back as tall as their rows lined up.
    const before = view.contentHeight;
    view.dispatch({ effects: forget.of(forgotten) });
    // A stretch that starts or ends inside lines CodeMirror only estimated splits them, and it
    // estimates the parts afresh, a little shorter or taller than their share was: the last block
    // makes up the difference, so the document stays as tall as it was.
    const off = view.contentHeight - before;
    const final = forgotten.at(-1)!;
    if (Math.abs(off) > 0.5 && final.height - off > 0) {
      view.dispatch({
        effects: [
          remember.of({ from: final.from, to: final.to }),
          forget.of([{ ...final, height: final.height - off }]),
        ],
      });
    }
    this.#restore(anchor);
    this.stats.forgetMaxMs = Math.max(this.stats.forgetMaxMs, performance.now() - started);
  }

  /**
   * The first and last lines an editor draws or the pass lines up, which can reach further, past
   * rows on its side alone: what it forgets must stay clear of them, and what it remembers covers
   * them, or the pass would measure a forgotten block for rows inside it.
   */
  #usedLines(side: Side): { first: number; last: number } {
    const view = this.#views[side];
    const { doc } = view.state;
    let first = doc.lineAt(view.viewport.from).number;
    let last = doc.lineAt(view.viewport.to).number;
    const region = this.#region();
    for (const ref of region.end ? [...region.refs, region.end] : region.refs) {
      const rows = this.#rows(ref.file);
      const firstLine = side === 'old' ? rows.oldFirst[ref.row]! : rows.newFirst[ref.row]!;
      const lastLine = side === 'old' ? rows.oldLast[ref.row]! : rows.newLast[ref.row]!;
      if (firstLine === -1) continue;
      first = Math.min(first, firstLine);
      last = Math.max(last, lastLine);
    }
    return { first, last };
  }

  /**
   * Has each editor remember the lines it forgot near what it draws or the pass lines up, as
   * CodeMirror's estimates, before it draws them: the scroll keeps its anchor as their heights
   * change.
   */
  #remember(): void {
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const { doc } = view.state;
      const forgotten = view.state.field(forgottenField);
      if (forgotten.size === 0) continue;
      const used = this.#usedLines(side);
      const from = doc.line(Math.max(1, used.first - rememberedLines));
      const to = doc.line(Math.min(doc.lines, used.last + rememberedLines));
      let found = false;
      forgotten.between(from.from, to.to, () => {
        found = true;
        return false;
      });
      if (found) view.dispatch({ effects: remember.of({ from: from.from, to: to.to }) });
    }
  }

  /**
   * Keeps the spacers below what's drawn to those near it, so they don't pile up over a long
   * session, and every transaction goes through them: the rows are lined up again when they're
   * drawn. Those above stay, and go into the blocks their lines are forgotten into: taking them
   * would move the scroll back by as much as they're tall.
   */
  #trim(): void {
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const { doc } = view.state;
      // What it draws and what the pass last lined up, which can reach further.
      const lined = this.#lined[side];
      const bottom = Math.max(view.viewport.to, Math.min(lined?.to ?? 0, doc.length));
      const to = doc.line(Math.min(doc.lines, doc.lineAt(bottom).number + keptLines)).to;
      if (to >= doc.length) continue;
      let far = false;
      view.state.field(spacerField).between(to + 1, doc.length, () => {
        far = true;
        return false;
      });
      if (far)
        view.dispatch({ effects: setSpacers.of({ from: to + 1, to: doc.length, spacers: [] }) });
    }
  }

  /**
   * Makes the shorter editor reach as far down as the other, when it would otherwise end above the
   * bottom of the screen, or beyond the other's end. It changes only the space after its end, so
   * nothing drawn moves.
   */
  #extend(): void {
    const reach = this.#scroller.scrollTop + 2 * this.#scroller.clientHeight;
    for (const [view, beside] of [
      [this.#views.old, this.#views.new],
      [this.#views.new, this.#views.old],
    ] as const) {
      const end = endHeight(view);
      const height = round(Math.max(0, ownHeight(beside) - ownHeight(view)));
      if (end === height) continue;
      // Short of the other's end, and a screen past this one, it can stay as it is.
      const bottom = ownHeight(view) + end;
      if (height > 0 && bottom <= ownHeight(beside) + 0.5 && bottom >= reach) continue;
      view.dispatch({ effects: setEnd.of(height) });
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
   * sides far apart, does the pass work from the rows the anchored editor draws alone.
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
    const fileRange = (first: number, last: number): { first: number; last: number } => ({
      first,
      last: Math.min(last + 1, layout.files.length - 1),
    });
    // Rows both editors draw are in files both draw.
    const both = fileRange(
      Math.max(layout.fileAt('old', old.first), layout.fileAt('new', added.first)),
      Math.min(layout.fileAt('old', old.last), layout.fileAt('new', added.last)),
    );
    const drawn = both.first <= both.last ? this.#drawn(both, old, added) : undefined;
    if (drawn) {
      return { refs: [...this.#leading(drawn[0]!, old, added), ...drawn], end: this.#endOf(drawn) };
    }
    const side = this.#anchor?.side ?? this.#anchorSide();
    const range = side === 'old' ? old : added;
    const files = fileRange(layout.fileAt(side, range.first), layout.fileAt(side, range.last));
    return { refs: this.#either(side, files, range) };
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
    const origins = { old: origin(this.#views.old), new: origin(this.#views.new) };
    const onScreen = (
      side: Side,
      line: number,
      range: { first: number; last: number },
    ): boolean => {
      if (line === -1 || line < range.first || line > range.last) return false;
      const view = this.#views[side];
      const block = view.lineBlockAt(view.state.doc.line(line).from);
      return block.bottom + origins[side] > screen;
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

  /**
   * The rows `side`'s editor draws, the one the scroll is anchored to, widened to start and end on
   * rows with lines on both sides: the other side's are lined up with them from its estimated
   * heights, which brings them on screen, so it draws them next.
   */
  #either(
    side: Side,
    files: { first: number; last: number },
    range: { first: number; last: number },
  ): RowRef[] {
    const refs: RowRef[] = [];
    let start = -1;
    let end = -1;
    for (let file = files.first; file <= files.last; file++) {
      const rows = this.#rows(file);
      for (let row = 0; row < rows.oldFirst.length; row++) {
        const inView =
          side === 'old'
            ? overlaps(rows.oldFirst[row]!, rows.oldLast[row]!, range)
            : overlaps(rows.newFirst[row]!, rows.newLast[row]!, range);
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
    // Rows it lines up are never forgotten: a forgotten block hides their lines, and their heights.
    // Those that are come back first, and the pass goes round again.
    let remembered = false;
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const { doc } = view.state;
      let first = Infinity;
      let last = -Infinity;
      for (const ref of refs) {
        const row = lines(ref, side);
        if (row.first === -1) continue;
        first = Math.min(first, row.first);
        last = Math.max(last, row.last);
      }
      if (first > last) continue;
      const from = doc.line(Math.max(1, first - rememberedLines)).from;
      const to = doc.line(Math.min(doc.lines, last + rememberedLines)).to;
      let forgotten = false;
      view.state.field(forgottenField).between(from, to, () => {
        forgotten = true;
        return false;
      });
      if (!forgotten) continue;
      view.dispatch({ effects: remember.of({ from, to }) });
      remembered = true;
    }
    if (remembered) return true;
    const measured: RowHeights[] = [];
    const tops = { old: 0, new: 0 };
    // Where each row with lines on a side starts there: a row ends where the next one starts.
    const starts = { old: [] as (number | undefined)[], new: [] as (number | undefined)[] };
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      for (const ref of refs) {
        const { first } = lines(ref, side);
        starts[side].push(
          first === -1 ? undefined : view.lineBlockAt(view.state.doc.line(first).from).top,
        );
      }
    }
    refs.forEach((ref, index) => {
      const heights: RowHeights = {};
      for (const side of ['old', 'new'] as const) {
        const { first, last } = lines(ref, side);
        if (first === -1) continue;
        const next = starts[side].slice(index + 1).find((start) => start !== undefined);
        const { top, ...rest } = this.#heights(side, first, last, next);
        heights[side] = rest;
        // Where it's drawn, which is what has to line up.
        if (index === 0)
          tops[side] = top + origin(this.#views[side]) - this.#views[side].documentTop;
      }
      if (end && index === refs.length - 1) heights.end = true;
      measured.push(heights);
    });
    // The lines the region covers on each side, which its spacers replace: the end row's only
    // where this side draws it.
    const ranges: { old?: { from: number; to: number }; new?: { from: number; to: number } } = {};
    for (const side of ['old', 'new'] as const) {
      const { state, viewport } = this.#views[side];
      let firstLine = -1;
      let lastLine = -1;
      for (const ref of refs) {
        const { first, last } = lines(ref, side);
        if (first === -1 || (ref === end && state.doc.line(first).from > viewport.to)) continue;
        if (firstLine === -1) firstLine = first;
        lastLine = ref === end ? first : last;
      }
      if (firstLine !== -1) {
        ranges[side] = { from: state.doc.line(firstLine).from, to: state.doc.line(lastLine).to };
      }
    }
    const current = {
      old: this.#current('old', ranges.old),
      new: this.#current('new', ranges.new),
    };
    const spacers = alignRows(
      measured,
      tops.old,
      tops.new,
      (side, row, place) => {
        const { first, last } = lines(refs[row]!, side);
        if (first === -1) return undefined;
        const doc = this.#views[side].state.doc;
        return place === 'above'
          ? current[side].get(`${doc.line(first).from}:-1`)
          : current[side].get(`${doc.line(last).to}:2`);
      },
      // Below lines a side doesn't draw, a spacer stays as it is: CodeMirror estimates the lines
      // around a block widget again when one comes or goes, which would move the row's top, and
      // the pass would go back and forth between the two.
      (side, row) => {
        const { last } = lines(refs[row]!, side);
        const { state, viewport } = this.#views[side];
        const to = state.doc.line(last).to;
        return to < viewport.from || to > viewport.to;
      },
    );

    let changed = false;
    for (const side of ['old', 'new'] as const) {
      const view = this.#views[side];
      const doc = view.state.doc;
      const { viewport } = view;
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
      const range = ranges[side];
      if (!range) continue;
      const { from, to } = range;
      this.#lined[side] = range;
      if (!sameSpacers(view, from, to, placed)) {
        view.dispatch({ effects: setSpacers.of({ from, to, spacers: placed }) });
        changed = true;
      }
    }
    return changed;
  }

  /** The spacers between `range`'s ends on `side`, by position and side. */
  #current(side: Side, range: { from: number; to: number } | undefined): Map<string, number> {
    const current = new Map<string, number>();
    if (!range) return current;
    this.#views[side].state
      .field(spacerField)
      .between(range.from, range.to, (pos, _to, decoration) => {
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
   * starts. The row ends at `end`, where the next row starts, if one does: the heights CodeMirror
   * gives lines it hasn't drawn, one by one, add up to a little more than the space it gives them
   * all, so the rows' heights are taken from where they start, not from their lines'.
   */
  #heights(
    side: Side,
    first: number,
    last: number,
    end: number | undefined,
  ): SideHeights & { top: number } {
    const view = this.#views[side];
    const doc = view.state.doc;
    let top: number | undefined;
    let bottom = 0;
    let above = 0;
    let spacers = 0;
    let started = false;
    for (let line = first; line <= last;) {
      const block = view.lineBlockAt(doc.line(line).from);
      top ??= block.top;
      bottom = block.bottom;
      const parts = Array.isArray(block.type) ? block.type : [block];
      for (const part of parts) {
        if (part.widget instanceof SpacerWidget) spacers += part.height;
        else if (!started && part.type === BlockType.WidgetBefore) above += part.height;
        else started = true;
      }
      line = doc.lineAt(block.to).number + 1;
    }
    return { top: top!, above, body: (end ?? bottom) - top! - above - spacers };
  }

  /** How many spacers each editor holds, drawn or not, for the measurements. */
  get spacers(): { old: number; new: number } {
    return {
      old: this.#views.old.state.field(spacerField).size,
      new: this.#views.new.state.field(spacerField).size,
    };
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
   * A line the anchoring editor draws on screen, and how far below the top of the scroller it
   * starts: the line's own top, not its block's, which takes in the spacers and labels drawn above
   * it, which the pass itself changes. Taken from where it's drawn, without making the editor
   * measure: the height map can be off from that by a line it has only estimated. In a focused
   * editor, the cursor's line, where the cursor is on screen: a motion's jump keeps the cursor where
   * CodeMirror scrolled it.
   */
  #anchorNow(): Anchor {
    const side = this.#anchorSide();
    const view = this.#views[side];
    // After a screen key, the line it scrolled to the edge of the screen it moved away from: rows
    // past it may not have been on screen yet, and as they're measured they move only away from it.
    const pin = screenKeyPin(this.#views.old) ?? screenKeyPin(this.#views.new);
    const pinSide = (['old', 'new'] as const).find((each) => this.#views[each] === pin?.view);
    if (pin && pinSide) {
      const screen = this.#scroller.getBoundingClientRect();
      // Any of it on screen: inside a line taller than the screen, its top is above it.
      const drawn = drawnRect(pin.view, pin.pos);
      if (drawn && drawn.top < screen.bottom && drawn.bottom > screen.top) {
        return {
          for: side,
          side: pinSide,
          pos: pin.pos,
          offset: drawn.top - screen.top,
          scrollTop: this.#scroller.scrollTop,
        };
      }
    }
    if (view.hasFocus) {
      const screen = this.#scroller.getBoundingClientRect();
      const cursor = view.lineBlockAt(view.state.selection.main.head);
      const top = drawnTop(view, cursor.from);
      if (top !== undefined && top >= screen.top && top < screen.bottom) {
        return {
          for: side,
          side,
          pos: cursor.from,
          offset: top - screen.top,
          scrollTop: this.#scroller.scrollTop,
        };
      }
    }
    // Beside a long stretch on the other side, an editor can have nothing of its own on screen,
    // or only below a spacer that grows as the stretch's lines are measured on the way down: then
    // the other editor's line higher up.
    const mine = this.#screenLine(side);
    const theirs = this.#screenLine(otherSide(side));
    const higher = this.#direction > 0 && mine && theirs && theirs.offset < mine.offset;
    const found = (higher ? theirs : mine) ?? theirs;
    if (found) return { for: side, ...found };
    // Nothing of its own starts on screen on either side, as inside a block taller than the screen.
    const y = this.#scroller.getBoundingClientRect().top - origin(view);
    const block = view.lineBlockAtHeight(Math.max(0, y));
    return {
      for: side,
      side,
      pos: block.from,
      offset: ownTop(block) - y,
      scrollTop: this.#scroller.scrollTop,
    };
  }

  /**
   * The line `side`'s editor draws on screen furthest from where rows come into view, if it draws
   * one: the first when the scroll last went down, and rows come in at the bottom, the last when it
   * went up. The pass changes the spacers of rows as they come in, and heights CodeMirror measures
   * for the first time are theirs, so what was on screen already stays where it was. `down` asks
   * for the first whichever way the scroll went.
   */
  #screenLine(side: Side, down = this.#direction > 0): Omit<Anchor, 'for'> | undefined {
    const view = this.#views[side];
    const screen = this.#scroller.getBoundingClientRect();
    const y = screen.top - origin(view);
    const blocks = view.viewportLineBlocks;
    let found: { pos: number; top: number } | undefined;
    // From the top on the way down, from the bottom on the way up, to the first drawn on screen.
    const first = blockIndex(blocks, y);
    const last = blockIndex(blocks, y + screen.height);
    for (
      let index = down ? first : last;
      down ? index <= last : index >= first;
      index += down ? 1 : -1
    ) {
      const block = blocks[index]!;
      // Where it's drawn, which the height map can be off from by a line it has only estimated.
      const top = drawnTop(view, block.from);
      if (top === undefined || top < screen.top || top >= screen.bottom) continue;
      found = { pos: block.from, top };
      break;
    }
    return (
      found && {
        side,
        pos: found.pos,
        offset: found.top - screen.top,
        scrollTop: this.#scroller.scrollTop,
      }
    );
  }

  /** Puts the anchored line back where it was on screen. Says whether the scroll moved. */
  #restore(anchor: Anchor): boolean {
    const view = this.#views[anchor.side];
    if (anchor.pos > view.state.doc.length) {
      this.#anchor = this.#anchorNow();
      return false;
    }
    const screen = this.#scroller.getBoundingClientRect().top;
    const drawn = drawnTop(view, anchor.pos);
    const shift =
      drawn === undefined
        ? ownTop(view.lineBlockAt(anchor.pos)) - anchor.offset - (screen - origin(view))
        : drawn - screen - anchor.offset;
    const moved = Math.abs(shift) > 0.5;
    if (moved) this.#scroller.scrollTop += shift;
    this.#anchor = { ...anchor, scrollTop: this.#scroller.scrollTop };
    return moved;
  }
}

/**
 * Where on the page the line at `pos` is drawn, its own top below any blocks drawn above it, if
 * the editor draws it: its text, or the block that replaces it, as a file's header does.
 */
export function drawnTop(view: EditorView, pos: number): number | undefined {
  return drawnRect(view, pos)?.top;
}

/** Where on the page the line at `pos` ends, as {@link drawnTop} finds it, if it's drawn. */
export function drawnBottom(view: EditorView, pos: number): number | undefined {
  return drawnRect(view, pos)?.bottom;
}

/** The box the line at `pos` is drawn in, without the blocks drawn around it, if it's drawn. */
function drawnRect(view: EditorView, pos: number): DOMRect | undefined {
  if (pos < view.viewport.from || pos > view.viewport.to) return undefined;
  const block = view.lineBlockAt(pos);
  const parts = Array.isArray(block.type) ? block.type : [block];
  const own = parts.findIndex(
    (part) => part.type === BlockType.Text || part.type === BlockType.WidgetRange,
  );
  if (own === -1) return undefined;
  // The element drawn for one of the block's parts, then for its first, then for its own.
  const { node, offset } = view.domAtPos(block.from);
  let element: Node | null | undefined = node === view.contentDOM ? node.childNodes[offset] : node;
  while (element && element.parentNode !== view.contentDOM) element = element.parentNode;
  const starts = (candidate: Node | null): candidate is Element =>
    candidate instanceof Element &&
    !candidate.classList.contains('cm-gap') &&
    view.posAtDOM(candidate) === block.from;
  const found = element ?? null;
  if (!starts(found)) return undefined;
  let first: Element = found;
  while (starts(first.previousSibling)) first = first.previousSibling;
  let mine: Element | null = first;
  for (let index = 0; index < own && mine; index++) mine = mine.nextElementSibling;
  if (!mine || view.posAtDOM(mine) !== block.from) return undefined;
  return mine.getBoundingClientRect();
}

/**
 * The row of text the cursor at `pos` is on, in its line drawn at `line`, where CodeMirror finds
 * it to scroll to: the character after it, or the one before at the end of its text. The whole
 * line where it has no text.
 */
function cursorRow(view: EditorView, pos: number, line: DOMRect): { top: number; bottom: number } {
  const { node, offset } = view.domAtPos(pos);
  if (!(node instanceof Text) || node.length === 0) return line;
  const from = Math.min(offset, node.length - 1);
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, from + 1);
  const row = range.getClientRects()[0];
  return row && row.top >= line.top - 1 && row.bottom <= line.bottom + 1 ? row : line;
}

function otherSide(side: Side): Side {
  return side === 'old' ? 'new' : 'old';
}

/**
 * Where on the page the editor draws the top of its document, for the lines in its viewport. It's
 * `documentTop`, give or take a fraction of a pixel: CodeMirror sizes the space it leaves for the
 * lines above its viewport from its estimate for the last of them, which with wrapped lines can
 * end a little past where the next line starts. The two editors are off by different fractions,
 * so the pass lines up, and anchors, what's drawn.
 */
function origin(view: EditorView): number {
  const { from } = view.viewport;
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line')) {
    const pos = view.posAtDOM(element);
    if (pos < from) continue;
    return element.getBoundingClientRect().top - ownTop(view.lineBlockAt(pos));
  }
  return view.documentTop;
}

/** A row's parts without the blocks drawn before its first line and after its last. */
function ownParts(block: BlockInfo): readonly BlockInfo[] {
  const parts: readonly BlockInfo[] = Array.isArray(block.type) ? block.type : [block];
  let start = 0;
  let end = parts.length;
  while (start < end && parts[start]!.type === BlockType.WidgetBefore) start++;
  while (end > start && parts[end - 1]!.type === BlockType.WidgetAfter) end--;
  return parts.slice(start, end);
}

/**
 * Where a line's own content starts in its block: its text, or the block that replaces it, below
 * any spacers, labels or other blocks drawn above it.
 */
export function ownTop(block: BlockInfo): number {
  if (!Array.isArray(block.type)) return block.top;
  for (const part of block.type) {
    if (part.type === BlockType.Text || part.type === BlockType.WidgetRange) return part.top;
  }
  return block.top;
}

/** The index of the block at `height` among `blocks`, which are in order, or the nearest. */
function blockIndex(blocks: readonly BlockInfo[], height: number): number {
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (blocks[middle]!.top <= height) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
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
