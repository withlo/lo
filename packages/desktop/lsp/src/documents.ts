/**
 * The files a server has open. A file is opened when Lo first asks about it, with its text from
 * git, and stays open as long as it's among the {@link OPEN_LIMIT} most recently asked about.
 */

/** How many files a server has open at once. */
export const OPEN_LIMIT = 50;

export class Documents {
  readonly #limit: number;
  /** Each open file's URI, the least recently asked about first. */
  readonly #open = new Set<string>();

  constructor(limit: number = OPEN_LIMIT) {
    this.#limit = limit;
  }

  /** Whether `uri` is open. */
  has(uri: string): boolean {
    return this.#open.has(uri);
  }

  /** Marks `uri` as just asked about, if it's open, and says whether it is. */
  touch(uri: string): boolean {
    if (!this.#open.delete(uri)) return false;
    this.#open.add(uri);
    return true;
  }

  /** Adds `uri`, which isn't open, and returns the files to close to make room for it. */
  add(uri: string): string[] {
    this.#open.add(uri);
    const closed: string[] = [];
    for (const oldest of this.#open) {
      if (this.#open.size <= this.#limit) break;
      this.#open.delete(oldest);
      closed.push(oldest);
    }
    return closed;
  }

  /** Forgets every file, and returns them. */
  clear(): string[] {
    const all = [...this.#open];
    this.#open.clear();
    return all;
  }
}
