/**
 * Reads the repository's code at a commit, as the checks ask for it: `git cat-file --batch` walks
 * the commit's trees, so each entry's mode says what it is, and a link is never followed. A file's
 * size comes first, from `git cat-file --batch-check`, and a file past what any check reads isn't
 * read at all. Paths never reach git: they're matched against trees here, byte for byte.
 *
 * What's read is bounded. Of a file, only the bytes a check asks for are kept. Of a tree, only the
 * entries on the way to a path the overview names. And git writes at most {@link STREAM_LIMIT}
 * bytes for one check, past which the code can't be checked.
 */

import { LIMITS, SIZE_ONLY, type CodeReader, type FileAnswer } from '@lo/artifact';

import { GitError, Objects, type Git } from './git.ts';

/**
 * The most bytes git writes for one check: enough for every file an overview that passes can name
 * to be read twice, its start and then whole, with as much again for the trees on the way.
 */
export const STREAM_LIMIT = 4 * LIMITS.code;

/** The largest tree read: one past it fails, rather than be held whole while it's read. */
const TREE_LIMIT = 32 * 1024 * 1024;

/** One entry of a tree: its mode, as the tree writes it, and its object's id. */
interface TreeEntry {
  mode: string;
  id: string;
}

/** Entries of a tree, by their names' bytes, read as Latin-1 so each byte is one character. */
type Tree = ReadonlyMap<string, TreeEntry>;

/** A code reader over the repository `git` runs in, and a way to stop its git. */
export interface GitCode {
  read: CodeReader;
  /** Whether the repository has `commit`, by that exact id, as a commit. */
  has(commit: string): Promise<boolean>;
  /** How many bytes git has written so far. */
  streamed(): number;
  /** How many tree entries are held, to read paths through. */
  held(): number;
  close(): void;
}

const encoder = new TextEncoder();

