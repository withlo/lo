// A tab's names for its files in the diff view. A file is known by its key, as the tree names it,
// which is never long: a path too long to key a map by is known by its digest.

/**
 * A tab's names for its files in the diff view: `d0`, `d1` and so on, one for each file for as
 * long as the tab is open, so a place in the tab's history names the same file in every view of
 * it. A file's key is the tree's: its path's text, a NUL and its bytes in hex, or a NUL, `#` and
 * its digest.
 */
export class FileIds {
  readonly #byKey = new Map<string, string>();
  readonly #keys: string[] = [];

  /** The id of the file `key` names, made the first time it's asked for. */
  of(key: string): string {
    let id = this.#byKey.get(key);
    if (id === undefined) {
      id = `d${this.#keys.length}`;
      this.#keys.push(key);
      this.#byKey.set(key, id);
    }
    return id;
  }

  /** The id of the file `key` names, if it has one. */
  find(key: string): string | undefined {
    return this.#byKey.get(key);
  }

  /** The key of the file `id` names. */
  keyOf(id: string): string | undefined {
    const match = /^d(\d+)$/.exec(id);
    return match ? this.#keys[Number(match[1])] : undefined;
  }
}
