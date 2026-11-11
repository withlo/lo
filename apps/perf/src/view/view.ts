// The diff view: a whole pull request in one scroll, the old side and the new side each one
// CodeMirror document holding every file. The documents never change; what each file shows comes
// from decorations, replaced as its diff, its highlighting and the moves arrive. Its blocks, which
// set the documents' heights, are kept for the whole document; its marks and highlighting are made
// only for the lines drawn.

import {
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, lineNumbers } from '@codemirror/view';
import { type FileDiff, type MovedBlock } from '@lo/diff';

import { Aligner, type PassStats, spacerField } from './aligner.ts';
import { fileBlocks, fileMarks, type ViewFile, type ViewThread } from './decorations.ts';
import { highlighting, setTokens, tokensField } from './highlight.ts';
import { Layout, type Side } from './layout.ts';
import { marking, marksChanged, rowKey } from './marks.ts';
import { type FileRows, fileRows, type Keep } from './rows.ts';

/** A file as the view is given it. */
export interface DiffViewFile extends ViewFile {
  /** Each side's lines, or none for a side the file isn't on or a file not shown. */
  oldLines: readonly string[];
  newLines: readonly string[];
}

export interface DiffViewThread extends Omit<ViewThread, 'id'> {
  file: number;
}

export interface DiffViewOptions {
  /** The nonce the page's content security policy lets CodeMirror's style elements carry. */
  nonce?: string;
}

/** Replaces one file's blocks. */
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

export class DiffView {
  readonly dom: HTMLElement;
  readonly views: { old: EditorView; new: EditorView };
  readonly #files: readonly DiffViewFile[];
  readonly #layout: Layout;
  readonly #diffs: (FileDiff | undefined)[];
  readonly #rows: FileRows[];
  readonly #threads: ViewThread[][];
  readonly #keep: Keep[];
  #moves: readonly MovedBlock[] = [];
  readonly #aligner: Aligner;

  /** What the spacer pass has cost so far, for the measurements. */
  get passStats(): PassStats {
    return this.#aligner.stats;
  }

