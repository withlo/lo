// A file's decorations in one document, in two kinds. Its blocks, which change the document's
// heights: its header, with the row under it in it where the side has none of the file's lines,
// that row where its lines aren't shown, its collapsed code, the labels on its moved code, and its
// threads, comment boxes, overview markers' notes and peek; each carries the file's index, so a
// file's can be replaced alone when its diff or the moves arrive, a run opens, a comment is written
// or a note opens. And its marks: changed lines and words, and moved lines and their edits, which
// the view makes only for the lines it draws, so a transaction's cost doesn't grow with the pull
// request. A side's document and the inline one draw the same things; the inline one has both
// sides' lines, one after the other.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';

import type { InlineLines } from './inline.ts';
import type { Side } from './layout.ts';
import { type FileLines, type Gap, inGap, type Keep, type Open, shownRuns } from './rows.ts';
import {
  type BoxHost,
  CollapsedWidget,
  type FileRow,
  FileNoteWidget,
  type HeaderInfo,
  type HeaderPart,
  type HeaderProblem,
  type HeaderRing,
  HeaderWidget,
  MovedLabelWidget,
  type NoteDraw,
  type PeekHost,
  type ThreadSizes,
  ThreadWidget,
} from './widgets.ts';
import type { ThreadHost } from './threads.ts';

/** A file as the view shows it. */
export interface ViewFile extends HeaderInfo {
  /** Why the file isn't shown as a diff, if it isn't. */
  skipped?: 'too-large' | 'binary' | 'empty' | undefined;
}

/**
 * What's under one of a file's lines: the threads there, comment boxes, the notes of overview
 * markers that end there, a peek, or any of them together. Line 0 is the file's header, under which
 * go the threads and comment boxes on the file.
 */
export interface ViewThread {
  id: string;
  side: Side;
  line: number;
  threads: readonly ThreadHost[];
  /** The comment boxes under the line: on it, or written in one of its threads. */
  boxes?: readonly BoxHost[] | undefined;
  /**
   * Changes when the threads and the boxes must be drawn again, to move them into the editor
   * showing.
   */
  drawing?: number | undefined;
  notes?: readonly NoteDraw[] | undefined;
  /** A peek open under the line. */
  peek?: PeekHost | undefined;
}

/**
 * What a file shows where its lines would be, when they aren't shown as a diff: `showing` is a
 * file too large to draw unasked whose lines were asked for, and `loading` one read again after
 * it failed.
 */
export type FileNote =
  'pending' | 'too-large' | 'showing' | 'loading' | 'failed' | 'binary' | 'empty' | 'closed';

export interface Common {
  index: number;
  file: ViewFile;
  doc: Text;
  /** The sizes of notes drawn in the document's editor. */
  sizes: ThreadSizes;
  /** Has the caller draw a thread, the first time it's drawn. */
  draw: (thread: ThreadHost) => void;
  diff?: FileDiff | undefined;
  /** The moves with an end in this file. */
  moves: readonly MovedBlock[];
  threads: readonly ViewThread[];
  keep: Keep;
  open: Open;
  /** Lines the file holds only as placeholders, until the whole file comes. */
  gaps: readonly Gap[];
  /** Why the file's lines aren't drawn as a diff, when they aren't. */
  note?: FileNote | undefined;
  /** The file whose header the keyboard is on, which every header reads. */
  ring: HeaderRing;
  /** The file's `Problem`, as the caller drew it, first under its header. */
  problem?: HeaderProblem | undefined;
}

/**
 * The row under a file's header in place of its lines: a button that shows them, or a wait. A
 * binary file, or one with no text changes, has none: its header's tag says so. Nor has a file
 * whose lines couldn't be read: its `Problem` is drawn with its header.
 */
export function fileRow(file: ViewFile, note: FileNote): FileRow | undefined {
  switch (note) {
    case 'too-large': {
      const { additions, deletions } = file.header;
      return { text: `Show ${(additions + deletions).toLocaleString('en-US')} lines`, act: true };
    }
    case 'closed':
      return { text: 'Expand file', act: true };
    case 'showing':
      return { text: 'Showing…', busy: true };
    case 'loading':
      return { text: 'Reading file…', busy: true };
    case 'pending':
      return { text: 'Comparing…', busy: true };
    case 'failed':
    case 'binary':
    case 'empty':
      return undefined;
    default:
      note satisfies never;
      throw new Error(`A note Lo doesn't know: ${JSON.stringify(note)}.`);
  }
}

