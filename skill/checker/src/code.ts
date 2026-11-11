/**
 * Reads the repository's code at a commit, as the checks ask for it: one `git cat-file --batch`
 * walks the commit's trees, so each entry's mode says what it is, and a link is never followed. A
 * file's size comes first, from `git cat-file --batch-check`, and a file past what any check reads
 * isn't read at all. Paths never reach git: they're matched against trees here, byte for byte.
 */

import { LIMITS, SIZE_ONLY, type CodeReader, type FileAnswer } from '@lo/artifact';

import { GitError, Objects, type Git } from './git.ts';

/** One entry of a tree: its mode, as the tree writes it, and its object's id. */
interface TreeEntry {
  mode: string;
  id: string;
}

/** A tree's entries, by their names' bytes, read as Latin-1 so each byte is one character. */
type Tree = ReadonlyMap<string, TreeEntry>;

/** A code reader over the repository `git` runs in, and a way to stop its git. */
export interface GitCode {
  read: CodeReader;
  /** Whether the repository has `commit`. */
  has(commit: string): Promise<boolean>;
  close(): void;
}

const encoder = new TextEncoder();

/** A part's bytes as a key, one character a byte. */
function key(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

/** Reads code from the repository `git` runs in. */
export function gitCode(git: Git): GitCode {
  const contents = new Objects(git, '--batch');
  const sizes = new Objects(git, '--batch-check');
  const roots = new Map<string, Promise<string | undefined>>();
  const trees = new Map<string, Promise<Tree>>();
  const blobs = new Map<string, Promise<Buffer>>();

  /** The id of `commit`'s tree, or undefined when the repository has no such commit. */
  const rootOf = (commit: string): Promise<string | undefined> => {
    let known = roots.get(commit);
    if (!known) {
      known = (async () => {
        const found = await contents.ask(commit, '^{commit}');
        if (!found?.data) return undefined;
        const tree = /^tree ([0-9a-f]+)\n/.exec(found.data.subarray(0, 100).toString('latin1'));
        if (!tree?.[1]) throw new GitError(`Commit ${found.id} names no tree.`);
        return tree[1];
      })();
      roots.set(commit, known);
    }
    return known;
  };

  const treeOf = (id: string): Promise<Tree> => {
    let known = trees.get(id);
    if (!known) {
      known = (async () => {
        const found = await contents.ask(id);
        if (found?.type !== 'tree' || !found.data) {
          throw new GitError(`The repository lacks tree ${id}, which its commit names.`);
        }
        return parseTree(found.data, id.length / 2);
      })();
      trees.set(id, known);
    }
    return known;
  };

  const blobOf = (id: string): Promise<Buffer> => {
    let known = blobs.get(id);
    if (!known) {
      known = (async () => {
        const found = await contents.ask(id, '', SIZE_ONLY);
        if (found?.type !== 'blob' || !found.data) {
          throw new GitError(`The repository lacks the contents of blob ${id}.`);
        }
        return found.data;
      })();
      blobs.set(id, known);
    }
    return known;
  };

  const read: CodeReader = async (commit, path, cap, signal): Promise<FileAnswer> => {
    const root = await rootOf(commit);
    if (root === undefined) return { kind: 'noCommit' };
    const parts = path.split('/').map((part) => encoder.encode(part));
    let tree = await treeOf(root);
    for (const [index, part] of parts.entries()) {
      signal.throwIfAborted();
      // A part longer than any target names nothing an overview can point at.
      const entry = part.length <= LIMITS.argument ? tree.get(key(part)) : undefined;
      if (!entry) return { kind: 'missing' };
      const kind = kindOf(entry.mode);
      if (index < parts.length - 1) {
        // Only a folder leads anywhere: a link, a file or a submodule on the way is nothing.
        if (kind !== 'folder') return { kind: 'missing' };
        tree = await treeOf(entry.id);
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
    const found = await sizes.ask(id);
    if (found?.type !== 'blob') throw new GitError(`The repository lacks blob ${id}.`);
    const { size } = found;
    if (size > SIZE_ONLY || cap === 0) return { kind: 'file', size, bytes: new Uint8Array() };
    const data = await blobOf(id);
    if (data.length !== size) throw new GitError(`Blob ${id} changed size as it was read.`);
    return { kind: 'file', size, bytes: new Uint8Array(data.subarray(0, cap)) };
  };

  return {
    read,
    has: async (commit) => (await rootOf(commit)) !== undefined,
    close: () => {
      contents.close();
      sizes.close();
    },
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
 * A tree object's entries: each a mode, a space, a name, a NUL and the object's id, `idLength`
 * bytes of it. Names longer than any target are left out, so no long string is a key.
 */
export function parseTree(data: Buffer, idLength: number): Tree {
  const entries = new Map<string, TreeEntry>();
  for (let at = 0; at < data.length;) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space + 1);
    if (space === -1 || nul === -1 || nul + 1 + idLength > data.length) {
      throw new GitError('A tree in the repository is damaged.');
    }
    const name = data.subarray(space + 1, nul);
    if (name.length <= LIMITS.argument) {
      entries.set(key(name), {
        mode: data.subarray(at, space).toString('latin1'),
        id: data.subarray(nul + 1, nul + 1 + idLength).toString('hex'),
      });
    }
    at = nul + 1 + idLength;
  }
  return entries;
}
