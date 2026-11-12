// Where each file sits in the two side-by-side documents. Each side's document holds every file in
// turn: a line the file's header replaces, then the file's own lines on that side, if it has any
// there. A file's lines can arrive later, as when a large file is loaded, which moves every file
// after it.

import type { FileLines } from './rows.ts';

export type Side = 'old' | 'new';

/**
 * What a header's line holds, which the block that replaces it covers: a space, which nothing
 * draws. Text that showed through would be Vim's: its block cursor on a header draws the character
 * under it, and its motions and searches reach the line's text.
 */
export const HEADER_TEXT = ' ';

/** A file as the documents show it. */
export interface LayoutFile {
  /** Its lines on each side: none for a side it isn't on, or when it isn't shown as a diff. */
  old: readonly string[];
  new: readonly string[];
}

export class Layout {
  /** Each file's lines in each document. */
  files: readonly { old: FileLines; new: FileLines }[] = [];
  /** Each document's text when the layout was made. */
  readonly text: { old: string; new: string };
  readonly #counts: { old: Int32Array; new: Int32Array };
  /** Each file's header line in each document, in order, for finding a line's file. */
  readonly #headers: { old: Int32Array; new: Int32Array };

  constructor(files: readonly LayoutFile[]) {
    const parts: { old: string[]; new: string[] } = { old: [], new: [] };
    this.#counts = { old: new Int32Array(files.length), new: new Int32Array(files.length) };
    this.#headers = { old: new Int32Array(files.length), new: new Int32Array(files.length) };
    files.forEach((file, index) => {
      for (const side of ['old', 'new'] as const) {
        parts[side].push(HEADER_TEXT, ...file[side]);
        this.#counts[side][index] = file[side].length;
      }
    });
    this.text = { old: parts.old.join('\n'), new: parts.new.join('\n') };
    this.#place(0);
  }

  /** Gives file `file` `count` lines on `side`, moving the files after it. */
  setCount(side: Side, file: number, count: number): void {
    this.#counts[side][file] = count;
    this.#place(file);
  }

  /** The index of the file that line `line` of `side`'s document belongs to. */
  fileAt(side: Side, line: number): number {
    return lastAtOrBefore(this.#headers[side], line);
  }

  /** The file's own line number for document line `line`, or 0 for a header line. */
  fileLine(side: Side, line: number): number {
    const file = this.files[this.fileAt(side, line)];
    return file ? line - file[side].header : 0;
  }

  /** Works out where the files from `from` on start. */
  #place(from: number): void {
    for (const side of ['old', 'new'] as const) {
      const headers = this.#headers[side];
      const counts = this.#counts[side];
      let next = from === 0 ? 1 : headers[from - 1]! + 1 + counts[from - 1]!;
      for (let index = from; index < headers.length; index++) {
        headers[index] = next;
        next += 1 + counts[index]!;
      }
    }
    const files = this.files.slice(0, from);
    for (let index = from; index < this.#headers.old.length; index++) {
      files.push({
        old: { header: this.#headers.old[index]!, count: this.#counts.old[index]! },
        new: { header: this.#headers.new[index]!, count: this.#counts.new[index]! },
      });
    }
    this.files = files;
  }
}

/** The index of the last of the ascending `values` at or before `value`, or 0. */
export function lastAtOrBefore(values: Int32Array, value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
