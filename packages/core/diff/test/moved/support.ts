// Helpers for describing moves compactly in assertions.

import { type FileChanges, type Line, type Move, Moves } from '../../src/moved.ts';

/** A small function, used as the moved block in most tests. */
export const total = [
  'function total(items: Item[]): number {',
  '  const sum = items.reduce((sum, item) => sum + item.price, 0);',
  '  return sum + tax(sum);',
  '}',
];

/** One file's changed lines, built up a block at a time. */
export class Changes implements FileChanges {
  readonly path: string;
  oldPath?: string;
  deleted: Line[] = [];
  added: Line[] = [];

  constructor(path: string) {
    this.path = path;
  }

  /** Marks the file as renamed from `oldPath`. */
  renamedFrom(oldPath: string): this {
    this.oldPath = oldPath;
    return this;
  }

  /** Adds consecutive deleted lines, the first at old line `start`. */
  delete(start: number, lines: readonly string[]): this {
    this.deleted.push(...numbered(start, lines));
    return this;
  }

  /** Adds consecutive added lines, the first at new line `start`. */
  add(start: number, lines: readonly string[]): this {
    this.added.push(...numbered(start, lines));
    return this;
  }
}

/** A file at `path` with no changed lines yet. */
export function changes(path: string): Changes {
  return new Changes(path);
}

function numbered(start: number, lines: readonly string[]): Line[] {
  return lines.map((text, index) => ({ number: start + index, text }));
}

/**
 * The moves found in `files`, each as `from -> to`, such as `a.ts:10-13 -> b.ts:1-4`, followed by
 * its edited line pairs, such as `edited 11/2 12/3`.
 */
export function moves(files: readonly FileChanges[]): string[] {
  return Moves.find(files).all.map(summarize);
}

export function summarize(moved: Move): string {
  const { from, to } = moved;
  let text = `${from.path}:${from.first}-${from.last} -> ${to.path}:${to.first}-${to.last}`;
  if (moved.edits.length > 0) {
    text += ` edited ${moved.edits.map((edit) => `${edit.old}/${edit.new}`).join(' ')}`;
  }
  return text;
}

/** `lines`, each indented by `spaces` more spaces. */
export function indented(spaces: number, lines: readonly string[]): string[] {
  return lines.map((line) => `${' '.repeat(spaces)}${line}`);
}
