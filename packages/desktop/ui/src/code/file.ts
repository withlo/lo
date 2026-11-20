// The whole-file view: one file, read-only, in one CodeMirror editor as tall as the file, inside a
// box that scrolls, as the diff view's sides are, so Lo's screen keys go by the box (`screen.ts`).
// Its editor is a code view's own, as the diff's are (`editor.ts`, `keys.ts`): no key changes its
// text or enters insert or replace mode, its jumps go to the caller as places, and its cursor
// doesn't blink. A peek opens under a line as a block of its own (`peek.ts`), and hints come into
// lines with the reader's next input, as in the diff.
//
// Callers see none of this: they name the file by their own id, places by that id, the file's side
// and a line, and reach the view only through `FileView` (`api.ts`). Keys reach it through the
// registry, which runs Lo's commands and hands the rest to Vim; the view is the `file` scope's
// `KeySource`.

import {
  EditorState,
  Prec,
  type Range,
  type SelectionRange,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, lineNumbers } from '@codemirror/view';

import {
  type HeaderTarget,
  KEY_EVENT,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import type {
  Anchor,
  FileEvents,
  FileInit,
  FileView,
  Mark,
  Mode,
  PeekFrame,
  PeekView,
  Place,
  Side,
  Spot,
  VimKey,
} from './api.ts';
import { drawnTop, lineOnScreen, partlyOnScreen } from './aligner.ts';
import { codeEditor } from './editor.ts';
import { type FileTokens, highlighting, lineStarts, tokensChanged } from './highlight.ts';
import { columnAt, type HintAt, hintRanges, hintsOf, sameHintList } from './hints.ts';
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
import { marking, marksChanged } from './marks.ts';
import { PeekBlock, PeekWidget, peekShownAt } from './peek.ts';
import { watchRests, type Word, wordAnchor, wordUnder } from './words.ts';

/** Opens a whole-file view of `init`'s file in `parent`, which tells `on` what happens in it. */
export function createFileView(parent: HTMLElement, init: FileInit, on: FileEvents): FileView {
  return new WholeFile(parent, init, on);
}

/** A line a mark picks out. */
const markedLine = Decoration.line({ class: 'lo-line-marked' });

/**
 * Shows a peek under a document line, or with `null` none. Not `undefined`: the editor's change
 * filter (`readOnly`) rejects every transaction the view didn't mark, which CodeMirror rebuilds
 * with the effects mapped, and mapping drops an effect whose value is undefined. A peek that closed
 * would then leave its block drawn, an empty band under the line.
 */
const setPeek = StateEffect.define<{ line: number; block: PeekBlock } | null>();

/** The peek open, as a block under its line. */
const peekField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(peeks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setPeek)) continue;
      const open = effect.value;
      if (open === null) return Decoration.none;
      const widget = new PeekWidget(open.block);
      const at = transaction.state.doc.line(open.line).to;
      return Decoration.set(Decoration.widget({ widget, block: true, side: 1 }).range(at));
    }
    return peeks.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The reader's input in the view, after which hints waiting for it come. */
const INPUT = ['wheel', KEY_EVENT, 'click'] as const;

class WholeFile implements FileView {
  readonly dom: HTMLElement;
  readonly #view: EditorView;
  readonly #on: FileEvents;
  readonly #id: string;
  readonly #side: Side;
  /** How many lines the file has. A file with none shows one empty line, which is its header. */
  readonly #count: number;
  readonly #starts: Int32Array;
  #tokens: FileTokens | undefined;
  /** The lines the marks pick out, as ranges of lines, first to last. */
  #marked: readonly { from: number; to: number }[];
  /** The hints drawn, and those given last while they wait for the reader's next input. */
  #hints: readonly HintAt[];
  #wantedHints: readonly HintAt[] | undefined;
  /** Hints waiting for the input that let them go to be handled. */
  #settling: ReturnType<typeof setTimeout> | undefined;
  /** The peek open, under a line. */
  #peek: { line: number; block: PeekBlock } | undefined;
  /** What the events last said, so each says only what changed. */
  readonly #said: { cursor?: string; mode: Mode } = { mode: 'normal' };
  readonly #stops: (() => void)[] = [];
  /** Whether the scroll the editor asks for next is `showLine`'s, which only the box takes. */
  #ownScroll = false;

