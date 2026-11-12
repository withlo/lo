// Putting a file's new lines in place of those an editor shows, changing as little as it can so
// what's on screen keeps its place.

import type { EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { ownChange } from './keys.ts';

/**
 * Puts lines `after` in place of `before`, after document line `header` of `view`, as
 * {@link swapping} says.
 */
export function swapLines(
  view: EditorView,
  header: number,
  before: readonly string[],
  after: readonly string[],
  inPlace: boolean,
): void {
  for (const transaction of swapping(view.state, header, before, after, inPlace)) {
    view.dispatch(transaction);
  }
}

/**
 * The transactions that put lines `after` in place of `before`, after document line `header` of
 * `state`, one after another, or none when nothing changes. `inPlace`, as `fitsInPlace` says,
 * changes only the lines that differ, and adds or removes lines at the end, so a cursor or a
 * scroll anchor on a line that stays keeps its place. Otherwise every line is replaced, and a
 * cursor on one goes to the nearest new line with the same text, at its column, or to the same
 * line if none has it.
 */
export function swapping(
  state: EditorState,
  header: number,
  before: readonly string[],
  after: readonly string[],
  inPlace: boolean,
): Transaction[] {
  const { doc, selection } = state;
  const from = doc.line(header).to;
  const changes: { from: number; to?: number; insert?: string }[] = [];
  if (!inPlace) {
    const to = doc.line(header + before.length).to;
    const head = selection.main.head;
    const on = head > from && head <= to ? doc.lineAt(head) : undefined;
    if (from === to && after.length === 0) return [];
    const swapped = state.update({
      changes: { from, to, insert: after.length === 0 ? '' : `\n${after.join('\n')}` },
      annotations: ownChange.of(true),
    });
    if (!on) return [swapped];
    const index = on.number - header - 1;
    const line = swapped.newDoc.line(header + 1 + nearestLine(after, before[index]!, index));
    const anchor = line.from + Math.min(head - on.from, line.length);
    return [swapped, swapped.state.update({ selection: { anchor } })];
  }
  const common = Math.min(before.length, after.length);
  // Each run of lines that differ is one change, not one a line: a gap of placeholders filled is
  // thousands of lines, and as many changes would take the editor that much longer to map.
  let differing: number | undefined;
  for (let index = 0; index <= common; index++) {
    if (index < common && before[index] !== after[index]) {
      differing ??= index;
      continue;
    }
    if (differing === undefined) continue;
    changes.push({
      from: doc.line(header + 1 + differing).from,
      to: doc.line(header + index).to,
      insert: after.slice(differing, index).join('\n'),
    });
    differing = undefined;
  }
  const end = doc.line(header + common).to;
  if (after.length > common)
    changes.push({ from: end, insert: `\n${after.slice(common).join('\n')}` });
  if (before.length > common) changes.push({ from: end, to: doc.line(header + before.length).to });
  return changes.length > 0 ? [state.update({ changes, annotations: ownChange.of(true) })] : [];
}

/**
 * The index of the line of `lines` that reads `text` nearest to `index`, or of the line at `index`,
 * or the last, when none does. -1 for no lines: the header's.
 */
function nearestLine(lines: readonly string[], text: string, index: number): number {
  for (let distance = 0; index - distance >= 0 || index + distance < lines.length; distance++) {
    if (lines[index - distance] === text) return index - distance;
    if (lines[index + distance] === text) return index + distance;
  }
  return Math.min(index, lines.length - 1);
}