/** Bytes as a key, one character a byte. */
function key(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** The keys of `path` and of each folder it passes through, by their bytes. */
function prefixesOf(path: Uint8Array): string[] {
  const found: string[] = [];
  for (let at = path.indexOf(0x2f); at !== -1; at = path.indexOf(0x2f, at + 1)) {
    found.push(key(path.subarray(0, at)));
  }
  found.push(key(path));
  return found;
}

/**
 * Reads code from the repository `git` runs in, for the overview whose targets name `paths`: each
 * tree on the way to one of them is read once, keeping only the entries on the way. A path not
 * among them is read all the same, holding nothing. Git writes at most `limit` bytes.
 */
export function gitCode(
  git: Git,
  paths: Iterable<string> = [],
  limit: number = STREAM_LIMIT,
): GitCode {
  const objects = new Objects(git, limit);
  const wanted = new Set<string>();
  for (const path of paths) {
    const bytes = encoder.encode(path);
    if (bytes.length <= LIMITS.argument) for (const each of prefixesOf(bytes)) wanted.add(each);
  }
  const roots = new Map<string, Promise<string | undefined>>();
  const trees = new Map<string, Promise<Tree>>();
  let held = 0;

  /** The id of `commit`'s tree, or undefined when the repository has no such commit. */
  const rootOf = (commit: string): Promise<string | undefined> => {
    let known = roots.get(commit);
    if (!known) {
      known = (async () => {
        // That exact object, as a commit: not a tag, or what a name or a shorter id resolves to.
        const info = await objects.info(commit);
        if (info?.type !== 'commit' || info.id !== commit) return undefined;
        const start = await objects.read(info, 128);
        const tree = /^tree ([0-9a-f]{40}|[0-9a-f]{64})\n/.exec(
          Buffer.from(start).toString('latin1'),
        );
        if (!tree?.[1]) throw new GitError(`Commit ${commit} names no tree.`);
        return tree[1];
      })();
      roots.set(commit, known);
    }
    return known;
  };

  /** The entries of the tree `id`, at the folder `folder`, that `keep` says lead somewhere. */
  const readTree = async (id: string, folder: string, keep: (path: string) => boolean) => {
    const info = await objects.info(id);
    if (info?.type !== 'tree') throw new GitError(`The repository lacks tree ${id}.`);
    if (info.size > TREE_LIMIT) {
      throw new GitError(`Tree ${id} is ${info.size} bytes, larger than the checker reads.`);
    }
    const data = await objects.read(info, info.size);
    return parseTree(data, id.length / 2, (name) =>
      keep(folder === '' ? name : `${folder}/${name}`),
    );
  };

  /** The entries of the tree `id`, at `folder`, on the way to the overview's paths, read once. */
  const treeOf = (id: string, folder: string): Promise<Tree> => {
    const at = `${folder}\0${id}`;
    let known = trees.get(at);
    if (!known) {
      known = readTree(id, folder, (path) => wanted.has(path)).then((tree) => {
        held += tree.size;
        return tree;
      });
      trees.set(at, known);
    }
    return known;
  };

  const read: CodeReader = async (commit, path, cap, signal): Promise<FileAnswer> => {
    const root = await rootOf(commit);
    if (root === undefined) return { kind: 'noCommit' };
    const bytes = encoder.encode(path);
    // A path no target names is read without keeping anything.
    const own = new Set(prefixesOf(bytes));
    const named = bytes.length <= LIMITS.argument && wanted.has(key(bytes));
    const tree = (id: string, folder: string) =>
      named ? treeOf(id, folder) : readTree(id, folder, (each) => own.has(each));
    const parts = path.split('/').map((part) => encoder.encode(part));
    let folder = '';
    let entries = await tree(root, folder);
    for (const [index, part] of parts.entries()) {
      signal.throwIfAborted();
      // A part longer than any target names nothing an overview can point at.
      const entry = part.length <= LIMITS.argument ? entries.get(key(part)) : undefined;
      if (!entry) return { kind: 'missing' };
      const kind = kindOf(entry.mode);
      if (index < parts.length - 1) {
        // Only a folder leads anywhere: a link, a file or a submodule on the way is nothing.
        if (kind !== 'folder') return { kind: 'missing' };
        folder = folder === '' ? key(part) : `${folder}/${key(part)}`;
        entries = await tree(entry.id, folder);
        continue;
      }
      switch (kind) {
        case 'file':
          return readFile(entry.id, cap);
        case 'folder':
        case 'link':
        case 'submodule':
          return { kind: 'notFile', is: kind };
        case undefined:
          return { kind: 'missing' };
        default:
          kind satisfies never;
          return { kind: 'missing' };
      }
    }
    return { kind: 'missing' };
  };

  /** A file's size, then its first `cap` bytes, unless it's past what any check reads. */
  const readFile = async (id: string, cap: number): Promise<FileAnswer> => {
    const info = await objects.info(id);
    if (info?.type !== 'blob') throw new GitError(`The repository lacks blob ${id}.`);
    const { size } = info;
    if (size > SIZE_ONLY || cap === 0) return { kind: 'file', size, bytes: new Uint8Array() };
    return { kind: 'file', size, bytes: await objects.read(info, cap) };
  };

  return {
    read,
    has: async (commit) => (await rootOf(commit)) !== undefined,
    streamed: () => objects.streamed,
    held: () => held,
    close: () => objects.close(),
  };
}

/** What a tree entry's mode makes it, or undefined for one no git writes. */
function kindOf(mode: string): 'file' | 'folder' | 'link' | 'submodule' | undefined {
  switch (mode) {
    case '40000':
      return 'folder';
    case '120000':
      return 'link';
    case '160000':
      return 'submodule';
    case '100644':
    case '100755':
    case '100664':
      return 'file';
    default:
      return undefined;
  }
}

/**
 * The entries of a tree object that `keep` keeps, by name: each entry is a mode, a space, a name, a
 * NUL and the object's id, `idLength` bytes of it. Names longer than any target are never kept, so
 * no long string is a key.
 */
export function parseTree(
  data: Uint8Array,
  idLength: number,
  keep: (name: string) => boolean,
): Tree {
  const entries = new Map<string, TreeEntry>();
  for (let at = 0; at < data.length;) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space + 1);
    if (space === -1 || nul === -1 || nul + 1 + idLength > data.length) {
      throw new GitError('A tree in the repository is damaged.');
    }
    const name = data.subarray(space + 1, nul);
    if (name.length <= LIMITS.argument) {
      const named = key(name);
      if (keep(named)) {
        entries.set(named, {
          mode: key(data.subarray(at, space)),
          id: Buffer.from(data.subarray(nul + 1, nul + 1 + idLength)).toString('hex'),
        });
      }
    }
    at = nul + 1 + idLength;
  }
  return entries;
}