/** The file's blocks in one side's document, in no particular order. */
export function fileBlocks(
  input: Common & {
    side: Side;
    lines: FileLines;
  },
): Range<Decoration>[] {
  const { side, index, file, lines, doc, diff, threads, keep, open, gaps } = input;
  const tag = { file: index };
  const line = (number: number): { from: number; to: number } => doc.line(lines.header + number);
  const headerLine = doc.line(lines.header);
  const row = input.note && fileRow(file, input.note);
  // The header reads once across both sides: the left column draws its start and the row's words,
  // the right its end and the row's ground.
  const part: HeaderPart = side === 'old' ? 'start' : 'end';
  const quiet = side === 'new';
  const onFile = threads.find((thread) => thread.line === 0 && thread.side === side);
  // A side with none of the file's lines draws the row under the header in the header.
  const out = [header(input, headerLine, part, lines.count === 0 ? row : undefined, onFile)];
  if (input.note) {
    if (row && lines.count > 0) {
      const widget = new FileNoteWidget(index, row, quiet, true);
      out.push(
        Decoration.replace({ widget, block: true, ...tag }).range(
          line(1).from,
          line(lines.count).to,
        ),
      );
    }
    return out;
  }
  if (!diff || lines.count === 0) return out;

  for (const run of shownRuns(diff, keep, open, gaps)) {
    const { first, last } = run[side];
    const widget = collapsed(index, run.old.first, first, last, inGap(run, gaps), quiet);
    out.push(
      Decoration.replace({ widget, block: true, ...tag }).range(line(first).from, line(last).to),
    );
  }
  movedLabels(input, side, (number) => line(number).from, out);
  for (const thread of threads) {
    if (thread.side !== side || thread.line === 0) continue;
    out.push(threadAt(thread, input, tag, line(thread.line).to));
  }
  return out;
}

/** The file's blocks in the inline document, in no particular order. */
export function inlineBlocks(
  input: Common & { lines: { header: number; count: number }; inline: InlineLines | undefined },
): Range<Decoration>[] {
  const { index, file, lines, inline, doc, diff, threads, keep, open, gaps } = input;
  const tag = { file: index };
  const headerLine = doc.line(lines.header);
  const note = input.note ?? (diff && inline ? undefined : 'pending');
  const row = note && fileRow(file, note);
  const onFile = threads.find((thread) => thread.line === 0);
  const out = [header(input, headerLine, 'both', lines.count === 0 ? row : undefined, onFile)];
  if (note) {
    if (row && lines.count > 0) {
      const widget = new FileNoteWidget(index, row, false, true);
      out.push(
        Decoration.replace({ widget, block: true, ...tag }).range(
          doc.line(lines.header + 1).from,
          doc.line(lines.header + lines.count).to,
        ),
      );
    }
    return out;
  }
  if (!diff || !inline || lines.count === 0) return out;
  const at = (side: Side, number: number): { from: number; to: number } =>
    doc.line(lines.header + (side === 'old' ? inline.ofOld : inline.ofNew)[number]!);

  for (const run of shownRuns(diff, keep, open, gaps)) {
    // An unchanged run's lines are both sides' lines at once.
    const widget = collapsed(index, run.old.first, run.new.first, run.new.last, inGap(run, gaps));
    out.push(
      Decoration.replace({ widget, block: true, ...tag }).range(
        at('new', run.new.first).from,
        at('new', run.new.last).to,
      ),
    );
  }
  for (const side of ['old', 'new'] as const) {
    movedLabels(input, side, (number) => at(side, number).from, out);
  }
  for (const thread of threads) {
    if (thread.line > 0) out.push(threadAt(thread, input, tag, at(thread.side, thread.line).to));
  }
  return out;
}

/**
 * The file's header, the part of it a column draws, with `row` in it, where the side has none of
 * the file's lines, and `onFile`, the threads and comment boxes on the file: as blocks of their own
 * after the header, CodeMirror can draw them above the lines it draws (see `HeaderWidget`).
 */
function header(
  input: Common,
  line: { from: number; to: number },
  part: HeaderPart,
  row?: FileRow,
  onFile?: ViewThread,
): Range<Decoration> {
  const under = onFile && {
    threads: onFile.threads,
    boxes: onFile.boxes ?? [],
    drawing: onFile.drawing ?? 0,
    draw: input.draw,
  };
  // The left column draws the problem with the path; the right lines up beside it.
  const problem = part === 'end' ? undefined : input.problem;
  const widget = new HeaderWidget(input.index, input.file, part, input.ring, row, under, problem);
  return Decoration.replace({ widget, block: true, file: input.index }).range(line.from, line.to);
}

