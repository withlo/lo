// How what an overview points at, at the commit it describes, is at the head on screen: where each
// file is there, renames found, and where each of its lines went, from the file's diff between the
// two. Following a block goes to the line its first line maps to, markers in the diff go on the
// lines that still exist, and a block is flagged when lines it shows changed since. Plain
// functions, each tested alone.

import type { FileDiff } from '@lo/diff';

import type { DiffedText } from '../../diff/window/shared.ts';
import type { FileSinceText } from '../contract.ts';

/** Lines `[start, end)`, numbered from 1, as `@lo/diff` gives them. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A run of lines that changed: `old` at the overview's commit, replaced by `new` at the head. */
export interface LineChange {
  readonly old: Span;
  readonly new: Span;
}

/**
 * A file at the overview's commit, as it is at the head on screen:
 *
 * - `same`: the same, at `path`, another when it was renamed since;
 * - `changed`: at `path`, its lines changed as `changes` say, in order;
 * - `opaque`: it changed, at `path`, and its lines can't be compared, and why: one side isn't
 *   text, say;
 * - `deleted`: it's gone;
 * - `unknown`: Lo couldn't tell, and why.
 *
 * `pushed` says whether the pushes since changed the file, rather than only the base branch they
 * were rebased onto.
 */
export type FileSince =
  | { readonly kind: 'same'; readonly path: string }
  | {
      readonly kind: 'changed';
      readonly path: string;
      readonly pushed: boolean;
      readonly changes: readonly LineChange[];
    }
  | {
      readonly kind: 'opaque';
      readonly path: string;
      readonly pushed: boolean;
      readonly why: string;
    }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'unknown'; readonly why: string };

/** A file diffed, as `diffTexts` diffs it, highlighted or not, or why it couldn't be. */
type Diffed =
  Pick<Extract<DiffedText, { ok: true }>, 'ok' | 'diff'> | Extract<DiffedText, { ok: false }>;

/**
 * A file as main said it is at the head, `text`, with its texts' diff, `diffed`, when it changed:
 * only the runs of lines that changed are kept, never the texts.
 */
export function fileSinceOf(
  text: Exclude<FileSinceText, { kind: 'waiting' }>,
  diffed: Diffed | undefined,
): FileSince {
  switch (text.kind) {
    case 'same':
      return { kind: 'same', path: text.path };
    case 'deleted':
      return { kind: 'deleted' };
    case 'unread':
      return { kind: 'unknown', why: text.why };
    case 'changed': {
      const { path, pushed, texts } = text;
      if ('why' in texts) return { kind: 'opaque', path, pushed, why: texts.why };
      if (!diffed?.ok) {
        return {
          kind: 'opaque',
          path,
          pushed,
          why: diffed?.why ?? 'Lo couldn’t compare its lines.',
        };
      }
      return { kind: 'changed', path, pushed, changes: changesOf(diffed.diff) };
    }
    default:
      // From main: say Lo can't tell, rather than guess.
      text satisfies never;
      return { kind: 'unknown', why: 'Lo couldn’t tell how the file changed.' };
  }
}

/** The runs of lines `diff` changed, in order. */
export function changesOf(diff: FileDiff): LineChange[] {
  return diff.changes.map((change) => ({
    old: { start: change.old.start, end: change.old.end },
    new: { start: change.new.start, end: change.new.end },
  }));
}

/**
 * Where line `line` at the overview's commit is among `changes`: `kept`, at line `at` of the head,
 * or `changed`, within (or, for lines only added, just before) `change`.
 */
type Located =
  | { readonly kind: 'kept'; readonly at: number }
  | { readonly kind: 'changed'; readonly change: LineChange };

function locate(changes: readonly LineChange[], line: number): Located {
  // The last change that starts at or before the line, found by halves.
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((changes[middle]?.old.start ?? 0) <= line) low = middle + 1;
    else high = middle;
  }
  const before = changes[low - 1];
  if (before === undefined) return { kind: 'kept', at: line };
  if (line < before.old.end) return { kind: 'changed', change: before };
  return { kind: 'kept', at: before.new.end + (line - before.old.end) };
}

/**
 * Where lines `lines` at the overview's commit are at the head, as the diff's markers go: the
 * file's path there, and the runs of those lines still there, unchanged, in order. A line that
 * changed or went is in none, and lines added among them since split a run. Nothing for a file
 * that's gone, or whose lines Lo can't compare, or when it can't tell.
 */
