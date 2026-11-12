// GitHub's diff of a file, drawn as GitHub gives it: the lines of its patch's hunks at their real
// line numbers, empty placeholders for the unchanged lines between them, and its changes exactly
// where the hunks put them. Nothing here diffs lines again, so no change can show anywhere GitHub
// didn't put one: only the words inside each change are looked for.

import { diffOfChanges, type FileDiff, type Lines } from '@lo/diff';
import { parsePatch } from '@lo/github';

import { FAR_LINES, type Gap } from '../jobs.ts';

/** A file as GitHub's patch shows it. */
export interface PatchShown {
  /** Each side's lines up to its last hunk's end, placeholders in the gaps. */
  lines: { old: string[]; new: string[] };
  /** The placeholders, on each side. */
  gaps: Gap[];
  diff: FileDiff;
}

/**
 * Reads GitHub's patch of a file. Throws when the patch doesn't add up, or when the unchanged lines
 * it leaves out don't pair one for one on the two sides, as unchanged lines must.
 */
export function patchShown(text: string, options: { budget?: number } = {}): PatchShown {
  const patch = parsePatch(text);
  const lines = { old: [] as string[], new: [] as string[] };
  const gaps: Gap[] = [];
  const changes: { old: Lines; new: Lines }[] = [];
  /** Placeholders on `side` up to row `row`, from 0, where the next hunk starts. */
  const fill = (side: 'old' | 'new', row: number): number => {
    if (row > FAR_LINES) throw new Error(`a hunk starts past line ${FAR_LINES}`);
    const each = lines[side];
    const missing = row - each.length;
    if (missing < 0) throw new Error(`a hunk on the ${side} side starts inside the one before`);
    if (missing > 0) gaps.push({ side, from: each.length + 1, to: row });
    for (let at = 0; at < missing; at++) each.push('');
    return missing;
  };
  for (const hunk of patch.hunks) {
    // Lines left out are unchanged, so there are as many on each side.
    if (fill('old', hunk.old.start) !== fill('new', hunk.new.start)) {
      throw new Error('the lines left out before a hunk differ in number on the two sides');
    }
    let change: { old: Lines; new: Lines } | undefined;
    for (const line of hunk.lines) {
      if (line.kind === 'unchanged') {
        if (change) changes.push(change);
        change = undefined;
        lines.old.push(line.text);
        lines.new.push(line.text);
        continue;
      }
      change ??= {
        old: { start: lines.old.length + 1, end: lines.old.length + 1 },
        new: { start: lines.new.length + 1, end: lines.new.length + 1 },
      };
      if (line.kind === 'deleted') {
        lines.old.push(line.text);
        change.old.end += 1;
      } else {
        lines.new.push(line.text);
        change.new.end += 1;
      }
    }
    if (change) changes.push(change);
    if (lines.old.length !== hunk.old.end || lines.new.length !== hunk.new.end) {
      throw new Error("a hunk's lines don't fill the rows its header says");
    }
  }
  const diff = diffOfChanges(changes, lines.old, lines.new, {
    budget: options.budget,
    noNewlineAtEnd: { old: patch.oldMissingNewline, new: patch.newMissingNewline },
  });
  return { lines, gaps, diff };
}
