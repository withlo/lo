// The diff view: a whole pull request in one scroll. Side by side, the old side and the new side
// are each one CodeMirror document holding every file, kept level by the spacer pass; inline, one
// document holds both, a change's deleted lines before its added ones. What each file shows comes
// from decorations, replaced as its diff, its highlighting and the moves arrive, as runs open and
// close, and as threads and comment boxes come and go. A file kept out joins the documents when
// it's loaded, and the inline document takes a file's lines once its diff decides their order.
//
// Callers see none of this: they name files by their own ids, places by file, side and line, and
// reach the view only through `DiffView` (`api.ts`). Keys reach it through the registry, which runs
// Lo's commands and hands the rest to Vim (`keys.ts`); the view is the `diff` scope's `KeySource`.

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

import {
  type HeaderTarget,
  type LineTarget,
  SCOPE_ATTRIBUTE,
  setScopeSource,
  type Target,
} from '../commands/index.ts';
import type {
  Composer,
  ComposerEvents,
  CursorReading,
  DiffEvents,
  DiffFile,
  DiffInit,
  DiffLayout,
  DiffView,
  FileHeader,
  Fold,
  JumpTo,
  Misalignment,
  Mode,
  MovedCode,
  Movement,
  PassStats,
  Place,
  Probe,
  Side,
  Span,
  Spot,
  ThreadView,
  VimKey,
} from './api.ts';
import { Aligner, alignerFields } from './aligner.ts';
import { CommentBox, placeKey } from './comments.ts';
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
import {
  addCodeEditor,
  clearVim,
  handlingKey,
  installVim,
  onVimMode,
  ownChange,
  passToVim,
  readOnly,
  setVimKeys,
  vimMode,
  vimPending,
} from './keys.ts';
import { Layout } from './layout.ts';
import { lineKey, marking, marksChanged, rowKey } from './marks.ts';
import {
  collapsedRuns,
  type FileRows,
  fileRows,
  type Gap,
  inGap,
  type LineRange,
  runAt,
  shownRuns,
} from './rows.ts';
import { leaveOnScreen } from './screen.ts';
import { ThreadSizes } from './widgets.ts';

/** Opens a diff view of `init`'s files in `parent`, which tells `on` what happens in it. */
export function createDiffView(parent: HTMLElement, init: DiffInit, on: DiffEvents): DiffView {
  return new View(parent, init, on);
}

type Pane = Side | 'inline';

/** A file's line on one side, by the file's index: line 0 is its header. */
interface At {
  file: number;
  side: Side;
  line: number;
}

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

/** A comment box open in the view, and its handle. */
interface OpenBox {
  box: CommentBox;
  composer: Composer;
}

/** The view's threads in one file, by where they are (`side:line`). */
type FileThreads = Map<string, ThreadView[]>;

