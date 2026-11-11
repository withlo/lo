// A commit's files as main keeps them for a tab's tree: listed from the local copy or from GitHub,
// sent whole while there are few enough, and otherwise folder by folder as the window opens them.
// Nothing here calls Electron.

import type { FileMode, TreeEntry } from '@lo/git';
import type { TreeItem } from '@lo/github';

import {
  type Entry,
  type EntryKind,
  type Folder,
  type Listing as Sent,
  PATH_LIMIT,
  pathBytes,
  type TreePath,
} from '../contract.ts';
import { keyOf, keyOfBytes, parentKey, pathOfKey, treePathOf } from './paths.ts';

/**
 * The most files the window gets at once. Past it, it gets the root's entries, and each other
 * folder's as it's opened, so a large repository's tree costs only what's open.
 */
export const WHOLE_LIMIT = 20_000;

/** A file, symlink or submodule of the commit, with the key its path's bytes make. */
export interface Listed {
  readonly key: string;
  readonly path: TreePath;
  readonly kind: Exclude<EntryKind, 'folder'>;
}

function kindOfMode(mode: FileMode): Listed['kind'] {
  switch (mode) {
    case 'regular':
    case 'executable':
      return 'file';
    case 'symlink':
      return 'symlink';
    case 'submodule':
      return 'submodule';
    default:
      mode satisfies never;
      throw new Error(`A file mode Lo doesn't know: ${String(mode)}.`);
  }
}

/**
 * A commit's files, as the tree has them: those whose paths are no longer than `PATH_LIMIT` bytes,
 * and how many it left out, which nothing then keys a map by.
 */
export interface Listing {
  readonly files: Listed[];
  readonly omitted: number;
}

/** The files of `entries`, a commit's tree as the local copy lists it. */
export function fromLocal(entries: readonly TreeEntry[]): Listing {
  const files: Listed[] = [];
  let omitted = 0;
  for (const entry of entries) {
    if (entry.path.length > PATH_LIMIT) {
      omitted++;
      continue;
    }
    files.push({
      key: keyOfBytes(entry.path),
      path: treePathOf(entry.path),
      kind: kindOfMode(entry.mode),
    });
  }
  return { files, omitted };
}

/** The files of `items`, a commit's tree as GitHub lists it: its folders are implied. */
export function fromGithub(items: readonly TreeItem[]): Listing {
  const files: Listed[] = [];
  let omitted = 0;
  for (const item of items) {
    if (item.type === 'tree') continue;
    const path = { text: item.path };
    if (pathBytes(path) > PATH_LIMIT) {
      omitted++;
      continue;
    }
    const kind = item.type === 'commit' ? 'submodule' : item.mode === '120000' ? 'symlink' : 'file';
    files.push({ key: keyOf(path), path, kind });
  }
  return { files, omitted };
}

/** A commit's files, and its folders' entries once asked for. */
export class Files {
  readonly files: readonly Listed[];
  readonly #wholeLimit: number;
  #folders: Map<string, Entry[]> | undefined;

  /** `files`, sent whole while there are no more than `wholeLimit`. */
  constructor(files: readonly Listed[], wholeLimit: number = WHOLE_LIMIT) {
    this.files = files;
    this.#wholeLimit = wholeLimit;
  }

  /** What the window gets: every file while there are few enough, else the root's entries. */
  listing(): Sent {
    if (this.files.length <= this.#wholeLimit) {
      return { kind: 'whole', entries: this.files.map(({ path, kind }) => ({ path, kind })) };
    }
    return { kind: 'folders', root: this.folder('') ?? [] };
  }

  /** The entries of the folder whose key is `key`, `''` for the root: nothing for no folder. */
  folder(key: string): Entry[] | undefined {
    return this.#byFolder().get(key);
  }

  /** The entries of each folder of `paths` the commit has, each once, in the order asked. */
  folders(paths: readonly TreePath[]): Folder[] {
    const seen = new Set<string>();
    const found: Folder[] = [];
    for (const path of paths) {
      // No folder holds a path longer than the files the tree lists.
      if (pathBytes(path) > PATH_LIMIT) continue;
      const key = keyOf(path);
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = this.folder(key);
      if (entries) found.push({ path, entries });
    }
    return found;
  }

  /** Each folder's entries, by its key: its folders first, then its files, each in git's order. */
  #byFolder(): Map<string, Entry[]> {
    if (this.#folders) return this.#folders;
    const files = new Map<string, Entry[]>([['', []]]);
    const subfolders = new Map<string, Entry[]>([['', []]]);
    const add = (key: string): Entry[] => {
      let entries = files.get(key);
      if (entries) return entries;
      entries = [];
      files.set(key, entries);
      subfolders.set(key, []);
      const parent = parentKey(key);
      add(parent);
      subfolders.get(parent)?.push({ path: pathOfKey(key), kind: 'folder' });
      return entries;
    };
    for (const file of this.files)
      add(parentKey(file.key)).push({ path: file.path, kind: file.kind });
    const folders = new Map<string, Entry[]>();
    for (const [key, entries] of files)
      folders.set(key, [...(subfolders.get(key) ?? []), ...entries]);
    this.#folders = folders;
    return folders;
  }
}
