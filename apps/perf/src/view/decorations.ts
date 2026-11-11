// A file's decorations on one side, in two kinds. Its blocks, which change the document's
// heights: its header, a note where it has no lines, its collapsed code, the labels on its moved
// code and its threads; each carries the file's index, so a file's can be replaced alone when its
// diff or the moves arrive. And its marks: changed lines and words, and moved lines and their
// edits, which the view makes only for the lines it draws, so a transaction's cost doesn't grow
// with the pull request.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';

import type { Side } from './layout.ts';
import { collapsedRuns, type FileLines, type Keep } from './rows.ts';
import {
  CollapsedWidget,
  FileNoteWidget,
  type HeaderInfo,
  HeaderWidget,
  MovedLabelWidget,
  ThreadWidget,
} from './widgets.ts';

/** A file as the view shows it. */
export interface ViewFile extends HeaderInfo {
  /** Why the file isn't shown as a diff, if it isn't. */
  skipped?: 'too-large' | 'binary' | undefined;
}

/** A thread under one of a file's lines. */
export interface ViewThread {
  id: string;
  side: Side;
  line: number;
  comments: readonly number[];
}

export interface FileDecorationsInput {
  side: Side;
  index: number;
  file: ViewFile;
  lines: FileLines;
  /** Whether the file has lines on the other side. */
  otherLines: boolean;
  doc: Text;
  diff?: FileDiff | undefined;
  /** The moves with an end in this file. */
  moves: readonly MovedBlock[];
  threads: readonly ViewThread[];
  keep: Keep;
}

/** The file's blocks on one side, in no particular order. */
export function fileBlocks(input: FileDecorationsInput): Range<Decoration>[] {
  const { side, index, file, lines, doc, diff, moves, threads, keep } = input;
  const tag = { file: index };
  const line = (number: number): { from: number; to: number } => doc.line(lines.header + number);
  const header = doc.line(lines.header);
  const out: Range<Decoration>[] = [
    Decoration.replace({ widget: new HeaderWidget(index, file), block: true, ...tag }).range(
      header.from,
      header.to,
    ),
  ];
  if (lines.count === 0) {
    // A file with no lines on either side says why under its header; a side without lines beside
    // one with them gets a spacer.
    if (!input.otherLines && file.skipped) {
      const text =
        file.skipped === 'binary'
          ? 'A binary file'
          : `${file.additions + file.deletions} changed lines: too many to show here`;
      out.push(
        Decoration.widget({
          widget: new FileNoteWidget(index, text),
          block: true,
          side: 1,
          ...tag,
        }).range(header.to),
      );
    }
    return out;
  }

  if (!diff) {
    const widget = new CollapsedWidget(
      `${index}:pending`,
      'Working out the diff…',
      '',
      input.otherLines ? `c:${index}:pending` : undefined,
    );
    out.push(
      Decoration.replace({ widget, block: true, ...tag }).range(line(1).from, line(lines.count).to),
    );
    return out;
  }

  for (const run of collapsedRuns(diff, keep)) {
    const { first, last } = run[side];
    const count = last - first + 1;
    const widget = new CollapsedWidget(
      `${index}:${run.old.first}`,
      `${count} unchanged line${count === 1 ? '' : 's'}`,
      `lines ${first}–${last}`,
      `c:${index}:${run.old.first}`,
    );
    out.push(
      Decoration.replace({ widget, block: true, ...tag }).range(line(first).from, line(last).to),
    );
  }

  for (const move of moves) {
    const end = side === 'old' ? move.from : move.to;
    if (end.file !== index) continue;
    const other = side === 'old' ? move.to : move.from;
    const label = new MovedLabelWidget(
      side === 'old' ? 'Moved to' : 'Moved from',
      `${other.path}:${other.first}`,
    );
    out.push(
      Decoration.widget({ widget: label, block: true, side: -2, ...tag }).range(
        line(end.first).from,
      ),
    );
  }

  for (const thread of threads) {
    if (thread.side !== side) continue;
    const widget = new ThreadWidget(thread.id, thread.comments);
    out.push(
      Decoration.widget({ widget, block: true, side: 1, ...tag }).range(line(thread.line).to),
    );
  }
  return out;
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
 * The file's marks on one side on its lines `first` to `last`: moved lines show as moved, with
 * only their edits marked, in place of their changes.
 */
export function fileMarks(
  input: Pick<FileDecorationsInput, 'side' | 'index' | 'lines' | 'doc' | 'diff' | 'moves'>,
  first: number,
  last: number,
): Range<Decoration>[] {
  const { side, index, lines, doc, diff, moves } = input;
  const out: Range<Decoration>[] = [];
  if (!diff) return out;
  const lineFrom = (number: number): number => doc.line(lines.header + number).from;
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