export function runsOnHead(
  since: FileSince,
  lines: { readonly start: number; readonly end: number },
): { readonly path: string; readonly runs: readonly Run[] } | undefined {
  switch (since.kind) {
    case 'same':
      return { path: since.path, runs: [{ from: lines.start, to: lines.end }] };
    case 'changed': {
      const runs: Run[] = [];
      for (let line = lines.start; line <= lines.end; line++) {
        const at = lineOnHead(since, line);
        if (at === undefined) continue;
        const last = runs.at(-1);
        if (last && at === last.to + 1) runs[runs.length - 1] = { from: last.from, to: at };
        else runs.push({ from: at, to: at });
      }
      return { path: since.path, runs };
    }
    case 'opaque':
    case 'deleted':
    case 'unknown':
      return undefined;
    default:
      since satisfies never;
      return undefined;
  }
}

/** The line at the head that line `line` at the overview's commit is, unchanged; none when it changed or Lo can't tell. */
export function lineOnHead(since: FileSince, line: number): number | undefined {
  switch (since.kind) {
    case 'same':
      return line;
    case 'changed': {
      const found = locate(since.changes, line);
      return found.kind === 'kept' ? found.at : undefined;
    }
    case 'opaque':
    case 'deleted':
    case 'unknown':
      return undefined;
    default:
      since satisfies never;
      return undefined;
  }
}

/** Where a range of lines at the overview's commit is at the head: its file there, and its lines. */
export interface OnHead {
  readonly path: string;
  /** The first line, which following goes to, when the file's lines can be mapped. */
  readonly line: number | undefined;
  /** Every line, which the whole file marks, when they can be mapped. */
  readonly lines: { readonly from: number; readonly to: number } | undefined;
}

/**
 * Where lines `lines` of the file at `path` at the overview's commit are at the head, as `since`
 * says, or as written while it's not known (`undefined`) or Lo can't tell: a line that changed maps
 * to the start of what replaced it, so following still lands where it was. None for a file that's
 * gone.
 */
export function onHead(
  since: FileSince | undefined,
  path: string,
  lines: { readonly start: number; readonly end: number } | undefined,
): OnHead | undefined {
  const asWritten: OnHead = {
    path,
    line: lines?.start,
    lines: lines && { from: lines.start, to: lines.end },
  };
  if (since === undefined) return asWritten;
  switch (since.kind) {
    case 'same':
      return { ...asWritten, path: since.path };
    case 'changed': {
      if (!lines) return { path: since.path, line: undefined, lines: undefined };
      const from = firstOnHead(since.changes, lines.start);
      const to = Math.max(from, lastOnHead(since.changes, lines.end));
      return { path: since.path, line: from, lines: { from, to } };
    }
    case 'opaque':
      return { path: since.path, line: undefined, lines: undefined };
    case 'deleted':
      return undefined;
    case 'unknown':
      return asWritten;
    default:
      since satisfies never;
      return asWritten;
  }
}

/** The first line at the head of what line `line` at the commit is now, or what replaced it. */
function firstOnHead(changes: readonly LineChange[], line: number): number {
  const found = locate(changes, line);
  return found.kind === 'kept' ? found.at : Math.max(1, found.change.new.start);
}

/** The last line at the head of what line `line` at the commit is now, or what replaced it. */
function lastOnHead(changes: readonly LineChange[], line: number): number {
  const found = locate(changes, line);
  if (found.kind === 'kept') return found.at;
  const { new: now } = found.change;
  return Math.max(1, now.end > now.start ? now.end - 1 : now.start - 1);
}

/** Lines `from` to `to`, numbered from 1, both in. */
export interface Run {
  readonly from: number;
  readonly to: number;
}

/**
 * How lines a block shows, at the overview's commit, changed by the head:
 *
 * - `none`: they didn't, as far as Lo knows, or only the base branch the pushes were rebased onto
 *   changed them;
 * - `lines`: the runs of its lines that changed or were deleted, `changed`; and the lines after
 *   which lines were added inside it, `added`, with how many were added in all;
 * - `deleted`: its file is gone;
 * - `opaque`: its file changed in a way Lo can't compare line by line.
 */
export type BlockChange =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'lines';
      readonly changed: readonly Run[];
      readonly added: readonly number[];
      readonly addedLines: number;
    }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'opaque' };

