// Which of a tree's files the syntax index reads, and in what order: files in a language with tags,
// 1 MB at most, neither a lockfile nor marked generated, nearest the pull request's own files first,
// then path order. Nothing here calls Electron or git, so it runs under unit tests.

import type { Oid, TreeEntry } from '@lo/git';
import { taggedLanguageOfPath } from '@lo/syntax';

import { FILE_BYTES, TREE_FILES } from '../jobs.ts';

/** The longest path the index keeps, in bytes: a longer one is never a key. */
export const PATH_BYTES = 1024;

/** A file the index may read: its path, blob, the language it's read as, and its size if known. */
export interface Candidate {
  readonly path: string;
  readonly oid: Oid;
  readonly language: string;
  readonly size: number | undefined;
}

const strict = new TextDecoder('utf-8', { fatal: true });

/** `path` as text, if it's UTF-8 and short enough to keep. */
function pathText(path: Uint8Array): string | undefined {
  if (path.byteLength > PATH_BYTES) return undefined;
  try {
    return strict.decode(path);
  } catch {
    return undefined;
  }
}

/**
 * The files of a tree's listing the index may read: a file in a language with tags and not a
 * lockfile, under a path that's UTF-8 and at most {@link PATH_BYTES}, and not known to be larger
 * than 1 MB. Symlinks and submodules aren't files.
 */
export function candidates(entries: readonly TreeEntry[]): Candidate[] {
  const found: Candidate[] = [];
  for (const entry of entries) {
    if (entry.mode !== 'regular' && entry.mode !== 'executable') continue;
    if (entry.size !== undefined && entry.size > FILE_BYTES) continue;
    const path = pathText(entry.path);
    if (path === undefined) continue;
    const language = taggedLanguageOfPath(path);
    if (language === undefined) continue;
    found.push({ path, oid: entry.oid, language, size: entry.size });
  }
  return found;
}

/** An entry's path by its bytes, which say which path is which. */
const byBytes = (entry: TreeEntry) => entry.path.toString('latin1');

/**
 * The paths that differ between two trees' listings, as text: a file added, removed, or with
 * another blob or mode. With no other side, every path of `ours`.
 */
export function changedPaths(
  ours: readonly TreeEntry[],
  theirs: readonly TreeEntry[] | undefined,
): Set<string> {
  const changed = new Set<string>();
  const add = (entry: TreeEntry) => changed.add(entry.path.toString('utf8'));
  if (!theirs) {
    for (const entry of ours) add(entry);
    return changed;
  }
  const other = new Map(theirs.map((entry) => [byBytes(entry), entry]));
  for (const entry of ours) {
    const there = other.get(byBytes(entry));
    other.delete(byBytes(entry));
    if (!there || there.oid !== entry.oid || there.mode !== entry.mode) add(entry);
  }
  for (const entry of other.values()) add(entry);
  return changed;
}

/** The folder a path is in, `""` at the root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function depthOf(folder: string): number {
  if (folder === '') return 0;
  let depth = 1;
  for (const character of folder) if (character === '/') depth += 1;
  return depth;
}

/**
 * How far each folder is from the pull request's own files, for files to be read nearest first:
 * a file the pull request changes is nearest, then those in or under the folders of its files,
 * then those a folder up, and so on, so the files around what changed come before the rest of the
 * repository. `changed` holds paths as text.
 */
export function distances(changed: Iterable<string>): (path: string) => number {
  const files = new Set<string>();
  /** For each folder holding a changed file, at any depth, the shallowest such file's folder depth. */
  const shallowest = new Map<string, number>();
  for (const path of changed) {
    files.add(path);
    const folder = folderOf(path);
    const depth = depthOf(folder);
    for (let at: string | undefined = folder; at !== undefined;) {
      const known = shallowest.get(at);
      if (known === undefined || depth < known) shallowest.set(at, depth);
      at = at === '' ? undefined : folderOf(at);
    }
  }
  return (path) => {
    if (files.has(path)) return -1;
    let best = Number.POSITIVE_INFINITY;
    for (let at: string | undefined = folderOf(path); at !== undefined;) {
      const depth = shallowest.get(at);
      if (depth !== undefined) best = Math.min(best, depth - depthOf(at));
      at = at === '' ? undefined : folderOf(at);
    }
    return best;
  };
}

function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The files to read, nearest the pull request's own first, then in path order, and whether there
 * were more than `limit`.
 */
export function nearestFirst(
  files: readonly Candidate[],
  changed: Iterable<string>,
  limit = TREE_FILES,
): { chosen: Candidate[]; more: boolean } {
  const distance = distances(changed);
  const ordered = files
    .map((file) => ({ file, distance: distance(file.path) }))
    .toSorted((a, b) => a.distance - b.distance || comparePaths(a.file.path, b.file.path))
    .map(({ file }) => file);
  return { chosen: ordered.slice(0, limit), more: ordered.length > limit };
}

/** A blob's key as the index counts it: a blob read as a language. */
export function blobKey(blob: { readonly oid: string; readonly language: string }): string {
  return `${blob.oid}:${blob.language}`;
}
