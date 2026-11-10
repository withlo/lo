// Where each file sits in the two documents. Each side's document holds every file in turn: a
// line the file's header replaces, then the file's own lines on that side, if it has any there.

import type { FileLines } from './rows.ts';

export type Side = 'old' | 'new';

/** A file as the documents show it. */
export interface LayoutFile {
  path: string;
  /** Its lines on each side: none for a side it isn't on, or when it isn't shown as a diff. */
  old: readonly string[];
  new: readonly string[];
}

export class Layout {
  /** Each file's lines in each document. */
  readonly files: readonly { old: FileLines; new: FileLines }[];
  /** Each document's text. */
  readonly text: { old: string; new: string };
  /** Each file's header line in each document, in order, for finding a line's file. */
  readonly #headers: { old: Int32Array; new: Int32Array };

  constructor(files: readonly LayoutFile[]) {
    const parts: { old: string[]; new: string[] } = { old: [], new: [] };
    const next = { old: 1, new: 1 };
    const headers = { old: new Int32Array(files.length), new: new Int32Array(files.length) };
    this.files = files.map((file, index) => {
      const place = (side: Side): FileLines => {
        const lines = file[side];
        const header = next[side];
        headers[side][index] = header;
        // The header's line holds the path, so the block that replaces it covers some text.
        parts[side].push(file.path || '/', ...lines);
        next[side] += 1 + lines.length;
        return { header, count: lines.length };
      };
      return { old: place('old'), new: place('new') };
    });
    this.text = { old: parts.old.join('\n'), new: parts.new.join('\n') };
    this.#headers = headers;
  }

  /** The index of the file that line `line` of `side`'s document belongs to. */
  fileAt(side: Side, line: number): number {
    const headers = this.#headers[side];
    let low = 0;
    let high = headers.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (headers[middle]! <= line) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  /** The file's own line number for document line `line`, or 0 for a header line. */
  fileLine(side: Side, line: number): number {
    const file = this.files[this.fileAt(side, line)];
    return file ? line - file[side].header : 0;
  }
}
