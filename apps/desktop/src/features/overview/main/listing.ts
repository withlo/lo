// An overview's commit as GitHub's REST API lists it, read as the overview's checks read a commit:
// which entries count, what each is, the bytes of its path, and which files main may read. Main
// reads with it. Nothing here calls Node or Electron.

import { ARTIFACT, FIGURE_TYPES, LIMITS, type TreeEntry } from '@lo/artifact';
import type { TreeItem } from '@lo/github';

import type { Entry, EntryKind } from '../contract.ts';

/** What GitHub writes in place of bytes of a path that aren't UTF-8. */
const REPLACEMENT = '\uFFFD';

/** What a tree item is, by its type and mode. */
function kindOf(item: TreeItem): EntryKind {
  switch (item.type) {
    case 'tree':
      return 'folder';
    case 'commit':
      return 'submodule';
    case 'blob':
      return item.mode === '120000' ? 'link' : 'file';
    default:
      item.type satisfies never;
      return 'file';
  }
}

/** Whether `sha` is an object's ID as GitHub writes one. */
function isObjectId(sha: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha);
}

/**
 * The entries of an overview's commit the checks look at, from GitHub's listing, in its order:
 * every one, up to one past the most an overview may hold, and `artifact.md` wherever it is. The
 * checks count no further than that, so past it a commit is too large, whatever else it holds.
 * Returns undefined when an entry has no ID GitHub would give, which isn't GitHub's listing.
 */
export function listedEntries(items: readonly TreeItem[]): Entry[] | undefined {
  const entries: Entry[] = [];
  for (const [index, item] of items.entries()) {
    if (index > LIMITS.entries && item.path !== ARTIFACT) continue;
    if (!isObjectId(item.sha)) return undefined;
    const kind = kindOf(item);
    const sized = kind === 'file' || kind === 'link';
    entries.push({
      path: item.path,
      kind,
      size: sized && item.size !== undefined ? item.size : null,
      id: item.sha,
    });
  }
  return entries;
}

/**
 * The bytes of `path`, a path as GitHub's listing writes it, as the commit stores it as far as
 * can be told: its UTF-8, with a byte that's never UTF-8 for each U+FFFD, which GitHub writes for
 * bytes that weren't. Such a path isn't UTF-8 to the checks, as it isn't in the commit.
 */
export function pathBytes(path: string): Uint8Array {
  if (!path.includes(REPLACEMENT)) return new TextEncoder().encode(path);
  const encoder = new TextEncoder();
  const parts = path.split(REPLACEMENT).map((part) => encoder.encode(part));
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0) + parts.length - 1,
  );
  let at = 0;
  for (const [index, part] of parts.entries()) {
    if (index > 0) bytes[at++] = 0xff;
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** `entries` as the overview's checks take a commit's. */
export function treeEntries(entries: readonly Entry[]): TreeEntry[] {
  return entries.map(({ path, kind, size }): TreeEntry => {
    const bytes = pathBytes(path);
    // A file or link GitHub gives no size for has none: the checks refuse such a commit.
    if (kind === 'file' || kind === 'link') return { path: bytes, kind, size: size ?? Number.NaN };
    return { path: bytes, kind };
  });
}

/**
 * Whether `path` is one an overview's files are ever read at: `artifact.md`, or a figure directly
 * in `figures/`, named with a figure's ending. A path holding U+FFFD never is, since GitHub wrote it
 * for bytes that aren't the ones the overview names.
 */
export function isReadable(path: string): boolean {
  if (path.includes(REPLACEMENT)) return false;
  if (path === ARTIFACT) return true;
  const name = path.startsWith('figures/') ? path.slice('figures/'.length) : undefined;
  if (name === undefined || name.includes('/')) return false;
  const dot = name.lastIndexOf('.');
  return dot > 0 && FIGURE_TYPES.some((type) => type === name.slice(dot + 1));
}

/**
 * The entry at `path` among `entries`, compared byte for byte, or undefined: one listed twice
 * reads as not there. Every entry is looked at, and none is ever a key, since a hostile path may
 * be long.
 */
export function entryAt<T extends Entry>(entries: readonly T[], path: string): T | undefined {
  let found: T | undefined;
  for (const each of entries) {
    if (each.path.length !== path.length || each.path !== path) continue;
    if (found !== undefined) return undefined;
    found = each;
  }
  return found;
}
