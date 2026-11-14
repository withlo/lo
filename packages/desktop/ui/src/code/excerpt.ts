// An excerpt: a range of a file's lines at one commit, read-only, as an inline diff from the
// base, as an overview's code block shows the code it points at. One CodeMirror editor holds the
// lines shown, a change's deleted lines before its added ones, each numbered on its sides as in the
// file, so the first is numbered as the range starts. It's a code view's own editor, as the diff's
// and the whole file's are (`editor.ts`, `keys.ts`): no key changes its text or enters insert or
// replace mode, its jumps go to the caller as places, its style elements carry the window's nonce,
// and its cursor doesn't blink. The cursor shows only while the excerpt has focus. Under its lines
// it draws review threads, each in an element the caller draws it in, and comment boxes, as the
// diff view does. Nothing on screen moves without the reader: threads that come, go or move on a
// line on screen, a thread that changes size there by itself, as an image loading, and the room a
// box left as it closed once its comment was sent wait until what they'd move is off screen, or the
// reader acts in the excerpt, or anywhere when no scroll can take them off. Whatever scrolls around
// it keeps the rest where it is as the excerpt changes height.
//
// Callers see none of this: they name the file by their own id, places by that id, a side and a
// line, and reach the excerpt only through `ExcerptView` (`api.ts`). Keys reach it through the
// registry, which runs Lo's commands and hands the rest to Vim, as for a whole file: the excerpt is
// the `file` scope's `KeySource`.

