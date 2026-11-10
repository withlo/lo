/**
 * Reading a file's patch from GitHub's list of a pull request's files: the hunks of its unified
 * diff, without the `diff --git`, `---` and `+++` lines.
 */

/** Rows of one side of a file, counted from 0: from `start` up to, but not including, `end`. */
export interface Rows {
  start: number;
  end: number;
}

/** A file's patch, read. */
export interface Patch {
  hunks: Hunk[];
  /**
   * Whether the base's version ends without a newline: GitHub's patch then follows the base's
   * last line with `\ No newline at end of file`.
   */
  oldMissingNewline: boolean;
  /** The same for the head's version. */
  newMissingNewline: boolean;
}

/** One hunk: a run of changed lines with the unchanged lines around them. */
export interface Hunk {
  /**
   * The rows the hunk covers in the base's version of the file: its unchanged and deleted lines.
   * When it has none, the empty range sits where its lines would go.
   */
  old: Rows;
  /** The same in the head's version: its unchanged and added lines. */
  new: Rows;
  /** The hunk's lines, in order. */
  lines: HunkLine[];
}

/**
 * One line of a hunk, without its `+`, `-` or ` ` and without its line ending: `unchanged` on both
 * sides, `deleted` only in the base, `added` only in the head.
 */
export interface HunkLine {
  kind: 'unchanged' | 'deleted' | 'added';
  text: string;
}

/** Whether the base has the line. */
export function lineInBase(line: HunkLine): boolean {
  return line.kind !== 'added';
}

/** Whether the head has the line. */
export function lineInHead(line: HunkLine): boolean {
  return line.kind !== 'deleted';
}

/** Why a patch couldn't be read. */
export class PatchError extends Error {
  override name = 'PatchError';
  /** The patch's line, from 1. */
  readonly line: number;
  readonly problem: string;

  constructor(line: number, problem: string) {
    super(`line ${line} of the patch: ${problem}`);
    this.line = line;
    this.problem = problem;
  }
}

/** Which side a hunk line was on, for `\ No newline at end of file`. */
type Side = 'old' | 'new' | 'both';

/**
 * Reads a patch: hunks that each start with a header such as `@@ -12,7 +12,8 @@ fn main()`. Lines
 * may end in `\r\n`, which reads as `\n`, as Lo's buffers have them. Throws a {@link PatchError}
 * when the patch doesn't add up.
 */
export function parsePatch(patch: string): Patch {
  const parsed: Patch = { hunks: [], oldMissingNewline: false, newMissingNewline: false };
  // The lines each side still expects in the current hunk.
  let oldLeft = 0;
  let newLeft = 0;
  // The side the previous line was on.
  let last: Side | undefined;
  const lines = patch.split('\n');
  for (const [index, raw] of lines.entries()) {
    const number = index + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft === 0 && newLeft === 0) {
      if (line.startsWith('@@ ')) {
        const header = parseHeader(line.slice('@@ '.length));
        if (typeof header === 'string') throw new PatchError(number, header);
        const [old, now] = header;
        const previous = parsed.hunks.at(-1);
        if (previous && (old.start < previous.old.end || now.start < previous.new.end)) {
          throw new PatchError(number, 'the hunk overlaps the one before it');
        }
        oldLeft = old.end - old.start;
        newLeft = now.end - now.start;
        parsed.hunks.push({ old, new: now, lines: [] });
        last = undefined;
        continue;
      }
      if (line.startsWith('\\')) {
        noNewline(parsed, last, number);
        continue;
      }
      // GitHub's patch has no newline after its last line.
      if (line === '' && index + 1 === lines.length) continue;
      throw new PatchError(
        number,
        parsed.hunks.length === 0
          ? `expected a hunk header, found ${quote(line)}`
          : `the hunk has more lines than its header says: ${quote(line)}`,
      );
    }
    const hunk = parsed.hunks.at(-1)!;
    // Some tools drop the space before an empty unchanged line.
    const kind = line === '' ? ' ' : line.charAt(0);
    if (kind === '\\') {
      noNewline(parsed, last, number);
      continue;
    }
    if (kind !== ' ' && kind !== '-' && kind !== '+') {
      throw new PatchError(number, `a hunk line starts with ${quote(line)}`);
    }
    const fits =
      kind === ' ' ? oldLeft > 0 && newLeft > 0 : kind === '-' ? oldLeft > 0 : newLeft > 0;
    if (!fits) throw new PatchError(number, 'the hunk has more lines than its header says');
    const text = line.slice(1);
    if (kind === ' ') {
      oldLeft--;
      newLeft--;
      hunk.lines.push({ kind: 'unchanged', text });
      last = 'both';
    } else if (kind === '-') {
      oldLeft--;
      hunk.lines.push({ kind: 'deleted', text });
      last = 'old';
    } else {
      newLeft--;
      hunk.lines.push({ kind: 'added', text });
      last = 'new';
    }
  }
  if (oldLeft !== 0 || newLeft !== 0) {
    // The last line, not the empty one after a final newline.
    const line = lines.length - (lines.length > 1 && patch.endsWith('\n') ? 1 : 0);
    throw new PatchError(
      line,
      `the patch ends ${oldLeft} lines of the base and ${newLeft} of the head short of its last hunk`,
    );
  }
  return parsed;
}

/** Notes `\ No newline at end of file` for the side of the line before it. */
function noNewline(patch: Patch, last: Side | undefined, line: number): void {
  if (last === undefined) {
    throw new PatchError(line, '`\\ No newline at end of file` follows no line');
  }
  if (last !== 'new') patch.oldMissingNewline = true;
  if (last !== 'old') patch.newMissingNewline = true;
}

/** Reads `-12,7 +12,8 @@ fn main()` into the rows each side covers, or says why it isn't a header. */
function parseHeader(header: string): [Rows, Rows] | string {
  const invalid = `${quote(`@@ ${header}`)} isn't a hunk header`;
  const end = header.indexOf(' @@');
  if (end < 0) return invalid;
  const ranges = header.slice(0, end);
  const space = ranges.indexOf(' ');
  if (space < 0) return invalid;
  const [old, now] = [ranges.slice(0, space), ranges.slice(space + 1)];
  if (!old.startsWith('-') || !now.startsWith('+')) return invalid;
  const oldRows = rows(old.slice(1));
  const newRows = rows(now.slice(1));
  return oldRows && newRows ? [oldRows, newRows] : invalid;
}

/**
 * The rows `start,count` covers. `start` counts lines from 1; with a count of 0 it's the line the
 * empty range follows, 0 at the start of the file. A missing count means 1.
 */
function rows(range: string): Rows | undefined {
  const comma = range.indexOf(',');
  const start = whole(comma < 0 ? range : range.slice(0, comma));
  const count = comma < 0 ? 1 : whole(range.slice(comma + 1));
  if (start === undefined || count === undefined) return undefined;
  if (count === 0) return { start, end: start };
  if (start === 0) return undefined;
  return { start: start - 1, end: start - 1 + count };
}

/** The whole number `text` spells, or nothing. */
function whole(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** `text` in quotes, with anything unprintable escaped, for a message. */
function quote(text: string): string {
  return JSON.stringify(text);
}
