// One file's diff, as the diff view reads it: which lines changed, the words that changed inside
// them, how the two sides' lines pair up into rows, and the hunks that stay open when unchanged
// code is collapsed. Everything here is plain data, so it can cross from a worker to the window.

import { DefaultLinesDiffComputer } from './vscode/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts';
import type { Range } from './vscode/editor/common/core/range.ts';

/** Lines `[start, end)`, numbered from 1. */
export interface Lines {
  start: number;
  end: number;
}

/** Part of one line: UTF-16 offsets `[from, to)` into line `line`. */
export interface WordRange {
  line: number;
  from: number;
  to: number;
}

/** A run of changed lines: the old lines it replaces with the new ones. Either side can be empty. */
export interface Change {
  old: Lines;
  new: Lines;
  /**
   * The words that changed inside the change's lines, on each side, in order. A line that changed
   * completely, or was only added or removed, has none: the line's own highlight says it all.
   */
  oldWords: WordRange[];
  newWords: WordRange[];
}

/**
 * Consecutive rows, numbered from 0, that pair the two sides' lines. Unchanged lines pair one for
 * one. A change's lines pair by index, and the side with fewer lines has no line in its last rows.
 */
export interface RowBlock {
  /** The first row. */
  row: number;
  /** The first old and new lines, and how many lines of each the block has. */
  old: number;
  new: number;
  oldCount: number;
  newCount: number;
  changed: boolean;
}

/** Changes with the unchanged lines around them that stay open when the rest is collapsed. */
export interface Hunk {
  old: Lines;
  new: Lines;
  /** The changes it holds, as indices into `FileDiff.changes`: `[start, end)`. */
  changes: { start: number; end: number };
}

export interface FileDiff {
  /** How many lines each side has: 0 for a side the file doesn't exist on. */
  oldLineCount: number;
  newLineCount: number;
  changes: Change[];
  /** Every row of the file, in order. */
  rows: RowBlock[];
  hunks: Hunk[];
  /**
   * Whether the diff stopped before it was done, at its time budget, so its changes can be larger
   * than the edits that were made.
   */
  approximate: boolean;
  /** Whether each side's last line has no line break, as git's "No newline at end of file". */
  noNewlineAtEnd: { old: boolean; new: boolean };
}

export interface DiffOptions {
  /** How long the diff may take, in milliseconds, before it settles for a coarser result. */
  budget?: number;
  /** How many unchanged lines a hunk keeps on each side of a change. */
  context?: number;
  /** Whether a change to a line's indentation or trailing whitespace counts. */
  whitespace?: boolean;
}

/**
 * One second: enough for all but a few files of even a huge pull request. Those come out coarse,
 * and can be diffed again with a longer budget when someone opens them.
 */
export const defaultBudget = 1000;

/** The unchanged lines a hunk keeps around each change, as GitHub shows them. */
export const defaultContext = 3;

/**
 * A file's lines, split at `\r\n`, `\r` or `\n` as CodeMirror splits a document. A line break at
 * the end ends the last line rather than starting another, as git counts lines.
 */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n?|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Whether `text` has a last line without a line break. */
function noNewlineAtEnd(text: string | undefined): boolean {
  return text !== undefined && text !== '' && !/[\r\n]$/.test(text);
}

const computer = new DefaultLinesDiffComputer();

/**
 * Diffs two versions of a file, each as its lines, or `undefined` for a side the file doesn't
 * exist on.
 */
export function diffLines(
  oldLines: readonly string[] | undefined,
  newLines: readonly string[] | undefined,
  options: DiffOptions = {},
): FileDiff {
  return compute(oldLines ?? [], newLines ?? [], options, { old: false, new: false });
}

/**
 * Diffs `old` and `lines`. When only one side's last line has a line break, that line counts as
 * changed on both sides, as git shows it.
 */
function compute(
  old: readonly string[],
  lines: readonly string[],
  options: DiffOptions,
  noNewline: FileDiff['noNewlineAtEnd'],
): FileDiff {
  let changes: Change[];
  let approximate = false;
  if (old.length === 0 || lines.length === 0) {
    // Added or removed: VS Code's diff expects a line on each side.
    changes =
      old.length === lines.length
        ? []
        : [{ old: lines1(old.length), new: lines1(lines.length), oldWords: [], newWords: [] }];
  } else {
    const differ = noNewline.old !== noNewline.new;
    const diff = computer.computeDiff(
      mark(old, differ && noNewline.old),
      mark(lines, differ && noNewline.new),
      {
        ignoreTrimWhitespace: !(options.whitespace ?? true),
        maxComputationTimeMs: options.budget ?? defaultBudget,
        computeMoves: false,
        extendToWords: true,
      },
    );
    approximate = diff.hitTimeout;
    changes = diff.changes.map((change) => {
      const result: Change = {
        old: {
          start: change.original.startLineNumber,
          end: change.original.endLineNumberExclusive,
        },
        new: {
          start: change.modified.startLineNumber,
          end: change.modified.endLineNumberExclusive,
        },
        oldWords: [],
        newWords: [],
      };
      if (!change.original.isEmpty && !change.modified.isEmpty) {
        for (const inner of change.innerChanges ?? []) {
          words(inner.originalRange, result.old, old, false, result.oldWords);
          words(inner.modifiedRange, result.new, lines, false, result.newWords);
        }
      }
      return result;
    });
  }
  return {
    oldLineCount: old.length,
    newLineCount: lines.length,
    changes,
    rows: rowBlocks(changes, old.length, lines.length),
    hunks: hunks(changes, old.length, options.context ?? defaultContext),
    approximate,
    noNewlineAtEnd: noNewline,
  };
}

