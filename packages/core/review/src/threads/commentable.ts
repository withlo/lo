/**
 * Which lines GitHub takes a comment on (`docs/design.md`, "Comments").
 *
 * GitHub takes a line comment only on a line of the pull request's diff: a line of one of a file's
 * hunks, on the side it's on. A removed line takes one on the left, the base's side, and an added
 * line on the right. An unchanged line is on both sides; Lo puts its comments on the right, as
 * GitHub's docs advise, so they show between revisions and can suggest a change. Each end of a
 * range must be a line of the diff, but the two may be in different hunks, and a range may start
 * on the other side, as a range from a removed line to the added line that replaces it does.
 * Anywhere else, the UI offers a file-level comment.
 *
 * Checked against GitHub: its API refuses a line outside the hunks. REST answers "could not be
 * resolved", `addPullRequestReview` "Line could not be resolved", and `addPullRequestReviewThread`
 * returns a null thread with no error. GitHub's newer Files changed page also takes comments on
 * unchanged lines outside the hunks of a changed file, but its API doesn't, so Lo keeps to the
 * hunks.
 */

import { Line, Lines } from '../threads.ts';
import type { Screen } from './place.ts';

/**
 * A line of a hunk, by its prefix in a unified diff: ` ` is `context`, unchanged and on both sides;
 * `-` is `removed`, on the left only; `+` is `added`, on the right only.
 */
export type HunkLine = 'context' | 'removed' | 'added';

/**
 * A hunk of a file's unified diff, as its patch gives it: changed lines and the unchanged lines
 * around them, as one `@@` header and the lines under it.
 */
export interface PatchHunk {
  readonly oldStart: number;
  readonly newStart: number;
  /** The position in the hunk of each of its left lines, from `oldStart` on. */
  readonly old: readonly number[];
  /** The position in the hunk of each of its right lines, from `newStart` on. */
  readonly new: readonly number[];
}

/** A unified diff {@link PatchHunk.parse} can't read. */
export class PatchError extends Error {
  override name = 'PatchError';
  /** The 1-based line of the patch where reading failed. */
  readonly line: number;
  /** What's wrong there. */
  readonly reason: string;

  constructor(line: number, reason: string) {
    super(`line ${line} of the patch: ${reason}`);
    this.line = line;
    this.reason = reason;
  }
}

const SECOND_FILE = "a second file's diff starts here, and a patch is one file's";

/** Making and reading {@link PatchHunk}s. */
export const PatchHunk = {
  /**
   * A hunk whose first left line is `oldStart` and first right line is `newStart`, as its header
   * says, with `lines` in order.
   */
  of: (oldStart: number, newStart: number, lines: Iterable<HunkLine>): PatchHunk => {
    const old: number[] = [];
    const added: number[] = [];
    for (const [at, line] of [...lines].entries()) {
      if (line !== 'added') old.push(at);
      if (line !== 'removed') added.push(at);
    }
    return { oldStart, newStart, old, new: added };
  },

  /**
   * The hunks of one file's unified diff: GitHub's `patch` for a changed file, or `git diff`'s
   * output for one file. Anything outside a hunk's counted lines, such as git's `diff --git`, `---`
   * and `+++` lines, is skipped, and so is `\ No newline at end of file`. A second file's header, a
   * second `diff` line or a second `---` and `+++` pair, is an error, since its hunks' lines are
   * another file's. Throws a {@link PatchError} for what it can't read.
   */
  parse: (patch: string): PatchHunk[] => {
    const lines = splitLines(patch);
    const hunks: PatchHunk[] = [];
    let diffHeader = false;
    let fileHeader = false;
    let at = 0;
    while (at < lines.length) {
      const text = lines[at]!;
      at += 1;
      const headerLine = at;
      if (text.startsWith('diff ')) {
        if (diffHeader || fileHeader || hunks.length > 0) {
          throw new PatchError(headerLine, SECOND_FILE);
        }
        diffHeader = true;
        continue;
      }
      if (text.startsWith('--- ') && lines[at]?.startsWith('+++ ')) {
        if (fileHeader || hunks.length > 0) throw new PatchError(headerLine, SECOND_FILE);
        fileHeader = true;
        continue;
      }
      if (!text.startsWith('@@')) continue;
      const counts = header(text);
      if (counts === undefined) {
        throw new PatchError(headerLine, "the hunk header isn't `@@ -start,count +start,count @@`");
      }
      const [oldStart, oldCount, newStart, newCount] = counts;
      let [oldLeft, newLeft] = [oldCount, newCount];
      const kinds: HunkLine[] = [];
      let lastLine = headerLine;
      while (oldLeft > 0 || newLeft > 0) {
        if (at >= lines.length) {
          // One unchanged line short: a last blank line whose space was trimmed, in a patch
          // without a last newline.
          if (oldLeft === 1 && newLeft === 1) {
            kinds.push('context');
            break;
          }
          throw new PatchError(lastLine, 'the patch ends inside a hunk');
        }
        const line = lines[at]!;
        at += 1;
        lastLine = at;
        const kind = hunkLine(line);
        if (kind === 'skipped') continue;
        if (kind === undefined) {
          throw new PatchError(
            lastLine,
            'a hunk line starts with something other than ` `, `-`, `+` or `\\`',
          );
        }
        oldLeft -= kind === 'added' ? 0 : 1;
        newLeft -= kind === 'removed' ? 0 : 1;
        if (oldLeft < 0 || newLeft < 0) {
          throw new PatchError(lastLine, 'the hunk has more lines than its header says');
        }
        kinds.push(kind);
      }
      hunks.push(PatchHunk.of(oldStart, newStart, kinds));
    }
    return hunks;
  },
};

