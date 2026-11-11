// The rows the two sides of the diff line up on. Each file starts with its header, on both sides.
// Unchanged lines pair one for one, a change's lines pair by index, and a run of collapsed lines is
// one row on both sides. A row has its lines on each side as a range of document lines, or none
// on a side with nothing there.

import type { FileDiff } from '@lo/diff';

/** A range of document lines on one side, first and last included. */
export interface LineRange {
  first: number;
  last: number;
}

/** What a file's document lines show. */
export type FileState =
  /** Its diff, with unchanged code outside its hunks collapsed, except the lines in `keep`. */
  | { kind: 'diff'; diff: FileDiff; keep?: Keep | undefined }
  /** One collapsed block: the diff isn't ready, or the file isn't shown as a diff. */
  | { kind: 'collapsed' };

/** Where a file is in each side's document, in document lines. */
export interface FileLines {
  /** The header's line, which the header replaces. */
  header: number;
  /** How many of the file's own lines follow it. */
  count: number;
}

/** A file's rows, as parallel arrays: document lines on each side, -1 where a side has none. */
export interface FileRows {
  oldFirst: Int32Array;
  oldLast: Int32Array;
  newFirst: Int32Array;
  newLast: Int32Array;
  /** Whether each row is collapsed lines, replaced by one block on each side. */
  collapsed: Uint8Array;
}

/** A collapsed run of a file's lines, by its lines on each side. Either side may be empty. */
export interface Collapsed {
  old?: LineRange;
  new?: LineRange;
}

/** File lines on each side that stay shown, such as the lines threads are on. */
export interface Keep {
  old: ReadonlySet<number>;
  new: ReadonlySet<number>;
}

/**
 * The unchanged runs a file's diff collapses: everything outside its hunks, in file lines, around
 * the lines in `keep`. A single line stays shown, since the block that would replace it takes as
 * much room.
 */
export function collapsedRuns(
  diff: FileDiff,
  keep?: Keep,
  least = 2,
): { old: LineRange; new: LineRange }[] {
  const runs: { old: LineRange; new: LineRange }[] = [];
  /** Collapses old lines `[from, to)`, which line up with new lines `offset` further on. */
  const collapse = (from: number, to: number, offset: number): void => {
    let start = from;
    for (let line = from; line <= to; line++) {
      const kept = line < to && (keep?.old.has(line) || keep?.new.has(line + offset));
      if (line < to && !kept) continue;
      if (line - start >= least) {
        runs.push({
          old: { first: start, last: line - 1 },
          new: { first: start + offset, last: line - 1 + offset },
        });
      }
      start = line + 1;
    }
  };
  let old = 1;
  let added = 1;
  for (const hunk of diff.hunks) {
    collapse(old, hunk.old.start, added - old);
    old = hunk.old.end;
    added = hunk.new.end;
  }
  collapse(old, diff.oldLineCount + 1, added - old);
  return runs;
}

/** A file's rows, header first, from where its lines are and what they show. */
export function fileRows(old: FileLines, added: FileLines, state: FileState): FileRows {
  const rows = new RowList();
  rows.push(old.header, old.header, added.header, added.header, false);
  const oldLine = (line: number): number => old.header + line;
  const newLine = (line: number): number => added.header + line;
  if (state.kind === 'collapsed') {
    if (old.count > 0 || added.count > 0) {
      rows.push(
        old.count > 0 ? oldLine(1) : -1,
        old.count > 0 ? oldLine(old.count) : -1,
        added.count > 0 ? newLine(1) : -1,
        added.count > 0 ? newLine(added.count) : -1,
        true,
      );
    }
    return rows.done();
  }
  const runs = collapsedRuns(state.diff, state.keep);
  let run = 0;
  for (const block of state.diff.rows) {
    if (block.changed) {
      for (let index = 0; index < Math.max(block.oldCount, block.newCount); index++) {
        const o = index < block.oldCount ? oldLine(block.old + index) : -1;
        const n = index < block.newCount ? newLine(block.new + index) : -1;
        rows.push(o, o, n, n, false);
      }
      continue;
    }
    // Unchanged lines: the collapsed runs inside the block are one row each, the rest pair up.
    let line = 0;
    while (line < block.oldCount) {
      const at = block.old + line;
      while (run < runs.length && runs[run]!.old.last < at) run++;
      const collapsed = runs[run];
      if (collapsed && collapsed.old.first <= at) {
        rows.push(
          oldLine(collapsed.old.first),
          oldLine(collapsed.old.last),
          newLine(collapsed.new.first),
          newLine(collapsed.new.last),
          true,
        );
        line += collapsed.old.last - at + 1;
        continue;
      }
      const offset = block.new - block.old;
      rows.push(oldLine(at), oldLine(at), newLine(at + offset), newLine(at + offset), false);
      line++;
    }
  }
  return rows.done();
}

class RowList {
  #length = 0;
  #oldFirst = new Int32Array(64);
  #oldLast = new Int32Array(64);
  #newFirst = new Int32Array(64);
  #newLast = new Int32Array(64);
  #collapsed = new Uint8Array(64);

  push(
    oldFirst: number,
    oldLast: number,
    newFirst: number,
    newLast: number,
    collapsed: boolean,
  ): void {
    if (this.#length === this.#collapsed.length) {
      this.#oldFirst = grow(this.#oldFirst);
      this.#oldLast = grow(this.#oldLast);
      this.#newFirst = grow(this.#newFirst);
      this.#newLast = grow(this.#newLast);
      const grown = new Uint8Array(this.#collapsed.length * 2);
      grown.set(this.#collapsed);
      this.#collapsed = grown;
    }
    const at = this.#length++;
    this.#oldFirst[at] = oldFirst;
    this.#oldLast[at] = oldLast;
    this.#newFirst[at] = newFirst;
    this.#newLast[at] = newLast;
    this.#collapsed[at] = collapsed ? 1 : 0;
  }

  done(): FileRows {
    return {
      oldFirst: this.#oldFirst.slice(0, this.#length),
      oldLast: this.#oldLast.slice(0, this.#length),
      newFirst: this.#newFirst.slice(0, this.#length),
      newLast: this.#newLast.slice(0, this.#length),
      collapsed: this.#collapsed.slice(0, this.#length),
    };
  }
}

/** `column` at twice its length, with what it held. */
function grow(column: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const grown = new Int32Array(column.length * 2);
  grown.set(column);
  return grown;
}
