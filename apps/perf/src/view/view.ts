// The diff view: a whole pull request in one scroll. Side by side, the old side and the new side
// are each one CodeMirror document holding every file, kept level by the spacer pass; inline, one
// document holds both, a change's deleted lines before its added ones. What each file shows comes
// from decorations, replaced as its diff, its highlighting and the moves arrive, as runs open and
// close, and as comments are written. A file's lines join the documents later when it's loaded,
// and the inline document takes a file's lines once its diff decides their order.
//
// Keys are Vim's, from CodeMirror's Vim package, with Lo's jumps and actions (keys.ts).

import {
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  lineNumbers,
} from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';
import { vim } from '@replit/codemirror-vim';

import { Aligner, alignerFields, type PassStats } from './aligner.ts';
import { CommentBox, type Place, placeKey } from './comments.ts';
import {
  type FileNote,
  fileBlocks,
  fileMarks,
  inlineBlocks,
  type ViewFile,
  type ViewThread,
} from './decorations.ts';
import { type FileTokens, highlighting, lineStarts, tokensChanged } from './highlight.ts';
import { InlineLayout, inlineLines, inlineText } from './inline.ts';
import { forgetJumps } from './jumps.ts';
import { type Action, diffKeys, type DiffKeys, registerDiffEditor, type Target } from './keys.ts';
import { Layout, type Side } from './layout.ts';
import { lineKey, marking, marksChanged, rowKey } from './marks.ts';
import { collapsedRuns, type FileRows, fileRows, runAt, shownRuns } from './rows.ts';
import { type ThreadComment, ThreadSizes } from './widgets.ts';

/** A file as the view is given it. */
export interface DiffViewFile extends ViewFile {
  /** Each side's lines, or none for a side the file isn't on or a file not shown. */
  oldLines: readonly string[];
  newLines: readonly string[];
}

export interface DiffViewThread {
  file: number;
  side: Side;
  line: number;
  comments: readonly ThreadComment[];
}

export interface DiffViewOptions {
  /** The nonce the page's content security policy lets CodeMirror's style elements carry. */
  nonce?: string;
  /** `za` on a file too large to have been shown: load its lines, then call `addLines`. */
  load?: (file: number) => void;
  /** `yl`: copy a link to a file's line. */
  copyLink?: (place: Place) => void;
}

export type { Place };

type Pane = Side | 'inline';

/** Replaces one file's decorations. */
const setFile = StateEffect.define<{
  file: number;
  from: number;
  to: number;
  decorations: readonly Range<Decoration>[];
}>();

const fileField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFile)) continue;
      const { file, from, to } = effect.value;
      next = next.update({
        filterFrom: from,
        filterTo: to,
        filter: (_from, _to, decoration) => decoration.spec.file !== file,
        add: effect.value.decorations,
        sort: true,
      });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A line number in the inline layout's gutters. */
class NumberMarker extends GutterMarker {
  readonly number: string;

  constructor(number: string) {
    super();
    this.number = number;
  }

  override eq(other: NumberMarker): boolean {
    return other.number === this.number;
  }

  override toDOM(): Node {
    return document.createTextNode(this.number);
  }
}

/** A thread as the view keeps it: the recorded comments, then any added here. */
interface Thread {
  side: Side;
  line: number;
  comments: ThreadComment[];
}

export class DiffView {
  readonly dom: HTMLElement;
  readonly views: { old: EditorView; new: EditorView };
  readonly #options: DiffViewOptions;
  readonly #files: readonly DiffViewFile[];
  readonly #lines: { old: readonly string[]; new: readonly string[] }[];
  readonly #layout: Layout;
  readonly #diffs: (FileDiff | undefined)[];
  readonly #rows: FileRows[];
  /** Each file's threads, by place. */
  readonly #threads: Map<string, Thread>[];
  readonly #keep: { old: Set<number>; new: Set<number> }[];
  /** Each file's opened runs, by their first old line. */
  readonly #open: Set<number>[];
  /** Files closed with `za`, and large files being loaded or loaded. */
  readonly #closed = new Set<number>();
  readonly #loading = new Set<number>();
  /** Large files whose lines couldn't be loaded, which `za` tries again. */
  readonly #failed = new Set<number>();
  readonly #loaded = new Set<number>();
  readonly #tokens: { old?: FileTokens | undefined; new?: FileTokens | undefined }[];
  readonly #boxes = new Map<string, CommentBox>();
  /** The boxes shown, by place. */
  readonly #shown = new Set<string>();
  #moves: readonly MovedBlock[] = [];
  /** Counts the layout's switches, so the comment boxes' threads are drawn again after one. */
  #drawing = 0;
  readonly #aligner: Aligner;
  #inline: { view: EditorView; layout: InlineLayout; sizes: ThreadSizes } | undefined;
  /** The sizes of the threads each side's editor draws. */
  readonly #sizes: Record<Side, ThreadSizes>;
  #pane: 'split' | 'inline' = 'split';
  /** The scroll input asked for since `movement()` was last called: wheel and moved cursors. */
  #asked = 0;
  /** The line `movement()` follows, by its side and document line, and where it was on screen. */
  #followed: { side: Side; line: number; top: number } | undefined;

