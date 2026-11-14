// A file's decorations in one document, in two kinds. Its blocks, which change the document's
// heights: its header, with a note in it where the file has no lines, a note where its lines
// aren't shown, its collapsed code, the labels on its moved code, and its threads, comment boxes
// and overview markers' notes; each carries the file's index, so a file's can be replaced alone
// when its diff or the moves arrive, a run opens, a comment is written or a note opens. And its
// marks: changed lines and words, and moved lines and their edits, which the view makes only for
// the lines it draws, so a transaction's cost doesn't grow with the pull request. A side's document
// and the inline one draw the same things; the inline one has both sides' lines, one after the
// other.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';

import type { InlineLines } from './inline.ts';
import type { Side } from './layout.ts';
import { type FileLines, type Gap, inGap, type Keep, type Open, shownRuns } from './rows.ts';
import {
  type BoxHost,
  CollapsedWidget,
  FileNoteWidget,
  type HeaderInfo,
  HeaderWidget,
  MovedLabelWidget,
  type NoteDraw,
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
 * markers that end there, or any of them together. Line 0 is the file's header, under which go the
 * threads and comment boxes on the file.
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
}

/** What a file shows where its lines would be, when they aren't shown as a diff. */
export type FileNote =
  'pending' | 'too-large' | 'loading' | 'failed' | 'binary' | 'empty' | 'closed';

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
}

function noteText(file: ViewFile, note: FileNote): string {
  const { additions, deletions } = file.header;
  const texts: Record<FileNote, string> = {
    'too-large': `${additions + deletions} changed lines: za loads them`,
    loading: 'Loading the file…',
    failed: 'The file couldn’t be loaded: za tries again',
    binary: 'A binary file',
    empty: 'No lines changed',
    pending: 'Working out the diff…',
    closed: `+${additions} −${deletions}, closed: za opens it`,
  };
  return texts[note];
}

/** The file's blocks in one side's document, in no particular order. */
export function fileBlocks(
  input: Common & {
    side: Side;
    lines: FileLines;
    /** Whether the file has lines on the other side. */
    otherLines: boolean;
  },
): Range<Decoration>[] {
  const { side, index, file, lines, doc, diff, threads, keep, open, gaps } = input;
  const tag = { file: index };
  const line = (number: number): { from: number; to: number } => doc.line(lines.header + number);
  const headerLine = doc.line(lines.header);
  const text = input.note && noteText(file, input.note);
  // A side without lines beside one with them gets a spacer, not a note.
  const onFile = threads.find((thread) => thread.line === 0 && thread.side === side);
  const out = [
    header(input, headerLine, lines.count === 0 && !input.otherLines ? text : undefined, onFile),
  ];
  if (text) {
    if (lines.count > 0) {
      const widget = new FileNoteWidget(index, text, input.otherLines);
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
    const widget = collapsed(index, run.old.first, first, last, inGap(run, gaps));
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
  const text = note && noteText(file, note);
  const onFile = threads.find((thread) => thread.line === 0);
  const out = [header(input, headerLine, lines.count === 0 ? text : undefined, onFile)];
  if (text) {
    if (lines.count > 0) {
      const widget = new FileNoteWidget(index, text, true);
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
 * The file's header, with `note` in it, where the file has no lines, and `onFile`, the threads and
 * comment boxes on the file: as blocks of their own after the header, CodeMirror can draw them above
 * the lines it draws (see `HeaderWidget`).
 */
function header(
  input: Common,
  line: { from: number; to: number },
  note?: string,
  onFile?: ViewThread,
): Range<Decoration> {
  const under = onFile && {
    threads: onFile.threads,
    boxes: onFile.boxes ?? [],
    drawing: onFile.drawing ?? 0,
    draw: input.draw,
  };
  const widget = new HeaderWidget(input.index, input.file, note, under);
  return Decoration.replace({ widget, block: true, file: input.index }).range(line.from, line.to);
}

/** Unchanged lines collapsed: `missing` when the view has them only as placeholders. */
function collapsed(
  file: number,
  key: number,
  first: number,
  last: number,
  missing: boolean,
): CollapsedWidget {
  const count = last - first + 1;
  const lines = `${count} unchanged line${count === 1 ? '' : 's'}`;
  return new CollapsedWidget(
    `${file}:${key}${missing ? ':missing' : ''}`,
    missing ? `${lines}, not loaded yet` : lines,
    `lines ${first}–${last}`,
    `c:${file}:${key}`,
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
