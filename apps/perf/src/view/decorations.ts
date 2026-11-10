// A file's decorations on one side: its header, its collapsed code, its changed lines and words,
// its moved code and its threads. Each carries the file's index, so a file's can be replaced alone
// when its diff or the moves arrive.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { FileDiff, MovedBlock } from '@lo/diff';

import type { Side } from './layout.ts';
import { collapsedRuns, type FileLines, type Keep } from './rows.ts';
import {
  CollapsedWidget,
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
  doc: Text;
  diff?: FileDiff | undefined;
  /** The moves with an end in this file. */
  moves: readonly MovedBlock[];
  threads: readonly ViewThread[];
  keep: Keep;
}

const lineClass = { old: 'lo-line-del', new: 'lo-line-add' } as const;
const wordClass = { old: 'lo-word-del', new: 'lo-word-add' } as const;

/** The file's decorations on one side, in no particular order. */
export function fileDecorations(input: FileDecorationsInput): Range<Decoration>[] {
  const { side, index, file, lines, doc, diff, moves, threads, keep } = input;
  const file1 = { file: index };
  const line = (number: number): { from: number; to: number } => doc.line(lines.header + number);
  const header = doc.line(lines.header);
  const out: Range<Decoration>[] = [
    Decoration.replace({ widget: new HeaderWidget(index, file), block: true, ...file1 }).range(
      header.from,
      header.to,
    ),
  ];
  if (lines.count === 0) return out;

  if (!diff) {
    const text =
      file.skipped === 'too-large'
        ? `${file.additions + file.deletions} changed lines: too many to show here`
        : file.skipped === 'binary'
          ? 'A binary file'
          : 'Working out the diff…';
    const widget = new CollapsedWidget(`${index}:${file.skipped ?? 'pending'}`, text);
    out.push(
      Decoration.replace({ widget, block: true, ...file1 }).range(
        line(1).from,
        line(lines.count).to,
      ),
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
    );
    out.push(
      Decoration.replace({ widget, block: true, ...file1 }).range(line(first).from, line(last).to),
    );
  }

  // Moved lines show as moved, with only their edits highlighted, in place of their changes.
  const moved = new Set<number>();
  for (const move of moves) {
    const end = side === 'old' ? move.from : move.to;
    if (end.file !== index) continue;
    const other = side === 'old' ? move.to : move.from;
    const label = new MovedLabelWidget(
      side === 'old' ? 'Moved to' : 'Moved from',
      `${other.path}:${other.first}`,
    );
    out.push(
      Decoration.widget({ widget: label, block: true, side: -2, ...file1 }).range(
        line(end.first).from,
      ),
    );
    for (let number = end.first; number <= end.last; number++) {
      moved.add(number);
      out.push(Decoration.line({ class: 'lo-moved', ...file1 }).range(line(number).from));
    }
    for (const word of move.words[side]) {
      const { from } = line(word.line);
      out.push(
        Decoration.mark({ class: 'lo-moved-edit', ...file1 }).range(
          from + word.from,
          from + word.to,
        ),
      );
    }
  }

  for (const change of diff.changes) {
    const { start, end } = change[side];
    for (let number = start; number < end; number++) {
      if (moved.has(number)) continue;
      out.push(Decoration.line({ class: lineClass[side], ...file1 }).range(line(number).from));
    }
    for (const word of side === 'old' ? change.oldWords : change.newWords) {
      if (moved.has(word.line)) continue;
      const { from } = line(word.line);
      out.push(
        Decoration.mark({ class: wordClass[side], ...file1 }).range(
          from + word.from,
          from + word.to,
        ),
      );
    }
  }

  for (const thread of threads) {
    if (thread.side !== side) continue;
    const widget = new ThreadWidget(thread.id, thread.comments);
    out.push(
      Decoration.widget({ widget, block: true, side: 1, ...file1 }).range(line(thread.line).to),
    );
  }
  return out;
}