import { EditorState, type Range, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view';
import type { FileDiff } from '@lo/diff';

import {
  type HeaderTarget,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import type {
  BoxFrame,
  ComposeOptions,
  Composer,
  ComposerEvents,
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  Mode,
  Place,
  RenderThread,
  Side,
  Span,
  Spot,
  ThreadView,
  VimKey,
} from './api.ts';
import { CommentBox } from './comments.ts';
import { fileMarks } from './decorations.ts';
import { codeEditor } from './editor.ts';
import { type FileTokens, highlighting, lineStarts, tokensChanged } from './highlight.ts';
import {
  addCodeEditor,
  clearVim,
  handlingKey,
  installVim,
  onVimMode,
  passToVim,
  setVimKeys,
  vimCount,
  vimMode,
  vimPending,
} from './keys.ts';
import { marking } from './marks.ts';
import { type ThreadHost, Threads } from './threads.ts';
import { type BoxHost, FileNoteWidget, ThreadSizes, ThreadWidget } from './widgets.ts';

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

/** The room a box closed once its comment was sent keeps, as tall as the box was. */
class Room implements BoxHost {
  readonly dom: HTMLElement;

  constructor(height: number) {
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffcomposer-room';
    this.dom.style.height = `${height}px`;
  }

  attach(parent: HTMLElement): void {
    parent.append(this.dom);
  }
}

/** What may change now: what's off screen, or also what's on it that no scroll can take off it. */
type Letting = 'off' | 'stuck' | 'all';

/** The reader's input outside the excerpt, which lets go of what no scroll can take off screen. */
const INPUT = ['keydown', 'pointerdown'] as const;

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
  /** The threads drawn, by the document line they're under. */
  #threads = new Map<number, ThreadView[]>();
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
  /** The rooms of boxes closed once their comments were sent, by the line they're under. */
  readonly #rooms = new Map<number, Room>();
  /** Whether it's been on the page a frame: until then, what it's given is how it comes. */
  #drawn = false;

  constructor(parent: HTMLElement, init: ExcerptInit, on: ExcerptEvents) {
    installVim();
    this.#on = on;
    this.#nonce = init.nonce;
    // What's drawn under its lines changed size: each thread takes its new height in the next
    // frame, which the editor measures. A change of size made now, as the page tells its observers
    // of sizes, would go untold to the editor's.
    // One on screen that changed by itself is held so until it's off screen, or the reader acts.
    this.#hosts = new Threads((entries) => {
      const changed = this.#hosts.resized(entries);
      if (changed.length === 0) return;
      const taking: ThreadHost[] = [];
      for (const { host, fresh, reflowed } of changed) {
        host.hold();
        if (!fresh && host.takeInput()) taking.push(host);
        else if (!fresh && !reflowed && this.#onScreen(host.dom)) this.#held.add(host);
        else taking.push(host);
      }
      if (taking.length === 0) return;
      requestAnimationFrame(() => {
        for (const host of taking) if (!this.#held.has(host)) host.letGo();
        this.#view.requestMeasure();
      });
    });
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
    );
    this.dom.addEventListener('contextmenu', (event) => this.#contextMenu(event));
    // The reader's pointer or key in the excerpt lets go of what waits in it; in a thread, what
    // becomes of the thread's size next is theirs.
    for (const type of ['pointerdown', 'keydown'] as const) {
      this.dom.addEventListener(type, this.#touched, { capture: true });
    }
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

  setThreads(threads: readonly ThreadView[], render: RenderThread): void {
    this.#hosts.render = render;
    const next = this.#placed(threads);
    for (const placed of next.values()) for (const thread of placed) this.#hosts.take(thread);
    // Threads that would come, go or move on a line on screen wait for it to leave the screen.
    const changes = changedLines(this.#threads, next);
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
    this.#threads = next;
    this.#dropThreads();
    this.#drawBlocks();
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
    const host = this.#hosts.get(id);
    if (!host) return false;
    // The reader's doing: it takes its own height.
    this.#held.delete(host);
    host.letGo();
    host.setOpen(open === 'toggle' ? !host.open : open);
    return true;
  }

  compose(
    at: Place | Span | { thread: string },
    draft: string,
    on: ComposerEvents,
    frame?: BoxFrame,
    options: ComposeOptions = {},
  ): Composer {
    const line = this.#boxLine(at);
    if (line === undefined) throw new Error('A comment box goes under a line the excerpt shows.');
    const focus = options.focus !== false;
    const open = this.#boxes.get(line);
    if (open) {
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
      escape: (closed) => {
        const keep = closed.text.trim() !== '';
        this.#closeBox(closed, 'escape');
        on.close(keep);
      },
      close: (closed) => this.#closeBox(closed, 'sent'),
      dismiss: (closed) => this.#closeBox(closed, 'dismiss'),
    });
    // A box opened where one's room is kept takes its place.
    this.#rooms.delete(line);
    this.#boxes.set(line, box);
    // The lines `v` selected are the box's now.
    if (focus && vimMode(this.#view) === 'visual') passToVim(this.#view, ['<Esc>']);
    this.#drawBlocks();
    if (focus) box.focus();
    return box.composer;
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

  /** The thread a key on document line `line` acts on: the only one there. */
  #threadOn(line: number): string | undefined {
    const threads = this.#threads.get(line);
    return threads?.length === 1 ? threads[0]!.id : undefined;
  }

  /**
   * Takes a box away: `Esc Esc`, the reader's, gives its line focus; once its comment was sent, or
   * as its draft goes elsewhere, focus goes to its line only if it was in the box, and a box sent
   * on screen leaves its room, which goes with what waits there.
   */
  #closeBox(box: CommentBox, how: 'escape' | 'sent' | 'dismiss'): void {
    const found = [...this.#boxes].find(([, open]) => open === box);
    if (!found) return;
    const [line] = found;
    const focused = how === 'escape' || box.dom.contains(document.activeElement);
    const height = box.dom.offsetHeight;
    this.#boxes.delete(line);
    if (how === 'sent' && this.#drawn && this.#lineOnScreen(line)) {
      this.#rooms.set(line, new Room(height));
    }
    this.#drawBlocks();
    if (focused) {
      this.#view.dispatch({ selection: { anchor: this.#view.state.doc.line(line).from } });
      this.#view.focus();
    }
    box.destroy();
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
    for (const line of rooms) this.#rooms.delete(line);
    const next = this.#waiting;
    const changes = next ? changedLines(this.#threads, next) : [];
    if (next && changes.every((line) => this.#mayGo(letting, this.#lineSpan(line)))) {
      this.#showThreads(next);
    } else if (rooms.length > 0) {
      this.#drawBlocks();
    }
    if (held.length > 0) this.#view.requestMeasure();
  }

  /** Whether anything waits. */
  get #holding(): boolean {
    return this.#held.size > 0 || this.#rooms.size > 0 || this.#waiting !== undefined;
  }

  /** A scroll anywhere: what waits off screen now changes. */
  readonly #scrolled = (): void => {
    if (this.#holding) this.#letGo('off');
  };

  /** The reader's pointer or key outside the excerpt: what no scroll can take off screen changes. */
  readonly #elsewhere = (event: Event): void => {
    if (!this.#holding || (event.target instanceof Node && this.dom.contains(event.target))) return;
    this.#letGo('stuck');
  };

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
    const lines = [
      ...new Set([...this.#threads.keys(), ...this.#boxes.keys(), ...this.#rooms.keys()]),
    ].toSorted((a, b) => a - b);
    if (lines.length === 0) {
      this.#view.dispatch({ effects: setBlocks.of([]) });
      return;
    }
    const sizes = (this.#sizes ??= new ThreadSizes(this.#view.contentDOM));
    const blocks = lines.map((line) => {
      const hosts = (this.#threads.get(line) ?? []).flatMap((thread) => {
        const host = this.#hosts.get(thread.id);
        return host ? [host] : [];
      });
      const box = this.#boxes.get(line) ?? this.#rooms.get(line);
      const widget = new ThreadWidget(`x:${line}`, hosts, sizes, draw, box ? [box] : []);
      return Decoration.widget({ widget, block: true, side: 2 }).range(doc.line(line).to);
    });
    this.#view.dispatch({ effects: setBlocks.of(blocks) });
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
      case 'line': {
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
      case 'none':
        return undefined;
      default:
        throw new Error(`A target Lo doesn't know: ${JSON.stringify(at satisfies never)}`);
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
    for (const type of ['pointerdown', 'keydown'] as const) {
      this.dom.removeEventListener(type, this.#touched, { capture: true });
    }
    document.removeEventListener('scroll', this.#scrolled, { capture: true });
    for (const type of INPUT) {
      window.removeEventListener(type, this.#elsewhere, { capture: true });
    }
    this.#held.clear();
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

  keyState(): { mode: Mode; pending: boolean; count: number | undefined; target: Target } {
    const view = this.#view;
    return {
      mode: vimMode(view),
      pending: vimPending(view),
      count: vimCount(view),
      target: this.#target(),
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
    const { head, anchor } = selection.main;
    const line = doc.lineAt(head);
    const target = this.#targetAt(line.number, head - line.from);
    if (vimMode(view) !== 'visual') {
      const count = vimCount(view);
      if (count === undefined || count < 2 || target.kind !== 'line') return target;
      const last = Math.min(doc.lines, line.number + count - 1);
      return { ...target, across: this.#spansIn(line.number, last) };
    }
    const anchorLine = doc.lineAt(anchor).number;
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

  /** What a key or a click on document line `line` acts on: its line and thread, or the header. */
  #targetAt(line: number, column?: number): LineTarget | HeaderTarget {
    const spot = this.#spot(line, column);
    if (spot.kind !== 'line') return spot;
    const thread = this.#threadOn(line);
    return thread === undefined
      ? { kind: 'line', at: spot.at }
      : { kind: 'line', at: spot.at, thread };
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
      this.#on.menu({ kind: 'thread', thread: thread.id }, event.clientX, event.clientY);
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
      Decoration.widget({ widget: new FileNoteWidget(0, text, false), block: true, side: 1 }).range(
        state.doc.line(more.after).to,
      ),
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