const NONE: BlockChange = { kind: 'none' };

/** How lines `lines`, at the overview's commit, of a file that is as `since` says, changed. */
export function blockChange(
  since: FileSince,
  lines: { readonly start: number; readonly end: number },
): BlockChange {
  switch (since.kind) {
    case 'same':
    case 'unknown':
      return NONE;
    case 'deleted':
      return { kind: 'deleted' };
    case 'opaque':
      return since.pushed ? { kind: 'opaque' } : NONE;
    case 'changed':
      return since.pushed ? linesChanged(since.changes, lines) : NONE;
    default:
      since satisfies never;
      return NONE;
  }
}

function linesChanged(
  changes: readonly LineChange[],
  { start, end }: { readonly start: number; readonly end: number },
): BlockChange {
  const changed: Run[] = [];
  const added: number[] = [];
  let addedLines = 0;
  for (const change of changes) {
    const { old } = change;
    if (old.start > end) break;
    if (old.start === old.end) {
      // Lines only added, before line `old.start`: inside the block when lines of it are on both sides.
      if (old.start > start && old.start <= end) {
        added.push(old.start - 1);
        addedLines += change.new.end - change.new.start;
      }
      continue;
    }
    const from = Math.max(start, old.start);
    const to = Math.min(end, old.end - 1);
    if (from <= to) changed.push({ from, to });
  }
  if (changed.length === 0 && added.length === 0) return NONE;
  return { kind: 'lines', changed, added, addedLines };
}

/** Every line in `runs`, for the excerpt to mark. */
export function linesIn(runs: readonly Run[]): number[] {
  const lines: number[] = [];
  for (const { from, to } of runs) for (let line = from; line <= to; line++) lines.push(line);
  return lines;
}

/**
 * Why a comment on a code block's lines goes on their file at the head on screen: the lines
 * `changed` since the overview's commit, or another line came between them; they're on the
 * `older` side, which Lo doesn't map past the overview's commit, since the base under them may have
 * moved; or Lo can't tell where they are (`unknown`), as for a file it can't compare.
 */
export type FileWhy = 'changed' | 'older' | 'unknown';

/**
 * Where lines a comment on a code block is on, at the head on screen: on the same lines there, when
 * each is there unchanged, in one run (`lines`); on the file, when it's there but they can't be,
 * saying why (`file`); or not at all, the file at `path` gone (`gone`), as when the pull request
 * deletes it, which GitHub still takes a comment on.
 */
export type CommentOnHead =
  | {
      readonly kind: 'lines';
      readonly path: string;
      readonly side: 'old' | 'new';
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: 'file'; readonly path: string; readonly why: FileWhy }
  | { readonly kind: 'gone'; readonly path: string };

/**
 * Where lines `from` to `to` on `side` of the file at `path`, at the overview's commit, are for a
 * comment at the head on screen, as `since` says: `same` where the overview describes that head.
 * Lines on the older side stay only where the head is the overview's commit, since the base under
 * them may have moved.
 */
export function commentOnHead(
  since: FileSince | 'same',
  path: string,
  lines: { readonly side: 'old' | 'new'; readonly from: number; readonly to: number },
): CommentOnHead {
  const from = Math.min(lines.from, lines.to);
  const to = Math.max(lines.from, lines.to);
  if (since === 'same') return { kind: 'lines', path, side: lines.side, from, to };
  switch (since.kind) {
    case 'deleted':
      return { kind: 'gone', path };
    case 'unknown':
      return { kind: 'file', path, why: 'unknown' };
    case 'opaque':
      return { kind: 'file', path: since.path, why: 'unknown' };
    case 'same':
    case 'changed': {
      if (lines.side === 'old') return { kind: 'file', path: since.path, why: 'older' };
      const first = lineOnHead(since, from);
      const last = lineOnHead(since, to);
      // Each line there, unchanged, with nothing added between them.
      const kept =
        first !== undefined &&
        last !== undefined &&
        last - first === to - from &&
        Array.from({ length: to - from + 1 }, (_, at) => lineOnHead(since, from + at)).every(
          (line, at) => line === first + at,
        );
      return kept
        ? { kind: 'lines', path: since.path, side: 'new', from: first, to: last }
        : { kind: 'file', path: since.path, why: 'changed' };
    }
    default:
      since satisfies never;
      return { kind: 'file', path, why: 'unknown' };
  }
}
