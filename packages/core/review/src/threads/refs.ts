import type { Line } from '../threads.ts';

/**
 * A line reference, as data: what a comment or thread is on. Whatever names lines to the reader
 * holds one, and {@link lineRefText} is the only place it's put into words.
 *
 * - `lines`: the lines, each with its side, a span from `start` to `end`; `null` for the file
 *   itself; `undefined` where GitHub no longer gives a line.
 * - `revision`: the revision the lines are on, as its label names it, `r2`, where that isn't the
 *   revision on screen.
 */
export interface LineRef {
  readonly lines:
    { readonly start?: Line | null | undefined; readonly end: Line } | null | undefined;
  readonly revision?: string | undefined;
}

/** A line as a line reference names it: the old side's is "removed", and the new side goes unsaid. */
function lineWords(line: Line): string {
  return line.side === 'RIGHT' ? `${line.number}` : `${line.number}, removed`;
}

/** Whether a span starts on a line of its own: on more than one line. */
function spans({ start, end }: NonNullable<LineRef['lines']>): boolean {
  return (
    start !== null &&
    start !== undefined &&
    (start.side !== end.side || start.number !== end.number)
  );
}

function linesText(lines: NonNullable<LineRef['lines']> | null): string {
  if (!lines) return 'File';
  const { start, end } = lines;
  if (!start || !spans(lines)) return `Line ${lineWords(end)}`;
  if (start.side === end.side) return `Lines ${start.number}–${lineWords(end)}`;
  return `Line ${lineWords(start)}, to line ${lineWords(end)}`;
}

/**
 * A line reference in words, the one form a line is named in everywhere: "Line 41", "Lines 39–41",
 * "Line 41, removed", "Line 3, removed, to line 5", "File"; with the revision last where it's
 * given, "Line 9 · r1"; and the revision alone, "r1", where there's no line to name. With `after`,
 * it follows other words on its line, as a file's name, and starts in lower case: "backoff.ts ·
 * line 2".
 */
export function lineRefText({ lines, revision }: LineRef, after = false): string {
  const named = lines === undefined ? undefined : linesText(lines);
  if (named === undefined) return revision ?? '';
  const on = after ? named.charAt(0).toLowerCase() + named.slice(1) : named;
  return revision === undefined ? on : `${on} · ${revision}`;
}

/**
 * Whether a line reference is to more than one line, "Lines 39–41" or "Line 3, removed, to line
 * 5", rather than one line, the file, or no line: what's under its last line says its lines then.
 */
export function onLines({ lines }: LineRef): boolean {
  return lines !== null && lines !== undefined && spans(lines);
}
