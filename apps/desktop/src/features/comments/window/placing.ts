// Where a view's review threads go in its diff as drawn: under a line of either column, on a
// file's header, or nowhere in the diff, as `@lo/review`'s `place` says for what each column shows.
// A file's threads are looked up by the path each column shows it at. GitHub names a renamed file
// by its new path on both sides, so a thread under one of its old lines is found by that path too.
// Unresolved threads start open and resolved ones collapsed. What each file's threads on screen
// hold is counted for its header and its row in the tree.

import { place, Screen, Thread, type ThreadComment } from '@lo/review';
import type { ThreadView } from '@lo/ui/code';

import type {
  DiffThreads,
  DrawnDiff,
  ThreadCounts,
  ThreadedFile,
} from '../../diff/window/shared.ts';
import type { FileThreads } from '../../tree/window/shared.ts';
import type { Compared, ThreadRow } from '../contract.ts';

/** A view's threads placed in its diff, with what each file's hold, by its name and by its key. */
export interface Placed extends DiffThreads {
  /** What each file's threads hold, by the tree's key for the file. */
  readonly byKey: ReadonlyMap<string, FileThreads>;
}

/** A thread as `@lo/review` reads it, from what main sent. */
export function threadOf(row: ThreadRow): Thread {
  return {
    id: row.id,
    path: row.path,
    subject: row.subject,
    side: row.side,
    startSide: row.startSide ?? undefined,
    line: row.line ?? undefined,
    startLine: row.startLine ?? undefined,
    originalLine: row.originalLine ?? undefined,
    originalStartLine: row.originalStartLine ?? undefined,
    outdated: row.outdated,
    resolved: row.resolved,
    currentOn: row.currentOn ?? undefined,
    writtenOn: row.writtenOn ?? undefined,
    comments: row.comments.map((comment): ThreadComment => ({
      id: comment.id,
      author: comment.author ?? undefined,
      body: comment.body,
      state: comment.state,
      createdAt: comment.createdAt,
      url: comment.url,
      hidden: comment.hidden ?? undefined,
      viewerCanUpdate: comment.viewerCanUpdate,
      viewerCanDelete: comment.viewerCanDelete,
    })),
    viewerCanReply: row.viewerCanReply,
    viewerCanResolve: row.viewerCanResolve,
    viewerCanUnresolve: row.viewerCanUnresolve,
  };
}

/**
 * What the columns of a diff as drawn show: the head on screen on the right, and on the left the
 * pull request's base, or the older of two revisions compared, as main said it compares them. Where
 * the left column's lines are no commit's a thread is written on, no thread shows there: two
 * revisions replayed onto one base, a stack's layer compared with the layer below it, and a
 * comparison main hasn't said yet.
 */
export function screenOf(drawn: DrawnDiff, compared: Compared | null): Screen {
  const { at, comparison, compareFrom } = drawn;
  if (comparison === null) {
    return compareFrom === null ? Screen.full(at) : Screen.replayed(compareFrom, at);
  }
  if (compared?.key !== comparison) return Screen.replayed(comparison, at);
  return compared.replayed ? Screen.replayed(compared.from, at) : Screen.between(compared.from, at);
}

/** A number that changes whenever `text` does: its FNV-1a hash. */
export function versionOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * `rows`, the view's threads, placed in its diff as `drawn` shows it, the left column as
 * {@link screenOf} says. A file that shows from a revision of its own has none in its left column.
 */
export function placeThreads(
  rows: readonly ThreadRow[],
  drawn: DrawnDiff,
  compared: Compared | null,
): Placed {
  const screen = screenOf(drawn, compared);
  const sinceScreen = Screen.replayed(drawn.at, drawn.at);
  const right = new Map<string, ThreadedFile>();
  const left = new Map<string, ThreadedFile>();
  for (const file of drawn.files) {
    if (file.path !== null && !right.has(file.path)) right.set(file.path, file);
    if (file.old !== null && !left.has(file.old)) left.set(file.old, file);
  }
  const threads: ThreadView[] = [];
  const counts = new Map<string, ThreadCounts>();
  const byKey = new Map<string, FileThreads>();
  const count = (file: ThreadedFile, thread: Thread) => {
    const was = counts.get(file.id) ?? { threads: 0, unresolved: 0, comments: 0 };
    const now = {
      threads: was.threads + 1,
      unresolved: was.unresolved + (thread.resolved ? 0 : 1),
      comments: was.comments + thread.comments.length,
    };
    counts.set(file.id, now);
    byKey.set(file.key, { total: now.threads, unresolved: now.unresolved });
  };
  for (const row of rows) {
    const thread = threadOf(row);
    const files = [right.get(thread.path), left.get(thread.path)].filter(
      (file, index, all): file is ThreadedFile => file !== undefined && all.indexOf(file) === index,
    );
    for (const file of files) {
      const placement = place(thread, file.since ? sinceScreen : screen);
      if (placement.kind === 'file') {
        count(file, thread);
        break;
      }
      if (placement.kind !== 'lines') break;
      const { end } = placement.lines;
      // The column it's in shows this file at another path: the next file tries it. GitHub names
      // a renamed file by its new path for a thread under one of its old lines too.
      const shown =
        end.side === 'RIGHT'
          ? file.path === thread.path
          : file.old === thread.path || file.path === thread.path;
      if (!shown) continue;
      threads.push({
        id: thread.id,
        at: { file: file.id, side: end.side === 'RIGHT' ? 'new' : 'old', line: end.number },
        open: Thread.startsOpen(thread),
        version: versionOf(JSON.stringify(row)),
      });
      count(file, thread);
      break;
    }
  }
  return { threads, counts, byKey };
}
