// An excerpt: a range of a file's lines at one commit, read-only, as an inline diff from the
// base, as an overview's code block shows the code it points at. One CodeMirror editor holds the
// lines shown, a change's deleted lines before its added ones, each numbered on its sides as in the
// file, so the first is numbered as the range starts. It's a code view's own editor, as the diff's
// and the whole file's are (`editor.ts`, `keys.ts`): no key changes its text or enters insert or
// replace mode, its jumps go to the caller as places, its style elements carry the window's nonce,
// and its cursor doesn't blink. The cursor shows only while the excerpt has focus.
//
// Callers see none of this: they name the file by their own id, places by that id, a side and a
// line, and reach the excerpt only through `ExcerptView` (`api.ts`). Keys reach it through the
// registry, which runs Lo's commands and hands the rest to Vim, as for a whole file: the excerpt is
// the `file` scope's `KeySource`.

import { EditorState, type Range, StateEffect, type Text } from '@codemirror/state';
import { type Decoration, EditorView, gutter, GutterMarker } from '@codemirror/view';
import type { FileDiff } from '@lo/diff';

import {
  type HeaderTarget,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import type {
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  Mode,
  Place,
  Side,
  Spot,
  VimKey,
} from './api.ts';
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
  vimMode,
  vimPending,
} from './keys.ts';
import { marking } from './marks.ts';

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
}

/**
 * The lines an excerpt of `range` shows, in order: those of the rows from the range's first line
 * to its last, a change's deleted lines before its added ones, and where the range's last line ends
 * a change, the rest of the change's rows. Without a diff, the range's lines alone. The range stops
 * at the file's ends, `count` lines on its side.
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
    for (let row = from; row <= to && row - block.row < block.newCount; row++) {
      push(0, block.new + row - block.row);
    }
  }
  return shown;
}

/**
 * The diff's rows from line `first` of `side` to line `last`, and on to the end of a change that
 * `last` ends; none if the diff doesn't have both lines.
 */
function rowsOf(
  diff: FileDiff,
  side: Side,
  first: number,
  last: number,
): { first: number; last: number } | undefined {
  let firstRow = -1;
  let lastRow = -1;
  for (const block of diff.rows) {
    const start = block[side];
    const count = side === 'old' ? block.oldCount : block.newCount;
    if (first >= start && first < start + count) firstRow = block.row + first - start;
    if (last >= start && last < start + count) {
      lastRow = block.row + last - start;
      if (block.changed && last === start + count - 1) {
        lastRow = block.row + Math.max(block.oldCount, block.newCount) - 1;
      }
    }
  }
  return firstRow < 0 || lastRow < 0 ? undefined : { first: firstRow, last: lastRow };
}

/** The lines marked as changed since arrived: number them again. */
const staleChanged = StateEffect.define();

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

  constructor(parent: HTMLElement, init: ExcerptInit, on: ExcerptEvents) {
    installVim();
    this.#on = on;
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

  /**
   * What a key acts on: the cursor's line, or the lines `v` selected when they're all on one side;
   * the header of an excerpt with no lines.
   */
  #target(): LineTarget | HeaderTarget {
    const { doc, selection } = this.#view.state;
    const { head, anchor } = selection.main;
    const line = doc.lineAt(head);
    if (vimMode(this.#view) === 'visual') {
      const from = this.#spot(doc.lineAt(anchor).number);
      const to = this.#spot(line.number);
      if (from.kind === 'line' && to.kind === 'line' && from.at.side === to.at.side) {
        const { side } = to.at;
        const span = {
          file: this.#id,
          side,
          from: Math.min(from.at.line, to.at.line),
          to: Math.max(from.at.line, to.at.line),
        };
        return { kind: 'line', at: span };
      }
    }
    return this.#targetAt(line.number, head - line.from);
  }

  /** What a key or a click on document line `line` acts on: its line, or the header. */
  #targetAt(line: number, column?: number): LineTarget | HeaderTarget {
    const spot = this.#spot(line, column);
    return spot.kind === 'line' ? { kind: 'line', at: spot.at } : spot;
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
