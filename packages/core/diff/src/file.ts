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
  try {
    return diffVersions(old, added, budget, options);
  } catch {
    // Anything that fails in one file leaves that file whole, so the rest go on.
    return fileDiff(old, added, whole(old.lines.length, added.lines.length), true, options);
  }
}

function diffVersions(
  old: Version,
  added: Version,
  budget: number,
  options: DiffOptions,
): FileDiff {
  // Lines are compared as git compares them, with their line endings. A last line without one is
  // a different line from any with one, and it can only be at the end, so it pairs only with the
  // other side's last line when that has none either. So each side's lines but such a last line
  // are diffed, and the last lines are compared after.
  const oldTail = old.noNewlineAtEnd ? 1 : 0;
  const newTail = added.noNewlineAtEnd ? 1 : 0;
  const oldLines = withEndings(old).slice(0, old.lines.length - oldTail);
  const newLines = withEndings(added).slice(0, added.lines.length - newTail);
  const edges = new Graphemes();
  const { changes, approximate } = diffBody(oldLines, newLines, old, added, budget, options, edges);
  const tailsMatch = oldTail === 1 && newTail === 1 && old.lines.at(-1) === added.lines.at(-1);
  if ((oldTail === 0 && newTail === 0) || tailsMatch) {
    return fileDiff(old, added, changes, approximate, options);
  }
  // The last lines differ: they're a change at the end, joined to a change that reaches it.
  const tail: Change = {
    old: { start: oldLines.length + 1, end: old.lines.length + 1 },
    new: { start: newLines.length + 1, end: added.lines.length + 1 },
    oldWords: [],
    newWords: [],
  };
  if (oldTail === 1 && newTail === 1) {
    const found = singleLineWords(
      old.lines.at(-1)!,
      added.lines.at(-1)!,
      budget,
      options.whitespace ?? true,
      false,
    );
    tail.oldWords = found.old.map((range) => ({ ...range, line: old.lines.length }));
    tail.newWords = found.new.map((range) => ({ ...range, line: added.lines.length }));
  }
  const last = changes.at(-1);
  if (last && last.old.end === tail.old.start && last.new.end === tail.new.start) {
    changes[changes.length - 1] = {
      old: { start: last.old.start, end: tail.old.end },
      new: { start: last.new.start, end: tail.new.end },
      oldWords: [...last.oldWords, ...tail.oldWords],
      newWords: [...last.newWords, ...tail.newWords],
    };
  } else {
    changes.push(tail);
  }
  return fileDiff(old, added, changes, approximate, options);
}

/** The changes between two sides' lines, as git compares them, with their words. */
function diffBody(
  oldLines: string[],
  newLines: string[],
  old: Version,
  added: Version,
  budget: number,
  options: DiffOptions,
  edges: Graphemes,
): { changes: Change[]; approximate: boolean } {
  if (oldLines.length === 0 || newLines.length === 0) {
    // Added or removed: VS Code's diff expects a line on each side.
    return { changes: whole(oldLines.length, newLines.length), approximate: false };
  }
  if (isBlankLine(oldLines) || isBlankLine(newLines)) {
    // VS Code's diff takes a single blank line for an empty file.
    return { changes: blankLineChanges(oldLines, newLines), approximate: false };
  }
  try {
    const diff = computer.computeDiff(oldLines, newLines, {
      ignoreTrimWhitespace: !(options.whitespace ?? true),
      maxComputationTimeMs: budget,
      computeMoves: false,
      extendToWords: true,
    });
    const changes = diff.changes.map((change) => {
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
          words(inner.originalRange, result.old, old.lines, edges.of('old'), result.oldWords);
          words(inner.modifiedRange, result.new, added.lines, edges.of('new'), result.newWords);
        }
        result.oldWords = joinWords(result.oldWords, old.lines);
        result.newWords = joinWords(result.newWords, added.lines);
      }
      return result;
    });
    return { changes, approximate: diff.hitTimeout };
  } catch {
    // A failed check inside VS Code's diff: these lines come out whole, and the rest go on.
    return { changes: whole(oldLines.length, newLines.length), approximate: true };
  }
}