  constructor(
    parent: HTMLElement,
    files: readonly DiffViewFile[],
    threads: readonly DiffViewThread[],
    options: DiffViewOptions = {},
  ) {
    this.#files = files;
    this.#layout = new Layout(
      files.map((file) => ({ path: file.path, old: file.oldLines, new: file.newLines })),
    );
    this.#diffs = files.map(() => undefined);
    this.#threads = files.map(() => []);
    const keep = files.map(() => ({ old: new Set<number>(), new: new Set<number>() }));
    threads.forEach((thread, index) => {
      this.#threads[thread.file]?.push({ ...thread, id: `${index}` });
      keep[thread.file]?.[thread.side].add(thread.line);
    });
    this.#keep = keep;
    this.#rows = files.map((_, index) => this.#rowsOf(index));

    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffview';
    parent.append(this.dom);
    const make = (side: Side): EditorView =>
      new EditorView({
        parent: this.dom,
        state: EditorState.create({
          doc: this.#layout.text[side],
          extensions: this.#extensions(side, options),
        }),
      });
    this.views = { old: make('old'), new: make('new') };
    this.#aligner = new Aligner(this.views, this.#layout, (file) => this.#rows[file]!, this.dom);
    for (const side of ['old', 'new'] as const) {
      this.views[side].dispatch({ effects: StateEffect.appendConfig.of(this.#aligner.plugin()) });
      const ranges = files.flatMap((_, index) => this.#blocks(side, index));
      this.views[side].dispatch({
        effects: setFile.of({ file: -1, from: 0, to: 0, decorations: ranges }),
      });
    }
    // A face that loads later, such as a script's subset when its first character shows, changes
    // the width of text, and so where lines wrap: measure again.
    document.fonts.addEventListener('loadingdone', this.#measure);
  }

  readonly #measure = (): void => {
    this.views.old.requestMeasure();
    this.views.new.requestMeasure();
  };

  /** Shows a file's diff and its highlighting. */
  setResult(
    file: number,
    diff: FileDiff,
    tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined },
  ): void {
    this.#diffs[file] = diff;
    this.#rows[file] = this.#rowsOf(file);
    for (const side of ['old', 'new'] as const) {
      const effects: StateEffect<unknown>[] = [this.#replace(side, file), marksChanged.of(null)];
      const sideTokens = tokens[side];
      if (sideTokens) effects.push(setTokens.of({ file, tokens: sideTokens }));
      this.views[side].dispatch({ effects });
    }
    this.#aligner.schedule();
  }

  /** Shows the code the pull request moves. */
  setMoves(moves: readonly MovedBlock[]): void {
    this.#moves = moves;
    const files = new Set(moves.flatMap((move) => [move.from.file, move.to.file]));
    for (const side of ['old', 'new'] as const) {
      this.views[side].dispatch({
        effects: [...[...files].map((file) => this.#replace(side, file)), marksChanged.of(null)],
      });
    }
    this.#aligner.schedule();
  }

  /**
   * How level the rows on screen are now, as drawn: every row with something on both sides whose
   * start is on screen on either side, its first line or the header, collapsed block or note it
   * starts with, found by the key each carries. Gives how many there are, how far apart the worst
   * one's tops are on the two sides, in pixels, and which it is, and how many are drawn on one side
   * only, with the other side's blank there. Cheap enough to call every frame.
   */
  misalignment(): { rows: number; worst: number; blank: number; at?: string } {
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

  destroy(): void {
    document.fonts.removeEventListener('loadingdone', this.#measure);
    this.#aligner.destroy();
    this.views.old.destroy();
    this.views.new.destroy();
    this.dom.remove();
  }

  #extensions(side: Side, options: DiffViewOptions): Extension[] {
    const layout = this.#layout;
    return [
      // Lines split at `\n` alone, as the diff splits them.
      EditorState.lineSeparator.of('\n'),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': side === 'old' ? 'Before' : 'After' }),
      options.nonce ? EditorView.cspNonce.of(options.nonce) : [],
      lineNumbers({
        formatNumber: (line) => {
          const number = layout.fileLine(side, line);
          return number === 0 ? '' : String(number);
        },
      }),
      fileField,
      spacerField,
      tokensField,
      highlighting(layout, side),
      marking((doc, first, last) => this.#marks(side, doc, first, last)),
    ];
  }

  #rowsOf(file: number): FileRows {
    const lines = this.#layout.files[file]!;
    const diff = this.#diffs[file];
    return fileRows(
      lines.old,
      lines.new,
      diff ? { kind: 'diff', diff, keep: this.#keep[file] } : { kind: 'collapsed' },
    );
  }

  #input(side: Side, file: number, doc: Text): Parameters<typeof fileBlocks>[0] {
    const lines = this.#layout.files[file]!;
    return {
      side,
      index: file,
      file: this.#files[file]!,
      lines: lines[side],
      otherLines: lines[side === 'old' ? 'new' : 'old'].count > 0,
      doc,
      diff: this.#diffs[file],
      moves: this.#moves.filter((move) => move.from.file === file || move.to.file === file),
      threads: this.#threads[file] ?? [],
      keep: this.#keep[file]!,
    };
  }

  #blocks(side: Side, file: number): Range<Decoration>[] {
    return fileBlocks(this.#input(side, file, this.views[side].state.doc));
  }

  /** The marks on document lines `first` to `last` of `side`, and each row's key on its first. */
  #marks(side: Side, doc: Text, first: number, last: number): Range<Decoration>[] {
    const out: Range<Decoration>[] = [];
    const layout = this.#layout;
    for (let file = layout.fileAt(side, first); file < layout.files.length; file++) {
      const lines = layout.files[file]![side];
      if (lines.header > last) break;
      if (lines.count === 0) continue;
      const from = Math.max(1, first - lines.header);
      const to = Math.min(lines.count, last - lines.header);
      if (from > to) continue;
      out.push(...fileMarks(this.#input(side, file, doc), from, to));
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

  /** The effect that replaces a file's decorations on one side. */
  #replace(side: Side, file: number): StateEffect<unknown> {
    const doc = this.views[side].state.doc;
    const lines = this.#layout.files[file]![side];
    return setFile.of({
      file,
      from: doc.line(lines.header).from,
      to: doc.line(lines.header + lines.count).to,
      decorations: this.#blocks(side, file),
    });
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
