/**
 * A commit's files: listed from its trees, which a blobless clone always has, so listing them
 * downloads nothing, and looked up by path one folder at a time, without a path ever going on
 * git's command line.
 */

import { GitError } from './errors.ts';
import type { ObjectReader } from './objects.ts';
import { type Oid, parseOid } from './oid.ts';

/** What a tree's entry is: a file, an executable, a symlink, or a submodule's commit. */
export type FileMode = 'regular' | 'executable' | 'symlink' | 'submodule';

/** A file, symlink or submodule in a commit's tree. */
export interface TreeEntry {
  /** The path from the tree's root, as git stores it: bytes, usually but not always UTF-8. */
  readonly path: Buffer;
  /**
   * The blob. For a submodule, the commit it points at, which is in another repository: never
   * read it.
   */
  readonly oid: Oid;
  readonly mode: FileMode;
  /**
   * The blob's size in bytes once the clone has it. Until then it's unknown, never small or empty;
   * a submodule has none.
   */
  readonly size?: number | undefined;
}

/**
 * The most entries Lo reads of a listing, such as a tree's files or a diff's, unless the caller
 * says otherwise: past it, the listing is `tooLarge`. Each entry is an object in main's memory, and
 * a repository's author decides how many there are.
 */
export const MAX_ENTRIES = 500_000;

/** The error for a listing, by `command`, of more than `limit` entries. */
export function tooManyEntries(command: string, limit: number): GitError {
  return new GitError({ kind: 'tooLarge', command, limit, unit: 'entries' });
}

/** `path` as text, with U+FFFD for bytes that aren't UTF-8. */
export function displayPath(path: Uint8Array): string {
  return Buffer.from(path.buffer, path.byteOffset, path.byteLength).toString('utf8');
}

/** Refuses a path git would misread: an empty one, or one holding a NUL. */
export function checkPaths(paths: readonly Uint8Array[]): void {
  const bad = paths.find((path) => path.length === 0 || path.includes(0));
  if (bad !== undefined)
    throw new GitError({ kind: 'invalid', what: 'path', value: displayPath(bad) });
}

/** git's mode for an entry, such as `100644`, as a {@link FileMode}; `000000` for none. */
export function parseMode(mode: string): FileMode | undefined {
  switch (mode) {
    case '000000':
      return undefined;
    case '100644':
      return 'regular';
    case '100755':
      return 'executable';
    case '120000':
      return 'symlink';
    case '160000':
      return 'submodule';
    default:
      throw new GitError({ kind: 'git', command: 'git', message: `printed a file mode ${mode}` });
  }
}

/** One record of `git ls-tree -z`, with `-l` or without. */
export interface Listed {
  readonly mode: string;
  /** `blob`, `tree` or `commit` (a submodule). */
  readonly kind: string;
  readonly oid: Oid;
  /** What `-l` printed: none without `-l`, for a submodule, or for a blob the clone lacks. */
  readonly size: number | undefined;
  readonly path: Buffer;
}

/**
 * Reads a record of `git ls-tree -z`: `<mode> <kind> <oid>`, with `-l` the size padded with
 * spaces, then a tab and the path, which may hold anything but a NUL.
 */
export function parseListed(record: Buffer): Listed {
  const tab = record.indexOf(0x09);
  const unexpected = () =>
    new GitError({
      kind: 'git',
      command: 'git ls-tree',
      message: `printed an unexpected entry ${JSON.stringify(record.toString('utf8'))}`,
    });
  if (tab === -1) throw unexpected();
  const fields = record.subarray(0, tab).toString('latin1').split(/ +/);
  const [mode, kind, oid, size, ...rest] = fields;
  if (mode === undefined || kind === undefined || oid === undefined || rest.length > 0) {
    throw unexpected();
  }
  let parsed: Oid;
  try {
    parsed = parseOid(oid);
  } catch {
    throw unexpected();
  }
  return {
    mode,
    kind,
    oid: parsed,
    // `-` for a submodule, and `BAD` for a blob the clone lacks.
    size: size !== undefined && /^\d+$/.test(size) ? Number(size) : undefined,
    path: record.subarray(tab + 1),
  };
}