/** Diffs two versions of a file's text, or `undefined` for a side the file doesn't exist on. */
export function diffText(
  oldText: string | undefined,
  newText: string | undefined,
  options: DiffOptions = {},
): FileDiff {
  return compute(
    oldText === undefined ? [] : splitLines(oldText),
    newText === undefined ? [] : splitLines(newText),
    options,
    { old: noNewlineAtEnd(oldText), new: noNewlineAtEnd(newText) },
  );
}

/**
 * The words that changed between two versions of a line, ignoring its indentation: where `oldLine`
 * and `newLine` differ, as ranges on line 1 of each.
 */
export function lineWords(
  oldLine: string,
  newLine: string,
  options: Pick<DiffOptions, 'budget'> = {},
): { old: WordRange[]; new: WordRange[] } {
  const result = { old: [] as WordRange[], new: [] as WordRange[] };
  const diff = computer.computeDiff([oldLine], [newLine], {
    ignoreTrimWhitespace: true,
    maxComputationTimeMs: options.budget ?? defaultBudget,
    computeMoves: false,
    extendToWords: true,
  });
  for (const change of diff.changes) {
    for (const inner of change.innerChanges ?? []) {
      words(inner.originalRange, lines1(1), [oldLine], true, result.old);
      words(inner.modifiedRange, lines1(1), [newLine], true, result.new);
    }
  }
  return result;
}

/** `lines`, with a character no line holds added to the last one when `marked`. */
function mark(lines: readonly string[], marked: boolean): string[] {
  return marked ? [...lines.slice(0, -1), `${lines.at(-1)}\0`] : [...lines];
}

/** Lines 1 to `count`. */
function lines1(count: number): Lines {
  return { start: 1, end: count + 1 };
}

/**
 * Adds the parts of each line `range` covers, within `within`, to `out`. Leaves out empty parts,
 * where text was only inserted on the other side, and unless `whole`, parts that cover a whole
 * line.
 */
function words(
  range: Range,
  within: Lines,
  lines: readonly string[],
  whole: boolean,
  out: WordRange[],
): void {
  const first = Math.max(range.startLineNumber, within.start);
  const last = Math.min(range.endLineNumber, within.end - 1);
  for (let line = first; line <= last; line++) {
    const length = lines[line - 1]?.length ?? 0;
    const from = line === range.startLineNumber ? range.startColumn - 1 : 0;
    const to = Math.min(line === range.endLineNumber ? range.endColumn - 1 : length, length);
    if (to > from && (whole || from > 0 || to < length)) out.push({ line, from, to });
  }
}

function rowBlocks(changes: readonly Change[], oldCount: number, newCount: number): RowBlock[] {
  const blocks: RowBlock[] = [];
  let row = 0;
  let old = 1;
  let added = 1;
  const push = (block: Omit<RowBlock, 'row'>): void => {
    if (block.oldCount === 0 && block.newCount === 0) return;
    blocks.push({ row, ...block });
    row += Math.max(block.oldCount, block.newCount);
  };
  for (const change of changes) {
    const same = change.old.start - old;
    push({ old, new: added, oldCount: same, newCount: same, changed: false });
    push({
      old: change.old.start,
      new: change.new.start,
      oldCount: change.old.end - change.old.start,
      newCount: change.new.end - change.new.start,
      changed: true,
    });
    old = change.old.end;
    added = change.new.end;
  }
  const same = oldCount + 1 - old;
  push({ old, new: added, oldCount: same, newCount: newCount + 1 - added, changed: false });
  return blocks;
}

function hunks(changes: readonly Change[], oldCount: number, context: number): Hunk[] {
  const result: Hunk[] = [];
  changes.forEach((change, index) => {
    // Unchanged lines line up one for one, so the context reaches as far on both sides.
    const before = Math.min(context, change.old.start - 1, change.new.start - 1);
    const after = Math.max(0, Math.min(context, oldCount + 1 - change.old.end));
    const hunk: Hunk = {
      old: { start: change.old.start - before, end: change.old.end + after },
      new: { start: change.new.start - before, end: change.new.end + after },
      changes: { start: index, end: index + 1 },
    };
    const last = result.at(-1);
    if (last && hunk.old.start <= last.old.end) {
      last.old.end = hunk.old.end;
      last.new.end = hunk.new.end;
      last.changes.end = index + 1;
    } else {
      result.push(hunk);
    }
  });
  return result;
}

/** How many rows the file has. */
export function rowCount(diff: FileDiff): number {
  const last = diff.rows.at(-1);
  return last ? last.row + Math.max(last.oldCount, last.newCount) : 0;
}

/** The row a line is on, by its number on one side, or `undefined` past the side's last line. */
export function rowOf(diff: FileDiff, side: 'old' | 'new', line: number): number | undefined {
  const count = side === 'old' ? 'oldCount' : 'newCount';
  const block = diff.rows[partitionPoint(diff.rows, (each) => each[side] <= line) - 1];
  if (!block || line >= block[side] + block[count]) return undefined;
  return block.row + line - block[side];
}

/** The old and new lines on a row: either is missing where its side has no line there. */
export function linesOf(diff: FileDiff, row: number): { old?: number; new?: number } {
  const block = diff.rows[partitionPoint(diff.rows, (each) => each.row <= row) - 1];
  const offset = row - (block?.row ?? 0);
  if (!block || offset >= Math.max(block.oldCount, block.newCount)) return {};
  return {
    ...(offset < block.oldCount && { old: block.old + offset }),
    ...(offset < block.newCount && { new: block.new + offset }),
  };
}

/** How many items from the start satisfy `before`, which holds up to some point and not after. */
function partitionPoint<T>(items: readonly T[], before: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(items[middle]!)) low = middle + 1;
    else high = middle;
  }
  return low;
}