  /** How many spacers each editor holds, drawn or not, for the measurements. */
  get spacers(): { old: number; new: number } {
    return this.#aligner.spacers;
  }

  constructor(
    parent: HTMLElement,
    files: readonly DiffViewFile[],
    threads: readonly DiffViewThread[],
    options: DiffViewOptions = {},
  ) {
    this.#options = options;
    this.#files = files;
    this.#lines = files.map((file) => ({ old: file.oldLines, new: file.newLines }));
    this.#layout = new Layout(
      files.map((file) => ({ path: file.path, old: file.oldLines, new: file.newLines })),
    );
    this.#diffs = files.map(() => undefined);
    this.#tokens = files.map(() => ({}));
    this.#open = files.map(() => new Set());
    this.#threads = files.map(() => new Map());
    this.#keep = files.map(() => ({ old: new Set<number>(), new: new Set<number>() }));
    for (const thread of threads) {
      this.#threads[thread.file]?.set(placeKey(thread), {
        side: thread.side,
        line: thread.line,
        comments: [...thread.comments],
      });
      this.#keep[thread.file]?.[thread.side].add(thread.line);
    }
    this.#rows = files.map((_, index) => this.#rowsOf(index));

    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffview';
    parent.append(this.dom);
    const make = (side: Side): EditorView =>
      new EditorView({
        parent: this.dom,
        state: EditorState.create({
          doc: this.#layout.text[side],
          extensions: this.#extensions(side),
        }),
      });
    this.views = { old: make('old'), new: make('new') };
    this.#sizes = {
      old: new ThreadSizes(this.views.old.contentDOM),
      new: new ThreadSizes(this.views.new.contentDOM),
    };
    this.#aligner = new Aligner(this.views, this.#layout, (file) => this.#rows[file]!, this.dom);
    // What the input asks the scroll to do, for `movement()`: the wheel's distance, and the
    // scroll CodeMirror makes to bring a moved cursor into view.
    this.dom.addEventListener(
      'wheel',
      (event) => {
        const line = this.views.new.defaultLineHeight;
        const page = this.dom.clientHeight;
        const scale = event.deltaMode === 1 ? line : event.deltaMode === 2 ? page : 1;
        const room = this.dom.scrollHeight - this.dom.clientHeight;
        const top = this.dom.scrollTop;
        // The scroll can't go past either end.
        this.#asked += Math.max(-top, Math.min(room - top, event.deltaY * scale));
      },
      { passive: true },
    );
    this.#aligner.onCursorScroll = (delta) => (this.#asked += delta);
    for (const side of ['old', 'new'] as const) {
      const view = this.views[side];
      registerDiffEditor(view, this.#keysFor(side));
      view.dispatch({ effects: StateEffect.appendConfig.of(this.#aligner.plugin()) });
      const ranges = files.flatMap((_, index) => this.#blocks(side, index));
      view.dispatch({ effects: setFile.of({ file: -1, from: 0, to: 0, decorations: ranges }) });
    }
    // A face that loads later, such as a script's subset when its first character shows, changes
    // the width of text, and so where lines wrap: measure again.
    document.fonts.addEventListener('loadingdone', this.#measure);
  }

  /** The inline layout's editor, once it has been shown. */
  get inlineView(): EditorView | undefined {
    return this.#inline?.view;
  }

  /** Which layout is showing. */
  get layout(): 'split' | 'inline' {
    return this.#pane;
  }

  /** What the spacer pass has cost so far, for the measurements. */
  get passStats(): PassStats {
    return this.#aligner.stats;
  }

  readonly #measure = (): void => {
    for (const view of this.#editors()) view.requestMeasure();
  };

  /** Shows a file's diff and its highlighting. */
  setResult(
    file: number,
    diff: FileDiff,
    tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined },
  ): void {
    this.#diffs[file] = diff;
    this.#loading.delete(file);
    for (const side of ['old', 'new'] as const) {
      const sideTokens = tokens[side];
      this.#tokens[file]![side] = sideTokens
        ? { tokens: sideTokens, starts: lineStarts(this.#lines[file]![side]) }
        : undefined;
    }
    if (this.#inline) this.#addInline(file);
    this.#refresh(file, [tokensChanged.of(null)]);
  }

  /** Shows the code the pull request moves. */
  setMoves(moves: readonly MovedBlock[]): void {
    this.#moves = moves;
    for (const file of new Set(moves.flatMap((move) => [move.from.file, move.to.file]))) {
      this.#refresh(file);
    }
  }

  /** Says a large file's lines couldn't be loaded: its note says so, and `za` tries again. */
  loadFailed(file: number): void {
    if (!this.#loading.delete(file)) return;
    this.#failed.add(file);
    this.#refresh(file);
  }

  /** Puts a large file's lines in the documents. Its diff follows with `setResult`. */
  addLines(file: number, oldLines: readonly string[], newLines: readonly string[]): void {
    if (this.#loaded.has(file)) return;
    this.#loaded.add(file);
    this.#lines[file] = { old: oldLines, new: newLines };
    for (const side of ['old', 'new'] as const) {
      const lines = side === 'old' ? oldLines : newLines;
      if (lines.length === 0) continue;
      const view = this.views[side];
      const header = view.state.doc.line(this.#layout.files[file]![side].header);
      view.dispatch({ changes: { from: header.to, insert: `\n${lines.join('\n')}` } });
      this.#layout.setCount(side, file, lines.length);
    }
    // Every file after it has moved.
    for (let index = file; index < this.#rows.length; index++) {
      this.#rows[index] = this.#rowsOf(index);
    }
    this.#refresh(file);
  }

  /** Shows the inline layout, or side by side again, keeping the line at the cursor in view. */
  toggleLayout(): void {
    const from = this.#focusedPlace();
    if (this.#pane === 'split') {
      const inline = this.#inline ?? this.#makeInline();
      this.#pane = 'inline';
      this.#aligner.paused = true;
      this.views.old.dom.hidden = true;
      this.views.new.dom.hidden = true;
      inline.view.dom.hidden = false;
      this.#moveBoxes();
      this.#show('inline', from);
    } else {
      this.#pane = 'split';
      if (this.#inline) this.#inline.view.dom.hidden = true;
      this.views.old.dom.hidden = false;
      this.views.new.dom.hidden = false;
      this.#aligner.paused = false;
      this.#moveBoxes();
      this.#show(from?.side ?? 'new', from);
    }
  }

  /**
   * How level the rows on screen are now, as drawn: every row with something on both sides whose
   * start is on screen on either side, its first line or the header, collapsed block or note it
   * starts with, found by the key each carries. Gives how many there are, how far apart the worst
   * one's tops are on the two sides, in pixels, and which it is, and how many are drawn on one side
   * only, with the other side's blank there. Cheap enough to call every frame.
   */
  misalignment(): { rows: number; worst: number; blank: number; at?: string } {
    if (this.#pane !== 'split') return { rows: 0, worst: 0, blank: 0 };
    const screen = this.dom.getBoundingClientRect();
    const drawn = { old: drawnRows(this.views.old), new: drawnRows(this.views.new) };
    const onScreen = (top: number | undefined): boolean =>
      top !== undefined && top >= screen.top && top < screen.bottom;
    let rows = 0;
    let worst = 0;
    let blank = 0;
    let at: string | undefined;
    for (const key of new Set([...drawn.old.keys(), ...drawn.new.keys()])) {
      const old = drawn.old.get(key);
      const added = drawn.new.get(key);
      if (!onScreen(old) && !onScreen(added)) continue;
      rows++;
      if (old === undefined || added === undefined) {
        blank++;
        continue;
      }
      if (Math.abs(old - added) > worst) {
        worst = Math.abs(old - added);
        at = key;
      }
    }
    return at ? { rows, worst, blank, at } : { rows, worst, blank };
  }

  /**
   * How far what's on screen moved since the last call, against what the input asked: the wheel's
   * distance and the scroll that brought a moved cursor into view. Follows a line on screen near
   * its middle, on the side the scroll is anchored to where it has one; `moved` is how far it went
   * up, so with nothing else moving it, it equals `asked`. Undefined when the line followed isn't
   * drawn now. Call it every frame.
   */
  movement(): { asked: number; moved?: number } {
    const asked = this.#asked;
    this.#asked = 0;
    const screen = this.dom.getBoundingClientRect();
    const followed = this.#followed;
    let moved: number | undefined;
    if (followed) {
      const element = this.views[followed.side].contentDOM.querySelector(
        `[data-line="${followed.line}"]`,
      );
      if (element) moved = followed.top - element.getBoundingClientRect().top;
    }
    // Follow, next, the line on screen nearest its middle, on the side the scroll is anchored to,
    // or on the other where that side has none, as beside a deleted file.
    const anchoring = this.#aligner.anchoring;
    const middle = (screen.top + screen.bottom) / 2;
    this.#followed = undefined;
    for (const side of [anchoring, anchoring === 'old' ? 'new' : 'old'] as const) {
      for (const element of this.views[side].contentDOM.querySelectorAll<HTMLElement>(
        '[data-line]',
      )) {
        const top = element.getBoundingClientRect().top;
        if (top < screen.top || top >= screen.bottom) continue;
        if (!this.#followed || Math.abs(top - middle) < Math.abs(this.#followed.top - middle)) {
          this.#followed = { side, line: Number(element.dataset.line), top };
        }
      }
      if (this.#followed) break;
    }
    return moved === undefined ? { asked } : { asked, moved };
  }

  destroy(): void {
    document.fonts.removeEventListener('loadingdone', this.#measure);
    this.#aligner.destroy();
    for (const box of this.#boxes.values()) box.destroy();
    for (const sizes of [this.#sizes.old, this.#sizes.new, this.#inline?.sizes]) sizes?.destroy();
    for (const view of this.#editors()) {
      forgetJumps(view);
      view.destroy();
    }
    this.dom.remove();
  }

  // Panes ------------------------------------------------------------------------------------

  #editors(): EditorView[] {
    return [this.views.old, this.views.new, ...(this.#inline ? [this.#inline.view] : [])];
  }

  /** What every diff editor has: Vim, read-only lines split at `\n`, wrapping, the decorations. */
  #common(): Extension[] {
    return [
      vim(),
      drawSelection(),
      // Lines split at `\n` alone, as the diff splits them.
      EditorState.lineSeparator.of('\n'),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      this.#options.nonce ? EditorView.cspNonce.of(this.#options.nonce) : [],
      fileField,
    ];
  }

  #extensions(side: Side): Extension[] {
    const layout = this.#layout;
    return [
      this.#common(),
      EditorView.contentAttributes.of({ 'aria-label': side === 'old' ? 'Before' : 'After' }),
      lineNumbers({
        formatNumber: (line) => {
          const number = layout.fileLine(side, line);
          return number === 0 ? '' : String(number);
        },
      }),
      alignerFields(),
      marking((doc, first, last) => this.#marks(side, doc, first, last)),
      highlighting({
        lineAt: (line) => {
          const file = layout.fileAt(side, line);
          const number = line - layout.files[file]![side].header;
          return number > 0 ? { file, side, line: number } : undefined;
        },
        tokens: (file, tokenSide) => this.#tokens[file]?.[tokenSide],
      }),
      diffKeys(this.#keysFor(side)),
    ];
  }

  #makeInline(): { view: EditorView; layout: InlineLayout } {
    const layout = new InlineLayout(
      this.#files.map((file, index) => {
        const diff = this.#diffs[index];
        if (!diff || this.#closed.has(index)) return { path: file.path };
        const lines = inlineLines(diff);
        const text = inlineText(lines, this.#lines[index]!.old, this.#lines[index]!.new);
        return { path: file.path, lines, text };
      }),
    );
    const number = (side: Side): Extension =>
      gutter({
        class: `cm-lineNumbers lo-inlinenumbers lo-inlinenumbers--${side}`,
        lineMarker: (view, block) => {
          const shown = layout.lineAt(view.state.doc.lineAt(block.from).number)[side];
          return shown > 0 ? new NumberMarker(String(shown)) : null;
        },
        initialSpacer: () => new NumberMarker('99999'),
      });
    const view = new EditorView({
      parent: this.dom,
      state: EditorState.create({
        doc: layout.text,
        extensions: [
          this.#common(),
          EditorView.contentAttributes.of({ 'aria-label': 'Changes' }),
          number('old'),
          number('new'),
          marking((doc, first, last) => this.#inlineMarks(doc, first, last)),
          highlighting({
            lineAt: (line) => {
              const shown = layout.lineAt(line);
              if (shown.new > 0) return { file: shown.file, side: 'new', line: shown.new };
              if (shown.old > 0) return { file: shown.file, side: 'old', line: shown.old };
              return undefined;
            },
            tokens: (file, side) => this.#tokens[file]?.[side],
          }),
          diffKeys(this.#keysFor('inline')),
        ],
      }),
    });
    view.dom.classList.add('lo-diffinline');
    this.#inline = { view, layout, sizes: new ThreadSizes(view.contentDOM) };
    registerDiffEditor(view, this.#keysFor('inline'));
    const ranges = this.#files.flatMap((_, index) => this.#inlineBlocks(index));
    view.dispatch({ effects: setFile.of({ file: -1, from: 0, to: 0, decorations: ranges }) });
    return this.#inline;
  }

  /** Gives the inline document a file's lines, once its diff is in. */
  #addInline(file: number): void {
    const inline = this.#inline!;
    const diff = this.#diffs[file];
    if (!diff || inline.layout.lines[file]) return;
    const lines = inlineLines(diff);
    const text = inlineText(lines, this.#lines[file]!.old, this.#lines[file]!.new);
    const header = inline.view.state.doc.line(inline.layout.files[file]!.header);
    inline.layout.setLines(file, lines);
    if (text.length > 0) {
      inline.view.dispatch({ changes: { from: header.to, insert: `\n${text.join('\n')}` } });
    }
  }

  /** Shows `pane`, scrolled to `place` with the cursor there and focus in it. */
  #show(pane: Pane, place: Place | undefined): void {
    const view = pane === 'inline' ? this.#inline!.view : this.views[pane];
    view.requestMeasure();
    if (!place) {
      view.focus();
      return;
    }
    const line = this.#docLine(pane, place);
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }

  // Files ------------------------------------------------------------------------------------

  #noteOf(file: number): FileNote | undefined {
    const skipped = this.#files[file]!.skipped;
    if (this.#loading.has(file)) return 'loading';
    if (this.#failed.has(file)) return 'failed';
    if (skipped === 'binary') return 'binary';
    if (skipped === 'too-large' && !this.#loaded.has(file)) return 'too-large';
    if (!this.#diffs[file]) return 'pending';
    if (this.#closed.has(file)) return 'closed';
    return undefined;
  }

  #rowsOf(file: number): FileRows {
    const lines = this.#layout.files[file]!;
    const diff = this.#diffs[file];
    return fileRows(
      lines.old,
      lines.new,
      diff && !this.#closed.has(file)
        ? { kind: 'diff', diff, keep: this.#keep[file], open: this.#open[file] }
        : { kind: 'collapsed' },
    );
  }

  /** The file's threads and the comment boxes shown in it. */
  #viewThreads(file: number): ViewThread[] {
    const threads: ViewThread[] = [];
    const places = new Set(this.#threads[file]!.keys());
    for (const key of this.#shown) {
      if (this.#boxes.get(key)?.place.file === file) places.add(key);
    }
    for (const key of places) {
      const thread = this.#threads[file]!.get(key);
      const box = this.#shown.has(key) ? this.#boxes.get(key) : undefined;
      const drawing = box ? this.#drawing : 0;
      const place = thread ?? box?.place;
      if (!place) continue;
      threads.push({
        id: key,
        side: place.side,
        line: place.line,
        comments: thread?.comments ?? [],
        box,
        drawing,
      });
    }
    return threads;
  }

  /** What a file's decorations need in any document. */
  #base(file: number) {
    return {
      index: file,
      file: this.#files[file]!,
      diff: this.#diffs[file],
      moves: this.#moves.filter((move) => move.from.file === file || move.to.file === file),
      threads: this.#viewThreads(file),
      keep: this.#keep[file]!,
      open: this.#open[file]!,
      note: this.#noteOf(file),
    };
  }

  #blocks(side: Side, file: number): Range<Decoration>[] {
    const lines = this.#layout.files[file]!;
    return fileBlocks({
      ...this.#base(file),
      side,
      lines: lines[side],
      otherLines: lines[side === 'old' ? 'new' : 'old'].count > 0,
      doc: this.views[side].state.doc,
      sizes: this.#sizes[side],
    });
  }

  #inlineBlocks(file: number): Range<Decoration>[] {
    const inline = this.#inline!;
    return inlineBlocks({
      ...this.#base(file),
      lines: inline.layout.files[file]!,
      inline: inline.layout.lines[file],
      doc: inline.view.state.doc,
      sizes: inline.sizes,
    });
  }

  /** The marks on document lines `first` to `last` of `side`, their numbers, and each row's key. */
  #marks(side: Side, doc: Text, first: number, last: number): Range<Decoration>[] {
    const out: Range<Decoration>[] = [];
    for (let line = first; line <= last; line++) out.push(lineKey(line).range(doc.line(line).from));
    const layout = this.#layout;
    for (let file = layout.fileAt(side, first); file < layout.files.length; file++) {
      const lines = layout.files[file]![side];
      if (lines.header > last) break;
      if (lines.count === 0 || this.#noteOf(file)) continue;
      const from = Math.max(1, first - lines.header);
      const to = Math.min(lines.count, last - lines.header);
      if (from > to) continue;
      out.push(
        ...fileMarks(
          {
            ...this.#base(file),
            side,
            lineFrom: (number) => doc.line(lines.header + number).from,
          },
          from,
          to,
        ),
      );
      const rows = this.#rows[file]!;
      const firsts = side === 'old' ? rows.oldFirst : rows.newFirst;
      const others = side === 'old' ? rows.newFirst : rows.oldFirst;
      for (let row = 1; row < firsts.length; row++) {
        const line = firsts[row]!;
        if (line === -1 || others[row] === -1 || rows.collapsed[row]) continue;
        if (line < lines.header + from || line > lines.header + to) continue;
        out.push(rowKey(`p:${file}:${row}`).range(doc.line(line).from));
      }
    }
    return out;
  }

  /** The marks on lines `first` to `last` of the inline document, both sides' lines in turn. */
  #inlineMarks(doc: Text, first: number, last: number): Range<Decoration>[] {
    const out: Range<Decoration>[] = [];
    const layout = this.#inline?.layout;
    if (!layout) return out;
    for (let file = layout.fileAt(first); file < layout.files.length; file++) {
      const { header, count } = layout.files[file]!;
      if (header > last) break;
      const lines = layout.lines[file];
      if (!lines || count === 0 || this.#noteOf(file)) continue;
      const from = Math.max(1, first - header);
      const to = Math.min(count, last - header);
      for (const side of ['old', 'new'] as const) {
        const numbers = side === 'old' ? lines.old : lines.new;
        const at = side === 'old' ? lines.ofOld : lines.ofNew;
        let low = Infinity;
        let high = -Infinity;
        for (let index = from; index <= to; index++) {
          const number = numbers[index - 1]!;
          if (number === 0) continue;
          low = Math.min(low, number);
          high = Math.max(high, number);
        }
        if (low > high) continue;
        out.push(
          ...fileMarks(
            {
              ...this.#base(file),
              side,
              lineFrom: (number) => doc.line(header + at[number]!).from,
            },
            low,
            high,
          ),
        );
      }
    }
    return out;
  }

  /** Draws a file again in every document, with `effects` alongside. */
  #refresh(file: number, more: StateEffect<unknown>[] = []): void {
    this.#rows[file] = this.#rowsOf(file);
    const effects = [...more, marksChanged.of(null)];
    const split = (): void => {
      for (const side of ['old', 'new'] as const) {
        const doc = this.views[side].state.doc;
        const lines = this.#layout.files[file]![side];
        this.views[side].dispatch({
          effects: [
            setFile.of({
              file,
              from: doc.line(lines.header).from,
              to: doc.line(lines.header + lines.count).to,
              decorations: this.#blocks(side, file),
            }),
            ...effects,
          ],
        });
      }
    };
    const inline = (): void => {
      if (!this.#inline) return;
      const { view, layout } = this.#inline;
      const doc = view.state.doc;
      const lines = layout.files[file]!;
      view.dispatch({
        effects: [
          setFile.of({
            file,
            from: doc.line(lines.header).from,
            to: doc.line(lines.header + lines.count).to,
            decorations: this.#inlineBlocks(file),
          }),
          ...effects,
        ],
      });
    };
    // A comment box is one element, which the last editor to draw it takes: the one showing.
    if (this.#pane === 'split') {
      inline();
      split();
    } else {
      split();
      inline();
    }
    this.#aligner.schedule();
  }

  /** Draws the files with comment boxes again, so the editors showing take the boxes. */
  #moveBoxes(): void {
    this.#drawing++;
    const files = new Set([...this.#shown].map((key) => this.#boxes.get(key)?.place.file));
    for (const file of files) if (file !== undefined) this.#refresh(file);
  }

  // Keys -------------------------------------------------------------------------------------

  #keysFor(pane: Pane): DiffKeys {
    return {
      jump: (target, forward, line, count) => this.#jump(pane, target, forward, line, count),
      act: (action, view) => this.#act(pane, action, view),
    };
  }

  /** The file whose document line `line` in `pane` is in. */
  #fileAt(pane: Pane, line: number): number {
    return pane === 'inline' ? this.#inline!.layout.fileAt(line) : this.#layout.fileAt(pane, line);
  }

  /** The file line at document line `line` of `pane`, or the header's place (line 0). */
  #placeAt(pane: Pane, line: number): Place {
    const file = this.#fileAt(pane, line);
    if (pane !== 'inline') return { file, side: pane, line: this.#layout.fileLine(pane, line) };
    const shown = this.#inline!.layout.lineAt(line);
    return shown.new > 0
      ? { file, side: 'new', line: shown.new }
      : { file, side: 'old', line: shown.old };
  }

  /** The document line of `place` in `pane`. */
  #docLine(pane: Pane, place: Place): number {
    if (pane === 'inline') return this.#inline!.layout.docLine(place.file, place.side, place.line);
    if (pane === place.side) return this.#layout.files[place.file]![pane].header + place.line;
    return this.#otherSideLine(
      place.side,
      this.#layout.files[place.file]![place.side].header + place.line,
    );
  }

  /** The place of the cursor in the focused diff editor. */
  #focusedPlace(): Place | undefined {
    const panes: Pane[] = this.#pane === 'split' ? ['new', 'old'] : ['inline'];
    const focused = panes.find((pane) => this.#viewOf(pane).hasFocus) ?? panes[0]!;
    const view = this.#viewOf(focused);
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    return this.#placeAt(focused, line);
  }

  #viewOf(pane: Pane): EditorView {
    return pane === 'inline' ? this.#inline!.view : this.views[pane];
  }

  /** The document lines `target` stops at in file `file` of `pane`, in order. */
  #stops(pane: Pane, target: Target, file: number): number[] {
    const header =
      pane === 'inline'
        ? this.#inline!.layout.files[file]!.header
        : this.#layout.files[file]![pane].header;
    if (target === 'file') return [header];
    const diff = this.#diffs[file];
    if (!diff || this.#noteOf(file)) return [];
    const at = (side: Side, line: number): number => this.#docLine(pane, { file, side, line });
    if (target === 'change') {
      return diff.changes.map((change) => {
        if (pane === 'inline') {
          return change.old.end > change.old.start
            ? at('old', change.old.start)
            : at('new', change.new.start);
        }
        const count = pane === 'old' ? diff.oldLineCount : diff.newLineCount;
        const { start } = change[pane];
        return count === 0 ? header : at(pane, Math.min(start, count));
      });
    }
    return [...this.#threads[file]!.values()]
      .filter((thread) => pane === 'inline' || thread.side === pane)
      .map((thread) => at(thread.side, thread.line))
      .toSorted((a, b) => a - b);
  }

  #jump(
    pane: Pane,
    target: Target,
    forward: boolean,
    line: number,
    count: number,
  ): number | undefined {
    const files = this.#files.length;
    let left = count;
    let found: number | undefined;
    for (let file = this.#fileAt(pane, line); file >= 0 && file < files; file += forward ? 1 : -1) {
      const stops = this.#stops(pane, target, file);
      if (!forward) stops.reverse();
      for (const stop of stops) {
        if (forward ? stop <= line : stop >= line) continue;
        found = stop;
        if (--left === 0) return found;
      }
    }
    return found;
  }

  #act(pane: Pane, action: Action, view: EditorView): void {
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    const place = this.#placeAt(pane, line);
    switch (action) {
      case 'comment':
        if (place.line > 0 && !this.#noteOf(place.file)) this.#openBox(place);
        return;
      case 'copy-link':
        if (place.line > 0) this.#options.copyLink?.(place);
        return;
      case 'inline':
        this.toggleLayout();
        return;
      case 'open':
      case 'close':
        this.#openRun(place, action === 'open');
        return;
      case 'open-file': {
        const diff = this.#diffs[place.file];
        if (!diff) return;
        for (const run of collapsedRuns(diff, this.#keep[place.file])) {
          this.#open[place.file]!.add(run.old.first);
        }
        this.#refresh(place.file);
        return;
      }
      case 'toggle-file':
        this.#toggleFile(place.file);
        return;
      case 'other-side':
        if (pane !== 'inline') this.#otherSide(pane, line);
        return;
    }
  }

  /** `zo` and `zc`: opens the collapsed run at `place`, or closes the opened run it's in. */
  #openRun(place: Place, open: boolean): void {
    const diff = this.#diffs[place.file];
    if (!diff || place.line === 0) return;
    const keep = this.#keep[place.file];
    const opened = this.#open[place.file]!;
    const runs = open ? shownRuns(diff, keep, opened) : collapsedRuns(diff, keep);
    const run = runAt(runs, place.side, place.line);
    if (!run || opened.has(run.old.first) === open) return;
    if (open) opened.add(run.old.first);
    else opened.delete(run.old.first);
    this.#refresh(place.file);
  }

  /** `za`: loads a large file, or closes a file into one block, or opens it again. */
  #toggleFile(file: number): void {
    const note = this.#noteOf(file);
    if (note === 'too-large' || note === 'failed') {
      if (!this.#options.load) return;
      this.#failed.delete(file);
      this.#loading.add(file);
      this.#refresh(file);
      this.#options.load(file);
      return;
    }
    if (note && note !== 'closed') return;
    if (this.#closed.has(file)) this.#closed.delete(file);
    else this.#closed.add(file);
    if (this.#inline && !this.#closed.has(file)) this.#addInline(file);
    this.#refresh(file);
  }

  /** The line on the other side in the row of line `line` of `side`, or the nearest before it. */
  #otherSideLine(side: Side, line: number): number {
    const other: Side = side === 'old' ? 'new' : 'old';
    const file = this.#layout.fileAt(side, line);
    const rows = this.#rows[file]!;
    const first = side === 'old' ? rows.oldFirst : rows.newFirst;
    const last = side === 'old' ? rows.oldLast : rows.newLast;
    const otherFirst = other === 'old' ? rows.oldFirst : rows.newFirst;
    const otherLast = other === 'old' ? rows.oldLast : rows.newLast;
    let row = 0;
    for (let index = 0; index < first.length; index++) {
      if (first[index] !== -1 && first[index]! <= line) row = index;
      if (first[index] !== -1 && last[index]! >= line) break;
    }
    if (otherFirst[row] !== -1) return otherFirst[row]!;
    for (let index = row - 1; index >= 0; index--) {
      if (otherLast[index] !== -1) return otherLast[index]!;
    }
    return this.#layout.files[file]![other].header;
  }

  /**
   * `Tab`: the cursor goes to the same row on the other side, which takes focus, and into view: in
   * a long file on one side alone, the other side's row is its header, screens away.
   */
  #otherSide(side: Side, line: number): void {
    const other: Side = side === 'old' ? 'new' : 'old';
    const view = this.views[other];
    const target = this.#otherSideLine(side, line);
    view.focus();
    view.dispatch({
      selection: { anchor: view.state.doc.line(target).from },
      scrollIntoView: true,
    });
  }

  // Comments ---------------------------------------------------------------------------------

  #openBox(place: Place): void {
    const key = placeKey(place);
    let box = this.#boxes.get(key);
    if (!box) {
      box = new CommentBox(
        place,
        {
          resized: () => this.#remeasure(),
          submit: (written, text) => this.#submit(written, text),
          close: (closed) => this.#closeBox(closed),
        },
        this.#options.nonce,
      );
      this.#boxes.set(key, box);
    }
    this.#shown.add(key);
    this.#keep[place.file]![place.side].add(place.line);
    this.#refresh(place.file);
    box.focus();
  }

  #submit(box: CommentBox, text: string): void {
    const key = placeKey(box.place);
    const threads = this.#threads[box.place.file]!;
    const thread = threads.get(key) ?? { side: box.place.side, line: box.place.line, comments: [] };
    thread.comments = [...thread.comments, text];
    threads.set(key, thread);
    box.clear();
    this.#closeBox(box);
  }

  #closeBox(box: CommentBox): void {
    this.#shown.delete(placeKey(box.place));
    this.#refresh(box.place.file);
    const pane: Pane = this.#pane === 'inline' ? 'inline' : box.place.side;
    const view = this.#viewOf(pane);
    const line = this.#docLine(pane, box.place);
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
    view.focus();
  }

  /** Lines the sides up now, so a box that grew is level before the page is painted. */
  #remeasure(): void {
    if (this.#pane === 'split') this.#aligner.run();
    else this.#inline?.view.requestMeasure();
  }
}

/** Where the rows `view` draws start on screen, by their keys. */
function drawnRows(view: EditorView): Map<string, number> {
  const tops = new Map<string, number>();
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>('[data-row]')) {
    const key = element.dataset.row;
    if (key) tops.set(key, element.getBoundingClientRect().top);
  }
  return tops;
}
