/**
 * The file list: the files a pull request changes, in review order or path order, with their
 * viewed marks (`docs/design.md`, "Modes" and "Viewed marks").
 */

import type { FileViewedState } from '@lo/github';

import type { ChangedFile } from './changed.ts';
import { pathOrder, reviewOrder } from './order.ts';

/**
 * How a pull request changes a file. `typeChanged` is a file that became a symlink or a submodule,
 * or the other way round.
 */
export type FileChange = 'added' | 'deleted' | 'modified' | 'renamed' | 'typeChanged';

/** The letter the list shows for a change, as git does. */
export function changeLetter(change: FileChange): string {
  switch (change) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'modified':
      return 'M';
    case 'renamed':
      return 'R';
    case 'typeChanged':
      return 'T';
    default:
      return change satisfies never;
  }
}

/** One file in the list. */
export interface FileEntry {
  /**
   * What review order and path order see: the path, the old path of a rename, line counts and
   * whether it's binary.
   */
  readonly file: ChangedFile;
  readonly change: FileChange;
  /**
   * GitHub's viewed mark for the account acting, or nothing when Lo doesn't know it: before GitHub
   * answered, or without signing in.
   */
  readonly viewed: FileViewedState | undefined;
}

/**
 * The order the list shows files in: `review`, each source file followed by its tests, then
 * config, then generated files; or `path`, as git and GitHub sort them. One key switches between
 * them.
 */
export type FileOrder = 'review' | 'path';

/** The list's files, both orders and the selected file. */
export class FileList {
  #entries: FileEntry[];
  readonly #reviewOrder: readonly number[];
  readonly #pathOrder: readonly number[];
  #order: FileOrder = 'review';
  /** The selected entry, by index into the entries, so it stays selected when the order changes. */
  #selected: number | undefined;

  /** The list of `entries`, in review order, with nothing selected. */
  constructor(entries: readonly FileEntry[] = []) {
    this.#entries = [...entries];
    const files = entries.map((entry) => entry.file);
    this.#reviewOrder = reviewOrder(files);
    this.#pathOrder = pathOrder(files);
  }

  get length(): number {
    return this.#entries.length;
  }

  isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  get order(): FileOrder {
    return this.#order;
  }

  set order(order: FileOrder) {
    this.#order = order;
  }

  /** Switches between review order and path order. */
  toggleOrder(): void {
    this.#order = this.#order === 'review' ? 'path' : 'review';
  }

  /** Indices into the entries, in the list's order. */
  #indices(): readonly number[] {
    return this.#order === 'review' ? this.#reviewOrder : this.#pathOrder;
  }

  #at(index: number | undefined): FileEntry | undefined {
    return index === undefined ? undefined : this.#entries[index];
  }

  /** The entry at `row`, counting rows in the list's order. */
  row(row: number): FileEntry | undefined {
    return this.#at(this.#indices()[row]);
  }

  /** The entries in the list's order. */
  rows(): FileEntry[] {
    return this.#indices().flatMap((index) => this.#at(index) ?? []);
  }

  /**
   * Where the entry for `path` sits in review order, which is the order the diff shows files in.
   */
  reviewPosition(path: string): number | undefined {
    const position = this.#reviewOrder.findIndex((index) => this.#at(index)?.file.path === path);
    return position < 0 ? undefined : position;
  }

  /**
   * Each entry's position in review order, by its index in the entries: where the diff shows each
   * file.
   */
  reviewPositions(): number[] {
    const positions = Array.from({ length: this.#entries.length }, () => 0);
    for (const [position, index] of this.#reviewOrder.entries()) positions[index] = position;
    return positions;
  }

  /** The entry at `position` in review order, which is the diff's order. */
  atReviewPosition(position: number): FileEntry | undefined {
    return this.#at(this.#reviewOrder[position]);
  }

  /**
   * The file `e` moves to after marking `path` viewed: the next one after it in review order that
   * isn't viewed, going round to the start. Changed since viewed, or with no mark known, counts as
   * unviewed. Nothing when every other file is viewed.
   */
  nextUnviewed(path: string): FileEntry | undefined {
    return this.unviewedAfter(path)[0];
  }

  /**
   * The files after `path` in review order that aren't viewed, going round to the start, as
   * {@link FileList.nextUnviewed} counts them.
   */
  unviewedAfter(path: string): FileEntry[] {
    const from = this.reviewPosition(path);
    if (from === undefined) return [];
    const count = this.#reviewOrder.length;
    const after: FileEntry[] = [];
    for (let step = 1; step < count; step++) {
      const entry = this.atReviewPosition((from + step) % count);
      if (entry !== undefined && entry.viewed !== 'VIEWED') after.push(entry);
    }
    return after;
  }

  /**
   * Takes GitHub's viewed marks, by path. A rename GitHub lists by its old path shows that path's
   * mark. Files GitHub doesn't list keep no mark.
   */
  setViewed(viewed: ReadonlyMap<string, FileViewedState>): void {
    this.#entries = this.#entries.map((entry) => {
      const { path, previousPath } = entry.file;
      const mark =
        viewed.get(path) ?? (previousPath === undefined ? undefined : viewed.get(previousPath));
      return { ...entry, viewed: mark };
    });
  }

  /** The entry for `path`. */
  entry(path: string): FileEntry | undefined {
    return this.#entries.find((entry) => entry.file.path === path);
  }

  /** The selected row, in the list's order. */
  selectedRow(): number | undefined {
    if (this.#selected === undefined) return undefined;
    const row = this.#indices().indexOf(this.#selected);
    return row < 0 ? undefined : row;
  }

  selected(): FileEntry | undefined {
    return this.#at(this.#selected);
  }

  /** Selects the file at `row`, counting rows in the list's order. */
  selectRow(row: number): void {
    const index = this.#indices()[row];
    if (index !== undefined) this.#selected = index;
  }

  /** Selects the file at `path`, if the list has it. */
  selectPath(path: string): void {
    const index = this.#entries.findIndex((entry) => entry.file.path === path);
    if (index >= 0) this.#selected = index;
  }

  /** Selects the next row, or the first when nothing is selected. Stays on the last row. */
  selectNext(): void {
    const row = this.selectedRow();
    this.selectRow(row === undefined ? 0 : Math.min(row + 1, Math.max(this.length - 1, 0)));
  }

  /** Selects the previous row, or the first when nothing is selected. Stays on the first row. */
  selectPrevious(): void {
    const row = this.selectedRow();
    this.selectRow(row === undefined ? 0 : Math.max(row - 1, 0));
  }
}
