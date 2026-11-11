/**
 * A file's patch, as GitHub gives a pull request's changed file: its hunks, with three lines of
 * context, which are the lines GitHub takes comments on.
 */

/**
 * A file's patch: its hunks, from the first `@@` line on, as GitHub's API gives them but ending in
 * a line break; empty when nothing changed. A binary file has none: git says only that it differs.
 */
export type FilePatch =
  { readonly binary: false; readonly hunks: Buffer } | { readonly binary: true };

/** No hunks: the file is the same on both sides, or in neither. */
export const UNCHANGED: FilePatch = { binary: false, hunks: Buffer.alloc(0) };

/**
 * How many bytes from the start git looks in for a NUL to take a file for binary, as
 * `buffer_is_binary` does.
 */
const FIRST_FEW_BYTES = 8000;

/** Whether git takes `contents` for binary, with no attributes to say otherwise. */
export function isBinary(contents: Uint8Array): boolean {
  return contents.subarray(0, FIRST_FEW_BYTES).includes(0);
}

/** The patch in `git diff`'s output for one pair of blobs: its hunks, without git's header. */
export function patchFromDiff(output: Buffer): FilePatch {
  // git's header names the two blobs, and its first hunk starts a line.
  const hunks = lineStarting(output, '@@ ');
  if (hunks !== -1) return { binary: false, hunks: output.subarray(hunks) };
  // "Binary files a/<oid> and b/<oid> differ", in the header, where a hunk would start.
  if (lineStarting(output, 'Binary files ') !== -1) return { binary: true };
  return UNCHANGED;
}

/** Where the first line of `output` that starts with `start` begins, or -1. */
function lineStarting(output: Buffer, start: string): number {
  if (output.subarray(0, start.length).equals(Buffer.from(start))) return 0;
  const at = output.indexOf(`\n${start}`);
  return at === -1 ? -1 : at + 1;
}

/**
 * The most lines a patch may hold, past which it's refused as too large: about what GitHub shows
 * of a diff, and far past what its API gives a patch for.
 */
export const MAX_PATCH_LINES = 500_000;

/** The marker git writes after a last line that has no line break. */
const NO_NEWLINE = Buffer.from('\n\\ No newline at end of file\n');

/** How many lines `contents` holds: one per line break, and one more for a last line without. */
export function lineCount(contents: Uint8Array): number {
  let count = 0;
  for (let at = contents.indexOf(0x0a); at !== -1; at = contents.indexOf(0x0a, at + 1)) count++;
  return contents.length > 0 && contents.at(-1) !== 0x0a ? count + 1 : count;
}

/**
 * The patch of a file whose whole contents changed, as git writes it for one added or deleted
 * (`old` or `now` missing), or for a submodule's commit line: one hunk, every old line deleted and
 * every new one added. A last line without a line break says so, as git does. It's written into
 * one buffer, a little larger than the two sides, and refused, as `null`, past `maxLines` lines.
 */
export function wholeFilePatch(
  old: Buffer | undefined,
  now: Buffer | undefined,
  maxLines = MAX_PATCH_LINES,
): FilePatch | null {
  if ((old !== undefined && isBinary(old)) || (now !== undefined && isBinary(now))) {
    return { binary: true };
  }
  const before = old === undefined ? 0 : lineCount(old);
  const after = now === undefined ? 0 : lineCount(now);
  if (before === 0 && after === 0) return UNCHANGED;
  if (before + after > maxLines) return null;
  const header = Buffer.from(`@@ -${range(before)} +${range(after)} @@\n`);
  const sides = [
    { sign: 0x2d, contents: old, count: before },
    { sign: 0x2b, contents: now, count: after },
  ];
  let length = header.length;
  for (const { contents, count } of sides) {
    if (contents === undefined || count === 0) continue;
    length += contents.length + count + (contents.at(-1) === 0x0a ? 0 : NO_NEWLINE.length);
  }
  const hunks = Buffer.allocUnsafe(length);
  let at = header.copy(hunks, 0);
  for (const { sign, contents } of sides) {
    if (contents === undefined) continue;
    let start = 0;
    while (start < contents.length) {
      const end = contents.indexOf(0x0a, start);
      const stop = end === -1 ? contents.length : end + 1;
      hunks[at++] = sign;
      at += contents.copy(hunks, at, start, stop);
      if (end === -1) at += NO_NEWLINE.copy(hunks, at);
      start = stop;
    }
  }
  return { binary: false, hunks };
}

/** A hunk's range of `count` lines from the start of a file, as git writes it. */
function range(count: number): string {
  if (count === 0) return '0,0';
  return count === 1 ? '1' : `1,${count}`;
}

/** What git shows as a submodule's contents: the commit it points at. */
export function submoduleLine(commit: string): Buffer {
  return Buffer.from(`Subproject commit ${commit}\n`);
}
