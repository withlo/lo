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
   * Whether the diff stopped before it was done, at its time budget or on an internal error, so
   * its changes can be larger than the edits that were made. Moves aren't looked for in such a
   * file, since its changes can hold lines that didn't change.
   */
  approximate: boolean;
  /** Whether each side's last line has no line break, as git's "No newline at end of file". */
  noNewlineAtEnd: { old: boolean; new: boolean };
  /** How each side's lines end. A line whose ending alone changed counts as changed. */
  lineEndings: { old: LineEndings; new: LineEndings };
}

/** How a file's lines end: all with `\n`, all with `\r\n`, some of each, or no line breaks. */
export type LineEndings = 'lf' | 'crlf' | 'mixed' | 'none';

export interface DiffOptions {
  /**
   * How long the diff may take, in milliseconds, before it settles for a coarser result. 0 means
   * no limit; a negative budget is an error.
   */
  budget?: number;
  /** How many unchanged lines a hunk keeps on each side of a change. */
  context?: number;
  /**
   * Whether a change to a line's indentation or trailing whitespace counts, its line ending
   * included.
   */
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
 * A file's lines, split as git splits them: at each `\n`, with the `\r` of a `\r\n` left out. A
 * line break at the end ends the last line rather than starting another. A `\r` on its own stays
 * part of its line, so a document showing these lines must split at `\n` alone.
 */
export function splitLines(text: string): string[] {
  return parse(text).lines;
}

/** A version of a file as the diff reads it. */
interface Version {
  lines: string[];
  /** Which lines end with `\r\n`, by index. */
  crlf: boolean[];
  noNewlineAtEnd: boolean;
  lineEndings: LineEndings;
}

function parse(text: string | undefined): Version {
  if (text === undefined || text === '') {
    return { lines: [], crlf: [], noNewlineAtEnd: false, lineEndings: 'none' };
  }
  const lines = text.split('\n');
  const noNewlineAtEnd = lines.at(-1) !== '';
  if (!noNewlineAtEnd) lines.pop();
  // Only a line followed by `\n` has a line ending.
  const crlf = lines.map(
    (line, index) => line.endsWith('\r') && (index < lines.length - 1 || !noNewlineAtEnd),
  );
  let withCr = 0;
  crlf.forEach((ends, index) => {
    if (ends) {
      lines[index] = lines[index]!.slice(0, -1);
      withCr++;
    }
  });
  const breaks = noNewlineAtEnd ? lines.length - 1 : lines.length;
  const lineEndings =
    breaks === 0 ? 'none' : withCr === 0 ? 'lf' : withCr === breaks ? 'crlf' : 'mixed';
  return { lines, crlf, noNewlineAtEnd, lineEndings };
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
  return compute(fromLines(oldLines ?? []), fromLines(newLines ?? []), options);
}

/** Lines that came without their line breaks, as a version. */
function fromLines(lines: readonly string[]): Version {
  return {
    lines: [...lines],
    crlf: lines.map(() => false),
    noNewlineAtEnd: false,
    lineEndings: lines.length === 0 ? 'none' : 'lf',
  };
}

/** Diffs two versions of a file's text, or `undefined` for a side the file doesn't exist on. */
export function diffText(
  oldText: string | undefined,
  newText: string | undefined,
  options: DiffOptions = {},
): FileDiff {
  return compute(parse(oldText), parse(newText), options);
}

/** The budget in `options`, checked: VS Code's diff takes 0 as no limit. */
function budgetOf(options: Pick<DiffOptions, 'budget'>): number {
  const budget = options.budget ?? defaultBudget;
  if (!(budget >= 0)) throw new RangeError(`A diff's budget can't be ${budget}.`);
  return budget;
}

function compute(old: Version, added: Version, options: DiffOptions): FileDiff {
  const budget = budgetOf(options);
  let changes: Change[];
  let approximate = false;
  if (old.lines.length === 0 || added.lines.length === 0) {
    // Added or removed: VS Code's diff expects a line on each side.
    changes = whole(old.lines.length, added.lines.length);
  } else if (isBlankLine(old.lines) || isBlankLine(added.lines)) {
    // VS Code's diff takes a single blank line for an empty file.
    changes = blankLineChanges(old.lines, added.lines);
  } else {
    try {
      // The `\r` of a line ending is part of the line, as git compares lines.
      const withEndings = (version: Version): string[] =>
        version.lines.map((line, index) => (version.crlf[index] ? `${line}\r` : line));
      const diff = computer.computeDiff(withEndings(old), withEndings(added), {
        ignoreTrimWhitespace: !(options.whitespace ?? true),
        maxComputationTimeMs: budget,
        computeMoves: false,
        extendToWords: true,
      });
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
            words(inner.originalRange, result.old, old.lines, false, result.oldWords);
            words(inner.modifiedRange, result.new, added.lines, false, result.newWords);
          }
        }
        return result;
      });
    } catch {
      // A failed check inside VS Code's diff: this file comes out whole, and the rest go on.
      approximate = true;
      changes = whole(old.lines.length, added.lines.length);
    }
  }
  if (old.noNewlineAtEnd !== added.noNewlineAtEnd) {
    changes = withLastLines(changes, old.lines.length, added.lines.length);
  }
  return {
    oldLineCount: old.lines.length,
    newLineCount: added.lines.length,
    changes,
    rows: rowBlocks(changes, old.lines.length, added.lines.length),
    hunks: hunks(changes, old.lines.length, options.context ?? defaultContext),
    approximate,
    noNewlineAtEnd: { old: old.noNewlineAtEnd, new: added.noNewlineAtEnd },
    lineEndings: { old: old.lineEndings, new: added.lineEndings },
  };
}

