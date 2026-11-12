// The lines of a pull request's tab's diff that something else explains, such as the pull
// request's overview, which the diff marks: a ball on the first, a rail down the rest and a note
// under the last. The diff asks for them at the commit its newer side shows, each time it's drawn
// and each time they change, so marks are always on the lines it draws, and "Read it in the
// overview" in a note goes back to what explains them.

import type { Mark } from '@lo/ui/code';

/** Lines of a file the diff's newer side shows, and what explains them. */
export interface ExplainedLines {
  /** The file's path at the newer side's commit. */
  readonly path: string;
  /** The first and last line, from 1. */
  readonly from: number;
  readonly to: number;
  /** The explainer's id for what explains them, which "Read it in the overview" gives back. */
  readonly block: string;
  /** What the note says, as plain text, never HTML: a label, such as a section, and the words. */
  readonly note: { readonly label: string; readonly text: string };
}

/** What explains the lines of pull requests' diffs. */
export interface Explainer {
  /**
   * The lines explained in tab `tab`'s diff, whose newer side shows commit `at`: none for a commit
   * the explanation doesn't describe and can't place its lines on.
   */
  linesAt(tab: string, at: string): readonly ExplainedLines[];
  /** "Read it in the overview": shows what `block` names in tab `tab`. Says whether it could. */
  read(tab: string, block: string): boolean;
}

let current: Explainer | undefined;

/** Each drawn diff's listeners, by tab, which ask for its lines again. */
const listeners = new Map<string, Set<() => void>>();

/** Takes `given` as what explains the diffs' lines. Returns a function that lets it go. */
export function explainWith(given: Explainer): () => void {
  current = given;
  for (const tab of listeners.keys()) changed(tab);
  return () => {
    if (current !== given) return;
    current = undefined;
    for (const tab of listeners.keys()) changed(tab);
  };
}

/** What explains the diffs' lines now, if anything does. */
export function explainer(): Explainer | undefined {
  return current;
}

/** Says tab `tab`'s explained lines changed, so its diff, if it's drawn, asks for them again. */
export function changed(tab: string): void {
  for (const listener of listeners.get(tab) ?? []) listener();
}

/**
 * Calls `listener` each time tab `tab`'s explained lines change, as for a diff drawn. Returns a
 * function that stops it.
 */
export function onExplained(tab: string, listener: () => void): () => void {
  let each = listeners.get(tab);
  if (!each) {
    each = new Set();
    listeners.set(tab, each);
  }
  each.add(listener);
  return () => {
    const kept = listeners.get(tab);
    kept?.delete(listener);
    if (kept?.size === 0) listeners.delete(tab);
  };
}

/**
 * The marks for `lines` on a diff of `files`, on their newer side, by each file's whole path: none
 * on a file the diff doesn't have there, as one the pull request deletes.
 */
export function marksOf(
  lines: readonly ExplainedLines[],
  files: readonly { readonly id: string; readonly path: string; readonly change: string }[],
): Mark[] {
  const ids = new Map<string, string>();
  for (const file of files) if (file.change !== 'deleted') ids.set(file.path, file.id);
  return lines.flatMap(({ path, from, to, block, note }): Mark[] => {
    const file = ids.get(path);
    if (file === undefined) return [];
    return [{ kind: 'overview', at: { file, side: 'new', from, to }, block, note }];
  });
}

/** Whether two lists of marks mark the same lines the same way, in the same order. */
export function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}
