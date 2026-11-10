/**
 * Where a thread shows in the diff on screen (`docs/design.md`, "Comments": "In the diff",
 * "Outdated threads").
 */

import { Line, Thread, type DiffSide, type Lines } from '../threads.ts';

/** What the left column of the diff on screen shows. */
export type Left =
  /**
   * The pull request's base, as of the right column's revision: that revision's whole diff,
   * GitHub's view of it.
   */
  | { kind: 'base' }
  /** Another revision, by head SHA, as it is: what changed between the two. */
  | { kind: 'revision'; head: string }
  /**
   * Another revision's changes, by its head SHA, replayed onto the right column's base
   * (`docs/design.md`, "Rebase-aware comparison"). Its lines are no commit's, so no thread shows on
   * them.
   */
  | { kind: 'replayed'; head: string };

/** The diff on screen, by what each column shows. Revisions are named by head SHA. */
export interface Screen {
  /** What the left column shows. */
  readonly left: Left;
  /** The revision the right column shows. */
  readonly right: string;
}

/** Making {@link Screen}s. */
export const Screen = {
  /** The whole diff of the revision with head `head`. */
  full: (head: string): Screen => ({ left: { kind: 'base' }, right: head }),

  /** What changed from revision `from` to revision `to`. */
  between: (from: string, to: string): Screen => ({
    left: { kind: 'revision', head: from },
    right: to,
  }),

  /** What changed from revision `from`, replayed onto `to`'s base, to revision `to`. */
  replayed: (from: string, to: string): Screen => ({
    left: { kind: 'replayed', head: from },
    right: to,
  }),
};

/** Where a thread shows in the diff on screen. */
export type Placement =
  /**
   * Under `lines.end`, covering the lines from `lines.start`. The sides here are the screen's
   * columns, not GitHub's: `LEFT` is the left column, whatever it shows.
   */
  | { kind: 'lines'; lines: Lines }
  /** On the file's header: a file-level thread. */
  | { kind: 'file' }
  /**
   * Only in the threads panel, labeled outdated: its lines changed after it was written, and the
   * revision it was written on isn't on screen.
   */
  | { kind: 'outdated' }
  /** Only in the threads panel: it's on revisions that aren't on screen. */
  | { kind: 'notOnScreen' };

const COLUMNS: readonly DiffSide[] = ['RIGHT', 'LEFT'];

/**
 * Where `thread` shows in the diff on `screen`.
 *
 * - A thread that isn't outdated shows under its current lines on {@link Thread.currentOn}, when a
 *   column shows that revision. That's usually the latest head, but not always: GitHub moves a
 *   thread to each new head only on the next push, so a thread written on an older revision after
 *   a newer one was pushed, or one read just before a push, is still on an older revision. GitHub
 *   says where a thread is on that one revision only, so on any other it shows only if it was
 *   written there.
 * - Any thread shows where it was written, when a column shows that revision. For an outdated
 *   thread that's the only place in the diff; elsewhere it's `outdated`.
 * - When both places are on screen, the right column wins, then the current lines: between r1 and
 *   r3, a thread written on r1 and unchanged since shows once, on r3's line.
 * - A line on GitHub's left side is on the base, so it shows only in a revision's whole diff. When
 *   only one end of a range is on screen, the thread shows under that line alone.
 * - A file-level thread shows on the file's header, unless it's outdated and the revision it was
 *   written on isn't on screen.
 *
 * It doesn't look at paths: the UI looks a file's threads up by the path a column shows. Between
 * revisions of a renamed file, a thread written on the older one under its old path shows in the
 * left column only if the UI looks threads up by the left file's path too. A thread written in
 * GitHub's view of a single commit is on a commit that isn't a revision's head, so it shows only in
 * the panel until GitHub moves it to a later head.
 */
export function place(thread: Thread, screen: Screen): Placement {
  const { writtenOn, currentOn } = thread;
  if (thread.subject === 'FILE') {
    const onScreen = writtenOn !== undefined && shows(screen, writtenOn);
    return !thread.outdated || onScreen ? { kind: 'file' } : { kind: 'outdated' };
  }
  const places: [Lines, string][] = [];
  const current = thread.outdated ? undefined : Thread.currentLines(thread);
  if (current && currentOn !== undefined) places.push([current, currentOn]);
  const written = Thread.writtenLines(thread);
  if (written && writtenOn !== undefined) places.push([written, writtenOn]);
  for (const column of COLUMNS) {
    for (const [lines, revision] of places) {
      const shown = linesOnScreen(screen, lines, revision, column);
      if (shown) return { kind: 'lines', lines: shown };
    }
  }
  return thread.outdated ? { kind: 'outdated' } : { kind: 'notOnScreen' };
}

/** Whether a column of `screen` shows the revision with head `revision`. */
function shows(screen: Screen, revision: string): boolean {
  return screen.right === revision || leftShows(screen, revision);
}

/** Whether the left column of `screen` shows the revision with head `revision`, as it is. */
function leftShows(screen: Screen, revision: string): boolean {
  return screen.left.kind === 'revision' && screen.left.head === revision;
}

/**
 * Where `lines` of `revision`'s diff are on `screen`, looking only at `column` for the revision
 * itself. Its base is in the left column of its whole diff.
 */
function linesOnScreen(
  screen: Screen,
  lines: Lines,
  revision: string,
  column: DiffSide,
): Lines | undefined {
  const onScreen = (line: Line): Line | undefined => {
    const side = columnShowing(screen, line.side, revision, column);
    return side && Line.of(side, line.number);
  };
  const start = lines.start && onScreen(lines.start);
  const end = onScreen(lines.end);
  if (end) return start ? { start, end } : { end };
  return start && { end: start };
}

/**
 * The column of `screen` that shows GitHub's `side` of `revision`'s diff, when `column` shows the
 * revision.
 */
function columnShowing(
  screen: Screen,
  side: DiffSide,
  revision: string,
  column: DiffSide,
): DiffSide | undefined {
  const shown = column === 'RIGHT' ? screen.right === revision : leftShows(screen, revision);
  if (side === 'RIGHT') return shown ? column : undefined;
  if (column === 'RIGHT') return shown && screen.left.kind === 'base' ? 'LEFT' : undefined;
  return undefined;
}
