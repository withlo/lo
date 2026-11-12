// The inline layout: one document holding every file, each a header line and then its lines, with
// a change's deleted lines before its added ones. Every line is a real line the cursor can land
// on. A file's lines arrive with its diff, since its diff decides their order.

import type { FileDiff } from '@lo/diff';

import { lastAtOrBefore } from './layout.ts';

/** A file's inline lines, each with its line on each side. */
export interface InlineLines {
  /** Each inline line's old and new file line, or 0 on a side it isn't on. */
  old: Int32Array;
  new: Int32Array;
  /** Each file line's inline line, indexed by file line (index 0 is unused). */
  ofOld: Int32Array;
  ofNew: Int32Array;
}

/** A file's inline lines, from its diff: unchanged lines once, a change's old lines then its new. */
export function inlineLines(diff: FileDiff): InlineLines {
  let count = 0;
  for (const block of diff.rows) {
    count += block.changed ? block.oldCount + block.newCount : block.oldCount;
  }
  const lines: InlineLines = {
    old: new Int32Array(count),
    new: new Int32Array(count),
    ofOld: new Int32Array(diff.oldLineCount + 1),
    ofNew: new Int32Array(diff.newLineCount + 1),
  };
  let at = 0;
  const push = (old: number, added: number): void => {
    lines.old[at] = old;
    lines.new[at] = added;
    at++;
    if (old > 0) lines.ofOld[old] = at;
    if (added > 0) lines.ofNew[added] = at;
  };
  for (const block of diff.rows) {
    if (!block.changed) {
      for (let index = 0; index < block.oldCount; index++) {
        push(block.old + index, block.new + index);
      }
      continue;
    }
    for (let index = 0; index < block.oldCount; index++) push(block.old + index, 0);
    for (let index = 0; index < block.newCount; index++) push(0, block.new + index);
  }
  return lines;
}

/** The text of each inline line: an old line where it has no new one, else the new line. */
export function inlineText(
  lines: InlineLines,
  oldLines: readonly string[],
  newLines: readonly string[],
): string[] {
  return Array.from(lines.old, (old, index) => {
    const added = lines.new[index]!;
    return added > 0 ? newLines[added - 1]! : oldLines[old - 1]!;
  });
}

/** Where each file sits in the inline document, and what each of its lines is. */
export class InlineLayout {
  /** Each file's header line and how many lines follow it. */
  files: readonly { header: number; count: number }[] = [];
  /** Each file's inline lines, once its diff is in. */
  readonly lines: (InlineLines | undefined)[];
  /** The document's text when the layout was made. */
  readonly text: string;
  readonly #headers: Int32Array;

  constructor(
    files: readonly {
      path: string;
      lines?: InlineLines | undefined;
      text?: readonly string[] | undefined;
    }[],
  ) {
    this.lines = files.map((file) => file.lines);
    this.#headers = new Int32Array(files.length);
    this.text = files.flatMap((file) => [file.path || '/', ...(file.text ?? [])]).join('\n');
    this.#place(0);
  }

  /** Gives file `file` its inline lines, moving the files after it. */
  setLines(file: number, lines: InlineLines): void {
    this.lines[file] = lines;
    this.#place(file);
  }

  /** Takes file `file`'s inline lines out, as before its diff came, moving the files after it. */
  clearLines(file: number): void {
    this.lines[file] = undefined;
    this.#place(file);
  }

  /** The index of the file that document line `line` belongs to. */
  fileAt(line: number): number {
    return lastAtOrBefore(this.#headers, line);
  }

  /** What document line `line` is: its file, and its old and new file lines (0 for none). */
  lineAt(line: number): { file: number; old: number; new: number } {
    const file = this.fileAt(line);
    const index = line - this.files[file]!.header;
    const lines = this.lines[file];
    if (index === 0 || !lines) return { file, old: 0, new: 0 };
    return { file, old: lines.old[index - 1]!, new: lines.new[index - 1]! };
  }

  /** The document line of file line `line` on `side`, or the header's if it has none. */
  docLine(file: number, side: 'old' | 'new', line: number): number {
    const lines = this.lines[file];
    const index = lines ? (side === 'old' ? lines.ofOld : lines.ofNew)[line] : undefined;
    return this.files[file]!.header + (index ?? 0);
  }

  #place(from: number): void {
    let next = from === 0 ? 1 : this.files[from - 1]!.header + 1 + this.files[from - 1]!.count;
    const files = this.files.slice(0, from);
    for (let index = from; index < this.lines.length; index++) {
      const count = this.lines[index]?.old.length ?? 0;
      this.#headers[index] = next;
      files.push({ header: next, count });
      next += 1 + count;
    }
    this.files = files;
  }
}
