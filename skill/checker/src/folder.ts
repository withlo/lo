/**
 * Reads an overview from a folder as its commit would hold it: every file, link and folder in it,
 * listed with `lstat` so a link is never followed, by the names the folder gives, so a disk that
 * ignores case still matches names exactly, as git does. A file is read whole the first time it's
 * asked for, and kept, so what's committed is exactly what was checked.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  type Stats,
} from 'node:fs';

import {
  ARTIFACT,
  LIMITS,
  SIZE_ONLY,
  type FileAnswer,
  type OverviewFiles,
  type TreeEntry,
} from '@lo/artifact';

/** The folder couldn't be read as an overview, and why, in words. */
export class FolderError extends Error {
  override name = 'FolderError';
}

/** One entry of the folder, with where it is on disk and what `lstat` said of it. */
interface Listed {
  entry: TreeEntry;
  /** Its path on disk, as bytes, since a name needn't be UTF-8. */
  disk: Buffer;
  stats: Stats;
}

/** An overview's folder, read as its commit. */
export interface Folder extends OverviewFiles {
  /** A file's bytes, as read for the check, if it was read whole. */
  contents(path: string): Uint8Array | undefined;
}

const SLASH = Buffer.from('/');

/**
 * The folder at `dir` as an overview's commit. Listing stops just past the limit on files and
 * folders, which an overview is past by then, though `artifact.md` is always looked for.
 */
export function readFolder(dir: string): Folder {
  const root = Buffer.from(dir);
  const listed: Listed[] = [];
  const byPath = new Map<string, Listed>();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  const add = (path: Buffer, disk: Buffer): Listed => {
    const stats = lstatSync(disk);
    const entry = entryOf(path, disk, stats);
    const item = { entry, disk, stats };
    listed.push(item);
    // Paths the checks can ask for: UTF-8, and no longer than a target.
    if (path.length <= LIMITS.argument) {
      try {
        byPath.set(decoder.decode(path), item);
      } catch {
        // Not UTF-8, so no target names it.
      }
    }
    return item;
  };

  let top: Buffer[];
  try {
    top = names(root);
  } catch (error) {
    const code = codeOf(error);
    throw new FolderError(
      code === 'ENOENT' || code === 'ENOTDIR'
        ? `There's no folder at ${JSON.stringify(dir)}.`
        : `The folder ${JSON.stringify(dir)} couldn't be read (${code}).`,
    );
  }
  // artifact.md first, so it's listed however many entries follow.
  const artifact = top.find((name) => name.equals(Buffer.from(ARTIFACT)));
  if (artifact) add(artifact, join(root, artifact));
  const stack: { path: Buffer | undefined; names: Buffer[] }[] = [
    { path: undefined, names: top.filter((name) => name !== artifact).toReversed() },
  ];
  while (stack.length > 0 && listed.length <= LIMITS.entries) {
    const folder = stack.at(-1)!;
    const name = folder.names.pop();
    if (name === undefined) {
      stack.pop();
      continue;
    }
    const path = folder.path ? join(folder.path, name) : name;
    const item = add(path, join(root, path));
    if (item.entry.kind === 'folder') {
      stack.push({ path, names: names(item.disk).toReversed() });
    }
  }

  const kept = new Map<string, Uint8Array>();
  const read = (path: string, cap: number): FileAnswer => {
    const item = byPath.get(path);
    if (!item) return { kind: 'missing' };
    const { entry } = item;
    if (entry.kind !== 'file') return { kind: 'notFile', is: entry.kind };
    const { size } = entry;
    // Past what any check reads, a file is known by its size, and never opened.
    if (size > SIZE_ONLY) return { kind: 'file', size, bytes: new Uint8Array() };
    let bytes = kept.get(path);
    if (!bytes) {
      bytes = readWhole(item);
      kept.set(path, bytes);
    }
    return { kind: 'file', size, bytes: bytes.subarray(0, cap) };
  };

  return {
    entries: listed.map(({ entry }) => entry),
    read: async (path, cap) => read(path, cap),
    contents: (path) => kept.get(path),
  };
}

/** What `stats` says the entry at `path` is. */
function entryOf(path: Buffer, disk: Buffer, stats: Stats): TreeEntry {
  const bytes = new Uint8Array(path);
  if (stats.isSymbolicLink()) {
    return { path: bytes, kind: 'link', size: readlinkSync(disk, { encoding: 'buffer' }).length };
  }
  if (stats.isDirectory()) return { path: bytes, kind: 'folder' };
  if (stats.isFile()) return { path: bytes, kind: 'file', size: stats.size };
  throw new FolderError(
    `${JSON.stringify(path.toString('utf8'))} isn't a file, a folder or a link, so it can't be in an overview's commit.`,
  );
}

/** The names in the folder at `disk`, in the order of their bytes. */
function names(disk: Buffer): Buffer[] {
  return readdirSync(disk, { encoding: 'buffer' }).toSorted((a, b) => Buffer.compare(a, b));
}

function join(folder: Buffer, name: Buffer): Buffer {
  return Buffer.concat([folder, SLASH, name]);
}

/**
 * The whole of the file `item` lists, read without following a link. It must still be the file
 * the listing found, at the size it found: one swapped or changed since isn't checked.
 */
function readWhole(item: Listed): Uint8Array {
  const { disk, stats } = item;
  const shown = JSON.stringify(Buffer.from(item.entry.path).toString('utf8'));
  const changed = (): FolderError =>
    new FolderError(`${shown} changed as it was checked. Check it again.`);
  let fd: number;
  try {
    fd = openSync(disk, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = codeOf(error);
    // Gone, or a link now, since it was listed.
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') throw changed();
    throw new FolderError(`${shown} couldn't be opened (${code}).`);
  }
  try {
    const now = fstatSync(fd);
    if (
      !now.isFile() ||
      now.ino !== stats.ino ||
      now.dev !== stats.dev ||
      now.size !== stats.size
    ) {
      throw changed();
    }
    const bytes = new Uint8Array(stats.size);
    for (let at = 0; at < bytes.length;) {
      const count = readSync(fd, bytes, at, bytes.length - at, at);
      if (count === 0) throw changed();
      at += count;
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** A file system error's code, such as `ENOENT`. */
function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'an unknown error';
}