function fileDiff(
  old: Version,
  added: Version,
  changes: Change[],
  approximate: boolean,
  options: DiffOptions,
): FileDiff {
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

/**
 * `ranges` sorted, with ranges that overlap, repeat or touch on a line joined into one. With
 * `lines`, a joined range that covers its whole line is left out, as one never does.
 */
function joinWords(ranges: WordRange[], lines?: readonly string[]): WordRange[] {
  const sorted = ranges.toSorted((a, b) => a.line - b.line || a.from - b.from);
  const joined: WordRange[] = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    if (last && last.line === range.line && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      joined.push({ ...range });
    }
  }
  if (!lines) return joined;
  return joined.filter(({ line, from, to }) => from > 0 || to < (lines[line - 1]?.length ?? 0));
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

/** A version's lines as git compares them, with the `\r` of each `\r\n` put back. */
function withEndings(version: Version): string[] {
  return version.lines.map((line, index) => (version.crlf[index] ? `${line}\r` : line));
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
  return singleLineWords(oldLine, newLine, budgetOf(options), false, true);
}

/**
 * The words that changed between two lines, as ranges on line 1 of each. With `whitespace`,
 * changes of indentation count; with `wholeLines`, a range may cover a whole line.
 */
function singleLineWords(
  oldLine: string,
  newLine: string,
  budget: number,
  whitespace: boolean,
  wholeLines: boolean,
): { old: WordRange[]; new: WordRange[] } {
  const result = { old: [] as WordRange[], new: [] as WordRange[] };
  const edges = new Graphemes();
  const diff = computer.computeDiff([oldLine], [newLine], {
    ignoreTrimWhitespace: !whitespace,
    maxComputationTimeMs: budget,
    computeMoves: false,
    extendToWords: true,
  });
  for (const change of diff.changes) {
    for (const inner of change.innerChanges ?? []) {
      words(inner.originalRange, lines1(1), [oldLine], edges.of('old'), result.old, wholeLines);
      words(inner.modifiedRange, lines1(1), [newLine], edges.of('new'), result.new, wholeLines);
    }
  }
  const keep = wholeLines ? undefined : { old: [oldLine], new: [newLine] };
  return { old: joinWords(result.old, keep?.old), new: joinWords(result.new, keep?.new) };
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
  edges: (line: number, text: string) => Int32Array | undefined,
  out: WordRange[],
  wholeLines = false,
): void {
  const first = Math.max(range.startLineNumber, within.start);
  const last = Math.min(range.endLineNumber, within.end - 1);
  for (let line = first; line <= last; line++) {
    const text = lines[line - 1] ?? '';
    let from = line === range.startLineNumber ? range.startColumn - 1 : 0;
    let to = Math.min(
      line === range.endLineNumber ? range.endColumn - 1 : text.length,
      text.length,
    );
    if (to <= from) continue;
    // Between two ASCII characters is always an edge between characters people see.
    const ascii = (at: number): boolean =>
      at <= 0 ||
      at >= text.length ||
      (text.charCodeAt(at - 1) < 0x80 && text.charCodeAt(at) < 0x80);
    if (!ascii(from) || !ascii(to)) {
      const lineEdges = edges(line, text);
      if (lineEdges) {
        from = lineEdges[partitionPoint(lineEdges, (edge) => edge <= from) - 1] ?? from;
        to = lineEdges[partitionPoint(lineEdges, (edge) => edge < to)] ?? to;
      }
    }
    if (wholeLines || from > 0 || to < text.length) out.push({ line, from, to });
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The edges between the characters people see in each line, worked out once a line, so a word
 * range never splits a surrogate pair, a letter from its accent, or an emoji sequence.
 */
class Graphemes {
  readonly #lines = { old: new Map<number, Int32Array>(), new: new Map<number, Int32Array>() };

  /** A lookup of one side's lines' edges, by line number. */
  of(side: 'old' | 'new'): (line: number, text: string) => Int32Array {
    const cache = this.#lines[side];
    return (line, text) => {
      let edges = cache.get(line);
      if (!edges) {
        const found = [];
        for (const { index } of segmenter.segment(text)) found.push(index);
        found.push(text.length);
        edges = Int32Array.from(found);
        cache.set(line, edges);
      }
      return edges;
    };
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
function partitionPoint<T>(items: ArrayLike<T>, before: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(items[middle]!)) low = middle + 1;
    else high = middle;
  }
  return low;
}
