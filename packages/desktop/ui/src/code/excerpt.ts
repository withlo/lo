// An excerpt: a range of a file's lines at one commit, read-only, as an inline diff from the
// base, as an overview's code block shows the code it points at. One CodeMirror editor holds the
// lines shown, a change's deleted lines before its added ones, each numbered on its sides as in the
// file, so the first is numbered as the range starts. It's a code view's own editor, as the diff's
// and the whole file's are (`editor.ts`, `keys.ts`): no key changes its text or enters insert or
// replace mode, its jumps go to the caller as places, its style elements carry the window's nonce,
// and its cursor doesn't blink. The cursor shows only while the excerpt has focus. Its review
// threads show as the diff's do, as its caller says (`ThreadsMode`): beside its lines, a mark in
// the threads' lane (`lanes.ts`) that opens a popover over the code (`beside.ts`), one shared by
// every excerpt in the scroll around it, so no excerpt clips it; or between them, each under its
// line in an element the caller draws it in, its bubble in the lane collapsing it or expanding it
// again, as the thread's own chevron does. Comment boxes open where its threads do: beside lines in
// the popover, a new comment's under its last line and a reply's or an edit's in its thread, with
// a draft's mark in the lane once it's closed; between lines under its line. Nothing on screen
// moves without the reader: threads that come, go or move on a line on screen, a thread that
// changes size there by itself, as an image loading, and the room a box left as it closed once its
// comment was sent wait until what they'd move is off screen, or the reader acts in the excerpt,
// or anywhere when no scroll can take them off. Whatever scrolls around it keeps the rest where it
// is as the excerpt changes height. A thread or a box opening on a line, as the cursor coming
// there, says so first (`askToShowLine`), so a block around the excerpt that cut the line off shows
// it whole before anything opens on it.
//
// Callers see none of this: they name the file by their own id, places by that id, a side and a
// line, and reach the excerpt only through `ExcerptView` (`api.ts`). Keys reach it through the
// registry, which runs Lo's commands and hands the rest to Vim, as for a whole file: the excerpt is
// the `file` scope's `KeySource`.

