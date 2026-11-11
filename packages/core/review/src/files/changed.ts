/** One changed file, as the file list, review order and a file's initial state see it. */

/**
 * One file a pull request changes, as GitHub's changed-file list or the local copy describes it,
 * plus the `linguist-generated` attribute the caller looks up in the head's `.gitattributes`.
 *
 * Paths are relative to the repository root and `/`-separated, as GitHub and git report them.
 */
export interface ChangedFile {
  /** The file's path in the head. For a deleted file, its path in the base. */
  readonly path: string;
  /**
   * The file's path in the base when the pull request renames it. Review order places a renamed
   * file by its new path.
   */
  readonly previousPath?: string | undefined;
  /** Lines added. Zero for a binary file. */
  readonly additions: number;
  /** Lines deleted. Zero for a binary file. */
  readonly deletions: number;
  /** Whether git sees the file as binary. */
  readonly binary: boolean;
  /** The larger side's size in bytes, when it's known: a file of few lines can still be huge. */
  readonly size?: number | undefined;
  /**
   * The file's `linguist-generated` attribute: `true` when it's set (`linguist-generated` or
   * `linguist-generated=true`), `false` when it's unset (`-linguist-generated` or
   * `linguist-generated=false`), and nothing when `.gitattributes` doesn't mention it.
   */
  readonly linguistGenerated?: boolean | undefined;
}

/**
 * Lines added plus lines deleted, GitHub's count of changes. A line edited in place counts twice,
 * once deleted and once added.
 */
export function changedLines(file: ChangedFile): number {
  return file.additions + file.deletions;
}

/** A path's last component. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Orders two paths byte by byte in UTF-8, which is git's order and the order of GitHub's
 * changed-file list: uppercase before lowercase, and `a.ts` before `a/b.ts`.
 */
export function comparePaths(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at++) {
    const x = a.charCodeAt(at);
    const y = b.charCodeAt(at);
    if (x !== y) return codePointRank(x) - codePointRank(y);
  }
  return a.length - b.length;
}

/**
 * A UTF-16 code unit's place in code point order, which is UTF-8's byte order. Surrogates make up
 * the code points past U+FFFF, so they go after U+E000 to U+FFFF rather than before.
 */
function codePointRank(unit: number): number {
  if (unit >= 0xd800 && unit <= 0xdfff) return unit + 0x2000;
  if (unit >= 0xe000) return unit - 0x800;
  return unit;
}
