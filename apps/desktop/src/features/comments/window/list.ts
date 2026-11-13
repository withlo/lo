// The threads panel's list, from a view's threads as main sent them: which threads each filter
// lists and how many, and a group for each file, in the left panel's order, each file's own threads
// first, then by line, every row saying who started the thread, where it is, its replies, its state
// and the opening of what was said.

import { panelShows, type PanelFilter } from '@lo/review';
import type { ThreadListGroup, ThreadListRow } from '@lo/ui';

import { avatarImage } from '../../../window/images.ts';
import type { ThreadRow } from '../contract.ts';
import { excerptOf } from './Card.tsx';
import { threadOf } from './placing.ts';

/** The panel's filters, in the order `f` steps through them. */
export const FILTERS: readonly PanelFilter[] = ['unresolved', 'all', 'yours'];

/** The filter after `filter`, round the end. */
export function nextFilter(filter: PanelFilter): PanelFilter {
  return FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length] ?? filter;
}

/**
 * How many of `rows` each filter lists, for the reader with login `viewer`: nothing is theirs
 * without one. Your pending threads count as unresolved.
 */
export function filterCounts(
  rows: readonly ThreadRow[],
  viewer: string | undefined,
): Readonly<Record<PanelFilter, number>> {
  const threads = rows.map(threadOf);
  const count = (filter: PanelFilter) =>
    viewer === undefined && filter === 'yours'
      ? 0
      : threads.filter((thread) => panelShows(filter, thread, viewer ?? '')).length;
  return { unresolved: count('unresolved'), all: count('all'), yours: count('yours') };
}

/** Lines `from` to `to`, as a row says them: `41`, or `39–41`. */
function lines(from: number | null, to: number): string {
  return from === null || from === to ? String(to) : `${from}–${to}`;
}

/**
 * Where a thread is, as its row says it: "On the file"; its side and line on the revision it's on,
 * "new 41" or "old 30"; or for an outdated one, the revision it was written on and its line there,
 * "r2 · line 22", as `label` names that revision.
 */
export function whereOf(row: ThreadRow, label: (head: string) => string | undefined): string {
  if (row.subject === 'FILE') return 'On the file';
  if (!row.outdated && row.line !== null) {
    return `${row.side === 'LEFT' ? 'old' : 'new'} ${lines(row.startLine, row.line)}`;
  }
  const line = row.originalLine ?? row.line;
  const at =
    line === null
      ? 'line ?'
      : `${row.originalStartLine !== null && row.originalStartLine !== line ? 'lines' : 'line'} ${lines(row.originalStartLine, line)}`;
  const revision = row.writtenOn === null ? undefined : label(row.writtenOn);
  return revision === undefined ? at : `${revision} · ${at}`;
}

/** The line a thread sorts by in its file's group: its own threads first, at line 0. */
function sortLine(row: ThreadRow): number {
  if (row.subject === 'FILE') return 0;
  return (row.outdated ? row.originalLine : (row.line ?? row.originalLine)) ?? 0;
}

/** A thread's row in the panel. */
export function rowOf(row: ThreadRow, label: (head: string) => string | undefined): ThreadListRow {
  const [first] = row.comments;
  const author = first?.author ?? null;
  return {
    key: row.id,
    // GitHub shows a deleted account as "ghost".
    author: author ?? 'ghost',
    image:
      author === null
        ? undefined
        : avatarImage({ login: author, type: first?.authorType ?? '' }, 20),
    where: whereOf(row, label),
    replies: Math.max(0, row.comments.length - 1),
    resolved: row.resolved,
    pending: first?.state === 'PENDING',
    outdated: row.outdated,
    excerpt: first === undefined ? '' : excerptOf(first.body),
  };
}

/** What the panel's list is made from. */
export interface ListOptions {
  readonly filter: PanelFilter;
  /** The reader's login, whose threads are theirs: none for nobody. */
  readonly viewer: string | undefined;
  /** The files, by path, in the order the left panel lists them. */
  readonly order: readonly string[];
  /** A revision's label, `r2`, by its head, if it's one of the pull request's. */
  readonly label: (head: string) => string | undefined;
}

/**
 * The groups `rows` make in the panel, filtered by `filter`: one for each file, in the left panel's
 * order, then the files it doesn't list, by path. In a group the file's own threads come first,
 * then the rest by line, the old side before the new on one line, and otherwise in GitHub's order.
 */
export function threadGroups(
  rows: readonly ThreadRow[],
  { filter, viewer, order, label }: ListOptions,
): ThreadListGroup[] {
  const listed =
    viewer === undefined && filter === 'yours'
      ? []
      : rows.filter((row) => panelShows(filter, threadOf(row), viewer ?? ''));
  const byPath = Map.groupBy(listed, (row) => row.path);
  const place = new Map(order.map((path, index) => [path, index]));
  const paths = [...byPath.keys()].toSorted((a, b) => {
    const at = place.get(a) ?? Infinity;
    const bt = place.get(b) ?? Infinity;
    if (at !== bt) return at - bt;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return paths.map((path) => ({
    key: path,
    label: path,
    file: true,
    rows: (byPath.get(path) ?? [])
      .toSorted(
        (a, b) => sortLine(a) - sortLine(b) || (a.side === b.side ? 0 : a.side === 'LEFT' ? -1 : 1),
      )
      .map((row) => rowOf(row, label)),
  }));
}

/** The keys of the rows `groups` list, in order: what `j` and `k` move through. */
export function rowKeys(groups: readonly ThreadListGroup[]): string[] {
  return groups.flatMap((group) => group.rows.map((row) => row.key));
}

/**
 * The row the keyboard is on among `keys`: `focused`, while it's listed, and otherwise the first
 * row, so a key always has a thread to act on.
 */
export function focusedIn(
  keys: readonly string[],
  focused: string | undefined,
): string | undefined {
  return focused !== undefined && keys.includes(focused) ? focused : keys[0];
}

/**
 * The row `step` rows on from `from` in `keys`, staying at the ends: from none, or a row no longer
 * listed, the first row.
 */
export function stepRow(
  keys: readonly string[],
  from: string | undefined,
  step: 1 | -1,
): string | undefined {
  const at = from === undefined ? -1 : keys.indexOf(from);
  if (at < 0) return keys[0];
  return keys[Math.min(Math.max(at + step, 0), keys.length - 1)];
}
