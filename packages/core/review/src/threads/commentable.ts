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

import type { Hunk } from '@lo/github';

import { type DiffSide, Line, Lines } from '../threads.ts';
import type { Screen } from './place.ts';

/** A hunk as comments find their lines in it. */
interface Placed {
  /** The number of the hunk's first left line, and of its first right line. */
  readonly oldStart: number;
  readonly newStart: number;
  /** The position in the hunk of each of its left lines, from `oldStart` on. */
  readonly old: readonly number[];
  /** The position in the hunk of each of its right lines, from `newStart` on. */
  readonly new: readonly number[];
  /** Each of its rows, by position: its line's number on each side it's on. */
  readonly rows: readonly Row[];
}

/**
 * A row of a hunk: a removed line's left number, an added line's right one, or an unchanged line's
 * two.
 */
interface Row {
  readonly left: number | undefined;
  readonly right: number | undefined;
}

function placed(hunk: Hunk): Placed {
  const old: number[] = [];
  const added: number[] = [];
  const rows: Row[] = [];
  const oldStart = hunk.old.start + 1;
  const newStart = hunk.new.start + 1;
  for (const [at, line] of hunk.lines.entries()) {
    rows.push({
      left: line.kind === 'added' ? undefined : oldStart + old.length,
      right: line.kind === 'deleted' ? undefined : newStart + added.length,
    });
    if (line.kind !== 'added') old.push(at);
    if (line.kind !== 'deleted') added.push(at);
  }
  return { oldStart, newStart, old, new: added, rows };
}

/** The position in `hunk` of `line`, if the hunk has it. */
function position(hunk: Placed, line: Line): number | undefined {
  const [start, positions] =
    line.side === 'LEFT' ? [hunk.oldStart, hunk.old] : [hunk.newStart, hunk.new];
  const index = line.number - start;
  return index < 0 ? undefined : positions[index];
}

/**
 * The right side's number of the line at `at` in `hunk`, if it's on the right: an added or
 * unchanged line.
 */
function rightNumber(hunk: Placed, at: number): number | undefined {
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
  readonly #hunks: readonly Placed[] | undefined;
  readonly #left: boolean;

  private constructor(hunks: readonly Hunk[] | undefined, left: boolean) {
    this.#hunks = hunks?.map(placed);
    this.#left = left;
  }

  /**
   * The comments a file on `screen` takes, when it's in the pull request's diff at the right
   * column's revision.
   *
   * `hunks` are the file's hunks in that diff, in order, as `@lo/github`'s `parsePatch` reads
   * them: from the revision's base to its head, with the three lines of context GitHub uses. They aren't the hunks of a diff between
   * revisions, nor the latest head's `patch` when an older revision is on screen. They come from
   * GitHub's `patch` for the file at the latest head. GitHub leaves `patch` out for binary files
   * and pure renames, which have no hunks, but also for some ordinary text files, apparently by
   * size. For those, and for older revisions, they come from the local copy with `git diff -U3`,
   * ignoring the user's git config (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`), whose
   * `diff.context`, `diff.interHunkContext` or `diff.algorithm` would make other hunks than
   * GitHub's.
   */
  static inDiff(screen: Screen, hunks: readonly Hunk[]): CommentableLines {
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
   * `lines` with one end moved to the next line that way that takes a comment, as a new comment's
   * lines change while its box is open: its `'first'` end or its `'last'`, up the file (-1) or down
   * it (1), in its hunk or across the lines between hunks. A range keeps to a side both its ends are
   * on, as one picked in a column does, so the other side's rows between them aren't in it; one
   * from a removed line to an added one takes the diff's next row, on either side. An end never
   * passes the other: where it reaches it, the range is that one line. Nothing where no line that
   * way takes a comment, or where an end of `lines` doesn't.
   */
  moveEnd(lines: Lines, end: 'first' | 'last', way: 1 | -1): Lines | undefined {
    const first = Lines.first(lines);
    const start = this.#find(first);
    const last = this.#find(lines.end);
    if (!start || !last) return undefined;
    const both = (on: 'left' | 'right') =>
      this.#row(start.at)[on] !== undefined && this.#row(last.at)[on] !== undefined;
    const side =
      first.side === lines.end.side
        ? first.side
        : both('left')
          ? 'LEFT'
          : both('right')
            ? 'RIGHT'
            : undefined;
    const [moving, other] = end === 'first' ? [start, last] : [last, start];
    let at: readonly [number, number] | undefined = moving.at;
    for (;;) {
      at = this.#step(at, way);
      if (!at) return undefined;
      if (at[0] === other.at[0] && at[1] === other.at[1]) return Lines.one(other.line);
      const line = this.#lineAt(at, side);
      if (!line) continue;
      const moved = end === 'first' ? this.range(line, lines.end) : this.range(first, line);
      return moved.kind === 'lines' ? moved.lines : undefined;
    }
  }

  /** The row at `at`, a hunk's index and a position in it. */
  #row([hunk, at]: readonly [number, number]): Row {
    return this.#hunks![hunk]!.rows[at]!;
  }

  /** The row past `at`, `way` down the diff or up it, across the lines between hunks. */
  #step([hunk, at]: readonly [number, number], way: 1 | -1): [number, number] | undefined {
    const hunks = this.#hunks ?? [];
    let index = hunk;
    let next = at + way;
    while (next < 0 || next >= hunks[index]!.rows.length) {
      index += way;
      const across = hunks[index];
      if (!across) return undefined;
      next = way === 1 ? 0 : across.rows.length - 1;
    }
    return [index, next];
  }

  /**
   * The line of the row at `at` that takes a comment, on `side` where it's given: an added or
   * unchanged line's on the right, a removed line's on the left. Nothing where the row isn't on
   * `side`, or its line is on a side that takes none.
   */
  #lineAt(at: readonly [number, number], side: DiffSide | undefined): Line | undefined {
    const { left, right } = this.#row(at);
    if (side !== 'LEFT' && right !== undefined) return Line.right(right);
    if (side !== 'RIGHT' && left !== undefined && this.#left) return Line.left(left);
    return undefined;
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
