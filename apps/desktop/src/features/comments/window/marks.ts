// What a thread is on, as a line reference, and what its mark in a code view's lane says of it:
// whether it's resolved, holds comments not yet sent, or is out of date, where its range starts,
// and its lines in words, for the mark's name.

import { type LineRef, lineRefText, type Lines } from '@lo/review';
import type { ThreadMark } from '@lo/ui/code';

import type { CommentLinesRow, ThreadRow } from '../contract.ts';

/** A revision's label, `r2`, by its head, if it's one of the view's revisions. */
export type RevisionLabel = (head: string) => string | undefined;

/** Thread `row`'s lines `from` to `to`, each with its side, as a line reference holds them. */
function span(row: ThreadRow, from: number | null, to: number): CommentLinesRow {
  return {
    start: from === null ? null : { side: row.startSide ?? row.side, number: from },
    end: { side: row.side, number: to },
  };
}

/**
 * What a thread is on, as a line reference: its file; its lines and their side on the revision
 * it's on; or for an outdated one, its lines on the revision it was written on, as `label` names
 * that revision, with no lines where GitHub no longer gives them.
 */
export function refOf(row: ThreadRow, label: RevisionLabel): LineRef {
  if (row.subject === 'FILE') return { lines: null };
  if (!row.outdated && row.line !== null) {
    return { lines: span(row, row.startLine, row.line) };
  }
  const line = row.originalLine ?? row.line;
  return {
    lines: line === null ? undefined : span(row, row.originalStartLine, line),
    revision: row.writtenOn === null ? undefined : label(row.writtenOn),
  };
}

/**
 * The mark of thread `row`, placed on `lines` as drawn, or on its file where they're `null`: its
 * state, where its range starts where that isn't the line it's under, and its lines in words, as
 * `label` names a revision.
 */
export function markOf(row: ThreadRow, lines: Lines | null, label: RevisionLabel): ThreadMark {
  const ref = refOf(row, label);
  const pending = row.comments.filter((comment) => comment.state === 'PENDING').length;
  const start = lines?.start;
  const end = lines?.end;
  const ranged =
    start !== undefined &&
    end !== undefined &&
    (start.side !== end.side || start.number !== end.number);
  const last = ref.lines ? { lines: { end: ref.lines.end }, revision: ref.revision } : ref;
  return {
    resolved: row.resolved,
    pending: pending === 0 ? undefined : pending === row.comments.length ? 'all' : 'some',
    outdated: row.outdated,
    from: ranged ? { side: start.side === 'RIGHT' ? 'new' : 'old', line: start.number } : undefined,
    words: { lines: lineRefText(ref, true), line: lineRefText(last, true) },
  };
}