class View implements DiffView {
  readonly dom: HTMLElement;
  readonly views: { old: EditorView; new: EditorView };
  readonly probe: Probe;
  readonly #on: DiffEvents;
  readonly #nonce: string;
  readonly #ids: readonly string[];
  readonly #index: ReadonlyMap<string, number>;
  readonly #files: ViewFile[];
  readonly #lines: { old: readonly string[]; new: readonly string[] }[];
  readonly #layout: Layout;
  readonly #diffs: (FileDiff | undefined)[];
  readonly #rows: FileRows[];
  readonly #threads: FileThreads[];
  /** File lines on each side that stay shown: those under threads and comment boxes. */
  readonly #keep: { old: Set<number>; new: Set<number> }[];
  /** Lines comment boxes were opened under, which stay shown once they close. */
  readonly #boxLines: { old: Set<number>; new: Set<number> }[];
  /** Each file's opened runs, by their first old line. */
  readonly #open: Set<number>[];
  /** Lines each file holds only as placeholders, until the whole file comes. */
  readonly #gaps: (readonly Gap[])[];
  /** Files closed with `za`, and files kept out being loaded or loaded. */
  readonly #closed = new Set<number>();
  readonly #loading = new Set<number>();
  /** Files kept out whose lines couldn't be loaded, which `za` tries again. */
  readonly #failed = new Set<number>();
  readonly #loaded = new Set<number>();
  /** Each side's highlighting triples, and the same with where each line starts. */
  readonly #triples: { old?: Uint32Array | undefined; new?: Uint32Array | undefined }[];
  readonly #tokens: { old?: FileTokens | undefined; new?: FileTokens | undefined }[];
  readonly #boxes = new Map<string, OpenBox>();
  #moves: readonly MovedBlock[] = [];
  /** Counts the layout's switches, so the comment boxes' threads are drawn again after one. */
  #drawing = 0;
  readonly #aligner: Aligner;
  #inline: { view: EditorView; layout: InlineLayout; sizes: ThreadSizes } | undefined;
  /** The sizes of the threads each side's editor draws. */
  readonly #sizes: Record<Side, ThreadSizes>;
  #pane: DiffLayout = 'split';
  /** The editor that last had focus, or the cursor was last revealed in. */
  #lastPane: Pane = 'new';
  /** The side that last had the cursor, which a header in the inline layout, on both, keeps. */
  #lastSide: Side = 'new';
  /** The thread `]t` last landed on, while the cursor stays on its line. */
  #landed: (At & { thread: string }) | undefined;
  /** Above 0 while the view changes its own documents, which says nothing until it's done. */
  #quiet = 0;
  /** What the events last said, so each says only what changed. */
  #said: { cursor?: string; mode: Mode; file: number } = { mode: 'normal', file: -1 };
  readonly #stops: (() => void)[] = [];
  /**
   * The scroll the input asked for since `movement()` was last called: the wheel's, and the
   * scroll CodeMirror makes to bring a cursor into view.
   */
  #asked = 0;
  /** What `movement()` follows on each side, and where it was on screen. */
  readonly #followed: {
    old?: { selector: string; top: number } | undefined;
    new?: { selector: string; top: number } | undefined;
  } = {};

  constructor(parent: HTMLElement, init: DiffInit, on: DiffEvents) {
    installVim();
    this.#on = on;
    this.#nonce = init.nonce;
    this.#ids = init.files.map((file) => file.id);
    this.#index = new Map(this.#ids.map((id, index) => [id, index]));
    if (this.#index.size !== this.#ids.length) throw new Error('Two files have the same id.');
    this.#files = init.files.map(viewFile);
    this.#lines = init.files.map((file, index) => {
      if (keptOut(file) || !file.lines) return { old: [], new: [] };
      this.#loaded.add(index);
      return file.lines;
    });
    init.files.forEach((file, index) => {
      if (file.collapsed || file.skip === 'generated') this.#closed.add(index);
    });
    this.#layout = new Layout(
      init.files.map((file, index) => ({ path: file.path, ...this.#lines[index]! })),
    );
    this.#diffs = init.files.map(() => undefined);
    this.#triples = init.files.map(() => ({}));
    this.#tokens = init.files.map(() => ({}));
    this.#open = init.files.map(() => new Set());
    this.#gaps = init.files.map((file) => file.gaps ?? []);
    this.#threads = init.files.map(() => new Map());
    this.#keep = init.files.map(() => ({ old: new Set<number>(), new: new Set<number>() }));
    this.#boxLines = init.files.map(() => ({ old: new Set<number>(), new: new Set<number>() }));
    this.#rows = init.files.map((_, index) => this.#rowsOf(index));

    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffview';
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'diff');
    if (init.note) {
      const tone = init.note.tone === 'plain' ? '' : ` lo-diffnote--${init.note.tone}`;
      const note = document.createElement('div');
      note.className = `lo-diffnote${tone}`;
      note.textContent = init.note.text;
      this.dom.append(note);
    }
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
    // What the wheel asks the scroll to do, for `movement()`.
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
    this.dom.addEventListener('scroll', this.#watchFile, { passive: true });
    this.dom.addEventListener('contextmenu', (event) => this.#contextMenu(event));
    for (const side of ['old', 'new'] as const) {
      const view = this.views[side];
      this.#addEditor(side, view);
      view.dispatch({ effects: StateEffect.appendConfig.of(this.#aligner.plugin()) });
      const ranges = init.files.flatMap((_, index) => this.#blocks(side, index));
      view.dispatch({ effects: setFile.of({ file: -1, from: 0, to: 0, decorations: ranges }) });
    }
    this.#stops.push(setScopeSource(this.dom, this));
    setVimKeys(init.vimKeys);
    // A face that loads later, such as a script's subset when its first character shows, changes
    // the width of text, and so where lines wrap: measure again.
    document.fonts.addEventListener('loadingdone', this.#measure);
    if (init.layout === 'inline') this.setLayout('inline');
    this.#watchFile();

    this.probe = new ViewProbe({
      misalignment: () => this.#misalignment(),
      movement: () => this.#movement(),
      passStats: () => this.#aligner.stats,
      spacers: () => this.#aligner.spacers,
      layout: () => this.#pane,
      cursor: () => this.#cursorReading(),
    });
  }

  readonly #measure = (): void => {
    for (const view of this.#editors()) view.requestMeasure();
  };

  // Data -------------------------------------------------------------------------------------

  setDiff(id: string, diff: FileDiff): void {
    const file = this.#fileOf(id);
    this.#diffs[file] = diff;
    if (this.#inline) this.#replaceInline(file);
    this.#refresh(file, [tokensChanged.of(null)]);
  }

  setMoves(moves: readonly MovedCode[]): void {
    const before = this.#moves;
    this.#moves = moves.flatMap((move) => this.#movedBlock(move) ?? []);
    const ends = [...before, ...this.#moves].flatMap((move) => [move.from.file, move.to.file]);
    for (const file of new Set(ends)) this.#refresh(file);
  }

  setTokens(id: string, side: Side, triples: Uint32Array): void {
    const file = this.#fileOf(id);
    this.#triples[file]![side] = triples;
    this.#tokens[file]![side] = { tokens: triples, starts: lineStarts(this.#lines[file]![side]) };
    // A file not drawn yet takes its highlighting when it's drawn.
    if (this.#noteOf(file)) return;
    for (const view of this.#editors()) view.dispatch({ effects: tokensChanged.of(null) });
  }

  setLines(
    id: string,
    lines: { old: readonly string[]; new: readonly string[] },
    diff?: FileDiff,
  ): void {
    this.#bringIn(this.#fileOf(id), lines, diff);
  }

  loadFailed(id: string): void {
    const file = this.#fileOf(id);
    if (!this.#loading.delete(file)) return;
    this.#failed.add(file);
    this.#refresh(file);
  }

  setHeader(id: string, header: FileHeader): void {
    const file = this.#fileOf(id);
    this.#files[file] = { ...this.#files[file]!, header };
    this.#refresh(file);
  }

  setLayout(layout: DiffLayout): void {
    if (layout !== this.#pane) this.#toggleLayout();
  }

  setThreads(threads: readonly ThreadView[]): void {
    const next: FileThreads[] = this.#ids.map(() => new Map());
    for (const thread of threads) {
      const file = this.#index.get(thread.at.file);
      if (file === undefined || thread.at.line < 1) continue;
      const key = `${thread.at.side}:${thread.at.line}`;
      const there = next[file]!.get(key);
      if (there) there.push(thread);
      else next[file]!.set(key, [thread]);
    }
    // Only the files whose threads changed are drawn again.
    next.forEach((byPlace, file) => {
      if (sameThreads(this.#threads[file]!, byPlace)) return;
      this.#threads[file] = byPlace;
      this.#keepAt(file);
      this.#refresh(file);
    });
  }

  // Moving -----------------------------------------------------------------------------------

  reveal(at: Target): boolean {
    const found = this.#atOf(at);
    if (!found) return false;
    const { place, column } = found;
    const pane: Pane = this.#pane === 'inline' ? 'inline' : place.side;
    const view = this.#viewOf(pane);
    const line = view.state.doc.line(this.#docLine(pane, place));
    // What Vim was in the middle of, such as a count typed before `⌃o`, ends here.
    this.clearPending();
    this.#lastPane = pane;
    this.#lastSide = place.side;
    this.#aligner.follow(pane === 'inline' ? undefined : pane);
    view.dispatch({
      selection: { anchor: line.from + Math.min(column, line.length) },
      scrollIntoView: true,
    });
    return true;
  }

  /** The place `at` names, and the column on it, if the view has it. */
  #atOf(at: Target): { place: At; column: number } | undefined {
    const fileOf = (id: string): number | undefined => this.#index.get(id);
    switch (at.kind) {
      case 'line': {
        const file = fileOf(at.at.file);
        if (file === undefined) return undefined;
        const line = 'line' in at.at ? at.at.line : Math.max(at.at.from, at.at.to);
        const column = 'line' in at.at ? (at.at.column ?? 0) : 0;
        return { place: { file, side: at.at.side, line }, column };
      }
      case 'header': {
        const file = fileOf(at.file);
        return file === undefined
          ? undefined
          : { place: { file, side: at.side, line: 0 }, column: 0 };
      }
      case 'file': {
        const file = fileOf(at.file);
        return file === undefined ? undefined : { place: this.#headerOf(file), column: 0 };
      }
      case 'thread': {
        const place = this.#threadPlace(at.thread);
        return place && { place, column: 0 };
      }
      case 'layer':
      case 'block':
      case 'tab':
      case 'none':
        return undefined;
      default:
        at satisfies never;
        return undefined;
    }
  }

  jump(to: JumpTo, count: number): void {
    if (count === 0) return;
    const pane = this.#activePane();
    const view = this.#viewOf(pane);
    const from = view.state.doc.lineAt(view.state.selection.main.head).number;
    const line = this.#jump(pane, to, count > 0, from, Math.abs(count));
    if (line === undefined) return;
    this.#moveTo(pane, line, from);
  }

  otherSide(): void {
    const pane = this.#activePane();
    if (pane === 'inline') return;
    const view = this.#viewOf(pane);
    const from = view.state.doc.lineAt(view.state.selection.main.head).number;
    this.#moveTo(pane === 'old' ? 'new' : 'old', this.#otherSideLine(pane, from), from, pane);
  }

  fold(at: Target, how: Fold): void {
    const found = this.#atOf(at);
    if (!found) return;
    const { place } = found;
    const { file } = place;
    switch (how) {
      case 'open':
      case 'close':
        this.#openRun(place, how === 'open');
        return;
      case 'file': {
        const diff = this.#diffs[file];
        if (!diff || this.#noteOf(file)) return;
        for (const run of collapsedRuns(diff, this.#keep[file], 2, this.#gaps[file])) {
          if (!this.#inGap(file, run)) this.#open[file]!.add(run.old.first);
        }
        this.#refresh(file);
        return;
      }
      case 'toggle':
        this.#toggleFile(file);
        return;
      default:
        throw new Error(`A fold Lo doesn't know: ${JSON.stringify(how satisfies never)}`);
    }
  }

  lines(span: Span): readonly string[] {
    const lines = this.#lines[this.#fileOf(span.file)]![span.side];
    return lines.slice(Math.max(0, Math.min(span.from, span.to) - 1), Math.max(span.from, span.to));
  }

  focus(): void {
    // Where `reveal` last put the cursor, or the editor that had focus last.
    const pane = this.#panes().includes(this.#lastPane) ? this.#lastPane : this.#activePane();
    this.#viewOf(pane).focus();
    // Said now: CodeMirror hears of focus a little later.
    this.#tell(pane);
  }

  destroy(): void {
    document.fonts.removeEventListener('loadingdone', this.#measure);
    for (const stop of this.#stops) stop();
    this.#aligner.destroy();
    for (const { box } of this.#boxes.values()) box.destroy();
    for (const sizes of [this.#sizes.old, this.#sizes.new, this.#inline?.sizes]) sizes?.destroy();
    for (const view of this.#editors()) view.destroy();
    this.dom.remove();
  }

  // Keys -------------------------------------------------------------------------------------

  keyState(): { mode: Mode; pending: boolean; target: Target } {
    const pane = this.#activePane();
    const view = this.#viewOf(pane);
    return { mode: vimMode(view), pending: vimPending(view), target: this.#targetOf(pane) };
  }

  passKeys(keys: readonly string[]): void {
    passToVim(this.#viewOf(this.#activePane()), keys);
  }

  clearPending(): void {
    for (const view of this.#editors()) clearVim(view);
  }

  setVimKeys(keys: readonly VimKey[]): void {
    setVimKeys(keys);
  }

  /**
   * What a key acts on in `pane`: the cursor's line, or the lines `v` selected, and a thread; or
   * the header the cursor is on.
   */
  #targetOf(pane: Pane): LineTarget | HeaderTarget {
    const view = this.#viewOf(pane);
    const { doc, selection } = view.state;
    const { head, anchor } = selection.main;
    const headLine = doc.lineAt(head);
    const at = this.#placeAt(pane, headLine.number);
    if (vimMode(view) === 'visual') {
      const other = this.#placeAt(pane, doc.lineAt(anchor).number);
      if (other.file === at.file && other.side === at.side) {
        const from = Math.max(1, Math.min(at.line, other.line));
        const to = Math.max(1, at.line, other.line);
        return { kind: 'line', at: { file: this.#ids[at.file]!, side: at.side, from, to } };
      }
    }
    return this.#lineTarget(at, head - headLine.from);
  }

  /** What a key or a click at `at` acts on: the line and its thread, or the header. */
  #lineTarget(at: At, column?: number): LineTarget | HeaderTarget {
    if (at.line === 0) return { kind: 'header', file: this.#ids[at.file]!, side: at.side };
    const place = this.#outward(at, column);
    const thread = this.#threadAt(at);
    return thread === undefined ? { kind: 'line', at: place } : { kind: 'line', at: place, thread };
  }

  /** The thread under `at` that a key there acts on: the only one, or the one `]t` landed on. */
  #threadAt(at: At): string | undefined {
    const threads = this.#threads[at.file]?.get(`${at.side}:${at.line}`);
    if (!threads) return undefined;
    if (threads.length === 1) return threads[0]!.id;
    const landed = this.#landed;
    if (landed && landed.file === at.file && landed.side === at.side && landed.line === at.line) {
      return landed.thread;
    }
    return undefined;
  }

  // Comments ---------------------------------------------------------------------------------

  compose(at: Place | Span | { thread: string }, draft: string, on: ComposerEvents): Composer {
    const place = this.#boxPlace(at);
    if (place.line < 1 || this.#noteOf(place.file)) {
      throw new Error('A comment box goes under a line of a file that is shown.');
    }
    const key = placeKey(place);
    const open = this.#boxes.get(key);
    if (open) {
      open.box.focus();
      return open.composer;
    }
    const thread = 'thread' in at ? at.thread : this.#threadAt(place);
    const where = 'line' in at || 'from' in at ? at : this.#outward(place);
    const target: LineTarget =
      thread === undefined ? { kind: 'line', at: where } : { kind: 'line', at: where, thread };
    const box = new CommentBox(
      place,
      target,
      draft,
      {
        resized: () => this.#remeasure(),
        change: (_box, text) => on.change(text),
        submit: (_box, how) => on.submit(how),
        close: (closed) => {
          const keep = closed.text.trim() !== '';
          this.#closeBox(closed);
          on.close(keep);
        },
      },
      this.#nonce,
    );
    const composer: Composer = {
      get text() {
        return box.text;
      },
      focus: () => box.focus(),
      insert: (text) => box.insert(text),
      close: () => this.#closeBox(box),
    };
    this.#boxes.set(key, { box, composer });
    // The lines `v` selected are the box's now.
    const active = this.#viewOf(this.#activePane());
    if (vimMode(active) === 'visual') passToVim(active, ['<Esc>']);
    this.#boxLines[place.file]![place.side].add(place.line);
    this.#keepAt(place.file);
    this.#refresh(place.file);
    box.focus();
    return composer;
  }

  /** Where a box for `at` goes: under a line, a span's last line, or a thread's line. */
  #boxPlace(at: Place | Span | { thread: string }): At {
    if ('thread' in at) {
      const place = this.#threadPlace(at.thread);
      if (!place) throw new Error(`There's no thread ${at.thread} in the view.`);
      return place;
    }
    const file = this.#fileOf(at.file);
    return { file, side: at.side, line: 'line' in at ? at.line : Math.max(at.from, at.to) };
  }

  /** The line thread `id` is under, if the view has it. */
  #threadPlace(id: string): At | undefined {
    for (const [file, byPlace] of this.#threads.entries()) {
      for (const threads of byPlace.values()) {
        const thread = threads.find((each) => each.id === id);
        if (thread) return { file, side: thread.at.side, line: thread.at.line };
      }
    }
    return undefined;
  }

  #closeBox(box: CommentBox): void {
    const key = placeKey(box.place);
    if (this.#boxes.get(key)?.box !== box) return;
    this.#boxes.delete(key);
    this.#refresh(box.place.file);
    const pane: Pane = this.#pane === 'inline' ? 'inline' : box.place.side;
    const view = this.#viewOf(pane);
    const line = this.#docLine(pane, box.place);
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
    view.focus();
    box.destroy();
  }

  /** Lines the sides up now, so a box that grew is level before the page is painted. */
  #remeasure(): void {
    if (this.#pane === 'split') this.#aligner.run();
    else this.#inline?.view.requestMeasure();
  }

  // Readings ---------------------------------------------------------------------------------

  /**
   * How level the rows on screen are now, as drawn: every row with something on both sides whose
   * start is on screen on either side, its first line or the header, collapsed block or note it
   * starts with, found by the key each carries.
   */
  #misalignment(): Misalignment {
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
   * distance, and the scroll CodeMirror makes to bring a cursor into view, as it makes it. Follows,
   * on each side, what it draws on screen nearest the middle of the screen, a line or the header
   * or collapsed block a row starts with. A side's is undefined when it had nothing on screen, or
   * what it followed isn't drawn now.
   */
  #movement(): Movement {
    const asked = this.#asked;
    this.#asked = 0;
    const screen = this.dom.getBoundingClientRect();
    const middle = (screen.top + screen.bottom) / 2;
    const result: Movement = { asked };
    for (const side of ['old', 'new'] as const) {
      const followed = this.#followed[side];
      if (followed) {
        const element = this.views[side].contentDOM.querySelector(followed.selector);
        if (element) result[side] = followed.top - element.getBoundingClientRect().top;
      }
      // Follow, next, what's on screen nearest its middle.
      let nearest: { selector: string; top: number } | undefined;
      for (const element of this.views[side].contentDOM.querySelectorAll<HTMLElement>(
        '[data-line], [data-row]',
      )) {
        const top = element.getBoundingClientRect().top;
        if (top < screen.top || top >= screen.bottom) continue;
        if (nearest && Math.abs(top - middle) >= Math.abs(nearest.top - middle)) continue;
        const { line, row } = element.dataset;
        const selector = line === undefined ? `[data-row="${row}"]` : `[data-line="${line}"]`;
        nearest = { selector, top };
      }
      this.#followed[side] = nearest;
    }
    return result;
  }

  #cursorReading(): CursorReading {
    const pane = this.#activePane();
    const view = this.#viewOf(pane);
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const at = this.#spot(this.#placeAt(pane, line.number), head - line.from);
    const drawn = view.coordsAtPos(head, 1);
    const block = view.lineBlockAt(head);
    const top = drawn?.top ?? block.top + view.documentTop;
    const bottom = drawn?.bottom ?? block.bottom + view.documentTop;
    const screen = this.dom.getBoundingClientRect();
    const end = screen.top + this.dom.clientHeight;
    const onScreen = drawn !== null && top >= screen.top - 1 && bottom <= end + 1;
    return { at, pane, top, bottom, onScreen };
  }

  // Events -----------------------------------------------------------------------------------

  /** Says where the cursor is in `pane`, and Vim's mode there, if either changed. */
  #tell(pane: Pane): void {
    this.#lastPane = pane;
    if (pane !== 'inline') this.#lastSide = pane;
    const view = this.#viewOf(pane);
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const at = this.#placeAt(pane, line.number);
    const landed = this.#landed;
    if (landed && (landed.file !== at.file || landed.side !== at.side || landed.line !== at.line)) {
      this.#landed = undefined;
    }
    const spot = this.#spot(at, head - line.from);
    const said = JSON.stringify(spot);
    if (said !== this.#said.cursor) {
      this.#said.cursor = said;
      this.#on.cursor(spot);
    }
    this.#tellMode(vimMode(view));
  }

  #tellMode(mode: Mode): void {
    if (mode === this.#said.mode) return;
    this.#said.mode = mode;
    this.#on.mode(mode);
  }

  /**
   * Says which file is at the top of the screen when it changes: read as the editor next reads the
   * layout, with what else it reads, once a frame at most.
   */
  readonly #watchFile = (): void => {
    const pane: Pane = this.#pane === 'inline' ? 'inline' : 'new';
    const view = this.#viewOf(pane);
    view.requestMeasure({
      key: this.#watchFile,
      read: () => {
        const top = this.dom.getBoundingClientRect().top - view.documentTop;
        const block = view.lineBlockAtHeight(Math.max(0, top + 1));
        return this.#fileAt(pane, view.state.doc.lineAt(block.from).number);
      },
      write: (file) => {
        if (file === this.#said.file) return;
        this.#said.file = file;
        this.#on.file(this.#ids[file]!);
      },
    });
  };

  /** A right-click: the menu of the thread or the line under the pointer. */
  #contextMenu(event: MouseEvent): void {
    const { target } = event;
    if (event.defaultPrevented || !(target instanceof Element)) return;
    // A comment box is text, which the system's own menu serves.
    if (target.closest('.lo-diffcomposer')) return;
    const card = target.closest<HTMLElement>('[data-thread-id]');
    let clicked: Target | undefined;
    if (card?.dataset.threadId) {
      clicked = { kind: 'thread', thread: card.dataset.threadId };
    } else {
      const pane = this.#panes().find((each) => this.#viewOf(each).dom.contains(target));
      if (!pane) return;
      const view = this.#viewOf(pane);
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return;
      clicked = this.#lineTarget(this.#placeAt(pane, view.state.doc.lineAt(pos).number));
    }
    event.preventDefault();
    this.#on.menu(clicked, event.clientX, event.clientY);
  }

  // Panes ------------------------------------------------------------------------------------

  #editors(): EditorView[] {
    return [this.views.old, this.views.new, ...(this.#inline ? [this.#inline.view] : [])];
  }

  /** The panes the layout shows. */
  #panes(): Pane[] {
    return this.#pane === 'split' ? ['old', 'new'] : ['inline'];
  }

  /** The pane keys go to: the one with focus, or the one that had it last. */
  #activePane(): Pane {
    const panes = this.#panes();
    return (
      panes.find((pane) => this.#viewOf(pane).hasFocus) ??
      (panes.includes(this.#lastPane) ? this.#lastPane : panes.at(-1)!)
    );
  }

  /** Makes `view` one of the view's own editors, showing `pane`. */
  #addEditor(pane: Pane, view: EditorView): void {
    addCodeEditor(view, {
      jump: (to, forward, line, count) => this.#jump(pane, to, forward, line, count),
      jumped: (from, to) => {
        const { doc } = view.state;
        const before = this.#placeAt(pane, doc.lineAt(Math.min(from, doc.length)).number);
        const after = this.#placeAt(pane, doc.lineAt(Math.min(to, doc.length)).number);
        if (
          before.file === after.file &&
          before.side === after.side &&
          before.line === after.line
        ) {
          return;
        }
        this.#on.jumped(this.#spot(before), this.#spot(after));
      },
      // What a key did is said once Vim is done with it, never what it passed through.
      settled: () => {
        if (view.hasFocus) this.#tell(pane);
      },
    });
    this.#stops.push(
      onVimMode(view, (mode) => {
        if (view.hasFocus && !handlingKey(view)) this.#tellMode(mode);
      }),
    );
  }

  /** What every diff editor has: Vim, read-only lines split at `\n`, wrapping, the decorations. */
  #common(pane: Pane): Extension[] {
    return [
      vim(),
      drawSelection(),
      // Lines split at `\n` alone, as the diff splits them.
      EditorState.lineSeparator.of('\n'),
      readOnly(),
      EditorView.lineWrapping,
      EditorView.cspNonce.of(this.#nonce),
      fileField,
      leaveOnScreen,
      EditorView.updateListener.of((update) => {
        if (!update.view.hasFocus || handlingKey(update.view) || this.#quiet > 0) return;
        if (update.selectionSet || update.focusChanged || update.docChanged) this.#tell(pane);
      }),
    ];
  }

  #extensions(side: Side): Extension[] {
    const layout = this.#layout;
    return [
      this.#common(side),
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
      EditorView.scrollHandler.of((view) => this.#scrollAsked(view)),
    ];
  }

  /**
   * Counts the scroll CodeMirror makes to bring a cursor into view, for `movement()`: from where
   * the scroll is as it starts to where it is when the editor next reads the layout, right after.
   * Lets CodeMirror scroll as it would.
   */
  #scrollAsked(view: EditorView): boolean {
    const before = this.dom.scrollTop;
    view.requestMeasure({
      read: () => {
        this.#asked += this.dom.scrollTop - before;
        return null;
      },
    });
    return false;
  }

  #makeInline(): { view: EditorView; layout: InlineLayout } {
    const layout = new InlineLayout(
      this.#files.map((file, index) => {
        const diff = this.#diffs[index];
        if (!diff || this.#noteOf(index)) return { path: file.path };
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
          this.#common('inline'),
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
        ],
      }),
    });
    view.dom.classList.add('lo-diffinline');
    this.#inline = { view, layout, sizes: new ThreadSizes(view.contentDOM) };
    this.#addEditor('inline', view);
    const ranges = this.#files.flatMap((_, index) => this.#inlineBlocks(index));
    view.dispatch({ effects: setFile.of({ file: -1, from: 0, to: 0, decorations: ranges }) });
    return this.#inline;
  }

  /** Gives the inline document a file's lines, once its diff is in. */
  #addInline(file: number): void {
    const inline = this.#inline!;
    const diff = this.#diffs[file];
    if (!diff || inline.layout.lines[file] || !this.#loaded.has(file)) return;
    const lines = inlineLines(diff);
    const text = inlineText(lines, this.#lines[file]!.old, this.#lines[file]!.new);
    const header = inline.view.state.doc.line(inline.layout.files[file]!.header);
    inline.layout.setLines(file, lines);
    if (text.length > 0) {
      inline.view.dispatch({
        changes: { from: header.to, insert: `\n${text.join('\n')}` },
        annotations: ownChange.of(true),
      });
    }
  }

  /** Shows the inline layout, or side by side again, keeping the line at the cursor in view. */
  #toggleLayout(): void {
    const pane = this.#activePane();
    const view = this.#viewOf(pane);
    const from = this.#placeAt(pane, view.state.doc.lineAt(view.state.selection.main.head).number);
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
      // The cursor stays on screen as the sides settle, as after any key that moves it.
      this.#aligner.follow();
      this.#show(from.side, from);
    }
  }

  /** Shows `pane`, scrolled to `place` with the cursor there and focus in it. */
  #show(pane: Pane, place: At): void {
    const view = this.#viewOf(pane);
    view.requestMeasure();
    const line = this.#docLine(pane, place);
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }

  /**
   * Moves the cursor in `pane` to document line `line`, gives it focus and brings it on screen, as
   * a jump from line `from` of `start`.
   */
  #moveTo(pane: Pane, line: number, from: number, start: Pane = pane): void {
    const view = this.#viewOf(pane);
    const before = this.#placeAt(start, from);
    this.#aligner.follow();
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from }, scrollIntoView: true });
    this.#on.jumped(this.#spot(before), this.#spot(this.#placeAt(pane, line)));
  }

  // Files ------------------------------------------------------------------------------------

  /** The index of the file the caller calls `id`. */
  #fileOf(id: string): number {
    const file = this.#index.get(id);
    if (file === undefined) throw new Error(`There's no file ${id} in the view.`);
    return file;
  }

  /** A line as the caller sees it. */
  #outward(at: At, column?: number): Place {
    const place: Place = { file: this.#ids[at.file]!, side: at.side, line: at.line };
    if (column !== undefined) place.column = column;
    return place;
  }

  /** Where the cursor is, as the caller sees it: a line, or a header. */
  #spot(at: At, column?: number): Spot {
    if (at.line === 0) return { kind: 'header', file: this.#ids[at.file]!, side: at.side };
    return { kind: 'line', at: this.#outward(at, column) };
  }

  /** A file's header, on the side the cursor was last on. */
  #headerOf(file: number): At {
    return { file, side: this.#lastSide, line: 0 };
  }

  #noteOf(file: number): FileNote | undefined {
    const { skipped } = this.#files[file]!;
    if (this.#loading.has(file)) return 'loading';
    if (this.#failed.has(file)) return 'failed';
    if (skipped === 'binary') return 'binary';
    if (skipped === 'empty') return 'empty';
    if (!this.#loaded.has(file)) return 'too-large';
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
      diff && !this.#noteOf(file)
        ? {
            kind: 'diff',
            diff,
            keep: this.#keep[file],
            open: this.#open[file],
            gaps: this.#gaps[file],
          }
        : { kind: 'collapsed' },
    );
  }

  /** Keeps shown the lines a file's threads and comment boxes are under. */
  #keepAt(file: number): void {
    const keep = {
      old: new Set(this.#boxLines[file]!.old),
      new: new Set(this.#boxLines[file]!.new),
    };
    for (const threads of this.#threads[file]!.values()) {
      const { side, line } = threads[0]!.at;
      keep[side].add(line);
    }
    this.#keep[file] = keep;
  }

  /** The file's threads and the comment boxes shown in it, by the line they're under. */
  #viewThreads(file: number): ViewThread[] {
    const byPlace = new Map<string, ViewThread>();
    for (const [key, threads] of this.#threads[file]!) {
      const { side, line } = threads[0]!.at;
      byPlace.set(key, { id: placeKey({ file, side, line }), side, line, threads });
    }
    for (const { box } of this.#boxes.values()) {
      if (box.place.file !== file) continue;
      const { side, line } = box.place;
      const key = `${side}:${line}`;
      const shown = byPlace.get(key) ?? { id: placeKey(box.place), side, line, threads: [] };
      byPlace.set(key, { ...shown, box, drawing: this.#drawing });
    }
    return [...byPlace.values()];
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
      gaps: this.#gaps[file]!,
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
    const files = new Set([...this.#boxes.values()].map(({ box }) => box.place.file));
    for (const file of files) this.#refresh(file);
  }

  /**
   * Puts a file's lines in the documents: a file kept out, or the whole of one in place of what it
   * showed, at the same place. Only the lines that differ change, so the cursor keeps its line and
   * the scroll its anchor. `diff`, when given, is shown with the new lines at once; without it, a
   * shown file keeps its diff while its lines keep their counts. Highlighting comes again.
   */
  #bringIn(
    file: number,
    given: { old: readonly string[]; new: readonly string[] },
    diff: FileDiff | undefined,
  ): void {
    const shown = this.#loaded.has(file);
    const before = this.#lines[file]!;
    const sameCounts =
      before.old.length === given.old.length && before.new.length === given.new.length;
    this.#loaded.add(file);
    this.#loading.delete(file);
    this.#failed.delete(file);
    this.#gaps[file] = [];
    this.#lines[file] = { old: given.old, new: given.new };
    if (diff) this.#diffs[file] = diff;
    else if (shown && !sameCounts) this.#diffs[file] = undefined;
    if (shown) {
      // Offsets into the old text: the highlighting of the new comes with `setTokens`.
      this.#triples[file] = {};
      this.#tokens[file] = {};
    }
    // The lines change under the editors: what the cursor is on is said once they settle.
    this.#quiet++;
    try {
      for (const side of ['old', 'new'] as const) {
        const lines = given[side];
        const triples = this.#triples[file]![side];
        if (triples) this.#tokens[file]![side] = { tokens: triples, starts: lineStarts(lines) };
        const { header } = this.#layout.files[file]![side];
        replaceLines(this.views[side], header, before[side], lines);
        this.#layout.setCount(side, file, lines.length);
      }
      // Every file after it has moved.
      for (let index = file; index < this.#rows.length; index++) {
        this.#rows[index] = this.#rowsOf(index);
      }
      if (this.#inline) this.#replaceInline(file);
      this.#refresh(file, [tokensChanged.of(null)]);
    } finally {
      this.#quiet--;
    }
    const pane = this.#activePane();
    if (this.#viewOf(pane).hasFocus) this.#tell(pane);
  }

  /** Gives the inline document file `file`'s lines from its diff now, in place of those it had. */
  #replaceInline(file: number): void {
    const inline = this.#inline!;
    const had = inline.layout.lines[file];
    if (!had) {
      this.#addInline(file);
      return;
    }
    const diff = this.#diffs[file];
    const lines = this.#lines[file]!;
    const { header, count } = inline.layout.files[file]!;
    const { view } = inline;
    const was = view.state.doc.sliceString(
      view.state.doc.line(header).to,
      view.state.doc.line(header + count).to,
    );
    const before = was === '' ? [] : was.slice(1).split('\n');
    if (diff && this.#loaded.has(file)) {
      const now = inlineLines(diff);
      const text = inlineText(now, lines.old, lines.new);
      if (text.length === before.length) {
        // The same rows: line for line, so the cursor stays where it is.
        replaceLines(view, header, before, text);
        inline.layout.setLines(file, now);
        return;
      }
    }
    // Other rows: the file's inline lines go, and come again from its diff, the cursor kept on
    // the same file line if it was in the file.
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head).number;
    const at = this.#fileAt('inline', line) === file ? this.#placeAt('inline', line) : undefined;
    replaceLines(view, header, before, []);
    inline.layout.clearLines(file);
    this.#addInline(file);
    if (at)
      view.dispatch({
        selection: { anchor: view.state.doc.line(this.#docLine('inline', at)).from },
      });
  }

  // Jumps and folds --------------------------------------------------------------------------

  /** The file whose document line `line` in `pane` is in. */
  #fileAt(pane: Pane, line: number): number {
    return pane === 'inline' ? this.#inline!.layout.fileAt(line) : this.#layout.fileAt(pane, line);
  }

  /** The file line at document line `line` of `pane`, or the header's place (line 0). */
  #placeAt(pane: Pane, line: number): At {
    const file = this.#fileAt(pane, line);
    if (pane !== 'inline') return { file, side: pane, line: this.#layout.fileLine(pane, line) };
    const shown = this.#inline!.layout.lineAt(line);
    if (shown.new > 0) return { file, side: 'new', line: shown.new };
    if (shown.old > 0) return { file, side: 'old', line: shown.old };
    // A header, on both sides at once: the side the cursor was last on.
    return { file, side: this.#lastSide, line: 0 };
  }

  /** The document line of `place` in `pane`. */
  #docLine(pane: Pane, place: At): number {
    if (pane === 'inline') return this.#inline!.layout.docLine(place.file, place.side, place.line);
    const lines = this.#layout.files[place.file]!;
    const line = Math.min(place.line, lines[place.side].count);
    if (pane === place.side) return lines[pane].header + line;
    return this.#otherSideLine(place.side, lines[place.side].header + line);
  }

  #viewOf(pane: Pane): EditorView {
    return pane === 'inline' ? this.#inline!.view : this.views[pane];
  }

  /** The document lines `target` stops at in file `file` of `pane`, in order. */
  #stopsIn(pane: Pane, target: JumpTo, file: number): number[] {
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
      .map((threads) => threads[0]!.at)
      .filter((place) => pane === 'inline' || place.side === pane)
      .map((place) => at(place.side, place.line))
      .toSorted((a, b) => a - b);
  }

  /** The document line `count` stops of `target` after (or before) line `line` of `pane`. */
  #jump(
    pane: Pane,
    target: JumpTo,
    forward: boolean,
    line: number,
    count: number,
  ): number | undefined {
    const files = this.#ids.length;
    let left = count;
    let found: number | undefined;
    for (let file = this.#fileAt(pane, line); file >= 0 && file < files; file += forward ? 1 : -1) {
      const stops = this.#stopsIn(pane, target, file);
      if (!forward) stops.reverse();
      for (const stop of stops) {
        if (forward ? stop <= line : stop >= line) continue;
        found = stop;
        if (--left === 0) break;
      }
      if (left === 0) break;
    }
    if (found !== undefined && target === 'thread') {
      const at = this.#placeAt(pane, found);
      const thread = this.#threads[at.file]?.get(`${at.side}:${at.line}`)?.[0];
      this.#landed = thread ? { ...at, thread: thread.id } : undefined;
    }
    return found;
  }

  /** `zo` and `zc`: opens the collapsed run at `place`, or closes the opened run it's in. */
  #openRun(place: At, open: boolean): void {
    const diff = this.#diffs[place.file];
    if (!diff || place.line === 0 || this.#noteOf(place.file)) return;
    const keep = this.#keep[place.file];
    const opened = this.#open[place.file]!;
    const gaps = this.#gaps[place.file];
    const runs = open ? shownRuns(diff, keep, opened, gaps) : collapsedRuns(diff, keep, 2, gaps);
    const run = runAt(runs, place.side, place.line);
    // Lines the view has only as placeholders stay collapsed.
    if (!run || opened.has(run.old.first) === open || this.#inGap(place.file, run)) return;
    if (open) opened.add(run.old.first);
    else opened.delete(run.old.first);
    this.#refresh(place.file);
  }

  /** Whether `run` takes in lines file `file` holds only as placeholders. */
  #inGap(file: number, run: { old: LineRange; new: LineRange }): boolean {
    return inGap(run, this.#gaps[file]!);
  }

  /** Moved code as the decorations take it, by the files' places in the view, if it has both. */
  #movedBlock(move: MovedCode): MovedBlock | undefined {
    const from = this.#index.get(move.from.file);
    const to = this.#index.get(move.to.file);
    if (from === undefined || to === undefined) return undefined;
    const fromFile = this.#files[from]!;
    return {
      from: { ...move.from, file: from, path: fromFile.previousPath ?? fromFile.path },
      to: { ...move.to, file: to, path: this.#files[to]!.path },
      edits: [],
      words: { old: [...move.words.old], new: [...move.words.new] },
    };
  }

  /** `za`: loads a file kept out, or closes a file into one block, or opens it again. */
  #toggleFile(file: number): void {
    const note = this.#noteOf(file);
    if (note === 'too-large' || note === 'failed') {
      this.#failed.delete(file);
      this.#loading.add(file);
      this.#refresh(file);
      this.#on.load(this.#ids[file]!);
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
}

/** How the probe reads each of its readings. */
type Readings = {
  [K in keyof Probe]: Probe[K] extends (...args: never[]) => unknown ? Probe[K] : () => Probe[K];
};

/** The view's readings, each read when it's asked for. */
class ViewProbe implements Probe {
  readonly #read: Readings;

  constructor(read: Readings) {
    this.#read = read;
  }

  misalignment(): Misalignment {
    return this.#read.misalignment();
  }

  movement(): Movement {
    return this.#read.movement();
  }

  get passStats(): PassStats {
    return this.#read.passStats();
  }

  get spacers(): { old: number; new: number } {
    return this.#read.spacers();
  }

  get layout(): DiffLayout {
    return this.#read.layout();
  }

  cursor(): CursorReading | undefined {
    return this.#read.cursor();
  }
}

/**
 * Replaces lines `before` after document line `header` of `view` with `after`, changing only the
 * lines that differ, and adding or removing lines at the end: a cursor or a scroll anchor on a line
 * that stays keeps its place.
 */
function replaceLines(
  view: EditorView,
  header: number,
  before: readonly string[],
  after: readonly string[],
): void {
  const { doc } = view.state;
  const changes: { from: number; to?: number; insert?: string }[] = [];
  const common = Math.min(before.length, after.length);
  for (let index = 0; index < common; index++) {
    if (before[index] === after[index]) continue;
    const line = doc.line(header + 1 + index);
    changes.push({ from: line.from, to: line.to, insert: after[index] });
  }
  const end = doc.line(header + common).to;
  if (after.length > common)
    changes.push({ from: end, insert: `\n${after.slice(common).join('\n')}` });
  if (before.length > common) changes.push({ from: end, to: doc.line(header + before.length).to });
  if (changes.length > 0) view.dispatch({ changes, annotations: ownChange.of(true) });
}

/** Whether a file's threads are the same threads, in the same places. */
function sameThreads(before: FileThreads, after: FileThreads): boolean {
  if (before.size !== after.size) return false;
  for (const [key, threads] of after) {
    const was = before.get(key);
    if (!was || was.length !== threads.length) return false;
    if (threads.some((thread, index) => thread !== was[index])) return false;
  }
  return true;
}

/** A file as the view's decorations show it. */
function viewFile(file: DiffFile): ViewFile {
  const shown: ViewFile = { path: file.path, previousPath: file.previousPath, header: file.header };
  if (file.skip === 'binary' || file.skip === 'empty') shown.skipped = file.skip;
  else if (keptOut(file)) shown.skipped = 'too-large';
  return shown;
}

/** Whether a file's lines stay out of the documents until it's loaded. */
function keptOut(file: DiffFile): boolean {
  if (file.skip === 'binary' || file.skip === 'empty') return false;
  return file.skip === 'large' || file.lines === undefined;
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
