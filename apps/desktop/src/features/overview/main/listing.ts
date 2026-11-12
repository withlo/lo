// An overview's commit as GitHub's REST API lists it, read as the overview's checks read a commit:
// which entries count, what each is, the bytes of its path, and which files main may read. Main
// reads with it. Nothing here calls Node or Electron.

import { ARTIFACT, FIGURE_TYPES, LIMITS } from '@lo/artifact';
import type { TreeItem } from '@lo/github';

import type { Entry, EntryKind } from '../contract.ts';

// How the checks take a listing's entries, as the check job does too.
export { pathBytes, treeEntries } from '../jobs.ts';

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