/** `text`'s lines, without their endings: a last line ending ends the last line. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * What a line inside a hunk is, by its first character: `skipped` for `\ No newline at end of
 * file`, and nothing for a line that isn't a hunk's. Some tools trim the space before an unchanged
 * blank line, so an empty line is unchanged.
 */
function hunkLine(line: string): HunkLine | 'skipped' | undefined {
  switch (line[0]) {
    case undefined:
    case ' ':
      return 'context';
    case '-':
      return 'removed';
    case '+':
      return 'added';
    case '\\':
      return 'skipped';
    default:
      return undefined;
  }
}

/**
 * A hunk header's left and right ranges, each a start and a count: `@@ -10,5 +12,7 @@` is
 * `[10, 5, 12, 7]`. A missing count is 1.
 */
function header(text: string): [number, number, number, number] | undefined {
  if (!text.startsWith('@@ ')) return undefined;
  const [old, added, end] = text.slice(3).split(' ');
  if (end !== '@@' || !old?.startsWith('-') || !added?.startsWith('+')) return undefined;
  const left = range(old.slice(1));
  const right = range(added.slice(1));
  if (left === undefined || right === undefined) return undefined;
  return [...left, ...right];
}

/** A hunk header's `start,count`, or `start` for a count of 1. */
function range(text: string): [number, number] | undefined {
  const comma = text.indexOf(',');
  const start = count(comma < 0 ? text : text.slice(0, comma));
  const lines = comma < 0 ? 1 : count(text.slice(comma + 1));
  if (start === undefined || lines === undefined) return undefined;
  return [start, lines];
}