/** Every line of each side as one change, or none when both sides are empty. */
function whole(oldCount: number, newCount: number): Change[] {
  if (oldCount === 0 && newCount === 0) return [];
  return [{ old: lines1(oldCount), new: lines1(newCount), oldWords: [], newWords: [] }];
}

function isBlankLine(lines: readonly string[]): boolean {
  return lines.length === 1 && lines[0] === '';
}

/** A change of whole lines, with no words. */
function lineChange(old: Lines, added: Lines): Change {
  return { old, new: added, oldWords: [], newWords: [] };
}

/** The changes between two sides when one of them is a single blank line. */
function blankLineChanges(old: readonly string[], added: readonly string[]): Change[] {
  if (isBlankLine(old) && isBlankLine(added)) return [];
  // The blank line pairs with the other side's first blank line, if it has one.
  const blank = isBlankLine(old) ? added.indexOf('') : old.indexOf('');
  if (blank === -1) return whole(old.length, added.length);
  const before = { start: 1, end: blank + 1 };
  const after = isBlankLine(old)
    ? { start: blank + 2, end: added.length + 1 }
    : { start: blank + 2, end: old.length + 1 };
  const changes: Change[] = [];
  if (blank > 0) {
    changes.push(
      isBlankLine(old)
        ? lineChange({ start: 1, end: 1 }, before)
        : lineChange(before, { start: 1, end: 1 }),
    );
  }
  if (after.end > after.start) {
    changes.push(
      isBlankLine(old)
        ? lineChange({ start: 2, end: 2 }, after)
        : lineChange(after, { start: 2, end: 2 }),
    );
  }
  return changes;
}

/**
 * `changes`, with each side's last line in a change: when only one side ends with a line break,
 * git shows that line as changed.
 */
function withLastLines(changes: Change[], oldCount: number, newCount: number): Change[] {
  if (oldCount === 0 || newCount === 0) return changes;
  const last = changes.at(-1);
  // Unchanged lines line up one for one, so as many follow the last change on each side.
  const after = oldCount + 1 - (last?.old.end ?? 1);
  if (after === 0) return changes;
  if (last && after === 1) {
    return [
      ...changes.slice(0, -1),
      {
        ...last,
        old: { ...last.old, end: last.old.end + 1 },
        new: { ...last.new, end: last.new.end + 1 },
      },
    ];
  }
  return [
    ...changes,
    {
      old: { start: oldCount, end: oldCount + 1 },
      new: { start: newCount, end: newCount + 1 },
      oldWords: [],
      newWords: [],
    },
  ];
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
    maxComputationTimeMs: budgetOf(options),
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

/** Lines 1 to `count`. */
function lines1(count: number): Lines {
  return { start: 1, end: count + 1 };
}

/**
 * Adds the parts of each line `range` covers, within `within`, to `out`, widened to whole
 * characters as people see them. Leaves out empty parts, where text was only inserted on the
 * other side, and unless `wholeLines`, parts that cover a whole line.
 */
function words(
  range: Range,
  within: Lines,
  lines: readonly string[],
  wholeLines: boolean,
  out: WordRange[],
): void {
  const first = Math.max(range.startLineNumber, within.start);
  const last = Math.min(range.endLineNumber, within.end - 1);
  for (let line = first; line <= last; line++) {
    const text = lines[line - 1] ?? '';
    const start = line === range.startLineNumber ? range.startColumn - 1 : 0;
    const end = Math.min(
      line === range.endLineNumber ? range.endColumn - 1 : text.length,
      text.length,
    );
    if (end <= start) continue;
    const [from, to] = graphemes(text, start, end);
    if (wholeLines || from > 0 || to < text.length) out.push({ line, from, to });
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * `[from, to)` widened to the edges of the characters people see, so a range never splits a
 * surrogate pair, a letter from its accent, or an emoji sequence.
 */
function graphemes(text: string, from: number, to: number): [number, number] {
  // Between two ASCII characters is always such an edge.
  const ascii = (at: number): boolean => at < 0 || at >= text.length || text.charCodeAt(at) < 0x80;
  if (ascii(from - 1) && ascii(from) && ascii(to - 1) && ascii(to)) return [from, to];
  let start = from;
  let end = to;
  for (const { index, segment } of segmenter.segment(text)) {
    const next = index + segment.length;
    if (index < from && from < next) start = index;
    if (index < to && to < next) end = next;
    if (index >= to) break;
  }
  return [start, end];
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
