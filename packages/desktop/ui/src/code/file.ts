// The whole-file view: one file, read-only, in one CodeMirror editor as tall as the file, inside a
// box that scrolls, as the diff view's sides are, so Lo's screen keys go by the box (`screen.ts`).
// Its editor is a code view's own, as the diff's are (`editor.ts`, `keys.ts`): no key changes its
// text or enters insert or replace mode, its jumps go to the caller as places, and its cursor
// doesn't blink.
//
// Callers see none of this: they name the file by their own id, places by that id, the file's side
// and a line, and reach the view only through `FileView` (`api.ts`). Keys reach it through the
// registry, which runs Lo's commands and hands the rest to Vim; the view is the `file` scope's
// `KeySource`.

import { EditorState, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';

import {
  type HeaderTarget,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import type {
  FileEvents,
  FileInit,
  FileView,
  Mark,
  Mode,
  PeekView,
  Place,
  Side,
  Spot,
  VimKey,
} from './api.ts';
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
  vimMode,
  vimPending,
} from './keys.ts';
import { marking, marksChanged } from './marks.ts';

/** Opens a whole-file view of `init`'s file in `parent`, which tells `on` what happens in it. */
export function createFileView(parent: HTMLElement, init: FileInit, on: FileEvents): FileView {
  return new WholeFile(parent, init, on);
}

/** A line a mark picks out. */
const markedLine = Decoration.line({ class: 'lo-line-marked' });

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
  /** What the events last said, so each says only what changed. */
  readonly #said: { cursor?: string; mode: Mode } = { mode: 'normal' };
  readonly #stops: (() => void)[] = [];

  constructor(parent: HTMLElement, init: FileInit, on: FileEvents) {
    installVim();
    this.#on = on;
    this.#id = init.id;
    this.#side = init.side ?? 'new';
    this.#count = init.lines.length;
    this.#starts = lineStarts(init.lines);
    if (init.tokens) this.#tokens = { tokens: init.tokens, starts: this.#starts };
    this.#marked = this.#ownMarks(init.marks ?? []);

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
          codeEditor(init.nonce, () => this.#tell()),
          EditorView.contentAttributes.of({ 'aria-label': init.path }),
          lineNumbers({ formatNumber: (line) => (count === 0 ? '' : String(line)) }),
          marking((doc, first, last) => this.#marks(doc, first, last)),
          highlighting({
            lineAt: (line) => (line <= count ? { file: 0, side, line } : undefined),
            tokens: () => this.#tokens,
          }),
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
  }

  /** The lines `marks` pick out in this file and side, each range first to last. */
  #ownMarks(marks: readonly Mark[]): { from: number; to: number }[] {
    return marks
      .filter(({ at }) => at.file === this.#id && at.side === this.#side)
      .map(({ at }) => ({ from: Math.min(at.from, at.to), to: Math.max(at.from, at.to) }));
  }

  /** The marks on document lines `first` to `last`. */
  #marks(doc: Text, first: number, last: number): Range<Decoration>[] {
    const out: Range<Decoration>[] = [];
    for (let line = first; line <= Math.min(last, this.#count); line++) {
      if (this.#marked.some(({ from, to }) => from <= line && line <= to)) {
        out.push(markedLine.range(doc.line(line).from));
      }
    }
    return out;
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

  peek(_at: Place, peek: PeekView | undefined): void {
    // None is ever open, so there's none to close.
    if (peek) throw new Error("The whole-file view doesn't draw peeks yet.");
  }

  focus(): void {
    this.#view.focus();
    // Said now: CodeMirror hears of focus a little later.
    this.#tell();
  }

  destroy(): void {
    for (const stop of this.#stops) stop();
    this.#view.destroy();
    this.dom.remove();
  }

  // Keys -------------------------------------------------------------------------------------

  keyState(): { mode: Mode; pending: boolean; target: Target } {
    const view = this.#view;
    return { mode: vimMode(view), pending: vimPending(view), target: this.#target() };
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
    const line = this.#view.state.doc.lineAt(pos).number;
    this.#on.menu(this.#targetAt(line), event.clientX, event.clientY);
  }
}