/**
 * Unchanged lines collapsed: `missing` when the view has them only as placeholders; `quiet` on the
 * side that draws the row's ground alone.
 */
function collapsed(
  file: number,
  key: number,
  first: number,
  last: number,
  missing: boolean,
  quiet = false,
): CollapsedWidget {
  const count = last - first + 1;
  return new CollapsedWidget(
    `${file}:${key}${missing ? ':missing' : ''}`,
    `${count.toLocaleString('en-US')} unchanged line${count === 1 ? '' : 's'}`,
    `c:${file}:${key}`,
    quiet,
    missing,
  );
}

/** The labels at each end of the file's moved code on one side. */
function movedLabels(
  input: Common,
  side: Side,
  lineFrom: (number: number) => number,
  out: Range<Decoration>[],
): void {
  for (const move of input.moves) {
    const end = side === 'old' ? move.from : move.to;
    if (end.file !== input.index) continue;
    const other = side === 'old' ? move.to : move.from;
    const label = new MovedLabelWidget(
      side === 'old' ? 'Moved to' : 'Moved from',
      `${other.path}:${other.first}`,
      { file: other.file, side: side === 'old' ? 'new' : 'old', line: other.first },
    );
    out.push(
      Decoration.widget({ widget: label, block: true, side: -2, file: input.index }).range(
        lineFrom(end.first),
      ),
    );
  }
}

function threadAt(
  thread: ViewThread,
  { sizes, draw }: Pick<Common, 'sizes' | 'draw'>,
  tag: { file: number },
  at: number,
): Range<Decoration> {
  const widget = new ThreadWidget(
    thread.id,
    thread.threads,
    sizes,
    draw,
    thread.boxes,
    thread.drawing,
    thread.notes,
    thread.peek,
  );
  return Decoration.widget({ widget, block: true, side: 1, ...tag }).range(at);
}

const lineMarks = {
  old: Decoration.line({ class: 'lo-line-del' }),
  new: Decoration.line({ class: 'lo-line-add' }),
  moved: Decoration.line({ class: 'lo-moved' }),
};
const wordMarks = {
  old: Decoration.mark({ class: 'lo-word-del' }),
  new: Decoration.mark({ class: 'lo-word-add' }),
  moved: Decoration.mark({ class: 'lo-moved-edit' }),
};

/**
 * The file's marks on one side on its lines `first` to `last`, wherever `lineFrom` puts them:
 * moved lines show as moved, with only their edits marked, in place of their changes.
 */
export function fileMarks(
  input: Pick<Common, 'index' | 'diff' | 'moves'> & {
    side: Side;
    lineFrom: (number: number) => number;
  },
  first: number,
  last: number,
): Range<Decoration>[] {
  const { side, index, diff, moves, lineFrom } = input;
  const out: Range<Decoration>[] = [];
  if (!diff || first > last) return out;
  const inside = (number: number): boolean => number >= first && number <= last;

  const moved = new Set<number>();
  for (const move of moves) {
    const end = side === 'old' ? move.from : move.to;
    if (end.file !== index) continue;
    for (let number = Math.max(end.first, first); number <= Math.min(end.last, last); number++) {
      moved.add(number);
      out.push(lineMarks.moved.range(lineFrom(number)));
    }
    for (const word of move.words[side]) {
      if (!inside(word.line)) continue;
      const from = lineFrom(word.line);
      out.push(wordMarks.moved.range(from + word.from, from + word.to));
    }
  }

  const { changes } = diff;
  // The first change that ends after `first`: changes are in order on both sides.
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (changes[middle]![side].end <= first) low = middle + 1;
    else high = middle;
  }
  for (let at = low; at < changes.length; at++) {
    const change = changes[at]!;
    const { start, end } = change[side];
    if (start > last) break;
    for (let number = Math.max(start, first); number < Math.min(end, last + 1); number++) {
      if (!moved.has(number)) out.push(lineMarks[side].range(lineFrom(number)));
    }
    for (const word of side === 'old' ? change.oldWords : change.newWords) {
      if (!inside(word.line) || moved.has(word.line)) continue;
      const from = lineFrom(word.line);
      out.push(wordMarks[side].range(from + word.from, from + word.to));
    }
  }
  return out;
}
