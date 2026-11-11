// A file's decorations in one document, in two kinds. Its blocks, which change the document's
// heights: its header, with a note in it where the file has no lines, a note where its lines
// aren't shown, its collapsed code, the labels on its moved code, and its threads and comment
// boxes; each carries the file's index, so a file's can be replaced alone when its diff or the
// moves arrive, a run opens, or a comment is written. And its marks: changed lines and words, and
// moved lines and their edits, which the view makes only for the lines it draws, so a
// transaction's cost doesn't grow with the pull request. A side's document and the inline one draw
// the same things; the inline one has both sides' lines, one after the other.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';

import type { InlineLines } from './inline.ts';
import type { Side } from './layout.ts';
import { type FileLines, type Keep, type Open, shownRuns } from './rows.ts';
import {
  type BoxHost,
  CollapsedWidget,
  FileNoteWidget,
  type HeaderInfo,
  HeaderWidget,
  MovedLabelWidget,
  type ThreadComment,
  ThreadWidget,
} from './widgets.ts';

/** A file as the view shows it. */
export interface ViewFile extends HeaderInfo {
  /** Why the file isn't shown as a diff, if it isn't. */
  skipped?: 'too-large' | 'binary' | undefined;
}

/** A thread under one of a file's lines, or a comment box there, or both. */
export interface ViewThread {
  id: string;
  side: Side;
  line: number;
  comments: readonly ThreadComment[];
  box?: BoxHost | undefined;
  /** Changes when the box must be drawn again, to move it into the editor showing. */
  drawing?: number | undefined;
}

/** What a file shows where its lines would be, when they aren't shown as a diff. */
export type FileNote = 'pending' | 'too-large' | 'loading' | 'failed' | 'binary' | 'closed';

export interface Common {
  index: number;
  file: ViewFile;
  doc: Text;
  diff?: FileDiff | undefined;
  /** The moves with an end in this file. */
  moves: readonly MovedBlock[];
  threads: readonly ViewThread[];
  keep: Keep;
  open: Open;
  /** Why the file's lines aren't drawn as a diff, when they aren't. */
  note?: FileNote | undefined;
}

function noteText(file: ViewFile, note: FileNote): string {
  const texts: Record<FileNote, string> = {
    'too-large': `${file.additions + file.deletions} changed lines: za loads them`,
    loading: 'Loading the file…',
    failed: 'The file couldn’t be loaded: za tries again',
    binary: 'A binary file',
    pending: 'Working out the diff…',
    closed: `+${file.additions} −${file.deletions}, closed: za opens it`,
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
  const { side, index, file, lines, doc, diff, threads, keep, open } = input;
  const tag = { file: index };
  const line = (number: number): { from: number; to: number } => doc.line(lines.header + number);
  const headerLine = doc.line(lines.header);
  const text = input.note && noteText(file, input.note);
  // A side without lines beside one with them gets a spacer, not a note.
  const out = [
    header(input, headerLine, lines.count === 0 && !input.otherLines ? text : undefined),
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

  for (const run of shownRuns(diff, keep, open)) {
    const { first, last } = run[side];
    const widget = collapsed(index, run.old.first, first, last);
    out.push(
      Decoration.replace({ widget, block: true, ...tag }).range(line(first).from, line(last).to),
    );
  }
  movedLabels(input, side, (number) => line(number).from, out);
  for (const thread of threads) {
    if (thread.side === side) out.push(threadAt(thread, tag, line(thread.line).to));
  }
  return out;
}

/** The file's blocks in the inline document, in no particular order. */
export function inlineBlocks(
  input: Common & { lines: { header: number; count: number }; inline: InlineLines | undefined },
): Range<Decoration>[] {
  const { index, file, lines, inline, doc, diff, threads, keep, open } = input;
  const tag = { file: index };
  const headerLine = doc.line(lines.header);
  const note = input.note ?? (diff && inline ? undefined : 'pending');
  const text = note && noteText(file, note);
  const out = [header(input, headerLine, lines.count === 0 ? text : undefined)];
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

  for (const run of shownRuns(diff, keep, open)) {
    // An unchanged run's lines are both sides' lines at once.
    const widget = collapsed(index, run.old.first, run.new.first, run.new.last);
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
  for (const thread of threads) out.push(threadAt(thread, tag, at(thread.side, thread.line).to));
  return out;
}

/**
 * The file's header, with `note` in it, where the file has no lines: as a block of its own after
 * the header, CodeMirror can draw a note above the lines it draws (see `HeaderWidget`).
 */
function header(
  input: Common,
  line: { from: number; to: number },
  note?: string,
): Range<Decoration> {
  const widget = new HeaderWidget(input.index, input.file, note);
  return Decoration.replace({ widget, block: true, file: input.index }).range(line.from, line.to);
}

function collapsed(file: number, key: number, first: number, last: number): CollapsedWidget {
  const count = last - first + 1;
  return new CollapsedWidget(
    `${file}:${key}`,
    `${count} unchanged line${count === 1 ? '' : 's'}`,
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

function threadAt(thread: ViewThread, tag: { file: number }, at: number): Range<Decoration> {
  const widget = new ThreadWidget(thread.id, thread.comments, thread.box, thread.drawing);
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