import { EditorState, type Range, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view';
import type { FileDiff } from '@lo/diff';

import {
  controlOf,
  type HeaderTarget,
  KEY_EVENT,
  type KeySource,
  type LineTarget,
  runControl,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import { handOffFocus } from '../focus.ts';
import type {
  BoxFrame,
  ComposeOptions,
  Composer,
  ComposerEvents,
  DraftMark,
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  Mode,
  Place,
  RenderPopover,
  RenderThread,
  Side,
  Span,
  Spot,
  ThreadsMode,
  ThreadView,
  VimKey,
} from './api.ts';
import { type At, Beside, type BesideHost, type Pane } from './beside.ts';
import { CommentBox, placeKey } from './comments.ts';
import { fileMarks } from './decorations.ts';
import { askToShowLine, codeEditor } from './editor.ts';
import { type FileTokens, highlighting, lineStarts, tokensChanged } from './highlight.ts';
import {
  addCodeEditor,
  clearVim,
  endSelection,
  handlingKey,
  installVim,
  onVimMode,
  passToVim,
  selectedLines,
  setVimKeys,
  vimCount,
  vimMode,
  vimOn,
  vimPending,
} from './keys.ts';
import { type LaneRange, type LaneUpdate, laneUpdate, setLane, threadLane } from './lanes.ts';
import { marking } from './marks.ts';
import { type PopRoom, sharedPop } from './popover.ts';
import { commentIn, type ThreadHost, Threads } from './threads.ts';
import { type Tip, tips } from './tip.ts';
import { FileNoteWidget, ThreadSizes, ThreadWidget } from './widgets.ts';

/** Opens an excerpt of `init`'s file in `parent`, which tells `on` what happens in it. */
export function createExcerptView(
  parent: HTMLElement,
  init: ExcerptInit,
  on: ExcerptEvents,
): ExcerptView {
  return new Excerpt(parent, init, on);
}

/** What each of an excerpt's lines is: its line on each side, or 0 on a side it isn't on. */
export interface ExcerptLines {
  old: number[];
  new: number[];
  /**
   * The lines of a change the range ends that are left out, past the most an excerpt shows, and the
   * line, from 1, they'd follow.
   */
  more?: { after: number; count: number };
}

/** How many of a change's lines past a range's last line an excerpt shows. */
export const CHANGE_REST = 50;

/**
 * The lines an excerpt of `range` shows, in order: those of the rows from the range's first line
 * to its last, a change's deleted lines before its added ones, and where the range's last line ends
 * a change, the rest of the change's rows, `CHANGE_REST` at most. Without a diff, the range's lines
 * alone. The range stops at the file's ends, `count` lines on its side.
 */
export function excerptLines(
  diff: FileDiff | undefined,
  range: { side: Side; from: number; to: number },
  count: number,
): ExcerptLines {
  const { side } = range;
  const first = Math.max(1, Math.min(range.from, range.to));
  const last = Math.min(count, Math.max(range.from, range.to));
  const shown: ExcerptLines = { old: [], new: [] };
  const push = (old: number, added: number): void => {
    shown.old.push(old);
    shown.new.push(added);
  };
  if (first > last) return shown;
  const rows = diff && rowsOf(diff, side, first, last);
  if (!diff || !rows) {
    for (let line = first; line <= last; line++) {
      push(side === 'old' ? line : 0, side === 'new' ? line : 0);
    }
    return shown;
  }
  for (const block of diff.rows) {
    const from = Math.max(rows.first, block.row);
    const to = Math.min(rows.last, block.row + Math.max(block.oldCount, block.newCount) - 1);
    if (from > to) continue;
    if (!block.changed) {
      for (let row = from; row <= to; row++) {
        push(block.old + row - block.row, block.new + row - block.row);
      }
      continue;
    }
    for (let row = from; row <= to && row - block.row < block.oldCount; row++) {
      push(block.old + row - block.row, 0);
    }
    // The rest of a change past the range is the other side's lines: what's left out follows them.
    if (rows.more > 0 && block.row === rows.block && side === 'new') {
      shown.more = { after: shown.old.length, count: rows.more };
    }
    for (let row = from; row <= to && row - block.row < block.newCount; row++) {
      push(0, block.new + row - block.row);
    }
    if (rows.more > 0 && block.row === rows.block && side === 'old') {
      shown.more = { after: shown.old.length, count: rows.more };
    }
  }
  return shown;
}

/**
 * The diff's rows from line `first` of `side` to line `last`, and on through `CHANGE_REST` more of
 * a change that `last` ends: with how many of the change's rows are left out past them, and the
 * change's first row. None if the diff doesn't have both lines.
 */
function rowsOf(
  diff: FileDiff,
  side: Side,
  first: number,
  last: number,
): { first: number; last: number; more: number; block: number } | undefined {
  let firstRow = -1;
  let lastRow = -1;
  let more = 0;
  let changed = -1;
  for (const block of diff.rows) {
    const start = block[side];
    const count = side === 'old' ? block.oldCount : block.newCount;
    if (first >= start && first < start + count) firstRow = block.row + first - start;
    if (last >= start && last < start + count) {
      lastRow = block.row + last - start;
      if (block.changed && last === start + count - 1) {
        const end = block.row + Math.max(block.oldCount, block.newCount) - 1;
        more = Math.max(0, end - lastRow - CHANGE_REST);
        lastRow = end - more;
        changed = block.row;
      }
    }
  }
  if (firstRow < 0 || lastRow < 0) return undefined;
  return { first: firstRow, last: lastRow, more, block: changed };
}

/** The lines marked as changed since arrived: number them again. */
const staleChanged = StateEffect.define();

/** Replaces the blocks under lines: threads and comment boxes. */
const setBlocks = StateEffect.define<readonly Range<Decoration>[]>();

const blockField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(blocks, transaction) {
    let next = blocks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setBlocks)) next = Decoration.set(effect.value, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A line's number on one side, marked when the line changed since. */
class NumberMarker extends GutterMarker {
  readonly number: string;
  readonly stale: boolean;
  override readonly elementClass: string;

  constructor(number: string, stale: boolean) {
    super();
    this.number = number;
    this.stale = stale;
    this.elementClass = stale ? 'is-stale' : '';
  }

  override eq(other: NumberMarker): boolean {
    return other.number === this.number && other.stale === this.stale;
  }

  override toDOM(): Node {
    return document.createTextNode(this.number);
  }
}

/** What may change now: what's off screen, or also what's on it that no scroll can take off it. */
type Letting = 'off' | 'stuck' | 'all';

/**
 * The reader's input in the page around the excerpt, which lets go of what no scroll can take off
 * screen: a pointer down, the wheel, and keys as the key listener's event says they're input, those
 * the registry takes among them, a sequence's only as it ends.
 */
const INPUT = [KEY_EVENT, 'pointerdown', 'wheel'] as const;

/** The reader's pointer or keys in the excerpt, which let go of what waits in it. */
const TOUCH = ['pointerdown', KEY_EVENT] as const;

/** An excerpt's one editor, with both sides' lines: its one pane. */
const PANES: readonly Pane[] = ['inline'];

/** The nearest box around `element` that scrolls up and down, or else its page's body. */
function scrollerOf(element: HTMLElement): HTMLElement {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return element.ownerDocument.body;
}

class Excerpt implements ExcerptView {
  readonly dom: HTMLElement;
  readonly #view: EditorView;
  readonly #on: ExcerptEvents;
  readonly #id: string;
  /** The range's side, which an unchanged line's place is on. */
  readonly #side: Side;
  readonly #shown: ExcerptLines;
  /** Each side's lines shown, by number: the first, and each one's document line from it. */
  readonly #docLines: Record<Side, { first: number; lines: number[] }>;
  readonly #diff: FileDiff | undefined;
  readonly #starts: Record<Side, Int32Array>;
  readonly #tokens: { old?: FileTokens | undefined; new?: FileTokens | undefined } = {};
  #stale: ReadonlySet<number>;
  /** What the events last said, so each says only what changed. */
  readonly #said: { cursor?: string; mode: Mode } = { mode: 'normal' };
  readonly #stops: (() => void)[] = [];
  readonly #nonce: string;
  /** Each thread's element, and what the caller drew in it. */
  readonly #hosts: Threads;
  /** How it shows threads now. */
  #mode: ThreadsMode;
  /** Its threads beside its lines: their marks, and the popover they open. */
  readonly #beside: Beside;
  /** The threads last given, which it shows again as the mode changes. */
  #given: readonly ThreadView[] = [];
  /** The threads drawn, by the document line they're under: between lines, under it. */
  #threads = new Map<number, ThreadView[]>();
  /** The threads drawn, by where they are (`side:line`), as their marks are worked out. */
  #byPlace = new Map<string, ThreadView[]>();
  /** The box that scrolls around it, once something has asked. */
  #scroller: HTMLElement | undefined;
  /** The comment boxes open, by the document line they're under. */
  readonly #boxes = new Map<number, CommentBox>();
  /** How tall what's drawn under lines is, made as the first thread or box comes. */
  #sizes: ThreadSizes | undefined;
  /**
   * The threads last given, by the document line they're under, while they wait for the lines
   * they'd change to leave the screen.
   */
  #waiting: Map<number, ThreadView[]> | undefined;
  /** Threads that changed size on screen by themselves, held at the height they were drawn at. */
  readonly #held = new Set<ThreadHost>();
  /**
   * The boxes closed once their comments were sent, by the line they're under, each still drawn as
   * it was, the comment it sent on it, as the room it took, until that comment's thread takes its
   * place.
   */
  readonly #rooms = new Map<number, CommentBox>();
  /** Whether it's been on the page a frame: until then, what it's given is how it comes. */
  #drawn = false;
  /** While the mode changes: its boxes close, focus going to a line only from one that had it. */
  #switching = false;

  constructor(parent: HTMLElement, init: ExcerptInit, on: ExcerptEvents) {
    installVim();
    this.#on = on;
    this.#nonce = init.nonce;
    // What's drawn under its lines changed size: each thread takes its new height in the next
    // frame, which the editor measures. A change of size made now, as the page tells its observers
    // of sizes, would go untold to the editor's.
    // One on screen that changed by itself is held so until it's off screen, or the reader acts,
    // unless a sent box is still drawn right after it, as when the reply sent there comes: then it
    // takes the box's place. So does a thread first drawn under a sent box's line: the comment is
    // on screen in every frame, on the box and then in its thread, and what's under it moves once.
    this.#hosts = new Threads((entries) => {
      const changed = this.#hosts.resized(entries);
      if (changed.length === 0) return;
      const taking: ThreadHost[] = [];
      const landing = new Set<number>();
      for (const { host, fresh, reflowed } of changed) {
        host.hold();
        const room = this.#roomAfter(host);
        const line = fresh ? this.#lineUnder(host) : undefined;
        if (line !== undefined && this.#rooms.has(line)) landing.add(line);
        if (!fresh && host.takeInput()) taking.push(host);
        else if (!fresh && !reflowed && this.#onScreen(host.dom)) {
          if (room === undefined) this.#held.add(host);
          else taking.push(host);
        } else taking.push(host);
        if (!fresh && room !== undefined && !this.#held.has(host)) landing.add(room);
      }
      if (taking.length === 0) return;
      requestAnimationFrame(() => {
        for (const host of taking) if (!this.#held.has(host)) host.letGo();
        const gone = [...landing].flatMap((line) => this.#rooms.get(line) ?? []);
        for (const line of landing) this.#rooms.delete(line);
        if (gone.length > 0) this.#drawBlocks();
        for (const box of gone) box.destroy();
        this.#view.requestMeasure();
      });
    });
    this.#hosts.lands = (host) => {
      const line = this.#lineUnder(host);
      return line !== undefined && this.#rooms.has(line);
    };
    this.#id = init.id;
    this.#side = init.range.side;
    this.#diff = init.diff;
    this.#stale = new Set(init.stale);
    const { lines } = init;
    this.#shown = excerptLines(init.diff, init.range, lines[init.range.side].length);
    this.#docLines = { old: docLinesOf(this.#shown.old), new: docLinesOf(this.#shown.new) };
    this.#starts = { old: lineStarts(lines.old), new: lineStarts(lines.new) };
    for (const side of ['old', 'new'] as const) {
      const triples = init.tokens?.[side];
      if (triples) this.#tokens[side] = { tokens: triples, starts: this.#starts[side] };
    }
    const text = this.#shown.new.map((added, index) =>
      added > 0 ? (lines.new[added - 1] ?? '') : (lines.old[this.#shown.old[index]! - 1] ?? ''),
    );

    this.dom = document.createElement('div');
    this.dom.className = 'lo-excerpt';
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'file');
    parent.append(this.dom);
    this.#mode = init.threads ?? 'between';
    this.dom.classList.toggle('is-beside', this.#mode === 'beside');
    this.#beside = new Beside(this.#besideHost());
    // Both sides' numbers with a diff; the range's side's alone without one.
    const sides: readonly Side[] = init.diff ? ['old', 'new'] : [this.#side];
    const view = new EditorView({
      parent: this.dom,
      state: EditorState.create({
        doc: text.join('\n'),
        extensions: [
          codeEditor(init.nonce, () => this.#tell()),
          EditorView.contentAttributes.of({ 'aria-label': init.path }),
          sides.map((side) => this.#numbers(side)),
          threadLane(),
          marking((doc, first, last) => this.#marks(doc, first, last)),
          moreRow(this.#shown.more),
          blockField,
          highlighting({
            lineAt: (line) => {
              const added = this.#shown.new[line - 1] ?? 0;
              if (added > 0) return { file: 0, side: 'new', line: added };
              const old = this.#shown.old[line - 1] ?? 0;
              return old > 0 ? { file: 0, side: 'old', line: old } : undefined;
            },
            tokens: (_file, side) => this.#tokens[side],
          }),
        ],
      }),
    });
    this.#view = view;
    addCodeEditor(view, {
      // Lo's motions stop at changes, files and threads, which an excerpt doesn't go between.
      jump: () => undefined,
      jumped: (from, to) => {
        const { doc } = view.state;
        const before = this.#spot(doc.lineAt(Math.min(from, doc.length)).number);
        const after = this.#spot(doc.lineAt(Math.min(to, doc.length)).number);
        if (JSON.stringify(before) !== JSON.stringify(after)) this.#on.jumped(before, after);
      },
      // What a key did is said once Vim is done with it, never what it passed through.
      settled: () => {
        if (view.hasFocus) this.#tell();
      },
    });
    this.#stops.push(
      onVimMode(view, (mode) => {
        if (view.hasFocus && !handlingKey(view)) this.#tellMode(mode);
      }),
      setScopeSource(this.dom, this),
      tips(this.dom, (control) => this.#tipOf(control)),
    );
    this.dom.addEventListener('contextmenu', (event) => this.#contextMenu(event));
    this.dom.addEventListener('click', this.#clicked);
    this.dom.addEventListener('pointerover', this.#hoverMark, { passive: true });
    this.dom.addEventListener('pointerleave', this.#hoverMark, { passive: true });
    // The reader's pointer or key in the excerpt lets go of what waits in it; in a thread, what
    // becomes of the thread's size next is theirs.
    for (const type of TOUCH) this.dom.addEventListener(type, this.#touched, { capture: true });
    document.addEventListener('scroll', this.#scrolled, { capture: true, passive: true });
    for (const type of INPUT) {
      window.addEventListener(type, this.#elsewhere, { capture: true, passive: true });
    }
    requestAnimationFrame(() => {
      this.#drawn = true;
    });
    setVimKeys(init.vimKeys);
  }

  /** The gutter of `side`'s line numbers, the stale ones marked on the range's side. */
  #numbers(side: Side) {
    const numbers = this.#shown[side];
    const widest = numbers.reduce((most, number) => Math.max(most, number), 0);
    return gutter({
      class: `cm-lineNumbers lo-inlinenumbers lo-inlinenumbers--${side}`,
      lineMarker: (view, block) => {
        const number = numbers[view.state.doc.lineAt(block.from).number - 1] ?? 0;
        if (number === 0) return null;
        return new NumberMarker(String(number), side === this.#side && this.#stale.has(number));
      },
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(staleChanged)),
        ),
      initialSpacer: () => new NumberMarker(String(Math.max(9, widest)), false),
    });
  }

  /** The changed lines and words on document lines `first` to `last`, on both sides. */
  #marks(doc: Text, first: number, last: number): Range<Decoration>[] {
    const diff = this.#diff;
    if (!diff) return [];
    const out: Range<Decoration>[] = [];
    for (const side of ['old', 'new'] as const) {
      const numbers = this.#shown[side];
      let low = Infinity;
      let high = -Infinity;
      for (let line = first; line <= last; line++) {
        const number = numbers[line - 1] ?? 0;
        if (number === 0) continue;
        low = Math.min(low, number);
        high = Math.max(high, number);
      }
      if (low > high) continue;
      const lineFrom = (number: number): number => doc.line(this.#docLine(side, number)!).from;
      out.push(...fileMarks({ index: 0, diff, moves: [], side, lineFrom }, low, high));
    }
    return out;
  }

  /**
   * What the threads' lane draws, as the diff's does (`Beside.lane`): a bubble beside each line
   * threads end on, and a bracket up each thread's range from its first line, or from the first
   * line shown where the excerpt starts after it. The excerpt runs its bubbles' clicks itself.
   */
  #lane(): LaneUpdate {
    const { ranges, bubbles } = this.#beside.lane('inline', 0);
    const { doc } = this.#view.state;
    const beside = this.#mode === 'beside';
    return laneUpdate(doc, { from: 0, to: doc.length }, ranges, bubbles, false, beside);
  }

  /**
   * The document lines a range from `from` to `end` covers, as its bracket draws it: from the top
   * where it starts before the first line shown, with no tick there. None where the excerpt shows
   * neither end.
   */
  #laneRange(
    from: { side: Side; line: number },
    end: { side: Side; line: number },
  ): Omit<LaneRange, 'tone'> | undefined {
    const last = this.#docLine(end.side, end.line);
    if (last === undefined) return undefined;
    const shown = this.#docLine(from.side, from.line);
    const start = shown ?? (from.line < this.#docLines[from.side].first ? 1 : undefined);
    if (start === undefined) return undefined;
    return { from: Math.min(start, last), to: Math.max(start, last), tick: shown !== undefined };
  }

  /** The line of the excerpt document line `line` shows, or, with none, the header's place. */
  #placeAt(line: number): At {
    const spot = this.#spot(line);
    return spot.kind === 'line'
      ? { file: 0, side: spot.at.side, line: spot.at.line }
      : { file: 0, side: this.#side, line: 0 };
  }

  /** The box that scrolls around it, as it's first asked for. */
  #scrollBox(): HTMLElement {
    this.#scroller ??= scrollerOf(this.dom);
    return this.#scroller;
  }

  /** What its threads beside lines ask of it: its one editor, and the scroll around it. */
  #besideHost(): BesideHost {
    const box = (): HTMLElement => this.#scrollBox();
    return {
      root: this.dom,
      get scroller() {
        return box();
      },
      nonce: this.#nonce,
      // One popover for every excerpt in the scroll, as an overview's code blocks have: out in
      // the scroll, where its own right-click doesn't reach, so the popover says what was clicked.
      popover: (pop) => sharedPop(pop),
      menu: (target, x, y) => this.#on.menu(target, x, y),
      mode: () => this.#mode,
      threadsIn: (file) => (file === 0 ? this.#byPlace : undefined),
      fileOf: (id) => (id === this.#id ? 0 : undefined),
      threadPlace: (id) => this.#threadPlace(id),
      threadOpen: (id) => this.#hosts.get(id)?.open ?? false,
      panes: () => PANES,
      lanePanes: () => PANES,
      activePane: () => 'inline',
      popPane: () => 'inline',
      viewOf: () => this.#view,
      hasLines: (_pane, file) => file === 0,
      drawsLine: (at) => at.line > 0,
      docLine: (_pane, at) => this.#docLine(at.side, at.line) ?? 1,
      placeAt: (_pane, line) => this.#placeAt(line),
      otherRow: () => undefined,
      laneRange: (_pane, _file, from, end) => this.#laneRange(from, end),
      room: (): PopRoom => {
        const scroller = box();
        return {
          scroll: scroller.scrollTop,
          height: scroller.clientHeight,
          width: scroller.clientWidth,
          edge: scroller.offsetWidth - scroller.clientLeft,
          end: scroller.scrollHeight,
          header: 0,
        };
      },
      scrollBy: (by) => {
        box().scrollTop += by;
      },
      putCursor: (_pane, line) => {
        this.#view.dispatch({ selection: { anchor: this.#view.state.doc.line(line).from } });
      },
      focusLine: (at) => this.#focusLine(this.#docLine(at.side, at.line) ?? 1),
      marksChanged: () => this.#view.dispatch({ effects: setLane.of([this.#lane()]) }),
      // It folds no line, so a box's line is always shown, and nothing holds the line a box left.
      keep: () => {},
      showLine: () => {},
      boxShown: () => {},
    };
  }

  /** Where thread `id` ends, if it's drawn. */
  #threadPlace(id: string): At | undefined {
    for (const threads of this.#byPlace.values()) {
      const at = threads.find((thread) => thread.id === id)?.at;
      if (at && 'line' in at) return { file: 0, side: at.side, line: at.line };
    }
    return undefined;
  }

  /**
   * A bubble's tip: what a click on it does. A draft's own runs its command, whose label and key it
   * says, or why it can't run, which also dims it. A thread's mark beside lines has none: what the
   * pointer resting on it shows is its thread.
   */
  #tipOf(control: HTMLElement): Tip | undefined {
    const { tip, command } = control.dataset;
    if (control.dataset.beside !== undefined) return undefined;
    if (command === undefined) return tip === undefined ? undefined : { label: tip };
    const target = this.#markTarget(control);
    const shown = target ? controlOf(command, target) : undefined;
    if (!shown) return undefined;
    if (shown.off === undefined) control.removeAttribute('aria-disabled');
    else control.setAttribute('aria-disabled', 'true');
    if (shown.off !== undefined) return { label: shown.off };
    return { label: tip ?? shown.label, keys: shown.keys };
  }

  /** What a mark in the lane runs its command on: the line it's beside, by where it is. */
  #markTarget(control: HTMLElement): LineTarget | HeaderTarget | undefined {
    const cell = control.closest('.cm-gutterElement');
    if (!cell || !this.#view.dom.contains(cell)) return undefined;
    const view = this.#view;
    const height = cell.getBoundingClientRect().top + 1 - view.documentTop;
    return this.#targetAt(view.state.doc.lineAt(view.lineBlockAtHeight(height).from).number);
  }

  /**
   * A click on a thread's bubble collapses its thread, or expands it again. Beside lines, a click
   * on a thread's mark pins its popover and takes focus into it, or closes it, and one on a draft's
   * own opens its box again, as `⏎` on its line does.
   */
  readonly #clicked = (event: MouseEvent): void => {
    if (this.#mode === 'beside') {
      const draft =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.lo-bubble[data-draft]')
          : null;
      const command = draft?.dataset.command;
      if (draft && command !== undefined && event.button === 0 && this.dom.contains(draft)) {
        const target = this.#markTarget(draft);
        if (!target) return;
        event.preventDefault();
        runControl(command, target);
        return;
      }
      const marked = this.#beside.markOf(event.target);
      if (!marked || event.button !== 0) return;
      event.preventDefault();
      this.#beside.clicked(marked.at);
      return;
    }
    const bubble =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.lo-bubble') : null;
    const id = bubble?.dataset.thread;
    if (!bubble || id === undefined || !this.dom.contains(bubble)) return;
    event.preventDefault();
    this.openThread(id, 'toggle');
  };

  /** The pointer came over something, or left: a mark it rests on beside lines previews it. */
  readonly #hoverMark = (event: PointerEvent): void => this.#beside.hover(event);

  /** The document line that shows line `number` of `side`, if the excerpt shows it. */
  #docLine(side: Side, number: number): number | undefined {
    const { first, lines } = this.#docLines[side];
    return lines[number - first];
  }

  // Data -------------------------------------------------------------------------------------

  setTokens(side: Side, triples: Uint32Array): void {
    this.#tokens[side] = { tokens: triples, starts: this.#starts[side] };
    this.#view.dispatch({ effects: tokensChanged.of(null) });
  }

  setStale(lines: readonly number[]): void {
    this.#stale = new Set(lines);
    this.#view.dispatch({ effects: staleChanged.of(null) });
  }

  setThreads(
    threads: readonly ThreadView[],
    render: RenderThread,
    options: { readonly popover?: RenderPopover } = {},
  ): void {
    this.#hosts.render = render;
    this.#given = threads;
    if (options.popover) this.#beside.render = options.popover;
    const next = this.#placed(threads);
    if (this.#mode === 'beside') {
      this.#placeBeside(next);
      return;
    }
    for (const placed of next.values()) for (const thread of placed) this.#hosts.take(thread);
    // Threads that would come, go or move on a line on screen wait for it to leave the screen.
    // What comes under the line of a box, open or sent and still drawn, is what the reader sent:
    // it comes now.
    const changes = changedLines(this.#threads, next).filter(
      (line) => !this.#boxes.has(line) && !this.#rooms.has(line),
    );
    if (this.#drawn && changes.some((line) => this.#lineOnScreen(line))) {
      this.#waiting = next;
      this.#dropThreads();
      return;
    }
    this.#showThreads(next);
  }

  /** The threads on lines the excerpt shows, by the document line they're under. */
  #placed(threads: readonly ThreadView[]): Map<number, ThreadView[]> {
    const next = new Map<number, ThreadView[]>();
    const given = new Set<string>();
    for (const thread of threads) {
      const { at } = thread;
      const line = 'line' in at && at.file === this.#id && this.#docLine(at.side, at.line);
      if (!line || given.has(thread.id)) continue;
      given.add(thread.id);
      const there = next.get(line);
      if (there) there.push(thread);
      else next.set(line, [thread]);
    }
    return next;
  }

  /** Draws `next` as the threads under their lines, in place of those drawn. */
  #showThreads(next: Map<number, ThreadView[]>): void {
    this.#waiting = undefined;
    this.#setDrawn(next);
    this.#dropThreads();
    this.#drawBlocks();
  }

  /** `next` is what's drawn now, by the document line each is under, and by where each is. */
  #setDrawn(next: Map<number, ThreadView[]>): void {
    this.#threads = next;
    const byPlace = new Map<string, ThreadView[]>();
    for (const threads of next.values()) {
      for (const thread of threads) {
        if (!('line' in thread.at)) continue;
        const key = `${thread.at.side}:${thread.at.line}`;
        byPlace.set(key, [...(byPlace.get(key) ?? []), thread]);
      }
    }
    this.#byPlace = byPlace;
  }

  /**
   * Beside lines, `next` is what's drawn, at once, since nothing moves for it: marks of threads new
   * to a line fade in, once the excerpt is on the page, and the popover shows what changed. Not
   * yet drawn, as the mode changes, what it draws then is drawn.
   */
  #placeBeside(next: Map<number, ThreadView[]>, switching = false): void {
    const seen = this.#drawn && !switching;
    // A sent box in the popover goes as the threads at its line change, which bring what it sent.
    this.#beside.takeThreads(() => {
      const was = this.#byPlace;
      this.#setDrawn(next);
      if (!seen) return;
      for (const [key, threads] of this.#byPlace) {
        const before = new Set((was.get(key) ?? []).map(({ id }) => id));
        for (const { id } of threads) if (!before.has(id)) this.#beside.arrive(id);
      }
    });
    if (switching) return;
    this.#drawBlocks();
    this.#beside.refresh();
  }

  setThreadsMode(mode: ThreadsMode): void {
    if (mode === this.#mode) return;
    // A box open closes, keeping its draft, wherever it's drawn: in the popover, or under its line,
    // where what boxes sent and closed still show goes too. Between lines nothing opens the
    // popover. Focus in a box goes to its line.
    this.#beside.switching(mode);
    this.#switching = true;
    try {
      // Each one leaving takes it out of the map this goes through, which a `Map` allows.
      for (const box of this.#boxes.values()) box.composer.leave();
    } finally {
      this.#switching = false;
    }
    for (const box of this.#rooms.values()) box.destroy();
    this.#rooms.clear();
    this.#mode = mode;
    this.dom.classList.toggle('is-beside', mode === 'beside');
    // What waited or was held is drawn as threads show now.
    this.#waiting = undefined;
    this.#held.clear();
    const next = this.#placed(this.#given);
    if (mode === 'beside') {
      this.#hosts.drop(() => true);
      this.#placeBeside(next, true);
      this.#drawBlocks();
      return;
    }
    for (const placed of next.values()) for (const thread of placed) this.#hosts.take(thread);
    this.#showThreads(next);
  }

  pinThread(id: string, focus = false): boolean {
    if (this.#mode === 'beside') {
      const place = this.#threadPlace(id);
      const line = place && this.#docLine(place.side, place.line);
      if (line !== undefined) this.#show(line);
    }
    return this.#beside.pinThread(id, focus);
  }

  pinned(): readonly string[] {
    return this.#beside.pinned();
  }

  popoverPinned(): boolean {
    return this.#beside.popoverPinned();
  }

  closePopover(): boolean {
    return this.#beside.closePopover();
  }

  hasFocus(): boolean {
    return this.dom.contains(document.activeElement) || this.#beside.hasFocus();
  }

  /** Takes down the threads neither drawn nor waiting to be. */
  #dropThreads(): void {
    const kept = new Set<string>();
    for (const threads of this.#threads.values()) for (const { id } of threads) kept.add(id);
    for (const threads of this.#waiting?.values() ?? []) for (const { id } of threads) kept.add(id);
    this.#hosts.drop((host) => {
      if (kept.has(host.id)) return false;
      this.#held.delete(host);
      return true;
    });
  }

  openThread(id: string, open: boolean | 'toggle'): boolean {
    if (this.#mode === 'beside') return this.#beside.openThread(id, open);
    const host = this.#hosts.get(id);
    if (!host) return false;
    // The reader's doing: it takes its own height.
    this.#held.delete(host);
    host.letGo();
    host.setOpen(open === 'toggle' ? !host.open : open);
    // Its bubble says so.
    this.#view.dispatch({ effects: setLane.of([this.#lane()]) });
    const line = host.open ? this.#lineUnder(host) : undefined;
    if (line !== undefined) this.#show(line, host.dom);
    return true;
  }

  compose(
    at: Place | Span | { thread: string },
    draft: string,
    on: ComposerEvents,
    frame?: BoxFrame,
    options: ComposeOptions = {},
  ): Composer {
    if (this.#mode === 'beside') return this.#composeBeside(at, draft, on, frame, options);
    const line = this.#boxLine(at);
    if (line === undefined) throw new Error('A comment box goes under a line the excerpt shows.');
    const focus = options.focus !== false;
    const open = this.#boxes.get(line);
    if (open) {
      this.#show(line, open.dom);
      if (focus) open.focus();
      return open.composer;
    }
    const where = 'thread' in at ? this.#spot(line) : { kind: 'line' as const, at };
    if (where.kind !== 'line')
      throw new Error('A comment box goes under a line the excerpt shows.');
    const thread = 'thread' in at ? at.thread : this.#threadOn(line);
    const target: LineTarget =
      thread === undefined
        ? { kind: 'line', at: where.at }
        : { kind: 'line', at: where.at, thread };
    // A key in the box names it too, for the caller's commands on the box.
    if (options.name !== undefined) target.box = options.name;
    const box = new CommentBox({
      target,
      draft,
      on,
      frame,
      nonce: this.#nonce,
      hint: options.hint,
      escape: (closed) => {
        const keep = closed.text.trim() !== '';
        this.#closeBox(closed, this.#switching ? 'dismiss' : 'escape');
        on.close(keep);
      },
      // Held, the box stays, and focus goes back to its line.
      leave: (left) => {
        if (left.dom.contains(document.activeElement)) this.#focusLine(line);
      },
      close: (closed, landed) => this.#closeBox(closed, landed ? 'landed' : 'sent'),
      dismiss: (closed) => this.#closeBox(closed, 'dismiss'),
    });
    // A box opened where one's room is kept takes its place.
    this.#rooms.get(line)?.destroy();
    this.#rooms.delete(line);
    this.#boxes.set(line, box);
    // The lines `v` selected are the box's now.
    if (focus) endSelection(this.#view);
    this.#drawBlocks();
    this.#show(line, box.dom);
    if (focus) box.focus();
    return box.composer;
  }

  /**
   * Beside lines, a box in the popover (`Beside.compose`), pinned: a new comment's under the last
   * line it's on, a reply's or an edit's in its thread.
   */
  #composeBeside(
    at: Place | Span | { thread: string },
    draft: string,
    on: ComposerEvents,
    frame: BoxFrame | undefined,
    options: ComposeOptions,
  ): Composer {
    const written = 'thread' in at ? at.thread : undefined;
    const place = 'thread' in at ? this.#threadPlace(at.thread) : this.#boxPlace(at);
    const line = place && this.#docLine(place.side, place.line);
    if (!place || line === undefined) {
      throw new Error('A comment box goes under a line the excerpt shows.');
    }
    // A box the caller named is one of its own: a reply's beside a comment on the same line.
    const key = options.name === undefined ? placeKey(place) : `${placeKey(place)}|${options.name}`;
    const from =
      'from' in at && Math.min(at.from, at.to) !== place.line
        ? { side: at.side, line: Math.min(at.from, at.to) }
        : undefined;
    const spot = 'thread' in at ? this.#spot(line) : { kind: 'line' as const, at };
    if (spot.kind !== 'line') throw new Error('A comment box goes under a line the excerpt shows.');
    const thread = written ?? this.#threadOn(line);
    const target: LineTarget =
      thread === undefined ? { kind: 'line', at: spot.at } : { kind: 'line', at: spot.at, thread };
    // A key in the box names it too, for the caller's commands on the box.
    if (options.name !== undefined) target.box = options.name;
    this.#show(line);
    return this.#beside.compose({ key, place, from, target, written }, draft, on, frame, options);
  }

  /** The line `at` names, or a span's last, as the popover places a box, if the excerpt has it. */
  #boxPlace(at: Place | Span): At | undefined {
    if (at.file !== this.#id) return undefined;
    return { file: 0, side: at.side, line: 'line' in at ? at.line : Math.max(at.from, at.to) };
  }

  setDrafts(drafts: readonly DraftMark[]): void {
    this.#beside.setDrafts(drafts);
  }

  openDraft(at: Place | { readonly thread: string }): boolean {
    return this.#beside.openDraft(at);
  }

  /** The document line a box for `at` goes under: a line, a span's last line, or a thread's. */
  #boxLine(at: Place | Span | { thread: string }): number | undefined {
    if ('thread' in at) {
      for (const [line, threads] of this.#threads) {
        if (threads.some((thread) => thread.id === at.thread)) return line;
      }
      return undefined;
    }
    if (at.file !== this.#id) return undefined;
    return this.#docLine(at.side, 'line' in at ? at.line : Math.max(at.from, at.to));
  }

  /**
   * The thread a key on document line `line` acts on: the only one under it, or beside lines, of
   * those whose mark is on it, the first the popover lists, or else the shortest range over it.
   */
  #threadOn(line: number): string | undefined {
    if (this.#mode === 'beside') {
      const at = this.#placeAt(line);
      return at.line === 0 ? undefined : this.#beside.threadAt(at);
    }
    const threads = this.#threads.get(line);
    return threads?.length === 1 ? threads[0]!.id : undefined;
  }

  /**
   * Takes a box away: `Esc Esc`, the reader's, gives its line focus; once its comment was sent, or
   * as its draft goes elsewhere, focus goes to its line only if it was in the box. A box sent on
   * screen stays drawn as it is, as the room it took, until the thread that draws its comment takes
   * its place, or it goes with what waits there. `landed`, that thread is drawn or about to be: the
   * box goes with it if it's measured within two frames, and by itself then.
   */
  #closeBox(box: CommentBox, how: 'escape' | 'sent' | 'landed' | 'dismiss'): void {
    const found = [...this.#boxes].find(([, open]) => open === box);
    if (!found) return;
    const [line] = found;
    const focused = how === 'escape' || box.dom.contains(document.activeElement);
    this.#boxes.delete(line);
    const kept = (how === 'sent' || how === 'landed') && this.#drawn && this.#lineOnScreen(line);
    if (kept) this.#rooms.set(line, box);
    if (kept && how === 'landed') {
      const go = (): void => {
        if (this.#rooms.get(line) !== box) return;
        this.#rooms.delete(line);
        this.#drawBlocks();
        box.destroy();
      };
      requestAnimationFrame(() => requestAnimationFrame(go));
    }
    this.#drawBlocks();
    if (focused) this.#focusLine(line);
    if (!kept) box.destroy();
  }

  /** Gives focus to document line `line`, the cursor on it. */
  #focusLine(line: number): void {
    this.#view.dispatch({ selection: { anchor: this.#view.state.doc.line(line).from } });
    this.#view.focus();
  }

  /** The document line thread `host` is drawn under. */
  #lineUnder(host: ThreadHost): number | undefined {
    for (const [line, threads] of this.#threads) {
      if (threads.some((thread) => thread.id === host.id)) return line;
    }
    return undefined;
  }

  // Holding ---------------------------------------------------------------------------------

  /**
   * Where what's visible of the page is, top to bottom: the window, within every element around the
   * excerpt that clips what it holds.
   */
  #visible(): { top: number; bottom: number } {
    let top = 0;
    let bottom = window.innerHeight;
    for (let element = this.dom.parentElement; element; element = element.parentElement) {
      const { overflowY } = getComputedStyle(element);
      if (overflowY === 'visible') continue;
      const box = element.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    return { top, bottom };
  }

  /** Whether anything from `top` to `bottom` on the page is on screen. */
  #spanOnScreen(top: number, bottom: number): boolean {
    if (bottom <= top) return false;
    const visible = this.#visible();
    return bottom > visible.top && top < visible.bottom;
  }

  #onScreen(element: Element): boolean {
    const { top, bottom } = element.getBoundingClientRect();
    return this.#spanOnScreen(top, bottom);
  }

  /** Where document line `line` is on the page, with what's drawn under it. */
  #lineSpan(line: number): { top: number; bottom: number } {
    const view = this.#view;
    const { doc } = view.state;
    const top = view.documentTop + view.lineBlockAt(doc.line(line).from).top;
    const bottom =
      view.documentTop +
      (line < doc.lines ? view.lineBlockAt(doc.line(line + 1).from).top : view.contentHeight);
    return { top, bottom };
  }

  #lineOnScreen(line: number): boolean {
    const { top, bottom } = this.#lineSpan(line);
    return this.#spanOnScreen(top, bottom);
  }

  /**
   * Says document line `line` is being shown, with `under`, what opens under it, if anything does:
   * a block around the excerpt that cut any of it off shows whole first (`askToShowLine`).
   */
  #show(line: number, under?: Element): void {
    askToShowLine(this.#view, line, under);
  }

  /**
   * Whether a scroll could take what's from `top` to `bottom` on the page off screen, in the
   * nearest element around the excerpt that scrolls.
   */
  #canLeave(top: number, bottom: number): boolean {
    let scroller: Element | null = this.dom.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    scroller ??= document.scrollingElement;
    if (!scroller) return false;
    const box =
      scroller === document.scrollingElement ? { top: 0 } : scroller.getBoundingClientRect();
    const from = top - box.top + scroller.scrollTop;
    const to = bottom - box.top + scroller.scrollTop;
    return to <= scroller.scrollHeight - scroller.clientHeight || from >= scroller.clientHeight;
  }

  /** Whether what's from `top` to `bottom` on the page may change now, as `letting` says. */
  #mayGo(letting: Letting, span: { top: number; bottom: number }): boolean {
    if (letting === 'all') return true;
    const shown = this.#spanOnScreen(span.top, span.bottom);
    if (letting === 'off') return !shown;
    return !shown || !this.#canLeave(span.top, span.bottom);
  }

  /**
   * What waits takes what it has now, as `letting` says: threads held at the height they were
   * drawn at, threads waiting for their lines, and the rooms of boxes sent. Waiting threads come
   * all at once, once none of the lines they change is held back; a room goes with them.
   */
  #letGo(letting: Letting): void {
    const held = [...this.#held].filter((host) =>
      this.#mayGo(letting, host.dom.getBoundingClientRect()),
    );
    for (const host of held) {
      this.#held.delete(host);
      host.letGo();
    }
    const rooms = [...this.#rooms.keys()].filter((line) =>
      this.#mayGo(letting, this.#lineSpan(line)),
    );
    const gone = rooms.flatMap((line) => this.#rooms.get(line) ?? []);
    for (const line of rooms) this.#rooms.delete(line);
    const next = this.#waiting;
    const changes = next ? changedLines(this.#threads, next) : [];
    if (next && changes.every((line) => this.#mayGo(letting, this.#lineSpan(line)))) {
      this.#showThreads(next);
    } else if (rooms.length > 0) {
      this.#drawBlocks();
    }
    for (const box of gone) box.destroy();
    if (held.length > 0) this.#view.requestMeasure();
  }

  /** The line of the sent box still drawn right after thread `host`, the last under its line. */
  #roomAfter(host: ThreadHost): number | undefined {
    for (const [line, threads] of this.#threads) {
      if (threads.at(-1)?.id === host.id) return this.#rooms.has(line) ? line : undefined;
    }
    return undefined;
  }

  /** Whether anything waits. */
  get #holding(): boolean {
    return this.#held.size > 0 || this.#rooms.size > 0 || this.#waiting !== undefined;
  }

  /** A scroll anywhere: what waits off screen now changes. */
  readonly #scrolled = (): void => {
    if (this.#holding) this.#letGo('off');
  };

  /**
   * The reader's input in the page around the excerpt, as the overview, or with nothing focused:
   * what no scroll can take off screen changes. Input in a dialog or the palette over the page, or
   * in another panel, isn't the page's. A pointer or key in the excerpt is `#touched`'s; the wheel
   * over it is the page's.
   */
  readonly #elsewhere = (event: Event): void => {
    const { target } = event;
    if (!this.#holding || !(target instanceof Node)) return;
    if (event.type !== 'wheel' && this.dom.contains(target)) return;
    if (!this.#page().contains(target) && !this.#unfocused(target)) return;
    this.#letGo('stuck');
  };

  /** The page the excerpt is in: the scope around its own, as the overview, or else the document. */
  #page(): Node {
    return this.dom.parentElement?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? this.dom.ownerDocument;
  }

  /** Whether input at `target` is for nothing in particular: the page itself, with nothing focused. */
  #unfocused(target: Node): boolean {
    const { ownerDocument } = this.dom;
    if (target !== ownerDocument && target !== ownerDocument.body) return false;
    const focused = ownerDocument.activeElement;
    return focused === null || focused === ownerDocument.body;
  }

  /** The reader's pointer or key in the excerpt: what waits in it changes. */
  readonly #touched = (event: Event): void => {
    const { target } = event;
    if (target instanceof Element) {
      const host = this.#hosts.around(target);
      host?.touched();
    }
    if (this.#holding) this.#letGo('all');
  };

  /** Draws the threads and boxes under their lines, in place of those drawn. */
  #drawBlocks(): void {
    const { doc } = this.#view.state;
    const draw = (host: ThreadHost): void => this.#hosts.draw(host);
    // Beside lines, no thread is drawn in the flow.
    const under = this.#mode === 'between' ? this.#threads : new Map<number, ThreadView[]>();
    const lines = [
      ...new Set([...under.keys(), ...this.#boxes.keys(), ...this.#rooms.keys()]),
    ].toSorted((a, b) => a - b);
    if (lines.length === 0) {
      this.#view.dispatch({ effects: [setBlocks.of([]), setLane.of([this.#lane()])] });
      return;
    }
    const sizes = (this.#sizes ??= new ThreadSizes(this.#view.contentDOM));
    const blocks = lines.map((line) => {
      const hosts = (under.get(line) ?? []).flatMap((thread) => {
        const host = this.#hosts.get(thread.id);
        return host ? [host] : [];
      });
      const box = this.#boxes.get(line) ?? this.#rooms.get(line);
      const widget = new ThreadWidget(`x:${line}`, hosts, sizes, draw, box ? [box] : []);
      return Decoration.widget({ widget, block: true, side: 2 }).range(doc.line(line).to);
    });
    this.#view.dispatch({ effects: [setBlocks.of(blocks), setLane.of([this.#lane()])] });
  }

  // Moving -----------------------------------------------------------------------------------

  reveal(at: Target): boolean {
    const found = this.#lineOf(at);
    if (!found) return false;
    const line = this.#view.state.doc.line(found.line);
    // What Vim was in the middle of, such as a count typed before `⌃o`, ends here.
    this.clearPending();
    this.#view.dispatch({
      selection: { anchor: line.from + Math.min(found.column, line.length) },
      scrollIntoView: true,
    });
    return true;
  }

  /** The document line `at` names, and the column on it, if the excerpt shows it. */
  #lineOf(at: Target): { line: number; column: number } | undefined {
    switch (at.kind) {
      case 'line':
      case 'draft': {
        const place = at.at;
        if (place.file !== this.#id) return undefined;
        const number = 'line' in place ? place.line : Math.max(place.from, place.to);
        const line = this.#docLine(place.side, number);
        if (line === undefined) return undefined;
        return { line, column: 'line' in place ? (place.column ?? 0) : 0 };
      }
      case 'header':
      case 'file':
        return at.file === this.#id ? { line: 1, column: 0 } : undefined;
      case 'thread':
      case 'layer':
      case 'block':
      case 'tab':
      case 'row':
      case 'box':
      case 'notice':
      case 'none':
        return undefined;
      default:
        throw new Error(`A target Lo doesn’t know: ${JSON.stringify(at satisfies never)}`);
    }
  }

  focus(): void {
    this.#view.focus();
    // Said now: CodeMirror hears of focus a little later.
    this.#tell();
  }

  height(): number {
    // Off screen, CodeMirror sizes the gutters by its guess at each line's height; the lines
    // themselves are laid out as they'll be.
    const view = this.#view;
    const around = this.dom.getBoundingClientRect().height - view.scrollDOM.offsetHeight;
    return around + view.contentDOM.getBoundingClientRect().height;
  }

  destroy(): void {
    // Focus in its code or its popover goes to the scroll around it, as the overview, not to the
    // page, once they're gone: the scroll found now, while the excerpt is in it.
    const active = this.dom.ownerDocument.activeElement;
    if (active && this.hasFocus()) {
      const scroller = this.#scrollBox();
      handOffFocus([active], () => [scroller]);
    }
    // Its popover goes first, with what it held, while its lines are there to say so.
    this.#beside.destroy();
    this.dom.removeEventListener('click', this.#clicked);
    this.dom.removeEventListener('pointerover', this.#hoverMark);
    this.dom.removeEventListener('pointerleave', this.#hoverMark);
    for (const type of TOUCH) this.dom.removeEventListener(type, this.#touched, { capture: true });
    document.removeEventListener('scroll', this.#scrolled, { capture: true });
    for (const type of INPUT) {
      window.removeEventListener(type, this.#elsewhere, { capture: true });
    }
    this.#held.clear();
    for (const box of this.#rooms.values()) box.destroy();
    this.#rooms.clear();
    for (const stop of this.#stops) stop();
    for (const box of this.#boxes.values()) box.destroy();
    this.#boxes.clear();
    this.#hosts.destroy();
    this.#sizes?.destroy();
    this.#view.destroy();
    this.dom.remove();
  }

  // Keys -------------------------------------------------------------------------------------

  keyState(): ReturnType<KeySource['keyState']> {
    const view = this.#view;
    return {
      mode: vimMode(view),
      pending: vimPending(view),
      count: vimCount(view),
      target: this.#target(),
      plain: !vimOn(),
    };
  }

  passKeys(keys: readonly string[]): void {
    passToVim(this.#view, keys);
  }

  clearPending(): void {
    clearVim(this.#view);
  }

  setVimKeys(keys: readonly VimKey[]): void {
    setVimKeys(keys);
  }

  /**
   * What a key acts on: the cursor's line, or the lines `v` selected when they start and end on
   * one side; the header of an excerpt with no lines. As the diff's do, the lines a key takes as
   * they show are `across` where they're more than one run of one side's: those `v` selected, the
   * other side's between them too; and with a count, as `4yy` takes, that many from the cursor's.
   */
  #target(): LineTarget | HeaderTarget {
    const view = this.#view;
    const { doc, selection } = view.state;
    const { head } = selection.main;
    const lines = selectedLines(view);
    const line = doc.line(lines.head);
    const column = Math.max(0, Math.min(head - line.from, line.length));
    const target = this.#targetAt(line.number, column);
    if (vimMode(view) !== 'visual') {
      const count = vimCount(view);
      if (count === undefined || count < 2 || target.kind !== 'line') return target;
      const last = Math.min(doc.lines, line.number + count - 1);
      return { ...target, across: this.#spansIn(line.number, last) };
    }
    const anchorLine = lines.anchor;
    const from = this.#spot(anchorLine);
    const to = this.#spot(line.number);
    const across = this.#spansIn(anchorLine, line.number);
    if (from.kind === 'line' && to.kind === 'line' && from.at.side === to.at.side) {
      const span: Span = {
        file: this.#id,
        side: to.at.side,
        from: Math.min(from.at.line, to.at.line),
        to: Math.max(from.at.line, to.at.line),
      };
      return isOnly(across, span) ? { kind: 'line', at: span } : { kind: 'line', at: span, across };
    }
    return target.kind === 'line' && across.length > 0 ? { ...target, across } : target;
  }

  /** The lines document lines `from` to `to` show, either way round: a run of one side's each. */
  #spansIn(from: number, to: number): Span[] {
    const spans: Span[] = [];
    for (let line = Math.min(from, to); line <= Math.max(from, to); line++) {
      const spot = this.#spot(line);
      if (spot.kind !== 'line') continue;
      const { side, line: number } = spot.at;
      const last = spans.at(-1);
      if (last?.side === side && last.to === number - 1) last.to = number;
      else spans.push({ file: this.#id, side, from: number, to: number });
    }
    return spans;
  }

  /**
   * What a key or a click on document line `line` acts on: its line and thread, or the header.
   * Beside lines, a draft's own mark on a line with no thread is said too (`draft`).
   */
  #targetAt(line: number, column?: number): LineTarget | HeaderTarget {
    const spot = this.#spot(line, column);
    if (spot.kind !== 'line') return spot;
    const thread = this.#threadOn(line);
    if (thread !== undefined) return { kind: 'line', at: spot.at, thread };
    const target: LineTarget = { kind: 'line', at: spot.at };
    if (this.#beside.draftOn(this.#placeAt(line))) target.draft = true;
    return target;
  }

  // Events -----------------------------------------------------------------------------------

  /**
   * Where document line `line` is, as the caller sees it: a line on the side it's on, the range's
   * side for an unchanged line; or, in an excerpt with no lines, its header.
   */
  #spot(line: number, column?: number): Spot {
    const numbers = { old: this.#shown.old[line - 1] ?? 0, new: this.#shown.new[line - 1] ?? 0 };
    const other: Side = this.#side === 'old' ? 'new' : 'old';
    const side = numbers[this.#side] > 0 ? this.#side : other;
    if (numbers[side] === 0) return { kind: 'header', file: this.#id, side: this.#side };
    const place: Place = { file: this.#id, side, line: numbers[side] };
    if (column !== undefined) place.column = column;
    return { kind: 'line', at: place };
  }

  /** Says where the cursor is, and Vim's mode, if either changed. */
  #tell(): void {
    const { state } = this.#view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    if (this.#mode === 'beside') {
      this.#beside.cursorMoved('inline', line.number, this.#placeAt(line.number));
    }
    const spot = this.#spot(line.number, head - line.from);
    const said = JSON.stringify(spot);
    if (said !== this.#said.cursor) {
      this.#said.cursor = said;
      this.#on.cursor(spot);
    }
    this.#tellMode(vimMode(this.#view));
  }

  #tellMode(mode: Mode): void {
    if (mode === this.#said.mode) return;
    this.#said.mode = mode;
    this.#on.mode(mode);
  }

  /** A right-click on the code: the menu of the thread or the line under the pointer. */
  #contextMenu(event: MouseEvent): void {
    const { target } = event;
    if (event.defaultPrevented || !(target instanceof Element)) return;
    if (!this.#view.dom.contains(target)) return;
    // A comment box is text, which the system's own menu serves.
    if (target.closest('.lo-diffcomposer')) return;
    const thread = this.#hosts.around(target);
    if (thread) {
      event.preventDefault();
      // On a comment of it, the comment's own menu: what Edit and Delete act on.
      const comment = commentIn(thread.dom, target);
      this.#on.menu(
        {
          kind: 'thread',
          thread: thread.id,
          collapsed: !thread.open,
          ...(comment === undefined ? {} : { comment }),
        },
        event.clientX,
        event.clientY,
      );
      return;
    }
    // A mark beside lines: its thread's menu, as on its card.
    const marked = this.#beside.markOf(target);
    if (marked) {
      event.preventDefault();
      this.#on.menu({ kind: 'thread', thread: marked.thread }, event.clientX, event.clientY);
      return;
    }
    const pos = this.#view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;
    event.preventDefault();
    const line = this.#view.state.doc.lineAt(pos).number;
    this.#on.menu(this.#targetAt(line), event.clientX, event.clientY);
  }
}

/** A row under the lines shown that says how many more lines the change has. */
function moreRow(more: ExcerptLines['more']) {
  if (!more || more.after < 1) return [];
  const text = `${more.count} more line${more.count === 1 ? '' : 's'} in this change`;
  return EditorView.decorations.compute([], (state) =>
    Decoration.set(
      Decoration.widget({
        widget: new FileNoteWidget(0, { text }, false, false),
        block: true,
        side: 1,
      }).range(state.doc.line(more.after).to),
    ),
  );
}

/** Where each of one side's numbers shown is, as document lines: they're shown in order. */
function docLinesOf(numbers: readonly number[]): { first: number; lines: number[] } {
  const lines: number[] = [];
  let first = 0;
  numbers.forEach((number, index) => {
    if (number === 0) return;
    if (first === 0) first = number;
    lines[number - first] = index + 1;
  });
  return { first, lines };
}

/** The ids of the threads under a line, as one string. */
function idsOf(threads: readonly ThreadView[] | undefined): string {
  return (threads ?? []).map(({ id }) => id).join('\n');
}

/** The lines whose threads differ between `drawn` and `next`, by their ids, in order. */
function changedLines(
  drawn: ReadonlyMap<number, readonly ThreadView[]>,
  next: ReadonlyMap<number, readonly ThreadView[]>,
): number[] {
  return [...new Set([...drawn.keys(), ...next.keys()])]
    .filter((line) => idsOf(drawn.get(line)) !== idsOf(next.get(line)))
    .toSorted((a, b) => a - b);
}

/** Whether `spans` are `span` alone. */
function isOnly(spans: readonly Span[], span: Span): boolean {
  const [only] = spans;
  return (
    spans.length === 1 &&
    only?.file === span.file &&
    only.side === span.side &&
    only.from === span.from &&
    only.to === span.to
  );
}
