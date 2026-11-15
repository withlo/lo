// Which of a tree's files the syntax index reads, and in what order: files in a language with tags,
// 1 MB at most, neither a lockfile nor marked generated, nearest the pull request's own files first,
// then in the listing's order, which is git's, by path. A tree can list hundreds of thousands of
// files, so each goes through them a stretch at a time, letting main's other work run in between.
// Nothing here calls Electron or git, so it runs under unit tests.

import { setImmediate as breathe } from 'node:timers/promises';

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

/** How many entries a stretch of work goes through before main's other work runs. */
const STRETCH = 5_000;

/** Calls `each` with every one of `items`, letting main's other work run after each stretch. */
async function inStretches<T>(items: Iterable<T>, each: (item: T) => void): Promise<void> {
  let done = 0;
  for (const item of items) {
    each(item);
    done += 1;
    if (done % STRETCH === 0) await breathe();
  }
}

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
export async function candidates(entries: readonly TreeEntry[]): Promise<Candidate[]> {
  const found: Candidate[] = [];
  await inStretches(entries, (entry) => {
    if (entry.mode !== 'regular' && entry.mode !== 'executable') return;
    if (entry.size !== undefined && entry.size > FILE_BYTES) return;
    const path = pathText(entry.path);
    if (path === undefined) return;
    const language = taggedLanguageOfPath(path);
    if (language === undefined) return;
    found.push({ path, oid: entry.oid, language, size: entry.size });
  });
  return found;
}

/** An entry's path by its bytes, which say which path is which. */
const byBytes = (entry: TreeEntry) => entry.path.toString('latin1');

/**
 * The paths that differ between two trees' listings, as text: a file added, removed, or with
 * another blob or mode. With no other side, every path of `ours`.
 */
export async function changedPaths(
  ours: readonly TreeEntry[],
  theirs: readonly TreeEntry[] | undefined,
): Promise<Set<string>> {
  const changed = new Set<string>();
  const add = (entry: TreeEntry) => changed.add(entry.path.toString('utf8'));
  if (!theirs) {
    await inStretches(ours, add);
    return changed;
  }
  const other = new Map<string, TreeEntry>();
  await inStretches(theirs, (entry) => other.set(byBytes(entry), entry));
  await inStretches(ours, (entry) => {
    const there = other.get(byBytes(entry));
    other.delete(byBytes(entry));
    if (!there || there.oid !== entry.oid || there.mode !== entry.mode) add(entry);
  });
  await inStretches(other.values(), add);
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
export async function distances(changed: Iterable<string>): Promise<(path: string) => number> {
  const files = new Set<string>();
  /** For each folder holding a changed file, at any depth, the shallowest such file's folder depth. */
  const shallowest = new Map<string, number>();
  await inStretches(changed, (path) => {
    files.add(path);
    const folder = folderOf(path);
    const depth = depthOf(folder);
    for (let at: string | undefined = folder; at !== undefined;) {
      const known = shallowest.get(at);
      if (known === undefined || depth < known) shallowest.set(at, depth);
      at = at === '' ? undefined : folderOf(at);
    }
  });
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

/**
 * The files to read, nearest the pull request's own first, then in the order given, and whether
 * there were more than `limit`.
 */
export async function nearestFirst(
  files: readonly Candidate[],
  changed: Iterable<string>,
  limit = TREE_FILES,
): Promise<{ chosen: Candidate[]; more: boolean }> {
  const distance = await distances(changed);
  // Files by how far they are, each in the order given: a few distances, so no sort of them all.
  const far = new Map<number, Candidate[]>();
  await inStretches(files, (file) => {
    const away = distance(file.path);
    const same = far.get(away);
    if (same) same.push(file);
    else far.set(away, [file]);
  });
  const chosen: Candidate[] = [];
  for (const away of [...far.keys()].toSorted((a, b) => a - b)) {
    for (const file of far.get(away) ?? []) {
      if (chosen.length >= limit) return { chosen, more: true };
      chosen.push(file);
    }
  }
  return { chosen, more: false };
}

/** A blob's key as the index counts it: a blob read as a language. */
export function blobKey(blob: { readonly oid: string; readonly language: string }): string {
  return `${blob.oid}:${blob.language}`;
}