/** The {@link TreeEntry} for one of `git ls-tree -r -l -z`'s records. */
export function treeEntry(listed: Listed): TreeEntry {
  const mode = parseMode(listed.mode);
  // `-r` lists files and submodules, never folders.
  if (
    mode === undefined ||
    listed.kind === 'tree' ||
    (listed.kind === 'commit') !== (mode === 'submodule')
  ) {
    throw new GitError({
      kind: 'git',
      command: 'git ls-tree',
      message: `printed an unexpected entry for ${JSON.stringify(displayPath(listed.path))}`,
    });
  }
  return {
    path: listed.path,
    oid: listed.oid,
    mode,
    size: mode === 'submodule' ? undefined : listed.size,
  };
}

/** An entry of a tree object: a file, symlink or submodule, or a folder. */
export interface Found {
  readonly mode: FileMode | 'folder';
  readonly oid: Oid;
}

/**
 * The entries of a tree object, by name: `<mode> <name>`, a NUL, and the object's ID as
 * `hashBytes` raw bytes. Modes are read as git reads them, so an old tree's `100664` is a file.
 */
export function parseTree(data: Buffer, hashBytes: number): Map<string, Found> {
  const entries = new Map<string, Found>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const nul = space === -1 ? -1 : data.indexOf(0, space + 1);
    if (nul === -1 || nul + 1 + hashBytes > data.length) throw unreadableTree();
    const mode = data.subarray(at, space).toString('latin1');
    if (!/^[0-7]+$/.test(mode)) throw unreadableTree();
    // Names are bytes, keyed one character per byte.
    const name = data.subarray(space + 1, nul).toString('latin1');
    const oid = parseOid(data.subarray(nul + 1, nul + 1 + hashBytes).toString('hex'));
    entries.set(name, { mode: canonicalMode(Number.parseInt(mode, 8)), oid });
    at = nul + 1 + hashBytes;
  }
  return entries;
}

function unreadableTree(): GitError {
  return new GitError({
    kind: 'git',
    command: 'git cat-file',
    message: 'read a tree it can’t parse',
  });
}

/** What git takes a tree entry's mode for, as `canon_mode` does. */
function canonicalMode(mode: number): Found['mode'] {
  switch (mode & 0o170000) {
    case 0o100000:
      return mode & 0o100 ? 'executable' : 'regular';
    case 0o120000:
      return 'symlink';
    case 0o040000:
      return 'folder';
    default:
      return 'submodule';
  }
}

/**
 * Looks paths up in commits' trees, reading each tree it needs once through the clone's reader.
 * It reads only trees, which a blobless clone has, so it downloads nothing.
 */
export class TreeWalk {
  readonly #reader: ObjectReader;
  readonly #trees = new Map<string, Map<string, Found>>();

  constructor(reader: ObjectReader) {
    this.#reader = reader;
  }

  /** The root tree of `rev`, a commit or a tree. One the clone lacks is `notFetched`. */
  async root(rev: Oid): Promise<Oid> {
    const info = await this.#reader.info(`${rev}^{tree}`);
    if (info === undefined) throw new GitError({ kind: 'notFetched', oid: rev });
    return info.oid;
  }

  /**
   * What is at `path` in the tree `root`, or `undefined` when nothing is. A path is its names
   * joined by `/`, as git stores it, so one with an empty name, as in `src/`, names nothing.
   */
  async find(root: Oid, path: Uint8Array): Promise<Found | undefined> {
    const bytes = Buffer.from(path.buffer, path.byteOffset, path.byteLength);
    let found: Found = { mode: 'folder', oid: root };
    let start = 0;
    for (;;) {
      if (found.mode !== 'folder') return undefined;
      const end = bytes.indexOf(0x2f, start);
      const name = bytes.subarray(start, end === -1 ? bytes.length : end).toString('latin1');
      const next = name === '' ? undefined : (await this.#tree(found.oid)).get(name);
      if (next === undefined) return undefined;
      if (end === -1) return next;
      found = next;
      start = end + 1;
    }
  }

  async #tree(oid: Oid): Promise<Map<string, Found>> {
    let tree = this.#trees.get(oid);
    if (tree === undefined) {
      const object = await this.#reader.read(oid);
      if (object === undefined || object.type !== 'tree') {
        throw new GitError({
          kind: 'git',
          command: 'git cat-file --batch-command',
          message: `${oid} isn't a tree the clone has`,
        });
      }
      tree = parseTree(object.data, oid.length / 2);
      this.#trees.set(oid, tree);
    }
    return tree;
  }
}