/** A count in a hunk header: digits only. */
function count(text: string): number | undefined {
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/** The position in `hunk` of `line`, if the hunk has it. */
function position(hunk: PatchHunk, line: Line): number | undefined {
  const [start, positions] =
    line.side === 'LEFT' ? [hunk.oldStart, hunk.old] : [hunk.newStart, hunk.new];
  const index = line.number - start;
  return index < 0 ? undefined : positions[index];
}

/**
 * The right side's number of the line at `at` in `hunk`, if it's on the right: an added or
 * unchanged line.
 */
function rightNumber(hunk: PatchHunk, at: number): number | undefined {
  const index = hunk.new.indexOf(at);
  return index < 0 ? undefined : hunk.newStart + index;
}

/**
 * Where a comment on a range of lines goes: on `lines`, or nowhere, since GitHub takes no comment
 * on `line`, one of its ends. That end is outside the diff's hunks, or in a column that doesn't
 * take comments.
 */
export type CommentRange = { kind: 'lines'; lines: Lines } | { kind: 'notCommentable'; line: Line };

/** Where a line that takes a comment is in the diff, and the line a comment on it goes on. */
interface Found {
  /** The index of its hunk, then its position there. */
  at: [number, number];
  line: Line;
}

/**
 * Which comments GitHub takes on one file on screen: line comments on some lines, only a
 * file-level comment, or none at all.
 *
 * - A file in the pull request's diff at the right column's revision takes line comments on the
 *   lines of its hunks, and a file-level comment.
 * - One whose hunks have no lines in a column that takes comments, such as a binary file, a pure
 *   rename, or a deleted file between revisions, takes only a file-level comment.
 * - One outside that diff, such as a file a later revision put back as it was, takes no comment at
 *   all, though a diff between revisions lists it.
 *
 * Comments go on the right column's revision, so the left column takes them only in a revision's
 * whole diff, where it shows the base. Between revisions it shows another revision, whose lines
 * GitHub's left side can't name.
 */
export class CommentableLines {
  /** The file's hunks, or nothing when it isn't in the pull request's diff. */
  readonly #hunks: readonly PatchHunk[] | undefined;
  readonly #left: boolean;

  private constructor(hunks: readonly PatchHunk[] | undefined, left: boolean) {
    this.#hunks = hunks;
    this.#left = left;
  }

  /**
   * The comments a file on `screen` takes, when it's in the pull request's diff at the right
   * column's revision.
   *
   * `hunks` are the file's hunks in that diff, in order: from the revision's base to its head,
   * with the three lines of context GitHub uses. They aren't the hunks of a diff between
   * revisions, nor the latest head's `patch` when an older revision is on screen. They come from
   * GitHub's `patch` for the file at the latest head. GitHub leaves `patch` out for binary files
   * and pure renames, which have no hunks, but also for some ordinary text files, apparently by
   * size. For those, and for older revisions, they come from the local copy with `git diff -U3`,
   * ignoring the user's git config (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`), whose
   * `diff.context`, `diff.interHunkContext` or `diff.algorithm` would make other hunks than
   * GitHub's.
   */
  static inDiff(screen: Screen, hunks: readonly PatchHunk[]): CommentableLines {
    return new CommentableLines(hunks, screen.left.kind === 'base');
  }

  /**
   * A file that isn't in the pull request's diff at the right column's revision, which takes no
   * comment: GitHub refuses even a file-level one there.
   */
  static notInDiff(): CommentableLines {
    return new CommentableLines(undefined, false);
  }

  /** Whether the file takes a file-level comment: it's in the pull request's diff. */
  takesFileComment(): boolean {
    return this.#hunks !== undefined;
  }

  /**
   * Whether any line of the file takes a comment. When none does, it takes only a file-level
   * comment, if {@link CommentableLines.takesFileComment}.
   */
  takesLineComment(): boolean {
    return (this.#hunks ?? []).some(
      (hunk) => hunk.new.length > 0 || (this.#left && hunk.old.length > 0),
    );
  }

  /**
   * The lines a comment on `line` goes on, or nothing when GitHub won't take one there, so the UI
   * offers a file-level comment. `line`'s side is its column on screen, which is GitHub's side
   * wherever a comment can go, except for an unchanged line picked in the left column: that goes
   * on the right, the side GitHub's docs give unchanged lines, so it still shows between revisions
   * and can suggest a change.
   */
  line(line: Line): Lines | undefined {
    const found = this.#find(line);
    return found && Lines.one(found.line);
  }

  /**
   * Where a comment on a selection from `from` to `to` goes, in either order: from the one higher
   * in the diff to the other. Both ends must take a comment, but they may be in different hunks,
   * and the lines between them needn't. An unchanged end goes on the right, as in
   * {@link CommentableLines.line}.
   */
  range(from: Line, to: Line): CommentRange {
    const start = this.#find(from);
    if (!start) return { kind: 'notCommentable', line: from };
    const end = this.#find(to);
    if (!end) return { kind: 'notCommentable', line: to };
    const order = start.at[0] - end.at[0] || start.at[1] - end.at[1];
    if (order === 0) return { kind: 'lines', lines: Lines.one(end.line) };
    const lines = order < 0 ? Lines.range(start.line, end.line) : Lines.range(end.line, start.line);
    return { kind: 'lines', lines };
  }

  /**
   * Where `line` is in the diff, if it takes a comment, and the line a comment on it goes on.
   */
  #find(line: Line): Found | undefined {
    if (line.side === 'LEFT' && !this.#left) return undefined;
    for (const [index, hunk] of (this.#hunks ?? []).entries()) {
      const at = position(hunk, line);
      if (at === undefined) continue;
      const right = line.side === 'LEFT' ? rightNumber(hunk, at) : undefined;
      return { at: [index, at], line: right === undefined ? line : Line.right(right) };
    }
    return undefined;
  }
}
