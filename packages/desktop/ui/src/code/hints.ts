// Hints inside lines, as a language server's types of names and names of parameters: what a code
// view keeps of the `hint` marks it's given, by file and side, line first, and their decorations
// on the lines an editor draws. A hint is drawn before the code at its column, which comes after
// it.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

import type { Mark } from './api.ts';
import { HintWidget } from './widgets.ts';

/** A hint on a line of one side of a file. */
export interface HintAt {
  line: number;
  /** From 0; none for the line's end. */
  column: number | undefined;
  label: string;
  before: boolean;
  after: boolean;
}

/** A file's hints, on each side, in the order of their lines and columns. */
export interface FileHints {
  old: HintAt[];
  new: HintAt[];
}

/** The hints among `marks`, by the caller's id for their files, in order. */
export function hintsOf(marks: readonly Mark[]): Map<string, FileHints> {
  const byFile = new Map<string, FileHints>();
  for (const mark of marks) {
    if (mark.kind !== 'hint' || mark.at.line < 1) continue;
    let hints = byFile.get(mark.at.file);
    if (!hints) {
      hints = { old: [], new: [] };
      byFile.set(mark.at.file, hints);
    }
    hints[mark.at.side].push({
      line: mark.at.line,
      column: mark.at.column,
      label: mark.label,
      before: mark.padding?.before === true,
      after: mark.padding?.after === true,
    });
  }
  for (const hints of byFile.values()) {
    for (const side of ['old', 'new'] as const) hints[side].sort(inOrder);
  }
  return byFile;
}

/** Hints by line, and by column on a line, a line's end last. */
function inOrder(a: HintAt, b: HintAt): number {
  const end = Number.MAX_SAFE_INTEGER;
  return a.line - b.line || (a.column ?? end) - (b.column ?? end);
}

/** Whether two sets of files' hints draw the same. */
export function sameHints<K>(a: ReadonlyMap<K, FileHints>, b: ReadonlyMap<K, FileHints>): boolean {
  if (a.size !== b.size) return false;
  for (const [file, hints] of a) {
    const other = b.get(file);
    if (!other) return false;
    if (!sameHintList(hints.old, other.old) || !sameHintList(hints.new, other.new)) return false;
  }
  return true;
}

/** Whether two lists of hints draw the same. */
export function sameHintList(a: readonly HintAt[], b: readonly HintAt[]): boolean {
  return a.length === b.length && a.every((hint, index) => sameHint(hint, b[index]!));
}

function sameHint(a: HintAt, b: HintAt): boolean {
  return (
    a.line === b.line &&
    a.column === b.column &&
    a.label === b.label &&
    a.before === b.before &&
    a.after === b.after
  );
}

/** Where column `column` of line `line` of `doc` is, or the line's end. */
export function columnAt(doc: Text, line: number, column: number | undefined): number {
  const { from, length } = doc.line(line);
  return from + Math.min(Math.max(0, column ?? length), length);
}

/**
 * The decorations of `hints` on their lines `first` to `last`, each where `at` puts its line and
 * column: before what's there, so a cursor there is drawn after it, on the code.
 */
export function hintRanges(
  hints: readonly HintAt[] | undefined,
  first: number,
  last: number,
  at: (line: number, column: number | undefined) => number,
): Range<Decoration>[] {
  if (!hints || hints.length === 0) return [];
  // The first hint on `first` or after it: hints are in order.
  let low = 0;
  let high = hints.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (hints[middle]!.line < first) low = middle + 1;
    else high = middle;
  }
  const out: Range<Decoration>[] = [];
  for (let index = low; index < hints.length; index++) {
    const hint = hints[index]!;
    if (hint.line > last) break;
    const widget = new HintWidget(hint.label, hint.before, hint.after);
    out.push(Decoration.widget({ widget, side: -1 }).range(at(hint.line, hint.column)));
  }
  return out;
}