  constructor(parent: HTMLElement, init: FileInit, on: FileEvents) {
    installVim();
    this.#on = on;
    this.#id = init.id;
    this.#side = init.side ?? 'new';
    this.#count = init.lines.length;
    this.#starts = lineStarts(init.lines);
    if (init.tokens) this.#tokens = { tokens: init.tokens, starts: this.#starts };
    this.#marked = this.#ownMarks(init.marks ?? []);
    // Drawn with the rest, as the view comes.
    this.#hints = this.#ownHints(init.marks ?? []);

    this.dom = document.createElement('div');
    this.dom.className = 'lo-fileview';
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'file');
    parent.append(this.dom);
    const count = this.#count;
    const side = this.#side;
    const view = new EditorView({
      parent: this.dom,
      state: EditorState.create({
        doc: init.lines.join('\n'),
        extensions: [
          Prec.highest(
            EditorView.scrollHandler.of((editor, range) => this.#scrollOwn(editor, range)),
          ),
          codeEditor(init.nonce, () => this.#tell()),
          EditorView.contentAttributes.of({ 'aria-label': init.path }),
          lineNumbers({ formatNumber: (line) => (count === 0 ? '' : String(line)) }),
          marking((doc, first, last) => this.#marks(doc, first, last)),
          highlighting({
            lineAt: (line) => (line <= count ? { file: 0, side, line } : undefined),
            tokens: () => this.#tokens,
          }),
          peekField,
        ],
      }),
    });
    this.#view = view;
    addCodeEditor(view, {
      // Lo's motions stop at changes, files and threads, which a whole file hasn't.
      jump: () => undefined,
      jumped: (from, to) => {
        const { doc } = view.state;
        const before = doc.lineAt(Math.min(from, doc.length)).number;
        const after = doc.lineAt(Math.min(to, doc.length)).number;
        if (before !== after) this.#on.jumped(this.#spot(before), this.#spot(after));
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
    for (const type of INPUT) {
      this.dom.addEventListener(type, this.#afterInput, { passive: true, capture: true });
    }
    const { rested } = on;
    if (rested) this.#stops.push(watchRests(this.dom, (event) => this.#wordAt(event), rested));
    setVimKeys(init.vimKeys);
  }

  // Data -------------------------------------------------------------------------------------

  setTokens(triples: Uint32Array): void {
    this.#tokens = { tokens: triples, starts: this.#starts };
    this.#view.dispatch({ effects: tokensChanged.of(null) });
  }

  setMarks(marks: readonly Mark[]): void {
    this.#marked = this.#ownMarks(marks);
    this.#view.dispatch({ effects: marksChanged.of(null) });
    // Hints can make lines wrap anew: they wait for the reader's next input, unless the view isn't
    // shown.
    const hints = this.#ownHints(marks);
    this.#wantedHints = sameHintList(hints, this.#hints) ? undefined : hints;
    if (!this.#showing()) this.#letHintsGo();
  }

  /** The hints among `marks` on this file and side. */
  #ownHints(marks: readonly Mark[]): HintAt[] {
    return hintsOf(marks).get(this.#id)?.[this.#side] ?? [];
  }

  /** The reader's wheel, key or click: once it's handled, hints waiting for it come. */
  readonly #afterInput = (): void => {
    if (this.#wantedHints === undefined || this.#settling !== undefined) return;
    this.#settling = setTimeout(() => {
      this.#settling = undefined;
      this.#keepReading(() => this.#letHintsGo());
    });
  };

  /** The hints waiting for the reader's input are drawn. */
  #letHintsGo(): void {
    const wanted = this.#wantedHints;
    if (!wanted) return;
    this.#wantedHints = undefined;
    this.#hints = wanted;
    this.#view.dispatch({ effects: marksChanged.of(null) });
  }

  /** Whether the view shows anything: it isn't hidden, and it has room. */
  #showing(): boolean {
    const { dom } = this;
    const visible =
      !('checkVisibility' in dom) || dom.checkVisibility({ visibilityProperty: true });
    return visible && dom.clientHeight > 0;
  }

  /**
   * The lines `marks` pick out in this file and side, each range first to last. Overview markers
   * are the diff's, and hints are taken apart: they're left out.
   */
  #ownMarks(marks: readonly Mark[]): { from: number; to: number }[] {
    return marks.flatMap((mark) => {
      if (mark.kind !== 'lines' || mark.at.file !== this.#id || mark.at.side !== this.#side) {
        return [];
      }
      const { from, to } = mark.at;
      return [{ from: Math.min(from, to), to: Math.max(from, to) }];
    });
  }

  /** The marks on document lines `first` to `last`: lines picked out, and hints. */
  #marks(doc: Text, first: number, last: number): Range<Decoration>[] {
    const out: Range<Decoration>[] = [];
    const end = Math.min(last, this.#count);
    for (let line = first; line <= end; line++) {
      if (this.#marked.some(({ from, to }) => from <= line && line <= to)) {
        out.push(markedLine.range(doc.line(line).from));
      }
    }
    out.push(...hintRanges(this.#hints, first, end, (line, column) => columnAt(doc, line, column)));
    return out;
  }

  // Moving -----------------------------------------------------------------------------------

  reveal(at: Target): boolean {
    const found = this.#lineOf(at);
    if (!found) return false;
    const line = this.#view.state.doc.line(found.line);
    // What Vim was in the middle of, such as a count typed before `⌃o`, ends here.
    this.clearPending();
    // Its scroll is the editor's own, whatever `showLine` asked for before it.
    this.#ownScroll = false;
    this.#view.dispatch({
      selection: { anchor: line.from + Math.min(found.column, line.length) },
      scrollIntoView: true,
    });
    return true;
  }

  /** The document line `at` names, and the column on it, if it's in this file and side. */
  #lineOf(at: Target): { line: number; column: number } | undefined {
    switch (at.kind) {
      case 'line': {
        const place = at.at;
        if (place.file !== this.#id || place.side !== this.#side) return undefined;
        if ('line' in place) return { line: this.#docLine(place.line), column: place.column ?? 0 };
        return { line: this.#docLine(Math.max(place.from, place.to)), column: 0 };
      }
      case 'header':
        return at.file === this.#id && at.side === this.#side ? { line: 1, column: 0 } : undefined;
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

  /** The document line of file line `line`, which is the file's last if it runs past it. */
  #docLine(line: number): number {
    return Math.min(Math.max(1, line), Math.max(1, this.#count));
  }

  showLine(line: number): void {
    const { doc } = this.#view.state;
    this.#ownScroll = true;
    this.#view.dispatch({
      effects: EditorView.scrollIntoView(doc.line(this.#docLine(line)).from, { y: 'start' }),
    });
  }

  /**
   * Takes the scroll `showLine` asked for, once the editor has laid the line out: the box alone
   * scrolls, so the line's top is two lines under the box's, and nothing around the box moves.
   */
  #scrollOwn(view: EditorView, range: SelectionRange): boolean {
    if (!this.#ownScroll) return false;
    this.#ownScroll = false;
    const box = this.dom.getBoundingClientRect();
    const top = view.documentTop + view.lineBlockAt(range.head).top;
    this.dom.scrollTop += top - box.top - 2 * view.defaultLineHeight;
    return true;
  }

  peek(at: Place, peek: PeekView | undefined, frame?: PeekFrame): boolean {
    if (at.file !== this.#id || at.side !== this.#side) return false;
    if (at.line < 1 || at.line > this.#count) return false;
    const open = this.#peek;
    const view = this.#view;
    if (open?.line === at.line) {
      const { block } = open;
      if (peek) {
        this.#keepPeek(at.line, () => block.update(peek));
        return true;
      }
      const focused = block.hasFocus;
      this.#keepPeek(at.line, () => {
        this.#peek = undefined;
        block.destroy();
        view.dispatch({ effects: setPeek.of(null) });
      });
      if (focused) {
        // The cursor where it was as the peek opened.
        const line = view.state.doc.line(at.line);
        const column = Math.min(block.at.column ?? 0, line.length);
        view.dispatch({ selection: { anchor: line.from + column } });
        view.focus();
      }
      return true;
    }
    if (!peek) return false;
    // Focus in the code, or in the peek this one takes the place of, goes into it.
    const focused = view.hasFocus || open?.block.hasFocus === true;
    const block = new PeekBlock(at, peek, frame);
    const opened = { line: at.line, block };
    const shown = this.#keepPeek(at.line, () => {
      open?.block.destroy();
      this.#peek = opened;
      view.dispatch({ effects: setPeek.of(opened) });
    });
    if (focused) block.focus();
    if (shown) this.#showPeek(opened);
    return true;
  }

  anchor(at: Place): Anchor | undefined {
    if (at.file !== this.#id || at.side !== this.#side) return undefined;
    if (at.line < 1 || at.line > this.#count || !this.#showing()) return undefined;
    const line = this.#view.state.doc.line(at.line);
    const pos = line.from + Math.min(Math.max(0, at.column ?? 0), line.length);
    return wordAnchor(this.#view, pos, this.dom.getBoundingClientRect());
  }

  /** The word under the pointer, if it's on one in a line of code, not in the peek. */
  #wordAt(event: PointerEvent): Word | undefined {
    const view = this.#view;
    const { target } = event;
    const line = target instanceof Element ? target.closest('.cm-line') : null;
    if (line?.parentElement !== view.contentDOM || this.#count === 0) return undefined;
    const word = wordUnder(view, event.clientX, event.clientY);
    if (!word) return undefined;
    const text = view.state.doc.lineAt(word.from);
    const at = {
      file: this.#id,
      side: this.#side,
      line: text.number,
      column: word.from - text.from,
    };
    return { key: `${word.from}:${word.to}`, at };
  }

  /**
   * Makes a change under line `line`, as a peek opening there: while some of the line is on screen,
   * it stays where it is, and so does all above it; off screen, above it or below, the first line
   * on screen does, so a peek opening or closing out of sight moves nothing in it. Says whether the
   * line was on screen.
   */
  #keepPeek(line: number, change: () => void): boolean {
    const view = this.#view;
    view.lineBlockAtHeight(0);
    const screen = this.dom.getBoundingClientRect();
    const pos = view.state.doc.line(line).from;
    const shown = partlyOnScreen(view, pos, screen);
    const kept = shown ? pos : lineOnScreen(view, screen)?.pos;
    if (kept === undefined) change();
    else this.#keepPos(kept, change);
    return shown;
  }

  /**
   * Brings `opened`, under a line on screen, on screen whole, once it's drawn: the least scroll
   * that ends it at the screen's foot, its line going no higher than the top, where a peek taller
   * than the room under it puts it. It's a jump the reader asked for, as `reveal`'s: the editor
   * scrolls to the line, the cursor on it where the peek has it. A peek on screen whole moves
   * nothing.
   */
  #showPeek(opened: { line: number; block: PeekBlock }): void {
    queueMicrotask(() => {
      if (this.#peek !== opened) return;
      const view = this.#view;
      view.lineBlockAtHeight(0);
      const line = view.state.doc.line(opened.line);
      // The line's box, which goes where the peek wants it, and its text, which the editor scrolls
      // to, a little under the box's top.
      const top = drawnTop(view, line.from);
      const text = view.coordsAtPos(line.from, 1);
      const { block } = opened;
      if (top === undefined || !text || !this.#showing() || !block.dom.isConnected) return;
      const bottom = block.dom.getBoundingClientRect().bottom;
      const screen = this.dom.getBoundingClientRect().top;
      const to = peekShownAt(top - screen, bottom - top, this.dom.clientHeight);
      if (to === undefined) return;
      // Its scroll is the editor's own, as a jump's, whatever `showLine` asked for before it.
      this.#ownScroll = false;
      view.dispatch({
        selection: { anchor: line.from + Math.min(block.at.column ?? 0, line.length) },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: to + text.top - top }),
      });
    });
  }

  /**
   * Makes a change that comes with the reader's input, keeping what they read where it is: the
   * cursor's line, while it's on screen, or else the first line on screen.
   */
  #keepReading(change: () => void): void {
    const view = this.#view;
    // The input's own scroll comes first, as `j`'s bringing the cursor on screen.
    view.lineBlockAtHeight(0);
    const screen = this.dom.getBoundingClientRect();
    const cursor = view.lineBlockAt(view.state.selection.main.head).from;
    const top = drawnTop(view, cursor);
    const onScreen = top !== undefined && top >= screen.top && top < screen.bottom;
    const pos = onScreen ? cursor : lineOnScreen(view, screen)?.pos;
    if (pos === undefined) change();
    else this.#keepPos(pos, change);
  }

  /** Makes a change, keeping the line at `pos` where it is on screen, and all above it. */
  #keepPos(pos: number, change: () => void): void {
    const view = this.#view;
    const before = drawnTop(view, pos);
    change();
    // The editor measures what changed now, as the box's scroll is put right.
    view.requestMeasure();
    view.lineBlockAtHeight(0);
    const after = drawnTop(view, pos);
    if (before !== undefined && after !== undefined && Math.abs(after - before) >= 0.5) {
      this.dom.scrollTop += after - before;
    }
  }

  focus(): void {
    this.#view.focus();
    // Said now: CodeMirror hears of focus a little later.
    this.#tell();
  }

  destroy(): void {
    clearTimeout(this.#settling);
    for (const stop of this.#stops) stop();
    this.#peek?.block.destroy();
    this.#view.destroy();
    this.dom.remove();
  }

  // Keys -------------------------------------------------------------------------------------

  keyState(): { mode: Mode; pending: boolean; count: number | undefined; target: Target } {
    const view = this.#view;
    const target = this.#target();
    return { mode: vimMode(view), pending: vimPending(view), count: vimCount(view), target };
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

  /** What a key acts on: the cursor's line, or the lines `v` selected; the header of no lines. */
  #target(): LineTarget | HeaderTarget {
    const { doc, selection } = this.#view.state;
    const { head, anchor } = selection.main;
    const line = doc.lineAt(head);
    if (this.#count > 0 && vimMode(this.#view) === 'visual') {
      const other = doc.lineAt(anchor).number;
      const from = Math.min(line.number, other);
      const to = Math.max(line.number, other);
      return { kind: 'line', at: { file: this.#id, side: this.#side, from, to } };
    }
    return this.#targetAt(line.number, head - line.from);
  }

  /** What a key or a click on document line `line` acts on: the line, or the header. */
  #targetAt(line: number, column?: number): LineTarget | HeaderTarget {
    const spot = this.#spot(line, column);
    return spot.kind === 'line' ? { kind: 'line', at: spot.at } : spot;
  }

  // Events -----------------------------------------------------------------------------------

  /** Where document line `line` is, as the caller sees it: the file's line, or its header. */
  #spot(line: number, column?: number): Spot {
    if (this.#count === 0) return { kind: 'header', file: this.#id, side: this.#side };
    const place: Place = { file: this.#id, side: this.#side, line };
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

  /** A right-click on the code: the menu of the line under the pointer. */
  #contextMenu(event: MouseEvent): void {
    const { target } = event;
    if (event.defaultPrevented || !(target instanceof Node)) return;
    if (!this.#view.dom.contains(target)) return;
    const pos = this.#view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;
    event.preventDefault();
    // At the column clicked, so what acts on a word, as `gd` does, acts on the one clicked.
    const line = this.#view.state.doc.lineAt(pos);
    this.#on.menu(this.#targetAt(line.number, pos - line.from), event.clientX, event.clientY);
  }
}
